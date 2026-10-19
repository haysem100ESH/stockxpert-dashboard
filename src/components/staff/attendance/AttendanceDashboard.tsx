import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Calendar, CheckCircle2, Clock, XCircle, Users, ShieldCheck, ShieldAlert, AlertTriangle, Pencil, Info, Loader2, FileSpreadsheet, FileText, Download, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/db';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import ExcelJS from 'exceljs';
import jsPDF from 'jspdf';
import 'jspdf-autotable';

interface AttendanceRecord {
  id: string;
  staff_id: string;
  branch_id: string;
  date: string;
  checkin_time: string | null;
  checkout_time: string | null;
  attendance_status: string;
  checkin_face_verified: boolean | null;
  checkout_face_verified: boolean | null;
  checkin_photo: string | null;
  checkout_photo: string | null;
  verification_score: number | null;
  status_override_reason: string | null;
  status_overridden_at: string | null;
  staff_name?: string;
  branch_name?: string;
}

interface SuspiciousAlert {
  id: string;
  staff_id: string;
  alert_type: string;
  description: string;
  created_at: string;
  staff_name?: string;
}

interface StaffOption { id: string; full_name: string; }
interface BranchOption { id: string; name: string; }

export default function AttendanceDashboard() {
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [staffList, setStaffList] = useState<StaffOption[]>([]);
  const [filterBranch, setFilterBranch] = useState<string>('all');
  const [filterStaff, setFilterStaff] = useState<string>('all');
  const [filterDateFrom, setFilterDateFrom] = useState<string>('');
  const [filterDateTo, setFilterDateTo] = useState<string>('');
  const [photoModal, setPhotoModal] = useState<{ url: string; title: string } | null>(null);
  const [alerts, setAlerts] = useState<SuspiciousAlert[]>([]);
  const [editRecord, setEditRecord] = useState<AttendanceRecord | null>(null);
  const [editStatus, setEditStatus] = useState<string>('');
  const [editReason, setEditReason] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const { profile, user } = useAuth();
  const { toast } = useToast();
  const isOwner = profile?.role === 'owner';

  useEffect(() => {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const today = now.toISOString().split('T')[0];
    setFilterDateFrom(firstDay);
    setFilterDateTo(today);
    if (isOwner) fetchBranchesAndStaff();
  }, [profile]);

  useEffect(() => {
    if (filterDateFrom && filterDateTo) {
      fetchRecords();
      if (isOwner) fetchAlerts();
    }
  }, [filterBranch, filterStaff, filterDateFrom, filterDateTo]);

  const extractPhotoPath = (photoValue: string | null) => {
    if (!photoValue) return null;

    if (!photoValue.startsWith('http')) {
      const normalized = photoValue.replace(/^\/+/, '');
      return normalized.startsWith('attendance-photos/')
        ? normalized.replace('attendance-photos/', '')
        : normalized;
    }

    try {
      const parsed = new URL(photoValue);
      const marker = '/attendance-photos/';
      const markerIndex = parsed.pathname.indexOf(marker);
      if (markerIndex === -1) return null;
      return decodeURIComponent(parsed.pathname.slice(markerIndex + marker.length));
    } catch {
      return null;
    }
  };

  const getDisplayPhotoUrl = async (photoValue: string | null) => {
    if (!photoValue) return null;

    const photoPath = extractPhotoPath(photoValue);
    if (!photoPath) return photoValue;

    // Since bucket is public, use getPublicUrl directly
    const { data: publicData } = supabase.storage
      .from('attendance-photos')
      .getPublicUrl(photoPath);

    return publicData?.publicUrl || photoValue;
  };

  const fetchBranchesAndStaff = async () => {
    if (!profile?.id) return;
    const [branchRes, staffRes] = await Promise.all([
      supabase.from('pharmacy_branches').select('id, name').eq('pharmacy_owner_id', profile.id).order('name'),
      supabase.from('profiles').select('id, full_name').eq('role', 'staff'),
    ]);
    setBranches(branchRes.data || []);
    setStaffList(staffRes.data || []);
  };

  const fetchRecords = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('staff_attendance')
        .select('*')
        .gte('date', filterDateFrom)
        .lte('date', filterDateTo)
        .order('date', { ascending: false });

      if (!isOwner && user?.id) query = query.eq('staff_id', user.id);
      if (filterBranch !== 'all') query = query.eq('branch_id', filterBranch);
      if (filterStaff !== 'all') query = query.eq('staff_id', filterStaff);

      const { data, error } = await query;
      if (error) throw error;

      const staffIds = [...new Set((data || []).map((r: any) => r.staff_id))];
      const branchIds = [...new Set((data || []).map((r: any) => r.branch_id))];

      const [staffRes, branchRes] = await Promise.all([
        staffIds.length ? supabase.from('profiles').select('id, full_name').in('id', staffIds) : { data: [] },
        branchIds.length ? supabase.from('pharmacy_branches').select('id, name').in('id', branchIds) : { data: [] },
      ]);

      const staffMap: Record<string, string> = {};
      (staffRes.data || []).forEach((s: any) => { staffMap[s.id] = s.full_name; });
      const branchMap: Record<string, string> = {};
      (branchRes.data || []).forEach((b: any) => { branchMap[b.id] = b.name; });

      const enriched = (data || []).map((r: any) => ({
        ...r,
        staff_name: staffMap[r.staff_id] || 'Unknown',
        branch_name: branchMap[r.branch_id] || 'Unknown',
      }));

      const recordsWithPhotoUrls = await Promise.all(
        enriched.map(async (record: any) => {
          const [checkinPhoto, checkoutPhoto] = await Promise.all([
            getDisplayPhotoUrl(record.checkin_photo),
            getDisplayPhotoUrl(record.checkout_photo),
          ]);

          return {
            ...record,
            checkin_photo: checkinPhoto,
            checkout_photo: checkoutPhoto,
          };
        })
      );

      setRecords(recordsWithPhotoUrls);
    } catch (error) {
      console.error('Failed to fetch attendance:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchAlerts = async () => {
    try {
      let query = supabase
        .from('attendance_suspicious_alerts')
        .select('*')
        .gte('created_at', `${filterDateFrom}T00:00:00`)
        .lte('created_at', `${filterDateTo}T23:59:59`)
        .order('created_at', { ascending: false })
        .limit(20);

      const { data } = await query;
      if (data && data.length > 0) {
        const staffIds = [...new Set(data.map((a: any) => a.staff_id))];
        const { data: staffRes } = await supabase.from('profiles').select('id, full_name').in('id', staffIds);
        const staffMap: Record<string, string> = {};
        (staffRes || []).forEach((s: any) => { staffMap[s.id] = s.full_name; });

        setAlerts(data.map((a: any) => ({ ...a, staff_name: staffMap[a.staff_id] || 'Unknown' })));
      } else {
        setAlerts([]);
      }
    } catch { setAlerts([]); }
  };

  const openStatusEdit = (record: AttendanceRecord) => {
    setEditRecord(record);
    setEditStatus(record.attendance_status);
    setEditReason(record.status_override_reason || '');
  };

  const closeStatusEdit = () => {
    setEditRecord(null);
    setEditStatus('');
    setEditReason('');
  };

  const handleSaveStatus = async () => {
    if (!editRecord || !editReason.trim()) {
      toast({ title: 'Reason required', description: 'Please provide a reason for changing the status.', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from('staff_attendance')
        .update({
          attendance_status: editStatus,
          status_override_reason: editReason.trim(),
          status_overridden_by: user?.id,
          status_overridden_at: new Date().toISOString(),
        })
        .eq('id', editRecord.id);

      if (error) throw error;

      toast({ title: 'Status updated', description: `Attendance marked as ${editStatus}.` });
      closeStatusEdit();
      fetchRecords();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Failed to update status', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  // Load attendance photos (stored in Supabase Storage) in a way that works for PDF/Excel embedding.
  // - Prefer Storage.download() (avoids CORS/auth edge cases)
  // - Normalize to JPEG/PNG (jsPDF/exceljs don't support WebP)
  // - Downscale large images to keep exports fast/stable
  type SupportedExportMime = 'image/jpeg' | 'image/png';

  const blobToDataUrl = (blob: Blob): Promise<string> =>
    new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve('');
      reader.readAsDataURL(blob);
    });

  const canvasToBlob = (canvas: HTMLCanvasElement, mime: SupportedExportMime, quality = 0.82) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, quality));

  const normalizeImageForExport = async (
    inputBlob: Blob,
    opts?: { maxDimension?: number; preferredMime?: SupportedExportMime }
  ): Promise<{ dataUrl: string; mime: SupportedExportMime } | null> => {
    const maxDimension = opts?.maxDimension ?? 1600;

    const isSupported = inputBlob.type === 'image/jpeg' || inputBlob.type === 'image/png';
    const targetMime: SupportedExportMime = opts?.preferredMime ?? (isSupported ? (inputBlob.type as SupportedExportMime) : 'image/jpeg');

    // If we can't decode/resize, fall back to direct dataURL for supported types.
    try {
      // createImageBitmap supports jpeg/png/webp in modern browsers.
      const bitmap = await createImageBitmap(inputBlob);

      let { width, height } = bitmap;
      const scale = Math.min(1, maxDimension / Math.max(width, height));
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0, width, height);

      const outBlob = await canvasToBlob(canvas, targetMime, targetMime === 'image/jpeg' ? 0.82 : 1);
      if (!outBlob) return null;

      const dataUrl = await blobToDataUrl(outBlob);
      if (!dataUrl) return null;
      return { dataUrl, mime: targetMime };
    } catch {
      // Fallback: only safe for jpeg/png
      if (!isSupported) return null;
      const dataUrl = await blobToDataUrl(inputBlob);
      if (!dataUrl) return null;
      return { dataUrl, mime: inputBlob.type as SupportedExportMime };
    }
  };

  const fetchPhotoForExport = async (
    photoValue: string,
    opts?: { maxDimension?: number; preferredMime?: SupportedExportMime }
  ): Promise<{ dataUrl: string; mime: SupportedExportMime } | null> => {
    try {
      // First try download via Supabase Storage (best for private buckets / strict CORS)
      const photoPath = extractPhotoPath(photoValue);
      if (photoPath) {
        const { data, error } = await supabase.storage.from('attendance-photos').download(photoPath);
        if (!error && data) {
          return await normalizeImageForExport(data, opts);
        }
      }

      // Fallback to fetch (works for public URLs)
      const response = await fetch(photoValue);
      if (!response.ok) return null;
      const blob = await response.blob();
      return await normalizeImageForExport(blob, opts);
    } catch {
      return null;
    }
  };

  const exportToExcel = async () => {
    if (records.length === 0) {
      toast({ title: 'No Data', description: 'No attendance records to export.', variant: 'destructive' });
      return;
    }

    setExporting(true);
    try {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Attendance Report');

      // Fixed photo column width/height
      const PHOTO_COL_WIDTH = 20; // chars
      const PHOTO_ROW_HEIGHT = 80; // pts

      // Column headers
      const headers = ['Date', ...(isOwner ? ['Staff', 'Branch'] : []), 'Check-In Time', 'Check-Out Time', 'Status', 'Face In', 'Face Out', 'Check-In Photo', 'Check-Out Photo'];
      const colCount = headers.length;

      // Header styling
      const headerRow = worksheet.addRow(['Attendance Report']);
      worksheet.mergeCells(`A1:${String.fromCharCode(64 + colCount)}1`);
      headerRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E6F3E' } };
      headerRow.getCell(1).font = { color: { argb: 'FFFFFFFF' }, size: 16, bold: true };
      headerRow.getCell(1).alignment = { horizontal: 'center' };

      const dateRangeRow = worksheet.addRow([`Period: ${filterDateFrom} to ${filterDateTo}`]);
      worksheet.mergeCells(`A2:${String.fromCharCode(64 + colCount)}2`);
      dateRangeRow.getCell(1).font = { size: 12 };
      dateRangeRow.getCell(1).alignment = { horizontal: 'center' };

      const summaryRow = worksheet.addRow([`Present: ${presentCount} | Late: ${lateCount} | Absent: ${absentCount}`]);
      worksheet.mergeCells(`A3:${String.fromCharCode(64 + colCount)}3`);
      summaryRow.getCell(1).font = { size: 11 };
      summaryRow.getCell(1).alignment = { horizontal: 'center' };

      worksheet.addRow([]); // empty row

      const headerRow2 = worksheet.addRow(headers);
      headerRow2.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F9F4' } };
        cell.font = { bold: true };
        cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
      });

      // Set photo column widths
      const checkinPhotoColIdx = headers.indexOf('Check-In Photo') + 1;
      const checkoutPhotoColIdx = headers.indexOf('Check-Out Photo') + 1;
      worksheet.getColumn(checkinPhotoColIdx).width = PHOTO_COL_WIDTH;
      worksheet.getColumn(checkoutPhotoColIdx).width = PHOTO_COL_WIDTH;

      // Data rows with embedded images
      for (let i = 0; i < records.length; i++) {
        const record = records[i];
        const checkinPhotoUrl = await getDisplayPhotoUrl(record.checkin_photo);
        const checkoutPhotoUrl = await getDisplayPhotoUrl(record.checkout_photo);

        const rowData = [
          new Date(record.date).toLocaleDateString(),
          ...(isOwner ? [record.staff_name, record.branch_name] : []),
          record.checkin_time ? new Date(record.checkin_time).toLocaleTimeString() : '—',
          record.checkout_time ? new Date(record.checkout_time).toLocaleTimeString() : '—',
          record.attendance_status,
          record.checkin_face_verified === true ? 'Verified' : record.checkin_face_verified === false ? 'Failed' : '—',
          record.checkout_face_verified === true ? 'Verified' : record.checkout_face_verified === false ? 'Failed' : '—',
          '',
          '',
        ];

        const row = worksheet.addRow(rowData);
        const rowNumber = row.number;

        // Alternating row colors
        if (i % 2 === 0) {
          row.eachCell({ includeEmpty: true }, (cell, colNum) => {
            if (colNum !== checkinPhotoColIdx && colNum !== checkoutPhotoColIdx) {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9F9F9' } };
            }
          });
        }

        // Embed check-in photo
        if (checkinPhotoUrl) {
          const img = await fetchPhotoForExport(checkinPhotoUrl, { maxDimension: 900, preferredMime: 'image/jpeg' });
          if (img) {
            const base64Data = img.dataUrl.split(',')[1];
            const extension: 'jpeg' | 'png' = img.mime === 'image/png' ? 'png' : 'jpeg';
            const imageId = workbook.addImage({ base64: base64Data, extension });
            row.height = PHOTO_ROW_HEIGHT;
            worksheet.addImage(imageId, {
              tl: { col: checkinPhotoColIdx - 1 + 0.1, row: rowNumber - 1 + 0.1 } as any,
              br: { col: checkinPhotoColIdx - 0.1, row: rowNumber - 0.1 } as any,
            });
          }
        }

        // Embed check-out photo
        if (checkoutPhotoUrl) {
          const img = await fetchPhotoForExport(checkoutPhotoUrl, { maxDimension: 900, preferredMime: 'image/jpeg' });
          if (img) {
            const base64Data = img.dataUrl.split(',')[1];
            const extension: 'jpeg' | 'png' = img.mime === 'image/png' ? 'png' : 'jpeg';
            const imageId = workbook.addImage({ base64: base64Data, extension });
            row.height = PHOTO_ROW_HEIGHT;
            worksheet.addImage(imageId, {
              tl: { col: checkoutPhotoColIdx - 1 + 0.1, row: rowNumber - 1 + 0.1 } as any,
              br: { col: checkoutPhotoColIdx - 0.1, row: rowNumber - 0.1 } as any,
            });
          }
        }
      }

      // Auto-fit non-photo columns
      worksheet.columns.forEach((column, idx) => {
        if (idx + 1 !== checkinPhotoColIdx && idx + 1 !== checkoutPhotoColIdx) {
          column.width = 18;
        }
      });

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `attendance-report-${filterDateFrom}-to-${filterDateTo}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      toast({ title: 'Export Complete', description: 'Attendance report downloaded successfully.' });
    } catch (error: any) {
      toast({ title: 'Export Failed', description: error.message || 'Failed to export data.', variant: 'destructive' });
    } finally {
      setExporting(false);
    }
  };

  const exportToPDF = async () => {
    if (records.length === 0) {
      toast({ title: 'No Data', description: 'No attendance records to export.', variant: 'destructive' });
      return;
    }

    setExporting(true);
    try {
      const doc = new jsPDF({ orientation: 'landscape' });
      const pageWidth = doc.internal.pageSize.width;
      const pageHeight = doc.internal.pageSize.height;

      // Header
      doc.setFillColor(30, 111, 62);
      doc.rect(0, 0, pageWidth, 25, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(18);
      doc.text('Attendance Report', pageWidth / 2, 16, { align: 'center' });

      doc.setTextColor(0, 0, 0);
      doc.setFontSize(12);
      doc.text(`Period: ${filterDateFrom} to ${filterDateTo}`, 14, 35);
      doc.text(`Present: ${presentCount} | Late: ${lateCount} | Absent: ${absentCount}`, 14, 45);

      // Main summary table (no photo columns — photos go on separate pages)
      const tableHeaders = ['Date', ...(isOwner ? ['Staff', 'Branch'] : []), 'Check-In', 'Check-Out', 'Status', 'Face In', 'Face Out'];
      const tableData = records.map((record) => [
        new Date(record.date).toLocaleDateString(),
        ...(isOwner ? [record.staff_name ?? '—', record.branch_name ?? '—'] : []),
        record.checkin_time ? new Date(record.checkin_time).toLocaleTimeString() : '—',
        record.checkout_time ? new Date(record.checkout_time).toLocaleTimeString() : '—',
        record.attendance_status.charAt(0).toUpperCase() + record.attendance_status.slice(1),
        record.checkin_face_verified === true ? 'Verified' : record.checkin_face_verified === false ? 'Failed' : '—',
        record.checkout_face_verified === true ? 'Verified' : record.checkout_face_verified === false ? 'Failed' : '—',
      ]);

      (doc as any).autoTable({
        head: [tableHeaders],
        body: tableData,
        startY: 55,
        theme: 'grid',
        headStyles: { fillColor: [30, 111, 62], textColor: [255, 255, 255], fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [249, 249, 249] },
        margin: { left: 14, right: 14 },
      });

      // Photo pages — one record per page (check-in + check-out side by side)
      const recordsWithPhotos = records.filter((r) => r.checkin_photo || r.checkout_photo);

       for (const record of recordsWithPhotos) {
         // Use the already computed public URLs when available, but fetch via Storage.download() when possible.
         const checkinPhotoUrl = await getDisplayPhotoUrl(record.checkin_photo);
         const checkoutPhotoUrl = await getDisplayPhotoUrl(record.checkout_photo);

         const [checkinImg, checkoutImg] = await Promise.all([
           checkinPhotoUrl ? fetchPhotoForExport(checkinPhotoUrl, { maxDimension: 1800, preferredMime: 'image/jpeg' }) : Promise.resolve(null),
           checkoutPhotoUrl ? fetchPhotoForExport(checkoutPhotoUrl, { maxDimension: 1800, preferredMime: 'image/jpeg' }) : Promise.resolve(null),
         ]);

         // Skip if no images could be loaded
         if (!checkinImg && !checkoutImg) continue;

         doc.addPage();

         // Page header bar
         doc.setFillColor(30, 111, 62);
         doc.rect(0, 0, pageWidth, 18, 'F');
         doc.setTextColor(255, 255, 255);
         doc.setFontSize(13);
         const dateStr = new Date(record.date).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
         const staffLabel = isOwner ? ` — ${record.staff_name}` : '';
         doc.text(`${dateStr}${staffLabel}`, pageWidth / 2, 12, { align: 'center' });

         doc.setTextColor(0, 0, 0);
         doc.setFontSize(10);

         const imgY = 25;
         const imgH = pageHeight - imgY - 20;
         const halfW = (pageWidth - 42) / 2; // 14 margin each side + 14 gap

         const fmt = (mime: 'image/jpeg' | 'image/png') => (mime === 'image/png' ? 'PNG' : 'JPEG');

         if (checkinImg && checkoutImg) {
           // Side by side
           doc.setFontSize(11);
           doc.setFont(undefined as any, 'bold');
           doc.text('Check-In Photo', 14 + halfW / 2, imgY + 6, { align: 'center' });
           doc.setFont(undefined as any, 'normal');
           doc.addImage(checkinImg.dataUrl, fmt(checkinImg.mime) as any, 14, imgY + 10, halfW, imgH - 10);

           doc.setFont(undefined as any, 'bold');
           doc.text('Check-Out Photo', 14 + halfW + 14 + halfW / 2, imgY + 6, { align: 'center' });
           doc.setFont(undefined as any, 'normal');
           doc.addImage(checkoutImg.dataUrl, fmt(checkoutImg.mime) as any, 14 + halfW + 14, imgY + 10, halfW, imgH - 10);
         } else if (checkinImg) {
           doc.setFont(undefined as any, 'bold');
           doc.text('Check-In Photo', pageWidth / 2, imgY + 6, { align: 'center' });
           doc.setFont(undefined as any, 'normal');
           doc.addImage(checkinImg.dataUrl, fmt(checkinImg.mime) as any, 14, imgY + 10, pageWidth - 28, imgH - 10);
         } else if (checkoutImg) {
           doc.setFont(undefined as any, 'bold');
           doc.text('Check-Out Photo', pageWidth / 2, imgY + 6, { align: 'center' });
           doc.setFont(undefined as any, 'normal');
           doc.addImage(checkoutImg.dataUrl, fmt(checkoutImg.mime) as any, 14, imgY + 10, pageWidth - 28, imgH - 10);
         }
       }

      doc.save(`attendance-report-${filterDateFrom}-to-${filterDateTo}.pdf`);
      toast({ title: 'Export Complete', description: 'Attendance report with photos downloaded successfully.' });
    } catch (error: any) {
      toast({ title: 'Export Failed', description: error.message || 'Failed to export PDF.', variant: 'destructive' });
    } finally {
      setExporting(false);
    }
  };

  const presentCount = records.filter((r) => r.attendance_status === 'present').length;
  const lateCount = records.filter((r) => r.attendance_status === 'late').length;
  const absentCount = records.filter((r) => r.attendance_status === 'absent').length;

  const statusBadge = (status: string) => {
    switch (status) {
      case 'present': return <Badge variant="default">Present</Badge>;
      case 'late': return <Badge variant="secondary">Late</Badge>;
      case 'absent': return <Badge variant="destructive">Absent</Badge>;
      default: return <Badge>{status}</Badge>;
    }
  };

  const faceBadge = (verified: boolean | null) => {
    if (verified === true) return <Badge variant="outline" className="gap-1 text-xs"><ShieldCheck className="h-3 w-3" />Verified</Badge>;
    if (verified === false) return <Badge variant="destructive" className="gap-1 text-xs"><ShieldAlert className="h-3 w-3" />Failed</Badge>;
    return <span className="text-xs text-muted-foreground">—</span>;
  };

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-8 w-8 text-emerald-500" />
              <div>
                <p className="text-2xl font-bold">{presentCount}</p>
                <p className="text-sm text-muted-foreground">Present Days</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Clock className="h-8 w-8 text-amber-500" />
              <div>
                <p className="text-2xl font-bold">{lateCount}</p>
                <p className="text-sm text-muted-foreground">Late Days</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <XCircle className="h-8 w-8 text-destructive" />
              <div>
                <p className="text-2xl font-bold">{absentCount}</p>
                <p className="text-sm text-muted-foreground">Absent Days</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Suspicious Activity Alerts */}
      {isOwner && alerts.length > 0 && (
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4" />
              Suspicious Activity Alerts ({alerts.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {alerts.map((alert) => (
                <div key={alert.id} className="flex items-start gap-2 p-2 rounded bg-destructive/10 text-sm">
                  <ShieldAlert className="h-4 w-4 mt-0.5 text-destructive shrink-0" />
                  <div>
                    <span className="font-medium">{alert.staff_name}</span>
                    <span className="text-muted-foreground"> — {alert.alert_type.replace(/_/g, ' ')}</span>
                    <p className="text-xs text-muted-foreground">{alert.description}</p>
                    <p className="text-xs text-muted-foreground">{new Date(alert.created_at).toLocaleString()}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label>From Date</Label>
              <Input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>To Date</Label>
              <Input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} />
            </div>
            {isOwner && (
              <>
                <div className="space-y-2">
                  <Label>Branch</Label>
                  <Select value={filterBranch} onValueChange={setFilterBranch}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Branches</SelectItem>
                      {branches.map((b) => (
                        <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Staff</Label>
                  <Select value={filterStaff} onValueChange={setFilterStaff}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Staff</SelectItem>
                      {staffList.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.full_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Records Table */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Attendance Records
            </CardTitle>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={fetchRecords}
                disabled={loading}
                className="gap-2"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Refresh
              </Button>
              {isOwner && records.length > 0 && (
                <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={exportToExcel}
                  disabled={exporting}
                  className="gap-2"
                >
                  {exporting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <FileSpreadsheet className="h-4 w-4" />
                  )}
                  Excel
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={exportToPDF}
                  disabled={exporting}
                  className="gap-2"
                >
                  {exporting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <FileText className="h-4 w-4" />
                  )}
                  PDF
                 </Button>
                </>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground text-center py-8">Loading...</p>
          ) : records.length === 0 ? (
            <div className="text-center py-8">
              <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">No attendance records found for the selected filters.</p>
            </div>
          ) : (
            <div className="overflow-x-auto pb-2">
              <Table className="min-w-[900px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    {isOwner && <TableHead>Staff</TableHead>}
                    {isOwner && <TableHead>Branch</TableHead>}
                    <TableHead>Check-In</TableHead>
                    <TableHead>Check-Out</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Face In</TableHead>
                    <TableHead>Face Out</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Photos</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {records.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{new Date(r.date).toLocaleDateString()}</TableCell>
                      {isOwner && <TableCell>{r.staff_name}</TableCell>}
                      {isOwner && <TableCell>{r.branch_name}</TableCell>}
                      <TableCell>
                        {r.checkin_time ? new Date(r.checkin_time).toLocaleTimeString() : '—'}
                      </TableCell>
                      <TableCell>
                        {r.checkout_time ? new Date(r.checkout_time).toLocaleTimeString() : '—'}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {statusBadge(r.attendance_status)}
                          {isOwner && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0"
                              onClick={() => openStatusEdit(r)}
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                          )}
                          {r.status_override_reason && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger>
                                  <Info className="h-3 w-3 text-muted-foreground" />
                                </TooltipTrigger>
                                <TooltipContent className="max-w-xs">
                                  <p className="text-xs font-medium">Override Reason:</p>
                                  <p className="text-xs">{r.status_override_reason}</p>
                                  {r.status_overridden_at && (
                                    <p className="text-xs text-muted-foreground mt-1">
                                      Changed: {new Date(r.status_overridden_at).toLocaleString()}
                                    </p>
                                  )}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{faceBadge(r.checkin_face_verified)}</TableCell>
                      <TableCell>{faceBadge(r.checkout_face_verified)}</TableCell>
                      <TableCell>
                        {r.verification_score != null ? `${r.verification_score}%` : '—'}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          {r.checkin_photo && (
                            <img
                              src={r.checkin_photo}
                              alt="Check-in"
                              className="h-10 w-10 rounded object-cover cursor-pointer hover:opacity-80 border transition-opacity"
                              onClick={() => setPhotoModal({ url: r.checkin_photo!, title: `Check-In — ${r.staff_name || 'You'} (${new Date(r.date).toLocaleDateString()})` })}
                            />
                          )}
                          {r.checkout_photo && (
                            <img
                              src={r.checkout_photo}
                              alt="Check-out"
                              className="h-10 w-10 rounded object-cover cursor-pointer hover:opacity-80 border transition-opacity"
                              onClick={() => setPhotoModal({ url: r.checkout_photo!, title: `Check-Out — ${r.staff_name || 'You'} (${new Date(r.date).toLocaleDateString()})` })}
                            />
                          )}
                          {!r.checkin_photo && !r.checkout_photo && (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Photo Preview Modal */}
      <Dialog open={!!photoModal} onOpenChange={() => setPhotoModal(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{photoModal?.title}</DialogTitle>
          </DialogHeader>
          {photoModal?.url && (
            <img src={photoModal.url} alt="Attendance photo" className="w-full rounded-lg" />
          )}
        </DialogContent>
      </Dialog>

      {/* Status Edit Dialog */}
      <Dialog open={!!editRecord} onOpenChange={(open) => !open && closeStatusEdit()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Attendance Status</DialogTitle>
            <DialogDescription>
              Update the attendance status for {editRecord?.staff_name} on {editRecord ? new Date(editRecord.date).toLocaleDateString() : ''}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>New Status</Label>
              <Select value={editStatus} onValueChange={setEditStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="present">Present</SelectItem>
                  <SelectItem value="late">Late</SelectItem>
                  <SelectItem value="absent">Absent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Reason for Change <span className="text-destructive">*</span></Label>
              <Textarea
                value={editReason}
                onChange={(e) => setEditReason(e.target.value)}
                placeholder="e.g., Staff had permission for late arrival, medical emergency, etc."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeStatusEdit} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSaveStatus} disabled={saving || !editReason.trim()}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

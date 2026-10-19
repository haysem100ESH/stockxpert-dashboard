import { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { Download, FileText, Loader2, CalendarIcon } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { format } from 'date-fns';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import ExcelJS from 'exceljs';

interface CustomerLedgerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: string;
  customerName: string;
}

interface LedgerEntry {
  id: string;
  date: string;
  referenceId: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
  type: 'sale_credit' | 'payment' | 'manual_add' | 'manual_reduce';
  branchId?: string | null;
  branchName?: string;
}

export default function CustomerLedgerDialog({ open, onOpenChange, customerId, customerName }: CustomerLedgerDialogProps) {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined);
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [branchFilter, setBranchFilter] = useState<string>('all');

  useEffect(() => {
    if (open && customerId) {
      fetchLedger();
    }
  }, [open, customerId]);

  const fetchLedger = async () => {
    setLoading(true);
    try {
      const { data: txData, error: txErr } = await (supabase as any)
        .from('customer_credit_transactions')
        .select('id, transaction_type, amount, previous_balance, new_balance, sale_id, payment_id, notes, branch_id, created_at')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: true });

      if (txErr) throw txErr;

      const branchIds = [...new Set((txData || []).map((t: any) => t.branch_id).filter(Boolean))];
      let branchMap: Record<string, string> = {};
      if (branchIds.length > 0) {
        const { data: branchData } = await (supabase as any)
          .from('pharmacy_branches')
          .select('id, name')
          .in('id', branchIds);
        for (const b of branchData || []) {
          branchMap[b.id] = b.name;
        }
        setBranches((branchData || []).map((b: any) => ({ id: b.id, name: b.name })));
      }

      const { data: allSales } = await (supabase as any)
        .from('sales')
        .select('id, total_amount, amount_paid, payment_status, branch_id, created_at')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: true });

      const creditSaleIds = new Set((txData || []).filter((t: any) => t.sale_id).map((t: any) => t.sale_id));

      let runningBalance = 0;
      const ledgerEntries: LedgerEntry[] = [];

      const allEvents: { date: string; type: 'tx' | 'paid_sale'; data: any }[] = [];

      for (const tx of txData || []) {
        allEvents.push({ date: tx.created_at, type: 'tx', data: tx });
      }

      for (const sale of allSales || []) {
        if (!creditSaleIds.has(sale.id) && sale.payment_status === 'paid') {
          allEvents.push({ date: sale.created_at, type: 'paid_sale', data: sale });
        }
      }

      allEvents.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      for (const event of allEvents) {
        if (event.type === 'tx') {
          const tx = event.data;
          const amount = Number(tx.amount);
          let debit = 0;
          let credit = 0;
          let description = '';

          if (tx.transaction_type === 'sale_credit') {
            debit = amount;
            description = 'Credit Sale';
            if (tx.notes) description += ` — ${tx.notes}`;
          } else if (tx.transaction_type === 'payment') {
            credit = amount;
            description = 'Payment Received';
            if (tx.notes) description += ` — ${tx.notes}`;
          } else if (tx.transaction_type === 'manual_add') {
            debit = amount;
            description = 'Manual Debt Addition';
            if (tx.notes) description += ` — ${tx.notes}`;
          } else if (tx.transaction_type === 'manual_reduce') {
            credit = amount;
            description = 'Manual Debt Reduction';
            if (tx.notes) description += ` — ${tx.notes}`;
          }

          runningBalance = runningBalance + debit - credit;

          ledgerEntries.push({
            id: tx.id,
            date: tx.created_at,
            referenceId: (tx.sale_id || tx.payment_id || tx.id || '').slice(0, 8).toUpperCase(),
            description,
            debit,
            credit,
            balance: runningBalance,
            type: tx.transaction_type,
            branchId: tx.branch_id,
            branchName: tx.branch_id ? branchMap[tx.branch_id] : undefined,
          });
        } else {
          const sale = event.data;
          const totalAmount = Number(sale.total_amount);
          const refId = (sale.id || '').slice(0, 8).toUpperCase();

          runningBalance += totalAmount;
          ledgerEntries.push({
            id: sale.id + '-sale',
            date: sale.created_at,
            referenceId: refId,
            description: 'Sale (Paid in Full)',
            debit: totalAmount,
            credit: 0,
            balance: runningBalance,
            type: 'sale_credit',
            branchId: sale.branch_id,
            branchName: sale.branch_id ? branchMap[sale.branch_id] : undefined,
          });

          runningBalance -= totalAmount;
          ledgerEntries.push({
            id: sale.id + '-pay',
            date: sale.created_at,
            referenceId: refId,
            description: 'Payment at Sale',
            debit: 0,
            credit: totalAmount,
            balance: runningBalance,
            type: 'payment',
            branchId: sale.branch_id,
            branchName: sale.branch_id ? branchMap[sale.branch_id] : undefined,
          });
        }
      }

      setEntries(ledgerEntries);
    } catch {
      toast({ title: 'Error', description: 'Failed to load ledger data', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(() => {
    const result = entries.filter(e => {
      if (dateFrom && new Date(e.date) < dateFrom) return false;
      if (dateTo) {
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        if (new Date(e.date) > end) return false;
      }
      if (typeFilter !== 'all') {
        if (typeFilter === 'debit' && e.debit === 0) return false;
        if (typeFilter === 'credit' && e.credit === 0) return false;
      }
      if (branchFilter !== 'all' && e.branchId !== branchFilter) return false;
      return true;
    });
    return [...result].reverse();
  }, [entries, dateFrom, dateTo, typeFilter, branchFilter]);

  const totalPurchases = filtered.reduce((s, e) => s + e.debit, 0);
  const totalPayments = filtered.reduce((s, e) => s + e.credit, 0);
  const outstandingBalance = entries.length > 0 ? entries[entries.length - 1].balance : 0;

  const exportExcel = async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Ledger');

    const headerFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E6F3E' } };
    const evenRowFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F9F4' } };
    const border: Partial<ExcelJS.Borders> = {
      top: { style: 'thin', color: { argb: 'FFD0D5DD' } },
      bottom: { style: 'thin', color: { argb: 'FFD0D5DD' } },
      left: { style: 'thin', color: { argb: 'FFD0D5DD' } },
      right: { style: 'thin', color: { argb: 'FFD0D5DD' } },
    };

    // Title
    ws.mergeCells('A1:F1');
    const titleCell = ws.getCell('A1');
    titleCell.value = `Customer Ledger — ${customerName}`;
    titleCell.font = { size: 16, bold: true, color: { argb: 'FF1E6F3E' } };
    titleCell.alignment = { horizontal: 'center' };

    ws.mergeCells('A2:F2');
    const dateCell = ws.getCell('A2');
    dateCell.value = `Generated: ${new Date().toLocaleDateString()} | Outstanding Balance: ETB ${outstandingBalance.toFixed(2)}`;
    dateCell.font = { size: 10, color: { argb: 'FF666666' } };
    dateCell.alignment = { horizontal: 'center' };

    // Summary row
    ws.getRow(4).values = ['', 'Total Purchases (Debit)', '', 'Total Payments (Credit)', '', 'Outstanding Balance'];
    ws.getRow(5).values = ['', `ETB ${totalPurchases.toFixed(2)}`, '', `ETB ${totalPayments.toFixed(2)}`, '', `ETB ${outstandingBalance.toFixed(2)}`];
    [4, 5].forEach(r => {
      ws.getRow(r).eachCell((cell) => {
        cell.font = r === 4 ? { bold: true, size: 9, color: { argb: 'FF555555' } } : { bold: true, size: 11 };
        cell.alignment = { horizontal: 'center' };
      });
    });

    // Headers
    const headerRow = 7;
    const headers = ['Date', 'Reference', 'Description', 'Debit (ETB)', 'Credit (ETB)', 'Balance (ETB)'];
    ws.getRow(headerRow).values = headers;
    ws.getRow(headerRow).eachCell((cell) => {
      cell.fill = headerFill;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      cell.alignment = { horizontal: 'center' };
      cell.border = border;
    });

    // Data
    filtered.forEach((e, i) => {
      const row = ws.getRow(headerRow + 1 + i);
      row.values = [
        new Date(e.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
        e.referenceId,
        e.description + (e.branchName ? ` (${e.branchName})` : ''),
        e.debit > 0 ? e.debit : '',
        e.credit > 0 ? e.credit : '',
        e.balance,
      ];
      row.eachCell((cell, colNum) => {
        cell.border = border;
        cell.alignment = { horizontal: colNum >= 4 ? 'right' : 'left' };
        if (i % 2 === 0) cell.fill = evenRowFill;
        if (colNum === 4 && e.debit > 0) cell.font = { color: { argb: 'FFDC2626' } };
        if (colNum === 5 && e.credit > 0) cell.font = { color: { argb: 'FF16A34A' } };
        if (colNum === 6) cell.font = { bold: true };
        if (colNum >= 4) cell.numFmt = '#,##0.00';
      });
    });

    ws.columns = [
      { width: 16 }, { width: 12 }, { width: 40 }, { width: 15 }, { width: 15 }, { width: 15 },
    ];

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Ledger_${customerName.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
  };

  const exportPDF = () => {
    const doc = new jsPDF();

    // Title bar
    doc.setFillColor(30, 111, 62);
    doc.rect(0, 0, 210, 28, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18);
    doc.text(`Customer Ledger`, 14, 14);
    doc.setFontSize(12);
    doc.text(customerName, 14, 22);

    // Info line
    doc.setTextColor(80, 80, 80);
    doc.setFontSize(9);
    doc.text(`Generated: ${new Date().toLocaleDateString()}`, 14, 36);
    doc.text(`Outstanding Balance: ETB ${outstandingBalance.toFixed(2)}`, 120, 36);

    // Summary boxes
    const summaryY = 42;
    const boxW = 58;
    [
      { label: 'Total Purchases', value: `ETB ${totalPurchases.toFixed(2)}`, color: [220, 38, 38] },
      { label: 'Total Payments', value: `ETB ${totalPayments.toFixed(2)}`, color: [22, 163, 74] },
      { label: 'Outstanding Balance', value: `ETB ${outstandingBalance.toFixed(2)}`, color: outstandingBalance > 0 ? [220, 38, 38] : [22, 163, 74] },
    ].forEach((item, i) => {
      const x = 14 + i * (boxW + 4);
      doc.setFillColor(240, 249, 244);
      doc.roundedRect(x, summaryY, boxW, 18, 2, 2, 'F');
      doc.setTextColor(100, 100, 100);
      doc.setFontSize(8);
      doc.text(item.label, x + 4, summaryY + 7);
      doc.setTextColor(item.color[0], item.color[1], item.color[2]);
      doc.setFontSize(11);
      doc.text(item.value, x + 4, summaryY + 14);
    });

    autoTable(doc, {
      startY: 66,
      head: [['Date', 'Ref', 'Description', 'Debit (ETB)', 'Credit (ETB)', 'Balance (ETB)']],
      body: filtered.map(e => [
        new Date(e.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
        e.referenceId,
        e.description + (e.branchName ? ` (${e.branchName})` : ''),
        e.debit > 0 ? e.debit.toFixed(2) : '',
        e.credit > 0 ? e.credit.toFixed(2) : '',
        e.balance.toFixed(2),
      ]),
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [30, 111, 62], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [240, 249, 244] },
      columnStyles: {
        3: { halign: 'right', textColor: [220, 38, 38] },
        4: { halign: 'right', textColor: [22, 163, 74] },
        5: { halign: 'right', fontStyle: 'bold' },
      },
    });

    doc.save(`Ledger_${customerName.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-[900px] max-h-[90vh] overflow-y-auto p-0">
        <DialogHeader className="p-4 sm:p-6 pb-0">
          <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
            <FileText className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
            Ledger — {customerName}
          </DialogTitle>
        </DialogHeader>

        <div className="p-4 sm:p-6 pt-3 sm:pt-4 space-y-3 sm:space-y-4">
          {/* Summary Cards */}
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <Card>
              <CardContent className="p-2.5 sm:p-4">
                <p className="text-[10px] sm:text-xs text-muted-foreground font-medium">Purchases</p>
                <p className="text-sm sm:text-xl font-bold text-foreground">ETB {totalPurchases.toFixed(2)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-2.5 sm:p-4">
                <p className="text-[10px] sm:text-xs text-muted-foreground font-medium">Payments</p>
                <p className="text-sm sm:text-xl font-bold text-green-600">ETB {totalPayments.toFixed(2)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-2.5 sm:p-4">
                <p className="text-[10px] sm:text-xs text-muted-foreground font-medium">Balance</p>
                <p className={`text-sm sm:text-xl font-bold ${outstandingBalance > 0 ? 'text-destructive' : 'text-green-600'}`}>
                  ETB {outstandingBalance.toFixed(2)}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-2 items-end">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">From</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="w-[120px] sm:w-[130px] justify-start text-left font-normal text-xs sm:text-sm">
                    <CalendarIcon className="mr-1 h-3 w-3" />
                    {dateFrom ? format(dateFrom, 'MMM dd') : 'Start'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={dateFrom} onSelect={setDateFrom} />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">To</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="w-[120px] sm:w-[130px] justify-start text-left font-normal text-xs sm:text-sm">
                    <CalendarIcon className="mr-1 h-3 w-3" />
                    {dateTo ? format(dateTo, 'MMM dd') : 'End'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={dateTo} onSelect={setDateTo} />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Type</label>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="h-9 w-[100px] sm:w-[120px] text-xs sm:text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="debit">Debits</SelectItem>
                  <SelectItem value="credit">Credits</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {branches.length > 1 && (
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Branch</label>
                <Select value={branchFilter} onValueChange={setBranchFilter}>
                  <SelectTrigger className="h-9 w-[120px] sm:w-[140px] text-xs sm:text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    {branches.map(b => (
                      <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex gap-1 ml-auto">
              <Button size="sm" variant="outline" onClick={exportExcel} disabled={filtered.length === 0} className="text-xs px-2">
                <Download className="h-3 w-3 mr-1" /> Excel
              </Button>
              <Button size="sm" variant="outline" onClick={exportPDF} disabled={filtered.length === 0} className="text-xs px-2">
                <Download className="h-3 w-3 mr-1" /> PDF
              </Button>
            </div>
          </div>

          {/* Ledger Content */}
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading ledger...
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center text-muted-foreground py-12 text-sm">No ledger entries found</div>
          ) : (
            <>
              {/* Mobile card layout */}
              <div className="space-y-2 sm:hidden">
                {filtered.map((entry) => (
                  <div key={entry.id} className="border rounded-lg p-3 bg-card space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        {new Date(entry.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </span>
                      <Badge variant="outline" className="font-mono text-[10px]">{entry.referenceId}</Badge>
                    </div>
                    <p className="text-xs text-foreground leading-snug">
                      {entry.description}
                      {entry.branchName && <span className="text-muted-foreground"> ({entry.branchName})</span>}
                    </p>
                    <div className="flex items-center justify-between pt-1">
                      <div className="flex gap-3">
                        {entry.debit > 0 && (
                          <span className="text-xs">
                            <span className="text-muted-foreground">Debit: </span>
                            <span className="text-destructive font-medium">{entry.debit.toFixed(2)}</span>
                          </span>
                        )}
                        {entry.credit > 0 && (
                          <span className="text-xs">
                            <span className="text-muted-foreground">Credit: </span>
                            <span className="text-green-600 font-medium">{entry.credit.toFixed(2)}</span>
                          </span>
                        )}
                      </div>
                      <span className={`text-xs font-semibold ${entry.balance > 0 ? 'text-destructive' : 'text-green-600'}`}>
                        Bal: {entry.balance.toFixed(2)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop table */}
              <div className="hidden sm:block">
                <ScrollArea className="w-full rounded-md border">
                  <Table className="min-w-[650px]">
                    <TableHeader>
                      <TableRow className="bg-muted/40">
                        <TableHead className="font-semibold text-xs">Date</TableHead>
                        <TableHead className="font-semibold text-xs">Reference</TableHead>
                        <TableHead className="font-semibold text-xs">Description</TableHead>
                        <TableHead className="font-semibold text-xs text-right">Debit (ETB)</TableHead>
                        <TableHead className="font-semibold text-xs text-right">Credit (ETB)</TableHead>
                        <TableHead className="font-semibold text-xs text-right">Balance (ETB)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.map((entry) => (
                        <TableRow key={entry.id} className="hover:bg-muted/20">
                          <TableCell className="text-sm whitespace-nowrap">
                            {new Date(entry.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="font-mono text-xs">{entry.referenceId}</Badge>
                          </TableCell>
                          <TableCell className="text-sm max-w-[200px] truncate">
                            {entry.description}
                            {entry.branchName && (
                              <span className="text-xs text-muted-foreground ml-1">({entry.branchName})</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-sm">
                            {entry.debit > 0 ? (
                              <span className="text-destructive font-medium">{entry.debit.toFixed(2)}</span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-sm">
                            {entry.credit > 0 ? (
                              <span className="text-green-600 font-medium">{entry.credit.toFixed(2)}</span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-sm font-semibold">
                            <span className={entry.balance > 0 ? 'text-destructive' : 'text-green-600'}>
                              {entry.balance.toFixed(2)}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <ScrollBar orientation="horizontal" />
                </ScrollArea>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

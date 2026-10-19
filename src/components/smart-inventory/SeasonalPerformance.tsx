import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { SeasonalItem } from '@/hooks/useSeasonalPerformance';
import { Search, Sun, RefreshCw, Download } from 'lucide-react';
import SeasonalItemChart from './SeasonalItemChart';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import ExcelJS from 'exceljs';

interface SeasonalPerformanceProps {
  items: SeasonalItem[];
  isPharmacy: boolean;
  currentMonth: number;
  loading: boolean;
  refetch: () => void;
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function getStrengthColor(strength: number): string {
  if (strength >= 150) return 'bg-green-500/20 text-green-700 dark:text-green-400';
  if (strength >= 120) return 'bg-blue-500/20 text-blue-700 dark:text-blue-400';
  if (strength >= 80) return 'bg-muted text-foreground';
  if (strength >= 50) return 'bg-amber-500/20 text-amber-700 dark:text-amber-400';
  return 'bg-destructive/20 text-destructive';
}

export default function SeasonalPerformance({ items, isPharmacy, currentMonth, loading, refetch }: SeasonalPerformanceProps) {
  const [search, setSearch] = useState('');
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const label = isPharmacy ? 'Medicine' : 'Item';

  const filtered = items.filter(i =>
    i.name.toLowerCase().includes(search.toLowerCase()) ||
    i.category.toLowerCase().includes(search.toLowerCase())
  );

  const itemsWithSales = filtered.filter(i => i.yearlyTotal > 0);

  const exportExcel = async () => {
    const data = itemsWithSales;
    if (data.length === 0) return;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Seasonal Breakdown');
    const hFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E6F3E' } };
    const eFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F9F4' } };
    const border: Partial<ExcelJS.Borders> = {
      top: { style: 'thin', color: { argb: 'FFD0D5DD' } }, bottom: { style: 'thin', color: { argb: 'FFD0D5DD' } },
      left: { style: 'thin', color: { argb: 'FFD0D5DD' } }, right: { style: 'thin', color: { argb: 'FFD0D5DD' } },
    };
    ws.mergeCells('A1:O1');
    const t = ws.getCell('A1');
    t.value = 'Seasonal Performance — Monthly Sales Breakdown';
    t.font = { size: 16, bold: true, color: { argb: 'FF1E6F3E' } };
    t.alignment = { horizontal: 'center' };
    ws.mergeCells('A2:O2');
    const sub = ws.getCell('A2');
    sub.value = `Generated: ${new Date().toLocaleDateString()} | ${data.length} items with sales`;
    sub.font = { size: 10, color: { argb: 'FF666666' } };
    sub.alignment = { horizontal: 'center' };

    const hr = 4;
    const headers = [label + ' Name', ...SHORT_MONTHS, 'Peak Month', 'Total'];
    ws.getRow(hr).values = headers;
    ws.getRow(hr).eachCell((cell) => {
      cell.fill = hFill;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      cell.alignment = { horizontal: 'center' };
      cell.border = border;
    });
    // Highlight current month header
    const cmCell = ws.getRow(hr).getCell(currentMonth + 1);
    cmCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E8B57' } };

    data.forEach((item, i) => {
      const row = ws.getRow(hr + 1 + i);
      row.values = [
        item.name,
        ...item.monthly.map(m => m.quantity || ''),
        item.peakMonthName,
        item.yearlyTotal,
      ];
      row.eachCell((cell, colNum) => {
        cell.border = border;
        cell.alignment = { horizontal: colNum === 1 ? 'left' : 'center' };
        if (i % 2 === 0) cell.fill = eFill;
        // Bold peak month cell
        if (colNum >= 2 && colNum <= 13) {
          const mIdx = colNum - 2;
          if (item.monthly[mIdx]?.month === item.peakMonth && item.monthly[mIdx]?.quantity > 0) {
            cell.font = { bold: true, color: { argb: 'FF1E6F3E' } };
          }
        }
        if (colNum === 15) cell.font = { bold: true };
      });
    });

    ws.columns = [{ width: 22 }, ...Array(12).fill({ width: 8 }), { width: 12 }, { width: 10 }];

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `Seasonal_Breakdown_${new Date().toISOString().slice(0, 10)}.xlsx`; a.click();
  };

  const exportPDF = () => {
    const data = itemsWithSales;
    if (data.length === 0) return;
    const doc = new jsPDF('landscape');
    doc.setFillColor(30, 111, 62); doc.rect(0, 0, 297, 22, 'F');
    doc.setTextColor(255, 255, 255); doc.setFontSize(16);
    doc.text('Seasonal Performance — Monthly Sales Breakdown', 14, 14);
    doc.setTextColor(80, 80, 80); doc.setFontSize(9);
    doc.text(`Generated: ${new Date().toLocaleDateString()} | ${data.length} items`, 14, 28);

    autoTable(doc, {
      startY: 34,
      head: [[label + ' Name', ...SHORT_MONTHS, 'Peak', 'Total']],
      body: data.map(item => [
        item.name,
        ...item.monthly.map(m => m.quantity > 0 ? m.quantity.toString() : '—'),
        item.peakMonthName,
        item.yearlyTotal.toString(),
      ]),
      styles: { fontSize: 7, cellPadding: 2, halign: 'center' },
      headStyles: { fillColor: [30, 111, 62], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [240, 249, 244] },
      columnStyles: { 0: { halign: 'left', cellWidth: 40 }, 14: { fontStyle: 'bold' } },
    });
    doc.save(`Seasonal_Breakdown_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <span className="text-muted-foreground text-lg">Analyzing seasonal patterns...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Sun className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-bold">Seasonal Performance Analysis</h2>
            <p className="text-sm text-muted-foreground">
              Monthly sales patterns & seasonal demand trends
            </p>
          </div>
        </div>
        <div className="flex gap-1">
          <Button variant="outline" size="sm" onClick={exportExcel} disabled={itemsWithSales.length === 0}>
            <Download className="h-3 w-3 mr-1" /> Excel
          </Button>
          <Button variant="outline" size="sm" onClick={exportPDF} disabled={itemsWithSales.length === 0}>
            <Download className="h-3 w-3 mr-1" /> PDF
          </Button>
          <Button variant="outline" size="sm" onClick={refetch}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={`Search ${label.toLowerCase()}s...`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Monthly Sales Breakdown</CardTitle>
          <CardDescription>
            Click any row to see the trend chart. Highlighted cells show peak months.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {itemsWithSales.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">No sales history to analyze seasonal trends.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky left-0 bg-card z-10">{label} Name</TableHead>
                    {SHORT_MONTHS.map((m, i) => (
                      <TableHead
                        key={m}
                        className={`text-center text-xs min-w-[50px] ${i + 1 === currentMonth ? 'bg-primary/10 font-bold' : ''}`}
                      >
                        {m}
                      </TableHead>
                    ))}
                    <TableHead className="text-center">Peak</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {itemsWithSales.slice(0, 50).map((item) => (
                    <>
                      <TableRow
                        key={item.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setExpandedItem(expandedItem === item.id ? null : item.id)}
                      >
                        <TableCell className="sticky left-0 bg-card z-10 font-medium max-w-[160px] truncate">
                          {item.name}
                        </TableCell>
                        {item.monthly.map((m, i) => {
                          const isPeak = m.month === item.peakMonth && m.quantity > 0;
                          const strength = item.seasonalStrengths[i];
                          return (
                            <TableCell
                              key={m.month}
                              className={`text-center text-xs p-1 ${isPeak ? 'ring-2 ring-primary rounded' : ''} ${i + 1 === currentMonth ? 'bg-primary/5' : ''}`}
                            >
                              {m.quantity > 0 ? (
                                <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${getStrengthColor(strength)}`}>
                                  {m.quantity}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                          );
                        })}
                        <TableCell className="text-center">
                          <Badge variant="secondary" className="text-xs">
                            {item.peakMonthName}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-medium">{item.yearlyTotal}</TableCell>
                      </TableRow>
                      {expandedItem === item.id && (
                        <TableRow key={`${item.id}-chart`}>
                          <TableCell colSpan={15} className="p-4">
                            <SeasonalItemChart item={item} currentMonth={currentMonth} />
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

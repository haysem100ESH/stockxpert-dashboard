import { useState } from 'react';
import { useSupplierIntelligence, SupplierScore } from '@/hooks/useSupplierIntelligence';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import {
  Truck, TrendingUp, AlertTriangle, DollarSign, Award, Search,
  RefreshCw, Shield, BarChart3, Users, Download
} from 'lucide-react';
import SupplierScoreCard from './SupplierScoreCard';
import PriceComparisonTable from './PriceComparisonTable';
import SupplierDependenceChart from './SupplierDependenceChart';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import ExcelJS from 'exceljs';

export default function SupplierIntelligenceDashboard() {
  const {
    supplierScores, priceComparisons, dependenceRisks, riskySuppliers,
    loading, isPharmacy, refetch
  } = useSupplierIntelligence();
  const [search, setSearch] = useState('');

  const label = isPharmacy ? 'Medicine' : 'Item';

  const exportScoresExcel = async () => {
    if (supplierScores.length === 0) return;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Supplier Scores');
    const hFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E6F3E' } };
    const eFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F9F4' } };
    const border: Partial<ExcelJS.Borders> = {
      top: { style: 'thin', color: { argb: 'FFD0D5DD' } }, bottom: { style: 'thin', color: { argb: 'FFD0D5DD' } },
      left: { style: 'thin', color: { argb: 'FFD0D5DD' } }, right: { style: 'thin', color: { argb: 'FFD0D5DD' } },
    };

    ws.mergeCells('A1:I1');
    const t = ws.getCell('A1');
    t.value = 'Supplier Intelligence — Performance Scores';
    t.font = { size: 16, bold: true, color: { argb: 'FF1E6F3E' } };
    t.alignment = { horizontal: 'center' };
    ws.mergeCells('A2:I2');
    const sub = ws.getCell('A2');
    sub.value = `Generated: ${new Date().toLocaleDateString()} | ${supplierScores.length} suppliers | Avg Score: ${avgScore}%`;
    sub.font = { size: 10, color: { argb: 'FF666666' } };
    sub.alignment = { horizontal: 'center' };

    const hr = 4;
    const headers = ['Supplier', 'Overall Score', 'Level', 'Price (30%)', 'Delivery (25%)', 'Accuracy (25%)', 'Availability (20%)', 'Orders', 'Total Spent', 'Share %'];
    ws.getRow(hr).values = headers;
    ws.getRow(hr).eachCell((cell) => {
      cell.fill = hFill;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      cell.alignment = { horizontal: 'center' };
      cell.border = border;
    });

    supplierScores.forEach((s, i) => {
      const row = ws.getRow(hr + 1 + i);
      row.values = [s.name, s.overallScore, s.scoreLevel.charAt(0).toUpperCase() + s.scoreLevel.slice(1), s.priceScore, s.deliveryScore, s.accuracyScore, s.availabilityScore, s.totalPurchases, s.totalSpent, s.purchaseShare];
      row.eachCell((cell, colNum) => {
        cell.border = border;
        cell.alignment = { horizontal: colNum === 1 ? 'left' : 'center' };
        if (i % 2 === 0) cell.fill = eFill;
        if (colNum === 2) {
          const score = s.overallScore;
          cell.font = { bold: true, color: { argb: score >= 75 ? 'FF16A34A' : score >= 50 ? 'FF2563EB' : score >= 30 ? 'FFCA8A04' : 'FFDC2626' } };
        }
        if (colNum === 9) cell.numFmt = '#,##0';
        if (colNum === 10) cell.numFmt = '0"%"';
      });
    });

    ws.columns = [{ width: 22 }, { width: 14 }, { width: 12 }, { width: 12 }, { width: 14 }, { width: 14 }, { width: 16 }, { width: 10 }, { width: 14 }, { width: 10 }];

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `Supplier_Scores_${new Date().toISOString().slice(0, 10)}.xlsx`; a.click();
  };

  const exportScoresPDF = () => {
    if (supplierScores.length === 0) return;
    const doc = new jsPDF('landscape');
    doc.setFillColor(30, 111, 62); doc.rect(0, 0, 297, 22, 'F');
    doc.setTextColor(255, 255, 255); doc.setFontSize(16);
    doc.text('Supplier Intelligence — Performance Scores', 14, 14);
    doc.setTextColor(80, 80, 80); doc.setFontSize(9);
    doc.text(`Generated: ${new Date().toLocaleDateString()} | ${supplierScores.length} suppliers | Avg Score: ${avgScore}%`, 14, 28);

    // Summary boxes
    const sy = 32; const bw = 50;
    ([
      { label: 'Total Suppliers', value: supplierScores.length.toString() },
      { label: 'Avg Performance', value: `${avgScore}%` },
      { label: 'Items Priced', value: priceComparisons.length.toString() },
      { label: 'Risk Alerts', value: (riskySuppliers.length + dependenceRisks.length).toString() },
    ]).forEach((item, i) => {
      const x = 14 + i * (bw + 4);
      doc.setFillColor(240, 249, 244); doc.roundedRect(x, sy, bw, 14, 2, 2, 'F');
      doc.setTextColor(100, 100, 100); doc.setFontSize(7); doc.text(item.label, x + 3, sy + 5);
      doc.setTextColor(30, 111, 62); doc.setFontSize(11); doc.text(item.value, x + 3, sy + 12);
    });

    autoTable(doc, {
      startY: 52,
      head: [['Supplier', 'Score', 'Level', 'Price (30%)', 'Delivery (25%)', 'Accuracy (25%)', 'Availability (20%)', 'Orders', 'Total Spent', 'Share']],
      body: supplierScores.map(s => [
        s.name, s.overallScore.toString(),
        s.scoreLevel.charAt(0).toUpperCase() + s.scoreLevel.slice(1),
        s.priceScore.toString(), s.deliveryScore.toString(), s.accuracyScore.toString(), s.availabilityScore.toString(),
        s.totalPurchases.toString(), s.totalSpent.toLocaleString(), `${s.purchaseShare}%`,
      ]),
      styles: { fontSize: 8, cellPadding: 2.5 },
      headStyles: { fillColor: [30, 111, 62], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [240, 249, 244] },
      columnStyles: {
        1: { halign: 'center', fontStyle: 'bold' },
        2: { halign: 'center' },
        3: { halign: 'center' }, 4: { halign: 'center' }, 5: { halign: 'center' }, 6: { halign: 'center' },
        7: { halign: 'center' }, 8: { halign: 'right' }, 9: { halign: 'center' },
      },
    });
    doc.save(`Supplier_Scores_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <span className="text-muted-foreground text-lg">Analyzing supplier intelligence...</span>
      </div>
    );
  }

  const avgScore = supplierScores.length > 0
    ? Math.round(supplierScores.reduce((s, sup) => s + sup.overallScore, 0) / supplierScores.length)
    : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Truck className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-bold">Supplier Intelligence</h2>
            <p className="text-sm text-muted-foreground">
              Performance scoring, price comparison & smart purchasing
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={refetch}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Users className="h-5 w-5 text-primary" />
            </div>
            <p className="text-2xl font-bold">{supplierScores.length}</p>
            <p className="text-xs text-muted-foreground">Total Suppliers</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Award className="h-5 w-5 text-green-500" />
            </div>
            <p className="text-2xl font-bold">{avgScore}%</p>
            <p className="text-xs text-muted-foreground">Avg Performance</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <BarChart3 className="h-5 w-5 text-blue-500" />
            </div>
            <p className="text-2xl font-bold">{priceComparisons.length}</p>
            <p className="text-xs text-muted-foreground">{label}s Priced</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
            </div>
            <p className="text-2xl font-bold">{riskySuppliers.length + dependenceRisks.length}</p>
            <p className="text-xs text-muted-foreground">Risk Alerts</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="scores" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2 md:grid-cols-4 h-auto">
          <TabsTrigger value="scores" className="gap-1">
            <Award className="h-4 w-4" />
            <span className="hidden sm:inline">Scores</span>
          </TabsTrigger>
          <TabsTrigger value="prices" className="gap-1">
            <DollarSign className="h-4 w-4" />
            <span className="hidden sm:inline">Prices</span>
          </TabsTrigger>
          <TabsTrigger value="dependence" className="gap-1">
            <Shield className="h-4 w-4" />
            <span className="hidden sm:inline">Dependence</span>
          </TabsTrigger>
          <TabsTrigger value="risks" className="gap-1">
            <AlertTriangle className="h-4 w-4" />
            <span className="hidden sm:inline">Risks</span>
            {(riskySuppliers.length + dependenceRisks.length) > 0 && (
              <Badge variant="destructive" className="ml-1 text-xs h-5 px-1.5">
                {riskySuppliers.length + dependenceRisks.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="scores">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search suppliers..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <div className="flex gap-1 ml-auto">
                <Button variant="outline" size="sm" onClick={exportScoresExcel} disabled={supplierScores.length === 0}>
                  <Download className="h-3 w-3 mr-1" /> Excel
                </Button>
                <Button variant="outline" size="sm" onClick={exportScoresPDF} disabled={supplierScores.length === 0}>
                  <Download className="h-3 w-3 mr-1" /> PDF
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {supplierScores
                .filter(s => s.name.toLowerCase().includes(search.toLowerCase()))
                .map(supplier => (
                  <SupplierScoreCard key={supplier.id} supplier={supplier} />
                ))}
            </div>
            {supplierScores.length === 0 && (
              <p className="text-muted-foreground text-center py-8">No suppliers found. Add suppliers to see intelligence data.</p>
            )}
          </div>
        </TabsContent>

        <TabsContent value="prices">
          <PriceComparisonTable comparisons={priceComparisons} isPharmacy={isPharmacy} />
        </TabsContent>

        <TabsContent value="dependence">
          <SupplierDependenceChart suppliers={supplierScores} />
        </TabsContent>

        <TabsContent value="risks">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-destructive" />
                Risk Alerts
              </CardTitle>
              <CardDescription>Suppliers that need attention</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {riskySuppliers.length === 0 && dependenceRisks.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No risk alerts at this time.</p>
              ) : (
                <>
                  {riskySuppliers.map(s => (
                    <div key={`risky-${s.id}`} className="flex items-center gap-3 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                      <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
                      <div className="flex-1">
                        <p className="font-medium">{s.name}</p>
                        <p className="text-sm text-muted-foreground">
                          Low performance score ({s.overallScore}%). Consider reviewing this supplier relationship.
                        </p>
                      </div>
                      <Badge variant="destructive">Score: {s.overallScore}</Badge>
                    </div>
                  ))}
                  {dependenceRisks.map(s => (
                    <div key={`dep-${s.id}`} className="flex items-center gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                      <Shield className="h-5 w-5 text-amber-500 shrink-0" />
                      <div className="flex-1">
                        <p className="font-medium">{s.name}</p>
                        <p className="text-sm text-muted-foreground">
                          High dependence risk — {s.purchaseShare}% of your purchases come from this supplier.
                        </p>
                      </div>
                      <Badge variant="outline" className="text-amber-600">{s.purchaseShare}% share</Badge>
                    </div>
                  ))}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

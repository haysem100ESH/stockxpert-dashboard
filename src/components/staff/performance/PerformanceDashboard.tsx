import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from '@/components/ui/dialog';
import { Trophy, TrendingUp, TrendingDown, Minus, Medal, Users, Info, CalendarCheck, DollarSign, Calculator, Repeat, LineChart, Star } from 'lucide-react';
import { supabase } from '@/lib/db';
import { useAuth } from '@/hooks/useAuth';
import { useBranchContext } from '@/hooks/useBranchContext';

interface StaffPerformance {
  id: string;
  name: string;
  branch_name: string;
  attendanceScore: number;
  salesVolumeScore: number;
  consistencyScore: number;
  growthScore: number;
  overallScore: number;
  presentOnTime: number;
  lateUnder15: number;
  late15to30: number;
  lateOver30: number;
  absentDays: number;
  totalSales: number;
  prevMonthSales: number;
  trendPct: number | null; // % change vs prev month, null if no prev data
  transactionCount: number;
  rank: number;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function trendScoreFromRatio(curr: number, prev: number): { score: number; pct: number | null } {
  if (prev <= 0 && curr <= 0) return { score: 0, pct: null };
  if (prev <= 0) return { score: 60, pct: null }; // neutral when no prior data
  const ratio = curr / prev;
  const pct = (ratio - 1) * 100;
  let score = 15;
  if (ratio > 1.20) score = 100;
  else if (ratio >= 1.10) score = 85;
  else if (ratio >= 1.00) score = 75;
  else if (ratio >= 0.80) score = 55;
  else if (ratio >= 0.60) score = 35;
  return { score, pct };
}

export default function PerformanceDashboard() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const [performances, setPerformances] = useState<StaffPerformance[]>([]);
  const [loading, setLoading] = useState(true);
  const { profile } = useAuth();
  const { selectedBranch } = useBranchContext();

  useEffect(() => {
    if (profile?.id) fetchPerformance();
  }, [month, year, profile, selectedBranch]);

  const fetchPerformance = async () => {
    setLoading(true);
    try {
      const startDate = new Date(year, month, 1).toISOString().split('T')[0];
      const endDate = new Date(year, month + 1, 0).toISOString().split('T')[0];
      const startDateTime = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0)).toISOString();
      const endDateTime = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999)).toISOString();

      // Previous month window for growth trend
      const prevStartDateTime = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0)).toISOString();
      const prevEndDateTime = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)).toISOString();

      const workingDays = getWorkingDays(year, month);

      const { data: branches, error: branchesErr } = await supabase
        .from('pharmacy_branches')
        .select('id, name')
        .eq('pharmacy_owner_id', profile!.id);
      if (branchesErr) throw branchesErr;

      const branchIds = (branches || []).map((b: any) => b.id);
      const branchMap: Record<string, string> = {};
      const branchSettings: Record<string, { work_start_time?: string }> = {};
      (branches || []).forEach((b: any) => {
        branchMap[b.id] = b.name;
        branchSettings[b.id] = { work_start_time: '08:00' };
      });

      if (!branchIds.length) { setPerformances([]); setLoading(false); return; }
      const scopedBranchIds = selectedBranch && branchIds.includes(selectedBranch) ? [selectedBranch] : branchIds;

      const { data: attendanceSettings } = await supabase
        .from('branch_attendance_settings')
        .select('branch_id, work_start_time')
        .in('branch_id', scopedBranchIds);

      (attendanceSettings || []).forEach((setting: any) => {
        if (setting.branch_id) {
          branchSettings[setting.branch_id] = { work_start_time: setting.work_start_time || '08:00' };
        }
      });

      const [staffRes, salesRes, prevSalesRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, full_name, branch_id, role')
          .eq('role', 'staff')
          .in('branch_id', scopedBranchIds),
        supabase
          .from('sales')
          .select('sold_by, total_amount, branch_id')
          .in('branch_id', scopedBranchIds)
          .gte('created_at', startDateTime)
          .lte('created_at', endDateTime),
        supabase
          .from('sales')
          .select('sold_by, total_amount, branch_id')
          .in('branch_id', scopedBranchIds)
          .gte('created_at', prevStartDateTime)
          .lte('created_at', prevEndDateTime),
      ]);

      if (staffRes.error) throw staffRes.error;
      if (salesRes.error) throw salesRes.error;
      if (prevSalesRes.error) throw prevSalesRes.error;

      const staffById = new Map<string, any>();
      (staffRes.data || []).forEach((s: any) => staffById.set(s.id, s));

      const sellerBranchMap = new Map<string, string>();
      const sellerIds: string[] = Array.from(new Set<string>((salesRes.data || [])
        .map((s: any) => {
          if (s.sold_by && s.branch_id) sellerBranchMap.set(s.sold_by, s.branch_id);
          return s.sold_by;
        })
        .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)));

      const missingSellerIds = sellerIds.filter((id) => !staffById.has(id));
      if (missingSellerIds.length > 0) {
        const { data: sellerProfiles } = await supabase
          .from('profiles')
          .select('id, full_name, branch_id, role')
          .eq('role', 'staff')
          .in('id', missingSellerIds);
        (sellerProfiles || []).forEach((s: any) => staffById.set(s.id, s));
      }

      const staffData = Array.from(staffById.values());
      if (!staffData.length) { setPerformances([]); setLoading(false); return; }

      const staffIds = staffData.map((s: any) => s.id);

      const { data: attendanceRows, error: attendanceErr } = await supabase
        .from('staff_attendance')
        .select('staff_id, branch_id, attendance_status, checkin_time, date')
        .in('staff_id', staffIds)
        .gte('date', startDate)
        .lte('date', endDate);
      if (attendanceErr) throw attendanceErr;

      // Punctuality-graded attendance points per staff
      const attPoints: Record<string, number> = {};
      const attBuckets: Record<string, { onTime: number; late15: number; late30: number; lateOver30: number; absent: number }> = {};
      const initBucket = () => ({ onTime: 0, late15: 0, late30: 0, lateOver30: 0, absent: 0 });

      (attendanceRows || []).forEach((a: any) => {
        if (!attBuckets[a.staff_id]) attBuckets[a.staff_id] = initBucket();
        const bucket = attBuckets[a.staff_id];
        let pts = 0;
        if (a.attendance_status === 'present') {
          pts = 100; bucket.onTime++;
        } else if (a.attendance_status === 'late') {
          // Compute minutes late vs branch work_start_time
          const settings = branchSettings[a.branch_id] || branchSettings[sellerBranchMap.get(a.staff_id) || ''] || { work_start_time: '08:00' };
          const minutesLate = computeMinutesLate(a.checkin_time, a.date, settings.work_start_time || '08:00');
          if (minutesLate < 15) { pts = 80; bucket.late15++; }
          else if (minutesLate <= 30) { pts = 60; bucket.late30++; }
          else { pts = 30; bucket.lateOver30++; }
        } else {
          pts = 0; bucket.absent++;
        }
        attPoints[a.staff_id] = (attPoints[a.staff_id] || 0) + pts;
      });

      // Current month sales & transactions per staff
      const salesMap: Record<string, number> = {};
      const txMap: Record<string, number> = {};
      (salesRes.data || []).forEach((s: any) => {
        const sid = s.sold_by;
        if (sid && staffIds.includes(sid)) {
          salesMap[sid] = (salesMap[sid] || 0) + Number(s.total_amount || 0);
          txMap[sid] = (txMap[sid] || 0) + 1;
        }
      });

      // Previous month sales per staff (for trend)
      const prevSalesMap: Record<string, number> = {};
      (prevSalesRes.data || []).forEach((s: any) => {
        const sid = s.sold_by;
        if (sid) prevSalesMap[sid] = (prevSalesMap[sid] || 0) + Number(s.total_amount || 0);
      });

      // Per-branch averages (group staff by branch)
      const staffByBranch: Record<string, string[]> = {};
      staffData.forEach((s: any) => {
        const bid = s.branch_id || sellerBranchMap.get(s.id) || 'unknown';
        if (!staffByBranch[bid]) staffByBranch[bid] = [];
        staffByBranch[bid].push(s.id);
      });

      const branchAvgSales: Record<string, number> = {};
      const branchTopSales: Record<string, number> = {};
      const branchAvgTx: Record<string, number> = {};
      Object.entries(staffByBranch).forEach(([bid, ids]) => {
        const activeIds = ids.filter((id) => (salesMap[id] || 0) > 0 || (txMap[id] || 0) > 0);
        const denom = Math.max(activeIds.length, 1);
        const totalSales = ids.reduce((sum, id) => sum + (salesMap[id] || 0), 0);
        const totalTx = ids.reduce((sum, id) => sum + (txMap[id] || 0), 0);
        const top = ids.reduce((m, id) => Math.max(m, salesMap[id] || 0), 0);
        branchAvgSales[bid] = totalSales / denom;
        branchAvgTx[bid] = totalTx / denom;
        branchTopSales[bid] = top;
      });

      const results: StaffPerformance[] = staffData.map((s: any) => {
        const bid = s.branch_id || sellerBranchMap.get(s.id) || 'unknown';
        const bucket = attBuckets[s.id] || initBucket();
        const pts = attPoints[s.id] || 0;
        const attendanceScore = workingDays > 0
          ? clamp(Math.round((pts / (workingDays * 100)) * 100), 0, 100)
          : 0;

        const totalSales = salesMap[s.id] || 0;
        const avg = branchAvgSales[bid] || 0;
        const top = branchTopSales[bid] || 0;
        let salesVolumeScore = 0;
        if (totalSales > 0) {
          const avgComp = avg > 0 ? clamp((totalSales / avg) * 100, 0, 150) : 0;
          const topComp = top > 0 ? clamp((totalSales / top) * 100, 0, 100) : 0;
          salesVolumeScore = clamp(Math.round(avgComp * 0.6 + topComp * 0.4), 0, 100);
        }

        const txCount = txMap[s.id] || 0;
        const avgTx = branchAvgTx[bid] || 0;
        const consistencyScore = txCount > 0 && avgTx > 0
          ? clamp(Math.round((txCount / avgTx) * 100), 0, 100)
          : 0;

        const prev = prevSalesMap[s.id] || 0;
        const { score: growthScore, pct: trendPct } = trendScoreFromRatio(totalSales, prev);

        const overallScore = Math.round(
          attendanceScore * 0.35 +
          salesVolumeScore * 0.30 +
          consistencyScore * 0.20 +
          growthScore * 0.15
        );

        return {
          id: s.id,
          name: s.full_name,
          branch_name: branchMap[bid] || 'Unknown',
          attendanceScore,
          salesVolumeScore,
          consistencyScore,
          growthScore,
          overallScore: clamp(overallScore, 0, 100),
          presentOnTime: bucket.onTime,
          lateUnder15: bucket.late15,
          late15to30: bucket.late30,
          lateOver30: bucket.lateOver30,
          absentDays: bucket.absent,
          totalSales,
          prevMonthSales: prev,
          trendPct,
          transactionCount: txCount,
          rank: 0,
        };
      });

      results.sort((a, b) => b.overallScore - a.overallScore);
      results.forEach((r, i) => { r.rank = i + 1; });

      setPerformances(results);
    } catch (error) {
      console.error('Failed to fetch performance:', error);
    } finally {
      setLoading(false);
    }
  };

  const computeMinutesLate = (checkinTime: string | null, date: string, workStart: string): number => {
    if (!checkinTime) return 0;
    try {
      const checkin = new Date(checkinTime);
      const [h, m] = workStart.split(':').map(Number);
      // Build the expected start in the same day, local time of the device
      const startLocal = new Date(checkin);
      startLocal.setHours(h || 0, m || 0, 0, 0);
      const diffMin = Math.max(0, Math.round((checkin.getTime() - startLocal.getTime()) / 60000));
      return diffMin;
    } catch {
      return 0;
    }
  };

  const getWorkingDays = (year: number, month: number) => {
    let count = 0;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      const day = new Date(year, month, d).getDay();
      if (day !== 0) count++;
    }
    return count;
  };

  const getRankIcon = (rank: number) => {
    if (rank === 1) return <Trophy className="h-5 w-5 text-yellow-500" />;
    if (rank === 2) return <Medal className="h-5 w-5 text-gray-400" />;
    if (rank === 3) return <Medal className="h-5 w-5 text-amber-700" />;
    return <span className="text-sm font-medium text-muted-foreground">#{rank}</span>;
  };

  const tierBadge = (score: number) => {
    if (score >= 85) return <Badge className="bg-green-500/15 text-green-600 hover:bg-green-500/15">🟢 Excellent</Badge>;
    if (score >= 70) return <Badge className="bg-blue-500/15 text-blue-600 hover:bg-blue-500/15">🔵 Good</Badge>;
    if (score >= 50) return <Badge className="bg-yellow-500/15 text-yellow-600 hover:bg-yellow-500/15">🟡 Needs Improvement</Badge>;
    return <Badge variant="destructive">🔴 At Risk</Badge>;
  };

  const scoreColor = (score: number) => {
    if (score >= 85) return 'text-green-600';
    if (score >= 70) return 'text-blue-600';
    if (score >= 50) return 'text-yellow-600';
    return 'text-destructive';
  };

  const trendBadge = (pct: number | null) => {
    if (pct === null) return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Minus className="h-3 w-3" /> No prior data
      </span>
    );
    if (pct > 2) return (
      <span className="inline-flex items-center gap-1 text-xs text-green-600 font-medium">
        <TrendingUp className="h-3 w-3" /> +{pct.toFixed(0)}% vs last month
      </span>
    );
    if (pct < -2) return (
      <span className="inline-flex items-center gap-1 text-xs text-destructive font-medium">
        <TrendingDown className="h-3 w-3" /> {pct.toFixed(0)}% vs last month
      </span>
    );
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Minus className="h-3 w-3" /> Stable vs last month
      </span>
    );
  };

  const years = Array.from({ length: 3 }, (_, i) => now.getFullYear() - i);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 flex-wrap justify-between">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Label>Month</Label>
            <Select value={month.toString()} onValueChange={(v) => setMonth(parseInt(v))}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MONTHS.map((m, i) => (
                  <SelectItem key={i} value={i.toString()}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Label>Year</Label>
            <Select value={year.toString()} onValueChange={(v) => setYear(parseInt(v))}>
              <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                {years.map((y) => (
                  <SelectItem key={y} value={y.toString()}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <HowItWorksDialog />
      </div>

      {/* Top Performers */}
      {!loading && performances.length >= 1 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {performances.slice(0, 3).map((p) => (
            <Card key={p.id} className={p.rank === 1 ? 'border-yellow-500/50 bg-yellow-500/5' : ''}>
              <CardContent className="pt-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {getRankIcon(p.rank)}
                    <div>
                      <p className="font-semibold">{p.name}</p>
                      <p className="text-xs text-muted-foreground">{p.branch_name}</p>
                    </div>
                  </div>
                  {tierBadge(p.overallScore)}
                </div>

                <div>
                  <div className="flex items-end justify-between">
                    <span className="text-xs text-muted-foreground">Overall</span>
                    <span className={`text-3xl font-bold ${scoreColor(p.overallScore)}`}>{p.overallScore}%</span>
                  </div>
                  <Progress value={p.overallScore} className="h-2 mt-1" />
                  <div className="mt-2">{trendBadge(p.trendPct)}</div>
                </div>

                <div className="space-y-2 pt-1">
                  <PillarRow label="Attendance" value={p.attendanceScore} />
                  <PillarRow label="Sales Volume" value={p.salesVolumeScore} />
                  <PillarRow label="Consistency" value={p.consistencyScore} />
                  <PillarRow label="Growth" value={p.growthScore} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Full Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Staff Performance Rankings — {MONTHS[month]} {year}
          </CardTitle>
          <CardDescription>
            Attendance 35% · Sales Volume 30% · Consistency 20% · Growth Trend 15%
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-center py-8 text-muted-foreground">Loading...</p>
          ) : performances.length === 0 ? (
            <div className="text-center py-8">
              <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">No staff performance data for this period.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">Rank</TableHead>
                    <TableHead>Staff</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead className="text-right">Attendance</TableHead>
                    <TableHead className="text-right">Sales</TableHead>
                    <TableHead className="text-right">Sales Score</TableHead>
                    <TableHead className="text-center">Tx</TableHead>
                    <TableHead className="text-right">Consistency</TableHead>
                    <TableHead className="text-right">Growth</TableHead>
                    <TableHead className="text-right">Overall</TableHead>
                    <TableHead>Tier</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {performances.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{getRankIcon(p.rank)}</TableCell>
                      <TableCell className="font-medium">
                        <div>{p.name}</div>
                        <div className="mt-0.5">{trendBadge(p.trendPct)}</div>
                      </TableCell>
                      <TableCell>{p.branch_name}</TableCell>
                      <TableCell className={`text-right font-medium ${scoreColor(p.attendanceScore)}`}>
                        {p.attendanceScore}%
                      </TableCell>
                      <TableCell className="text-right">{p.totalSales.toLocaleString()}</TableCell>
                      <TableCell className={`text-right font-medium ${scoreColor(p.salesVolumeScore)}`}>
                        {p.salesVolumeScore}%
                      </TableCell>
                      <TableCell className="text-center">{p.transactionCount}</TableCell>
                      <TableCell className={`text-right font-medium ${scoreColor(p.consistencyScore)}`}>
                        {p.consistencyScore}%
                      </TableCell>
                      <TableCell className={`text-right font-medium ${scoreColor(p.growthScore)}`}>
                        {p.growthScore}%
                      </TableCell>
                      <TableCell className={`text-right font-bold ${scoreColor(p.overallScore)}`}>
                        {p.overallScore}%
                      </TableCell>
                      <TableCell>{tierBadge(p.overallScore)}</TableCell>
                    </TableRow>
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

function PillarRow({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex justify-between text-xs mb-0.5">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{value}%</span>
      </div>
      <Progress value={value} className="h-1.5" />
    </div>
  );
}

function HowItWorksDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Info className="h-4 w-4" />
          How it works
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-yellow-500" />
            How Staff Performance is Scored
          </DialogTitle>
          <DialogDescription>
            Each staff member gets an <strong>Overall Score (0–100%)</strong> from four weighted pillars.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Pillar 1 */}
          <div className="rounded-lg border p-4 bg-muted/30">
            <div className="flex items-center gap-2 mb-2">
              <CalendarCheck className="h-5 w-5 text-primary" />
              <h3 className="font-semibold">1. Attendance & Punctuality · 35%</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              From check-in records. Working days exclude Sundays. Late minutes are measured against the
              branch's <code>work_start_time</code>.
            </p>
            <div className="grid grid-cols-5 gap-2 text-center text-xs">
              <div className="rounded-md bg-green-500/10 p-2">
                <div className="font-bold text-green-600">On time</div>
                <div className="text-muted-foreground">100 pts</div>
              </div>
              <div className="rounded-md bg-yellow-500/10 p-2">
                <div className="font-bold text-yellow-600">&lt; 15 min</div>
                <div className="text-muted-foreground">80 pts</div>
              </div>
              <div className="rounded-md bg-yellow-500/10 p-2">
                <div className="font-bold text-yellow-700">15–30 min</div>
                <div className="text-muted-foreground">60 pts</div>
              </div>
              <div className="rounded-md bg-orange-500/10 p-2">
                <div className="font-bold text-orange-600">&gt; 30 min</div>
                <div className="text-muted-foreground">30 pts</div>
              </div>
              <div className="rounded-md bg-destructive/10 p-2">
                <div className="font-bold text-destructive">Absent</div>
                <div className="text-muted-foreground">0 pts</div>
              </div>
            </div>
            <div className="mt-3 rounded-md bg-background border p-2 text-xs font-mono">
              Attendance % = Σ daily points ÷ (workingDays × 100) × 100
            </div>
          </div>

          {/* Pillar 2 */}
          <div className="rounded-lg border p-4 bg-muted/30">
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="h-5 w-5 text-primary" />
              <h3 className="font-semibold">2. Sales Volume · 30%</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              Hybrid score: <strong>60%</strong> vs branch average, <strong>40%</strong> vs the top performer.
              Average performers land near a fair baseline; excellence is still rewarded.
            </p>
            <div className="rounded-md bg-background border p-2 text-xs font-mono">
              Sales % = (staffSales ÷ branchAvg × 60%) + (staffSales ÷ topPerformer × 40%)
            </div>
          </div>

          {/* Pillar 3 */}
          <div className="rounded-lg border p-4 bg-muted/30">
            <div className="flex items-center gap-2 mb-2">
              <Repeat className="h-5 w-5 text-primary" />
              <h3 className="font-semibold">3. Sales Consistency · 20%</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              Number of transactions (customers served) vs branch average. Rewards steady customer
              throughput, not just one big order.
            </p>
            <div className="rounded-md bg-background border p-2 text-xs font-mono">
              Consistency % = staffTransactions ÷ branchAvgTransactions × 100
            </div>
          </div>

          {/* Pillar 4 */}
          <div className="rounded-lg border p-4 bg-muted/30">
            <div className="flex items-center gap-2 mb-2">
              <LineChart className="h-5 w-5 text-primary" />
              <h3 className="font-semibold">4. Growth Trend · 15%</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              Compares current month sales to the previous month. New staff get a neutral 60%
              until their second month.
            </p>
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-md bg-green-500/10 p-2"><div className="font-bold text-green-600">&gt; +20%</div><div className="text-muted-foreground">100</div></div>
              <div className="rounded-md bg-green-500/10 p-2"><div className="font-bold text-green-600">+10–20%</div><div className="text-muted-foreground">85</div></div>
              <div className="rounded-md bg-blue-500/10 p-2"><div className="font-bold text-blue-600">0–10%</div><div className="text-muted-foreground">75</div></div>
              <div className="rounded-md bg-yellow-500/10 p-2"><div className="font-bold text-yellow-600">0 to −20%</div><div className="text-muted-foreground">55</div></div>
              <div className="rounded-md bg-orange-500/10 p-2"><div className="font-bold text-orange-600">−20 to −40%</div><div className="text-muted-foreground">35</div></div>
              <div className="rounded-md bg-destructive/10 p-2"><div className="font-bold text-destructive">&lt; −40%</div><div className="text-muted-foreground">15</div></div>
            </div>
          </div>

          {/* Overall */}
          <div className="rounded-lg border-2 border-primary/40 p-4 bg-primary/5">
            <div className="flex items-center gap-2 mb-2">
              <Calculator className="h-5 w-5 text-primary" />
              <h3 className="font-semibold">Overall Score</h3>
            </div>
            <div className="rounded-md bg-background border p-2 text-xs font-mono">
              Overall = Attendance×0.35 + SalesVolume×0.30 + Consistency×0.20 + Growth×0.15
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <Badge className="bg-green-500/15 text-green-600 hover:bg-green-500/15">≥ 85% Excellent</Badge>
              <Badge className="bg-blue-500/15 text-blue-600 hover:bg-blue-500/15">70–84% Good</Badge>
              <Badge className="bg-yellow-500/15 text-yellow-600 hover:bg-yellow-500/15">50–69% Needs Improvement</Badge>
              <Badge variant="destructive">&lt; 50% At Risk</Badge>
            </div>
          </div>

          {/* Example */}
          <div className="rounded-lg border p-4">
            <div className="flex items-center gap-2 mb-2">
              <Star className="h-4 w-4 text-yellow-500" />
              <h4 className="font-semibold text-sm">Quick Example</h4>
            </div>
            <p className="text-xs text-muted-foreground">
              22 on-time + 2 late (10 min) + 2 absent out of 26 working days. Sales 60,000 vs branch
              avg 50,000 and top performer 90,000. Transactions 120 vs avg 100. Previous month 48,000.
            </p>
            <ul className="text-xs mt-2 space-y-1 list-disc pl-5">
              <li>Attendance = (22×100 + 2×80 + 2×0) ÷ (26×100) × 100 = <strong>91%</strong></li>
              <li>Sales Volume = (60k÷50k × 60%) + (60k÷90k × 40%) ≈ <strong>99%</strong></li>
              <li>Consistency = 120÷100 × 100 = <strong>100%</strong></li>
              <li>Growth = 60k÷48k = 1.25 → <strong>100</strong></li>
              <li>Overall = 91×0.35 + 99×0.30 + 100×0.20 + 100×0.15 = <strong>97%</strong> · 🟢 Excellent</li>
            </ul>
          </div>

          {/* Simple Story Section */}
          <div className="rounded-xl border-2 border-amber-200 dark:border-amber-900/40 bg-gradient-to-br from-amber-50 via-orange-50/50 to-yellow-50 dark:from-amber-950/30 dark:via-orange-950/20 dark:to-yellow-950/30 p-5 space-y-4 shadow-sm">
            <div>
              <h3 className="text-lg font-bold text-amber-900 dark:text-amber-200">📖 A Simple Example to Understand Scoring</h3>
              <p className="text-sm text-amber-950/80 dark:text-amber-100/80 mt-1">
                Imagine your branch has 3 staff members selling in the same month:
              </p>
            </div>

            {/* Leaderboard */}
            <div className="rounded-lg bg-white/70 dark:bg-background/40 border border-amber-200/60 dark:border-amber-900/30 overflow-hidden">
              <div className="px-4 py-2 bg-amber-100/70 dark:bg-amber-900/30 text-xs font-semibold uppercase tracking-wide text-amber-900 dark:text-amber-200">
                🏆 This Month's Leaderboard
              </div>
              <div className="divide-y divide-amber-100 dark:divide-amber-900/30">
                <div className="flex items-center justify-between px-4 py-2.5">
                  <span className="flex items-center gap-2 text-sm font-medium">🥇 👩 Sara</span>
                  <span className="font-mono font-semibold text-amber-900 dark:text-amber-200">ETB 90,000</span>
                </div>
                <div className="flex items-center justify-between px-4 py-2.5">
                  <span className="flex items-center gap-2 text-sm font-medium">🥈 👨 John</span>
                  <span className="font-mono font-semibold">ETB 60,000</span>
                </div>
                <div className="flex items-center justify-between px-4 py-2.5">
                  <span className="flex items-center gap-2 text-sm font-medium">🥉 👩 Mia</span>
                  <span className="font-mono font-semibold">ETB 30,000</span>
                </div>
              </div>
            </div>

            {/* Two Bars */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg bg-white/70 dark:bg-background/40 border border-amber-200/60 dark:border-amber-900/30 p-3">
                <div className="font-semibold text-sm">🏪 Branch Average</div>
                <div className="text-xs text-muted-foreground italic">"The Fair Bar"</div>
                <div className="mt-2 text-xs font-mono bg-amber-100/60 dark:bg-amber-900/30 rounded px-2 py-1">
                  (90k + 60k + 30k) ÷ 3 = <strong>ETB 60,000</strong>
                </div>
                <p className="text-xs mt-2 text-muted-foreground">
                  A normal, solid month at this branch. Asks: <em>"Did you pull your weight?"</em>
                </p>
              </div>
              <div className="rounded-lg bg-white/70 dark:bg-background/40 border border-amber-200/60 dark:border-amber-900/30 p-3">
                <div className="font-semibold text-sm">🏆 Top Performer</div>
                <div className="text-xs text-muted-foreground italic">"The Excellence Bar"</div>
                <div className="mt-2 text-xs font-mono bg-amber-100/60 dark:bg-amber-900/30 rounded px-2 py-1">
                  Sara → <strong>ETB 90,000</strong>
                </div>
                <p className="text-xs mt-2 text-muted-foreground">
                  The highest bar anyone reached. Asks: <em>"Did you go above and beyond?"</em>
                </p>
              </div>
            </div>

            {/* Step-by-step for John */}
            <div className="rounded-lg bg-white/70 dark:bg-background/40 border border-amber-200/60 dark:border-amber-900/30 p-4 space-y-3">
              <div className="font-semibold text-sm">🧮 Let's score John (ETB 60,000):</div>

              <div className="rounded-md bg-amber-50 dark:bg-amber-950/40 border border-amber-200/60 dark:border-amber-900/40 p-3">
                <div className="text-xs font-semibold mb-1">Step 1 — Against Branch Average (60% of sales pillar)</div>
                <div className="text-xs font-mono">60,000 ÷ 60,000 × 100 = <strong>100%</strong></div>
                <div className="text-xs text-muted-foreground mt-1">→ Exactly average. Fair and solid.</div>
              </div>

              <div className="rounded-md bg-amber-50 dark:bg-amber-950/40 border border-amber-200/60 dark:border-amber-900/40 p-3">
                <div className="text-xs font-semibold mb-1">Step 2 — Against Top Performer (40% of sales pillar)</div>
                <div className="text-xs font-mono">60,000 ÷ 90,000 × 100 = <strong>66.7%</strong></div>
                <div className="text-xs text-muted-foreground mt-1">→ Below Sara, but that's okay.</div>
              </div>

              <div className="rounded-md bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-900/40 p-3">
                <div className="text-xs font-semibold mb-1">Step 3 — John's Final Sales Volume Score</div>
                <div className="text-xs font-mono">(100% × 60%) + (66.7% × 40%) = 60 + 26.7 = <strong className="text-green-700 dark:text-green-400">86.7%</strong></div>
              </div>
            </div>


            {/* Closing callout */}
            <div className="rounded-lg bg-gradient-to-r from-amber-100 to-yellow-100 dark:from-amber-900/40 dark:to-yellow-900/40 border-l-4 border-amber-500 dark:border-amber-400 p-4">
              <p className="text-sm text-amber-950 dark:text-amber-100 leading-relaxed">
                <span className="text-lg">💡</span> The <strong>branch average</strong> asks <em>"did you carry your share?"</em> The <strong>top performer</strong> comparison asks <em>"did you excel?"</em> Your <strong>Sales Volume</strong> score blends both — so solid performers are recognized, and exceptional ones still shine.
              </p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

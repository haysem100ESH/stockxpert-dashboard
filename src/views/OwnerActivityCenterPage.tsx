import { useEffect, useState } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import Leaderboard, { type LeaderboardRange } from '@/components/activity/Leaderboard';
import GoalManager from '@/components/activity/GoalManager';
import ActivityRowItem from '@/components/activity/ActivityRowItem';
import { useActivityFeed } from '@/hooks/useActivityFeed';
import { toast } from '@/hooks/use-toast';

interface StaffPick { id: string; full_name: string | null }

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function StaffActivityDrawer({ staff, range, onClose }: { staff: StaffPick | null; range: LeaderboardRange | null; onClose: () => void }) {
  const isAllTime = !range?.from && !range?.to;
  const { rows, loading } = useActivityFeed({ userId: staff?.id, limit: isAllTime ? 1000 : 200, from: range?.from, to: range?.to });

  const grouped = (() => {
    if (!isAllTime) return null;
    const byYear = new Map<number, Map<number, typeof rows>>();
    for (const r of rows) {
      const d = new Date(r.created_at);
      const y = d.getFullYear();
      const m = d.getMonth();
      if (!byYear.has(y)) byYear.set(y, new Map());
      const months = byYear.get(y)!;
      if (!months.has(m)) months.set(m, [] as any);
      (months.get(m) as any).push(r);
    }
    return Array.from(byYear.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([year, months]) => ({
        year,
        months: Array.from(months.entries()).sort((a, b) => b[0] - a[0]).map(([m, items]) => ({ month: m, items })),
      }));
  })();

  return (
    <Sheet open={!!staff} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{staff?.full_name || 'Staff'} — Activity</SheetTitle>
          <p className="text-xs text-muted-foreground">{range?.label || 'All Time'}</p>
        </SheetHeader>
        <div className="mt-4 space-y-2">
          {loading && <div className="text-sm text-muted-foreground">Loading…</div>}
          {!loading && rows.length === 0 && <div className="text-sm text-muted-foreground">No activity yet.</div>}
          {!loading && !isAllTime && rows.map((r) => <ActivityRowItem key={r.id} row={r} />)}
          {!loading && isAllTime && grouped && grouped.map((y, yi) => (
            <Collapsible key={y.year} defaultOpen={yi === 0} className="space-y-2">
              <CollapsibleTrigger className="group sticky top-0 z-10 -mx-1 flex w-[calc(100%+0.5rem)] items-center gap-2 px-1 py-1.5 bg-background/95 backdrop-blur border-b hover:bg-muted/40 transition-colors">
                <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=closed]:-rotate-90" />
                <span className="text-base font-bold tracking-tight">{y.year}</span>
                <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">
                  {y.months.reduce((s, m) => s + (m.items as any).length, 0)} actions
                </span>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-3 data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up">
                {y.months.map((mo, mi) => (
                  <Collapsible key={mo.month} defaultOpen={yi === 0 && mi === 0} className="space-y-1.5">
                    <CollapsibleTrigger className="group flex w-full items-center gap-2 pl-1 hover:opacity-80 transition-opacity">
                      <ChevronDown className="h-3 w-3 text-muted-foreground transition-transform group-data-[state=closed]:-rotate-90" />
                      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {MONTH_NAMES[mo.month]}
                      </span>
                      <div className="h-px flex-1 bg-border" />
                      <span className="text-[10px] tabular-nums text-muted-foreground">{(mo.items as any).length}</span>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="space-y-2 data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up">
                      {(mo.items as any).map((r: any) => <ActivityRowItem key={r.id} row={r} />)}
                    </CollapsibleContent>
                  </Collapsible>
                ))}
              </CollapsibleContent>
            </Collapsible>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default function OwnerActivityCenterPage() {
  const { profile } = useAuth();
  const [selected, setSelected] = useState<StaffPick | null>(null);
  const [selectedRange, setSelectedRange] = useState<LeaderboardRange | null>(null);

  // Goal completion notifications
  useEffect(() => {
    if (!profile || profile.role !== 'owner') return;
    const ch = (supabase as any)
      .channel(`owner-goal-completions-${profile.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'staff_goal_completions' }, async (payload: any) => {
        const r = payload.new;
        if (r.owner_id !== profile.id) return;
        const [{ data: g }, { data: s }] = await Promise.all([
          (supabase as any).from('staff_goals').select('name').eq('id', r.goal_id).maybeSingle(),
          (supabase as any).from('profiles').select('full_name, branch_id').eq('id', r.staff_id).maybeSingle(),
        ]);
        const time = new Date(r.completed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        toast({
          title: '🎯 Goal Completed',
          description: `${(s as any)?.full_name || 'A staff'} completed ${(g as any)?.name || 'a goal'} at ${time}`,
        });
      })
      .subscribe();
    return () => { (supabase as any).removeChannel(ch); };
  }, [profile]);

  if (profile?.role !== 'owner') return <div className="p-6">Only owners can view this page.</div>;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">Activity Center</h1>
        <p className="text-sm text-muted-foreground">Monitor your team's productivity in real time.</p>
      </div>

      <Leaderboard onSelectStaff={(s, range) => { setSelected({ id: s.id, full_name: s.full_name }); setSelectedRange(range); }} />

      <GoalManager />

      <StaffActivityDrawer staff={selected} range={selectedRange} onClose={() => setSelected(null)} />
    </div>
  );
}

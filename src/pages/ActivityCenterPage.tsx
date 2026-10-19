import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { CalendarIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { useActivityFeed } from '@/hooks/useActivityFeed';
import { useActivityCounts } from '@/hooks/useActivityCounts';
import { useStaffGoals, type StaffGoal } from '@/hooks/useStaffGoals';
import ActivityRowItem from '@/components/activity/ActivityRowItem';
import GoalProgressCard from '@/components/activity/GoalProgressCard';
import GoalCompletionModal from '@/components/activity/GoalCompletionModal';
import { cn } from '@/lib/utils';
import { usePendingActivities } from '@/hooks/usePendingActivities';
import { pendingActivityCounts } from '@/lib/offline/activity';

export default function ActivityCenterPage() {
  const [date, setDate] = useState<Date>(new Date());
  const [celebrating, setCelebrating] = useState<StaffGoal | null>(null);

  const { counts, cacheMissing: countsMissing } = useActivityCounts();
  const { myGoals, loading: goalsLoading } = useStaffGoals();
  const goals = myGoals();
  const { rows: serverRows, loading, banner, cacheMissing } = useActivityFeed({ date });
  const from = new Date(date); from.setHours(0, 0, 0, 0);
  const to = new Date(from); to.setDate(to.getDate() + 1);
  const pending = usePendingActivities(serverRows);
  const pendingCounts = pendingActivityCounts(pending);
  const rows = [...serverRows, ...pending.filter(row => +new Date(row.created_at) >= +from && +new Date(row.created_at) < +to)]
    .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));

  const grouped = useMemo(() => {
    const map = new Map<string, typeof rows>();
    for (const r of rows) {
      const h = format(new Date(r.created_at), 'p').replace(/:\d+/, '');
      const key = format(new Date(r.created_at), 'HH:00');
      const arr = map.get(key) ?? [];
      arr.push(r);
      map.set(key, arr);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [rows]);

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">Activity Center</h1>
        <p className="text-sm text-muted-foreground">Track everything you do across the system, in real time.</p>
      </div>

      {banner && <div role="status" className="border border-border bg-muted/40 p-3 text-sm text-muted-foreground">{banner}</div>}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Today',      value: counts.today, pending: pendingCounts.today },
          { label: 'This Week',  value: counts.week, pending: pendingCounts.week },
          { label: 'This Month', value: counts.month, pending: pendingCounts.month },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">{s.label}</div>
              <div className="flex flex-wrap items-baseline gap-2 mt-1"><span className="text-3xl font-bold tabular-nums">{countsMissing ? '—' : s.value}</span>{s.pending > 0 && <span className="text-xs text-muted-foreground">+{s.pending} pending</span>}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {goals.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Your Goals</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {goals.map((g) => (
              <GoalProgressCard key={g.id} goal={g} onComplete={setCelebrating} />
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Activity Log</h2>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className={cn('justify-start text-left font-normal', !date && 'text-muted-foreground')}>
              <CalendarIcon className="h-4 w-4 mr-2" />
              {date ? format(date, 'PP') : 'Pick a date'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <Calendar mode="single" selected={date} onSelect={(d) => d && setDate(d)} initialFocus className="p-3 pointer-events-auto" />
          </PopoverContent>
        </Popover>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : rows.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">{cacheMissing ? 'This date was not loaded before going offline.' : 'No activities on this date.'}</CardContent></Card>
      ) : (
        <div className="space-y-4">
          {grouped.map(([hour, items]) => (
            <div key={hour} className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">{hour}</div>
              <div className="space-y-2">
                {items.map((r) => <ActivityRowItem key={r.id} row={r} />)}
              </div>
            </div>
          ))}
        </div>
      )}

      <GoalCompletionModal goal={celebrating} onClose={() => setCelebrating(null)} />
    </div>
  );
}

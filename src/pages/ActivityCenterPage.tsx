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

export default function ActivityCenterPage() {
  const [date, setDate] = useState<Date>(new Date());
  const [celebrating, setCelebrating] = useState<StaffGoal | null>(null);

  const { counts } = useActivityCounts();
  const { myGoals, loading: goalsLoading } = useStaffGoals();
  const goals = myGoals();
  const { rows, loading } = useActivityFeed({ date });

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

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Today',      value: counts.today },
          { label: 'This Week',  value: counts.week },
          { label: 'This Month', value: counts.month },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">{s.label}</div>
              <div className="text-3xl font-bold tabular-nums mt-1">{s.value}</div>
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
        <Card><CardContent className="p-8 text-center text-muted-foreground">No activities on this date.</CardContent></Card>
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

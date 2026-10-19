import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Trophy, Sparkles } from 'lucide-react';
import { useGoalProgress } from '@/hooks/useGoalProgress';
import type { StaffGoal } from '@/hooks/useStaffGoals';
import { cn } from '@/lib/utils';

interface Props {
  goal: StaffGoal;
  onComplete?: (g: StaffGoal) => void;
}

export default function GoalProgressCard({ goal, onComplete }: Props) {
  const p = useGoalProgress(goal, onComplete);
  const isDone = p.count >= p.target;

  return (
    <Card className={cn('overflow-hidden transition-all', isDone && 'border-emerald-500/40 shadow-[0_0_0_1px_hsl(var(--primary)/0.25)]')}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              {goal.goal_type === 'daily' && 'Daily Goal'}
              {goal.goal_type === 'weekly' && 'Weekly Goal'}
              {goal.goal_type === 'monthly' && 'Monthly Goal'}
              {goal.goal_type === 'custom' && 'Custom Goal'}
            </div>
            <div className="font-semibold flex items-center gap-2">
              {goal.name}
              {isDone && <Badge variant="default" className="bg-emerald-600 hover:bg-emerald-600"><Trophy className="h-3 w-3 mr-1" /> Done</Badge>}
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold tabular-nums">{p.count}<span className="text-sm text-muted-foreground"> / {p.target}</span></div>
            <div className="text-xs text-muted-foreground">{p.percent}% complete</div>
          </div>
        </div>
        <Progress value={Math.min(100, p.percent)} className={cn('h-2 transition-all duration-500', isDone && '[&>div]:bg-emerald-500')} />
        {p.bonus > 0 && (
          <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
            <Sparkles className="h-4 w-4" />
            <span><span className="font-semibold">+{p.bonus}</span> bonus activities ({p.bonusPercent}% over target)</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

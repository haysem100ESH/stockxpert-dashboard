import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { TrendingUp, TrendingDown, ArrowRight, Turtle } from 'lucide-react';
import { SmartItem } from '@/hooks/useSmartInventory';
import { cn } from '@/lib/utils';

export function TrendIndicator({ item, className }: { item: SmartItem; className?: string }) {
  const { trendDirection, trendPercent, isSlowMover } = item;
  const colorClass =
    trendDirection === 'up' ? 'text-green-600 dark:text-green-400'
    : trendDirection === 'down' ? 'text-destructive'
    : 'text-muted-foreground';
  const Icon = trendDirection === 'up' ? TrendingUp : trendDirection === 'down' ? TrendingDown : ArrowRight;
  const sign = trendPercent > 0 ? '+' : '';
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={cn('inline-flex items-center gap-1 text-xs font-medium', colorClass, className)}>
            <Icon className="h-3.5 w-3.5" />
            <span>{trendDirection === 'stable' ? 'Stable' : `${sign}${trendPercent}%`}</span>
            {isSlowMover && <Turtle className="h-3.5 w-3.5 text-amber-500" />}
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <div className="text-xs space-y-0.5">
            <p>Trend multiplier: <b>{item.trendMultiplier.toFixed(2)}×</b></p>
            <p>Compares last 14 days vs the previous 16 days.</p>
            {isSlowMover && <p className="text-amber-500">Slow mover — prediction based on 60-day window.</p>}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

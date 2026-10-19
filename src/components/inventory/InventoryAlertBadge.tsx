import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useNavigate } from 'react-router-dom';
import { useInventoryAlerts } from '@/hooks/useInventoryAlerts';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export default function InventoryAlertBadge() {
  const navigate = useNavigate();
  const { counts } = useInventoryAlerts();

  if (counts.total === 0) {
    return (
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        aria-label="No inventory alerts"
        onClick={() => navigate('/smart-inventory')}
      >
        <Bell className="h-4 w-4 text-muted-foreground" />
      </Button>
    );
  }

  const tooltipParts: string[] = [];
  if (counts.expired > 0) tooltipParts.push(`${counts.expired} expired`);
  if (counts.expiringSoon > 0) tooltipParts.push(`${counts.expiringSoon} expiring soon`);
  if (counts.outOfStock > 0) tooltipParts.push(`${counts.outOfStock} out of stock`);
  if (counts.lowStock > 0) tooltipParts.push(`${counts.lowStock} low stock`);
  const tooltip = tooltipParts.join(' · ');

  const display = counts.total > 99 ? '99+' : String(counts.total);

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="relative h-8 w-8"
            aria-label={`Inventory alerts: ${tooltip}`}
            onClick={() => navigate('/smart-inventory')}
          >
            <Bell className="h-4 w-4 text-amber-500" />
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 h-4 min-w-[16px] px-1 text-[10px] leading-none flex items-center justify-center rounded-full"
            >
              {display}
            </Badge>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p className="text-xs">{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

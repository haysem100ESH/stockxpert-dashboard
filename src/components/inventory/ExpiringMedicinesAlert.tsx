import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { useInventoryAlerts } from '@/hooks/useInventoryAlerts';

export default function ExpiringMedicinesAlert() {
  const navigate = useNavigate();
  const { counts } = useInventoryAlerts();

  if (counts.total === 0) return null;

  const parts: string[] = [];
  if (counts.expired > 0) parts.push(`${counts.expired} expired`);
  if (counts.expiringSoon > 0) parts.push(`${counts.expiringSoon} expiring soon`);
  if (counts.outOfStock > 0) parts.push(`${counts.outOfStock} out of stock`);
  if (counts.lowStock > 0) parts.push(`${counts.lowStock} low stock`);

  return (
    <Alert variant="default" className="mb-2 py-1.5 px-3 border-amber-500 bg-amber-50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-200 [&>svg]:left-2 [&>svg]:top-2 [&>svg~*]:pl-5">
      <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
      <AlertDescription className="flex flex-row items-center justify-between gap-2">
        <span className="text-xs truncate">⚠️ {parts.join(', ')}</span>
        <Button variant="outline" size="sm" onClick={() => navigate('/smart-inventory')} className="h-6 px-2 text-xs flex-shrink-0 border-amber-600 text-amber-800 hover:bg-amber-100 dark:text-amber-200 dark:border-amber-400 dark:hover:bg-amber-950/40">View</Button>
      </AlertDescription>
    </Alert>
  );
}

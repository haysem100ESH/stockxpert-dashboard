import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useAuth } from '@/hooks/useAuth';
import { useOfflineStatus } from '@/lib/offline/store';
import { NOT_PROTECTED_WARNING, OFFLINE_BLOCKED_MESSAGE } from '@/lib/offline/storageGuard';
import { resumeBackup } from '@/lib/offline/backup';

export default function StorageBackupIndicators() {
  const { user } = useAuth();
  const { storage, backup, storageError } = useOfflineStatus();
  if (!user) return null;
  const protectedOk = storage?.persisted === true && !storageError;
  const tip = storageError || storage?.privateLike ? OFFLINE_BLOCKED_MESSAGE
    : protectedOk ? 'The browser will not clear offline sales automatically.' : NOT_PROTECTED_WARNING;
  const backupLabel = backup.state === 'ok' ? `Backup up to date ${new Date(backup.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : backup.state === 'paused' ? 'Backup paused — click to resume'
    : backup.state === 'failing' ? `Backup failing: ${backup.reason}`
    : backup.state === 'unsupported' ? 'Backup not supported' : 'Backup not set up';
  return <TooltipProvider><div className="flex flex-wrap items-center gap-1 text-xs">
    <Tooltip><TooltipTrigger asChild>
      <Badge variant={protectedOk ? 'default' : 'destructive'} className={protectedOk ? 'bg-success text-success-foreground hover:bg-success' : ''}>
        {protectedOk ? 'Storage protected' : 'Storage NOT protected'}
      </Badge>
    </TooltipTrigger><TooltipContent className="max-w-xs">{tip}</TooltipContent></Tooltip>
    {backup.state === 'paused'
      ? <button type="button" onClick={() => void resumeBackup(user.id)}><Badge variant="destructive">{backupLabel}</Badge></button>
      : <Badge variant={backup.state === 'failing' ? 'destructive' : 'secondary'} className="max-w-[16rem] truncate" title={backupLabel}>{backupLabel}</Badge>}
  </div></TooltipProvider>;
}

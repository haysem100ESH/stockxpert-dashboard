import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useAuth } from '@/hooks/useAuth';
import { useOfflinePrepare } from '@/hooks/useOfflinePrepare';
import { useOfflineStatus } from '@/lib/offline/store';
import { readMeta } from '@/lib/offline/db';
import type { CachedBranch } from '@/lib/offline/catalog';
import {
  indicatorState, usePrepareStatus, requestPreparation, PREPARE_PAGE_LABELS, type ShownEntry, type IndicatorState,
} from '@/lib/offline/prepare';

const hhmm = (iso?: string) => iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

/** Badge text/tooltip for an indicator state (pure, shared with tests). */
export function indicatorLabel(state: IndicatorState): { text: string; tone: 'ok' | 'busy' | 'warn' | 'none'; title?: string } {
  switch (state.kind) {
    case 'preparing': return { text: `Preparing offline data… ${state.percent}%`, tone: 'busy' };
    case 'ready': return { text: 'Offline ready ✓', tone: 'ok', title: `Prepared ${hhmm(state.preparedAt)}` };
    case 'incomplete': return { text: 'Offline data incomplete', tone: 'warn', title: 'Some offline data could not be prepared. Open for details.' };
    default: return { text: '', tone: 'none' };
  }
}
export function entryStatusText(entry: ShownEntry): string {
  const saved = entry.savedAt ? `saved ${hhmm(entry.savedAt)}` : 'not saved yet';
  switch (entry.status) {
    case 'ready': return saved;
    case 'capped': return `capped — ${entry.error ?? 'only part of the list was saved'} (${saved})`;
    case 'failed': return `failed — ${entry.error ?? 'request failed'}${entry.savedAt ? ` (previous copy ${saved})` : ''}`;
    case 'skipped': return `${entry.error ?? 'not prepared'}${entry.savedAt ? ` (previous copy ${saved})` : ''}`;
    default: return 'waiting to be prepared';
  }
}

/** Header indicator + background preparation scheduler (mounted once in the signed-in header). */
export default function OfflinePrepareIndicator() {
  useOfflinePrepare();
  const { user, profile } = useAuth();
  const status = usePrepareStatus();
  const { reachable } = useOfflineStatus();
  const [branchNames, setBranchNames] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || !user) return;
    void readMeta<CachedBranch[]>(`branchDetails:${user.id}`).then(list => {
      setBranchNames(Object.fromEntries((list ?? []).map(b => [b.id, b.name])));
    }).catch(() => undefined);
  }, [open, user?.id]);

  const state = indicatorState(status);
  const label = indicatorLabel(state);
  const groups = useMemo(() => {
    const byPage = new Map<string, ShownEntry[]>();
    for (const entry of status.entries) {
      const list = byPage.get(entry.page) ?? [];
      list.push(entry); byPage.set(entry.page, list);
    }
    return [...byPage.entries()];
  }, [status.entries]);

  if (!user || !profile || profile.role === 'developer' || status.userId !== user.id || label.tone === 'none') return null;
  const scopeName = (entry: ShownEntry) => entry.scope === 'user' ? ''
    : entry.scopeKey === 'owner-all' ? 'All branches' : branchNames[entry.scopeKey] ?? (profile.role === 'staff' ? 'Your branch' : 'Branch');
  const icon = label.tone === 'busy' ? <Loader2 className="h-3 w-3 animate-spin" />
    : label.tone === 'ok' ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />;
  const badgeClass = label.tone === 'ok' ? 'bg-success text-success-foreground hover:bg-success'
    : label.tone === 'warn' ? 'bg-amber-500 text-amber-950 hover:bg-amber-500' : '';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" data-offline-allow aria-label={`Offline preparation: ${label.text}`} title={label.title} className="text-xs">
          <Badge variant={label.tone === 'busy' ? 'secondary' : 'default'} className={`gap-1 ${badgeClass}`}>{icon}{label.text}</Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent data-offline-allow align="start" className="w-[min(24rem,calc(100vw-2rem))] p-3 text-xs">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="font-semibold text-sm">Offline data on this PC</div>
          <Button size="sm" variant="outline" data-offline-allow disabled={!reachable || status.running}
            onClick={() => requestPreparation(true)}>Prepare now</Button>
        </div>
        {status.running && <div className="mb-2 text-muted-foreground">Preparing {status.done} of {status.total}…</div>}
        {!reachable && <div className="mb-2 text-muted-foreground">Offline — preparation resumes when the connection returns.</div>}
        {status.storageWarning && (
          <div role="alert" className="mb-2 rounded border border-amber-500/50 bg-amber-500/10 p-2">
            Storage on this PC is nearly full (over 85%). Lower-priority pages were not prepared; Sales and access data still are.
          </div>
        )}
        <div className="max-h-80 overflow-y-auto space-y-3">
          {groups.map(([page, entries]) => (
            <div key={page}>
              <div className="font-medium">{PREPARE_PAGE_LABELS[page as keyof typeof PREPARE_PAGE_LABELS] ?? page}</div>
              <ul className="mt-1 space-y-0.5">
                {entries.map(entry => (
                  <li key={entry.key} className="flex flex-wrap justify-between gap-x-2">
                    <span>{entry.label}{scopeName(entry) ? ` · ${scopeName(entry)}` : ''}</span>
                    <span className={entry.status === 'ready' ? 'text-muted-foreground' : 'text-amber-700 dark:text-amber-400'}>{entryStatusText(entry)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

import { useSyncExternalStore } from 'react';
import { offlineDb, readMeta, writeMeta } from './db';
import { bindPrepare, getReadContext } from './readCache';
import { getOfflineState } from './store';
import { withPosLock } from './network';

/**
 * Background offline preparation engine (Phase 4 Feature A).
 * Generic over a dataset registry (see prepare.ts): plans entries in priority/branch order,
 * runs them one at a time, yields to checkout/sync through the POS lock between entries,
 * stops when unreachable or signed out, and records each entry's durable status in `meta`.
 */
export const PREPARE_MAX_ROWS = 20_000;
export const PREPARE_FRESH_MS = 6 * 60 * 60 * 1000;
export const STORAGE_STOP_RATIO = 0.85;
/** Priorities at or above this stop when storage is above STORAGE_STOP_RATIO (access data and Sales keep going). */
export const LOW_PRIORITY_FROM = 2;

export type PreparePage = 'account' | 'sales' | 'inventory' | 'medicineCodes' | 'customers' | 'suppliers' | 'overview' | 'activity';
export const PREPARE_PAGE_LABELS: Record<PreparePage, string> = {
  account: 'Account & access', sales: 'Sales', inventory: 'Inventory', medicineCodes: 'Medicine Codes',
  customers: 'Customers', suppliers: 'Suppliers', overview: 'Overview', activity: 'Activity Center',
};
export type PermissionLevel = 'no_access' | 'read' | 'edit';
export interface PrepareProfile { id: string; role: string; branch_id?: string | null }
/** One read-cache scope as the visible pages use it: a branch, or an owner's "All branches" (owner-all). */
export interface PrepareTarget { scopeKey: string; selectedBranch: string | null; branchIds: string[] }
export interface DatasetContext {
  userId: string; profile: PrepareProfile; target: PrepareTarget; ownerBranchIds: string[];
  signal: AbortSignal; maxRows: number; now: Date;
  /** Shared between entries of one run (e.g. the inventory list reused by Medicine Codes). */
  memo: Map<string, unknown>;
}
export interface DatasetOutcome { rows?: number; capped?: boolean; error?: string }
export interface DatasetDef {
  id: string; label: string; page: PreparePage; route: string;
  /** Staff page permission required (owners always pass). */
  permission?: string;
  /** 'user': once per user; 'branch': once per prepared read scope. */
  scope: 'user' | 'branch';
  /** 0 access data, 1 Sales catalog, 2 Inventory, 3 Customers/Suppliers/Medicine Codes, 4 Overview/Activity. */
  priority: number;
  ownerOnly?: boolean; staffOnly?: boolean;
  /** For an owner's "All branches" scope, run once per owned branch instead (catalog rows are per branch). */
  perBranchOnly?: boolean;
  /** False when the offline copy lives in `meta` (access data, Activity snapshots), not the read cache. */
  saveReads: boolean;
  /** The page query key this entry reproduces (documentation and the dataset inventory). */
  queryKey: string;
  run(ctx: DatasetContext): Promise<DatasetOutcome | void>;
}
export interface PlannedEntry { key: string; def: DatasetDef; target: PrepareTarget }
export type EntryState = 'ready' | 'failed' | 'capped' | 'skipped';
export interface EntryStatus {
  key: string; datasetId: string; page: PreparePage; label: string; scopeKey: string; scope: 'user' | 'branch';
  status: EntryState; savedAt?: string; attemptedAt: string; error?: string; rows?: number; dirty?: boolean;
}

export const statusKey = (userId: string, key: string) => `prepare:${userId}:${key}`;
export const planKey = (userId: string) => `preparePlan:${userId}`;
export const entryKey = (def: DatasetDef, target: PrepareTarget) => `${def.id}@${def.scope === 'user' ? 'user' : target.scopeKey}`;

// ---------- planning (pure) ----------
export function prepareTargets(profile: PrepareProfile, ownerBranchIds: string[], activeBranch: string | null): PrepareTarget[] {
  if (profile.role === 'owner') {
    const all: PrepareTarget = { scopeKey: 'owner-all', selectedBranch: null, branchIds: ownerBranchIds };
    const each = ownerBranchIds.map(id => ({ scopeKey: id, selectedBranch: id, branchIds: [id] }));
    const active = (activeBranch && each.find(t => t.selectedBranch === activeBranch)) || all;
    return [active, ...[all, ...each].filter(t => t !== active)];
  }
  if (profile.role === 'staff' && profile.branch_id) {
    return [{ scopeKey: profile.branch_id, selectedBranch: profile.branch_id, branchIds: [profile.branch_id] }];
  }
  return [];
}
export function datasetAllowed(def: DatasetDef, profile: PrepareProfile, permissions?: Record<string, PermissionLevel>) {
  if (def.ownerOnly && profile.role !== 'owner') return false;
  if (def.staffOnly && profile.role !== 'staff') return false;
  // Staff: only pages their previously verified permissions allow; never-verified denies everything.
  if (def.permission && profile.role === 'staff' && (permissions?.[def.permission] ?? 'no_access') === 'no_access') return false;
  return true;
}
export function planAccess(registry: DatasetDef[], profile: PrepareProfile): PlannedEntry[] {
  const target: PrepareTarget = { scopeKey: 'user', selectedBranch: null, branchIds: [] };
  return registry.filter(d => d.priority === 0 && datasetAllowed(d, profile)).map(def => ({ key: entryKey(def, target), def, target }));
}
export interface PlanInput {
  registry: DatasetDef[]; profile: PrepareProfile; permissions?: Record<string, PermissionLevel>;
  subscriptionOk: boolean; ownerBranchIds: string[]; activeBranch: string | null;
}
/** Page datasets after access data: active scope first (by priority), then every other allowed scope. */
export function planPreparation({ registry, profile, permissions, subscriptionOk, ownerBranchIds, activeBranch }: PlanInput): PlannedEntry[] {
  // Pages behind the subscription guard stay blocked offline, so there is nothing to prepare.
  if (!subscriptionOk || profile.role === 'developer') return [];
  const defs = registry.filter(d => d.priority > 0 && datasetAllowed(d, profile, permissions))
    .map((def, index) => ({ def, index })).sort((a, b) => a.def.priority - b.def.priority || a.index - b.index).map(x => x.def);
  const plan: PlannedEntry[] = [];
  const seen = new Set<string>();
  const add = (def: DatasetDef, target: PrepareTarget) => {
    const key = entryKey(def, target);
    if (!seen.has(key)) { seen.add(key); plan.push({ key, def, target }); }
  };
  prepareTargets(profile, ownerBranchIds, activeBranch).forEach((target, i) => {
    for (const def of defs) {
      if (def.scope === 'user' && i > 0) continue;
      if (def.perBranchOnly && target.selectedBranch === null) {
        for (const id of target.branchIds) add(def, { scopeKey: id, selectedBranch: id, branchIds: [id] });
        continue;
      }
      add(def, target);
    }
  });
  return plan;
}
export function isFresh(status: EntryStatus | undefined, now: number) {
  return !!status && (status.status === 'ready' || status.status === 'capped') && !status.dirty
    && !!status.savedAt && now - Date.parse(status.savedAt) < PREPARE_FRESH_MS;
}

// ---------- status store (header indicator) ----------
export type ShownState = EntryState | 'missing';
export interface ShownEntry extends Omit<EntryStatus, 'status' | 'attemptedAt'> { status: ShownState; attemptedAt?: string }
export interface PrepareState {
  userId?: string; running: boolean; done: number; total: number;
  startedAt?: string; finishedAt?: string; storageWarning: boolean; entries: ShownEntry[];
}
let state: PrepareState = { running: false, done: 0, total: 0, storageWarning: false, entries: [] };
const listeners = new Set<() => void>();
export const getPrepareState = () => state;
export function setPrepareState(patch: Partial<PrepareState>) { state = { ...state, ...patch }; listeners.forEach(l => l()); }
export function usePrepareStatus() {
  return useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l); }; }, getPrepareState, getPrepareState);
}
/** The last plan's entries with their saved status; planned-but-never-saved entries show as missing. */
export async function loadPrepareEntries(userId: string): Promise<ShownEntry[]> {
  const plan = await readMeta<Pick<ShownEntry, 'key' | 'datasetId' | 'page' | 'label' | 'scopeKey' | 'scope'>[]>(planKey(userId)) ?? [];
  const rows = await offlineDb.meta.bulkGet(plan.map(p => statusKey(userId, p.key)));
  return plan.map((p, i) => (rows[i]?.value as EntryStatus | undefined) ?? { ...p, status: 'missing' as const });
}
export async function refreshPrepareEntries(userId: string) {
  const entries = await loadPrepareEntries(userId).catch(() => []);
  // Never show one user's preparation details to whoever signed in meanwhile.
  if (getReadContext().userId === userId) setPrepareState({ userId, entries });
}
export type IndicatorState =
  | { kind: 'none' }
  | { kind: 'preparing'; percent: number }
  | { kind: 'ready'; preparedAt: string }
  | { kind: 'incomplete'; reasons: string[] };
/** Header badge: preparing (with progress), ready (all saved), or incomplete (failed/capped/missing/storage). */
export function indicatorState(s: Pick<PrepareState, 'running' | 'done' | 'total' | 'entries' | 'storageWarning'>): IndicatorState {
  if (s.running) return { kind: 'preparing', percent: s.total ? Math.min(100, Math.floor((s.done / s.total) * 100)) : 0 };
  if (!s.entries.length) return { kind: 'none' };
  const reasons = [...new Set(s.entries.filter(e => e.status !== 'ready').map(e => e.status))] as string[];
  if (s.storageWarning) reasons.push('storage');
  if (reasons.length) return { kind: 'incomplete', reasons };
  const oldest = s.entries.map(e => e.savedAt!).filter(Boolean).sort()[0];
  return { kind: 'ready', preparedAt: oldest };
}

const hhmm = (iso?: string) => iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

/** Badge text/tooltip for an indicator state. */
export function indicatorLabel(state: IndicatorState): { text: string; tone: 'ok' | 'busy' | 'warn' | 'none'; title?: string } {
  switch (state.kind) {
    case 'preparing': return { text: `Preparing offline data… ${state.percent}%`, tone: 'busy' };
    case 'ready': return { text: 'Offline ready ✓', tone: 'ok', title: `Prepared ${hhmm(state.preparedAt)}` };
    case 'incomplete': return { text: 'Offline data incomplete', tone: 'warn', title: 'Some offline data could not be prepared. Open for details.' };
    default: return { text: '', tone: 'none' };
  }
}
/** Popover line for one page/branch entry. */
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

// ---------- invalidation after the user's own synced changes ----------
export const PREPARE_EVENT = 'offline:prepare';
const ACTIVITY_DATASETS = ['activity.feed', 'activity.counts', 'activity.goals', 'activity.leaderboard'];
const STOCK_DATASETS = ['sales.catalog', 'inventory.items', 'codes.stock', 'overview.summary', 'overview.seasonal', 'overview.smart'];
/** Datasets a confirmed sale changes (stock, overview totals, activity). */
export const SALE_DATASETS = [...STOCK_DATASETS, ...ACTIVITY_DATASETS];
/** Datasets an applied record/stock operation changes. Medicine codes are owner-wide (every scope). */
export function opDatasets(entityType: string): { datasets: string[]; ownerWide: boolean } {
  switch (entityType) {
    case 'customer': return { datasets: ['customers', ...ACTIVITY_DATASETS], ownerWide: false };
    case 'supplier': return { datasets: ['suppliers', ...ACTIVITY_DATASETS], ownerWide: false };
    case 'medicine_code': return { datasets: ['codes.list', 'overview.summary', ...ACTIVITY_DATASETS], ownerWide: true };
    case 'stock': return { datasets: [...STOCK_DATASETS, ...ACTIVITY_DATASETS], ownerWide: false };
    default: return { datasets: ACTIVITY_DATASETS, ownerWide: false };
  }
}
/** Mark matching entries stale so the next run re-prepares them; scopeKeys limits branch-scoped entries. */
export async function markPrepareDirty(userId: string, datasetIds: string[], scopeKeys?: string[]) {
  const rows = await offlineDb.meta.where('key').startsWith(`prepare:${userId}:`).toArray();
  const changed = rows.filter(r => {
    const s = r.value as EntryStatus;
    return datasetIds.includes(s.datasetId) && (!scopeKeys || s.scope === 'user' || scopeKeys.includes(s.scopeKey)) && !s.dirty;
  }).map(r => ({ key: r.key, value: { ...(r.value as EntryStatus), dirty: true } }));
  if (changed.length) await offlineDb.meta.bulkPut(changed);
  try { window.dispatchEvent(new Event(PREPARE_EVENT)); } catch { /* no window in tests */ }
  return changed.length;
}

// ---------- runner ----------
export interface RunOptions {
  userId: string; profile: PrepareProfile; activeBranch: string | null;
  /** Reconnect / Prepare now: ignore six-hour freshness. */
  force: boolean;
  signal: AbortSignal; registry: DatasetDef[];
  maxRows?: number; now?: () => Date;
  estimate?: () => Promise<{ usage?: number; quota?: number } | undefined>;
  /** Wait for any checkout/sync holding the POS lock; never held across the run. */
  yieldToPos?: () => Promise<void>;
}
export type RunResult = 'completed' | 'stopped';
const defaultEstimate = async () => { try { return await navigator.storage?.estimate?.(); } catch { return undefined; } };
const defaultYield = () => withPosLock(async () => undefined);
const message = (e: unknown) => e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e);

let activeRun: Promise<RunResult> | null = null;
export const preparationRunning = () => !!activeRun;
/** Single-flight: a second call while running waits for the current run instead of starting another. */
export function runPreparation(opts: RunOptions): Promise<RunResult> {
  if (activeRun) return activeRun;
  activeRun = doRun(opts).finally(() => { activeRun = null; });
  return activeRun;
}
async function doRun(o: RunOptions): Promise<RunResult> {
  const now = o.now ?? (() => new Date());
  const maxRows = o.maxRows ?? PREPARE_MAX_ROWS;
  const stopped = () => o.signal.aborted || !getOfflineState().reachable || getReadContext().userId !== o.userId;
  if (stopped()) return 'stopped';
  const memo = new Map<string, unknown>();
  let done = 0; let total = 0; let storageWarning = false;
  setPrepareState({ userId: o.userId, running: true, done, total, storageWarning, startedAt: now().toISOString(), finishedAt: undefined });
  const progress = () => setPrepareState({ done, total });

  const runEntry = async (entry: PlannedEntry, ownerBranchIds: string[]): Promise<'ok' | 'stopped'> => {
    const sKey = statusKey(o.userId, entry.key);
    const previous = await readMeta<EntryStatus>(sKey);
    if (!o.force && isFresh(previous, now().getTime())) return 'ok';
    await (o.yieldToPos ?? defaultYield)();
    if (stopped()) return 'stopped';
    const controller = new AbortController();
    const abort = () => controller.abort();
    o.signal.addEventListener('abort', abort);
    const binding = bindPrepare(controller.signal, o.userId, entry.target.scopeKey, entry.def.saveReads);
    let outcome: DatasetOutcome = {}; let error: string | undefined;
    try {
      outcome = (await entry.def.run({ userId: o.userId, profile: o.profile, target: entry.target, ownerBranchIds,
        signal: controller.signal, maxRows, now: now(), memo })) || {};
    } catch (e) { error = message(e); }
    const writes = await Promise.all(binding.writes);
    o.signal.removeEventListener('abort', abort);
    // Interrupted (offline, signed out, cancelled): record nothing; the next run retries.
    if (stopped()) return 'stopped';
    const failedRequests = [...binding.outcomes.values()].filter(r => !r.ok).length;
    const refused = writes.filter(w => !w).length;
    let status: EntryState = 'ready';
    if (error || outcome.error) { status = 'failed'; error = error ?? outcome.error; }
    else if (failedRequests) { status = 'failed'; error = `${failedRequests} request${failedRequests === 1 ? '' : 's'} failed`; }
    else if (refused) { status = 'failed'; error = 'Too large to save on this PC'; }
    else if (outcome.capped) { status = 'capped'; error = `Only the first ${maxRows.toLocaleString()} rows were saved`; }
    const at = now().toISOString();
    const saved = status === 'ready' || status === 'capped';
    const record: EntryStatus = {
      key: entry.key, datasetId: entry.def.id, page: entry.def.page, label: entry.def.label,
      scopeKey: entry.def.scope === 'user' ? 'user' : entry.target.scopeKey, scope: entry.def.scope,
      status, savedAt: saved ? at : previous?.savedAt, attemptedAt: at, error, rows: outcome.rows,
    };
    // Durable before it counts as prepared.
    await writeMeta(sKey, record);
    return 'ok';
  };
  const describe = (entries: PlannedEntry[]) => entries.map(e => ({ key: e.key, datasetId: e.def.id, page: e.def.page, label: e.def.label,
    scopeKey: e.def.scope === 'user' ? 'user' : e.target.scopeKey, scope: e.def.scope }));

  try {
    const access = planAccess(o.registry, o.profile);
    total = access.length; progress();
    for (const entry of access) {
      if (stopped() || await runEntry(entry, []) === 'stopped') return 'stopped';
      done++; progress();
    }
    const [permissions, subscription, branchOrder] = await Promise.all([
      o.profile.role === 'staff' ? readMeta<Record<string, PermissionLevel>>(`permissions:${o.userId}`) : Promise.resolve(undefined),
      readMeta<{ status: string }>(`subscription:${o.userId}`),
      o.profile.role === 'owner' ? readMeta<string[]>(`prepareBranchOrder:${o.userId}`) : Promise.resolve(undefined),
    ]);
    const ownerBranchIds = (memo.get('ownerBranchIds') as string[] | undefined) ?? branchOrder ?? [];
    const plan = planPreparation({
      registry: o.registry, profile: o.profile, permissions, ownerBranchIds, activeBranch: o.activeBranch,
      subscriptionOk: subscription?.status === 'active' || subscription?.status === 'expiring_soon',
    });
    await writeMeta(planKey(o.userId), describe([...access, ...plan]));
    total = access.length + plan.length; progress();
    for (const entry of plan) {
      if (stopped()) return 'stopped';
      if (entry.def.priority >= LOW_PRIORITY_FROM) {
        const estimate = await (o.estimate ?? defaultEstimate)();
        if (estimate?.quota && (estimate.usage ?? 0) / estimate.quota > STORAGE_STOP_RATIO) {
          // Lower-priority data is not prepared; previously saved copies stay usable.
          storageWarning = true;
          const at = now().toISOString();
          const previous = await readMeta<EntryStatus>(statusKey(o.userId, entry.key));
          await writeMeta(statusKey(o.userId, entry.key), { ...describe([entry])[0], status: 'skipped', savedAt: previous?.savedAt,
            attemptedAt: at, error: 'Storage nearly full — not prepared' } satisfies EntryStatus);
          done++; setPrepareState({ done, storageWarning });
          continue;
        }
      }
      if (await runEntry(entry, ownerBranchIds) === 'stopped') return 'stopped';
      done++; progress();
    }
    return 'completed';
  } finally {
    setPrepareState({ running: false, finishedAt: now().toISOString(), storageWarning });
    await refreshPrepareEntries(o.userId);
  }
}

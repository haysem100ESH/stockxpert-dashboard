/**
 * Offline preparation dataset registry (Phase 4 Feature A).
 *
 * Every entry calls the SAME shared query function its page uses, with the same arguments the
 * page derives for that scope, so each prepared request (path, select, filters, order, range,
 * Accept/Prefer) and therefore its read-cache key is exactly what the page asks for offline.
 * Requests go through the existing client and read cache; the entry's AbortSignal binds the
 * saved copies to the user/branch being prepared (see bindPrepare in readCache.ts).
 *
 * Read-cache datasets are prepared per scope (branch, or the owner's "All branches"), because
 * the cache is keyed by the scope the page is viewed in. Access data and Activity snapshots
 * live in `meta` and are prepared once per user.
 */
import { cacheMeta, writeMeta } from './db';
import { refreshCatalog } from './catalog';
import { saveActivityCache } from './activity';
import {
  PREPARE_EVENT, runPreparation, type DatasetContext, type DatasetDef, type RunOptions,
} from './prepareEngine';
import { fetchProfileRow, cacheProfileMeta } from '@/hooks/useAuth';
import { fetchAndCacheStaffPermissions } from '@/hooks/useStaffPermissions';
import { fetchAndCacheSubscription } from '@/components/subscription/SubscriptionGuard';
import { fetchOwnerBranchIds } from '@/hooks/useOwnerBranchIds';
import { fetchAndCacheBranchDetails } from '@/components/branch/BranchSelector';
import {
  fetchBranchInventoryProgressive, fetchActiveIngredients, inventoryMedicineIds, type EnrichedBranchItem,
} from '@/hooks/useBranchInventory';
import { fetchBatchCounts, fetchHasBranches } from '@/components/inventory/StaffInventoryWithActions';
import { fetchCategoryRows } from '@/components/inventory/CategoryManagement';
import { fetchGroups } from '@/hooks/useMedicineGroups';
import { resolveOwnerId, fetchCodes } from '@/hooks/useMedicineCodes';
import { fetchCodePackagings } from '@/components/inventory/MedicineCodes';
import { fetchBatches, fetchSaleItems, rangeStart } from '@/hooks/useMedicineCodeAnalytics';
import { fetchCustomers } from '@/hooks/useCustomers';
import { fetchSupplierList } from '@/components/suppliers/SupplierManagement';
import { loadDashboardData } from '@/pages/Dashboard';
import { fetchSeasonalItems, seasonalBranchIds } from '@/hooks/useSeasonalPerformance';
import { fetchBranchItemsFallback } from '@/hooks/useSmartInventory';
import { loadActivityFeed, activityFeedScope } from '@/hooks/useActivityFeed';
import { loadActivityCounts, activityCountsScope } from '@/hooks/useActivityCounts';
import { loadStaffGoals, goalsForStaff, STAFF_GOALS_SCOPE } from '@/hooks/useStaffGoals';
import { loadGoalProgress, goalPeriod, goalProgressScope } from '@/hooks/useGoalProgress';
import { loadLeaderboard, leaderboardScope } from '@/components/activity/Leaderboard';
import { loadGoalOptions, GOAL_OPTIONS_SCOPE } from '@/components/activity/GoalManager';

export * from './prepareEngine';

/** Activity Center: today plus the previous seven days. */
export const ACTIVITY_FEED_DAYS = 8;
/** useBranchInventory page sizes: the list arrives progressively in these prefixes. */
const FIRST_PAGE = 24; const NEXT_PAGE = 200;

// ---------- helpers ----------
/** Inventory list lengths the page renders while it pages through (24, 224, 424 … total). */
export function progressivePrefixes(total: number): number[] {
  if (total <= 0) return [];
  const out: number[] = [];
  for (let n = Math.min(FIRST_PAGE, total); ; n = Math.min(n + NEXT_PAGE, total)) { out.push(n); if (n >= total) break; }
  return out;
}
/**
 * Distinct chunks (exactly as chunkedIn builds them: unique, non-empty, in order) across every
 * intermediate list the page passes to an ID-chunked query. Pages re-run those queries for each
 * progressive list, so each intermediate chunk is a request the page makes offline.
 */
export function distinctChunks(lists: string[][], size: number): string[][] {
  const seen = new Set<string>(); const out: string[][] = [];
  for (const list of lists) {
    const unique = [...new Set(list)].filter(Boolean);
    for (let i = 0; i < unique.length; i += size) {
      const chunk = unique.slice(i, i + size); const key = chunk.join(',');
      if (!seen.has(key)) { seen.add(key); out.push(chunk); }
    }
  }
  return out;
}
const isOwner = (ctx: DatasetContext) => ctx.profile.role === 'owner';
/** Same `selectedBranch` the BranchProvider gives the page (staff are pinned to their branch). */
const selectedBranchOf = (ctx: DatasetContext) => ctx.target.selectedBranch;
/** Branch list useBranchInventory / useMedicineCodeBatches / useSmartInventory derive for the scope. */
const scopedBranchIds = (ctx: DatasetContext) => ctx.target.selectedBranch ? [ctx.target.selectedBranch]
  : isOwner(ctx) ? ctx.ownerBranchIds : ctx.profile.branch_id ? [ctx.profile.branch_id] : [];
async function inventoryItems(ctx: DatasetContext): Promise<EnrichedBranchItem[]> {
  const key = `items:${ctx.target.scopeKey}`;
  if (!ctx.memo.has(key)) ctx.memo.set(key, await fetchBranchInventoryProgressive(scopedBranchIds(ctx), () => undefined, { signal: ctx.signal, maxRows: ctx.maxRows }));
  return ctx.memo.get(key) as EnrichedBranchItem[];
}
const capped = (rows: number, ctx: DatasetContext) => ({ rows, capped: rows >= ctx.maxRows });
const daysBack = (now: Date, n: number) => { const d = new Date(now); d.setDate(d.getDate() - n); return d; };

// ---------- registry ----------
export const PREPARE_REGISTRY: DatasetDef[] = [
  // ----- 0: access data (meta) -----
  {
    id: 'access.profile', label: 'Profile & account', page: 'account', route: '/account', scope: 'user', priority: 0, saveReads: false,
    queryKey: 'useAuth: profiles?select=*&id=eq.<user> (single) → meta profile:<user>',
    async run(ctx) {
      const { data, error } = await fetchProfileRow(ctx.userId, ctx.signal);
      if (error || !data) throw error ?? new Error('Profile unavailable');
      await cacheProfileMeta(ctx.userId, data);
    },
  },
  {
    id: 'access.permissions', label: 'Page permissions', page: 'account', route: '/', scope: 'user', priority: 0, saveReads: false, staffOnly: true,
    queryKey: 'StaffPermissionsProvider: staff_permissions?select=page_name,permission_level&staff_id=eq.<user> → meta permissions:<user>',
    async run(ctx) {
      if (!await fetchAndCacheStaffPermissions(ctx.userId, ctx.signal)) throw new Error('Permissions unavailable');
    },
  },
  {
    id: 'access.subscription', label: 'Subscription', page: 'account', route: '/', scope: 'user', priority: 0, saveReads: false,
    queryKey: 'SubscriptionGuard: [staff: pharmacy_branches owner] + pharmacy_subscriptions → meta subscription:<user>',
    async run(ctx) { await fetchAndCacheSubscription(ctx.userId, ctx.profile, ctx.signal); },
  },
  {
    id: 'access.branches', label: 'Allowed branches', page: 'account', route: '/', scope: 'user', priority: 0, saveReads: false,
    queryKey: "['owner-branch-ids', owner] + BranchSelector pharmacy_branches → meta branches:<user>, branchDetails:<user>",
    async run(ctx) {
      if (isOwner(ctx)) {
        await fetchAndCacheBranchDetails(ctx.profile, ctx.signal);
        // useOwnerBranchIds' own request and order: owner-wide page queries embed this exact list.
        const ids = await fetchOwnerBranchIds(ctx.userId, ctx.signal);
        await cacheMeta(`branches:${ctx.userId}`, ids);
        await writeMeta(`prepareBranchOrder:${ctx.userId}`, ids);
        ctx.memo.set('ownerBranchIds', ids);
        return { rows: ids.length };
      }
      if (ctx.profile.branch_id) await cacheMeta(`branches:${ctx.userId}`, [ctx.profile.branch_id]);
    },
  },
  // ----- 1: Sales catalog (existing catalog path) -----
  {
    id: 'sales.catalog', label: 'Sales catalog', page: 'sales', route: '/sales', permission: 'sales', scope: 'branch', priority: 1,
    perBranchOnly: true, saveReads: true,
    queryKey: 'Dexie catalog (fetchCatalog / replaceCatalog) + catalogSync:<user>:<branch>',
    async run(ctx) { return { rows: await refreshCatalog([ctx.target.selectedBranch!], ctx.userId, ctx.signal) }; },
  },
  // ----- 2: Inventory -----
  {
    id: 'inventory.items', label: 'Items, packaging & batch counts', page: 'inventory', route: '/inventory', permission: 'inventory',
    scope: 'branch', priority: 2, saveReads: true,
    queryKey: "['branch-inventory', scope] (branch_items pages 24/200 + medicines, packaging, branch names) + ['branch-inventory-ingredients'] + batch counts + has-branches",
    async run(ctx) {
      const items = await inventoryItems(ctx);
      const prefixes = progressivePrefixes(items.length).map(n => items.slice(0, n));
      // Active ingredients and live batch counts are re-queried by the page for each progressive list.
      for (const chunk of distinctChunks(prefixes.map(p => inventoryMedicineIds(p)), 50)) await fetchActiveIngredients(chunk, ctx.signal);
      for (const chunk of distinctChunks(prefixes.map(p => p.map(i => i.id)), 50)) await fetchBatchCounts(chunk, ctx.signal);
      await fetchHasBranches(ctx.profile, ctx.signal);
      return capped(items.length, ctx);
    },
  },
  {
    id: 'inventory.categories', label: 'Categories', page: 'inventory', route: '/inventory?tab=categories', permission: 'inventory',
    scope: 'branch', priority: 2, saveReads: true,
    queryKey: 'CategoryManagement: custom_categories?select=*&order=name',
    async run(ctx) {
      const { data, error } = await fetchCategoryRows(ctx.signal);
      if (error) throw error;
      return { rows: data?.length ?? 0 };
    },
  },
  {
    id: 'inventory.groups', label: 'Medicine groups', page: 'inventory', route: '/inventory', permission: 'inventory',
    scope: 'branch', priority: 2, saveReads: true,
    queryKey: "['medicine-groups', ownerId|null]",
    async run(ctx) { return { rows: (await fetchGroups(isOwner(ctx) ? ctx.userId : null, ctx.signal)).length }; },
  },
  // ----- 3: Medicine Codes, Customers, Suppliers -----
  {
    id: 'codes.list', label: 'Codes', page: 'medicineCodes', route: '/medicine-codes', permission: 'inventory',
    scope: 'branch', priority: 3, saveReads: true,
    queryKey: "['medicine-codes-owner', user] + ['medicine-codes', ownerId]",
    async run(ctx) {
      const ownerId = await resolveOwnerId(ctx.profile, ctx.signal);
      return { rows: (await fetchCodes(ownerId, ctx.signal)).length };
    },
  },
  {
    id: 'codes.stock', label: 'Linked stock, packaging, batches & sales', page: 'medicineCodes', route: '/medicine-codes', permission: 'inventory',
    scope: 'branch', priority: 3, saveReads: true,
    queryKey: "['branch-inventory', scope] + MedicineCodes packaging (chunks of 20) + ['mcode-batches', branches] + ['mcode-sales', branches, 'weekly']",
    async run(ctx) {
      const items = await inventoryItems(ctx);
      const prefixes = progressivePrefixes(items.length).map(n => items.slice(0, n));
      for (const chunk of distinctChunks(prefixes.map(p => p.map(i => (i as { medicine_id?: string }).medicine_id ?? '')), 20)) {
        await fetchCodePackagings(chunk.map(medicine_id => ({ medicine_id })), ctx.signal);
      }
      const branchIds = scopedBranchIds(ctx);
      await fetchBatches(branchIds, ctx.signal);
      await fetchSaleItems(branchIds, rangeStart('weekly'), ctx.signal);
      // The linked-stock list is the inventory list: capped when that list is.
      return capped(items.length, ctx);
    },
  },
  {
    id: 'customers', label: 'Customers', page: 'customers', route: '/customers', permission: 'customers',
    scope: 'branch', priority: 3, saveReads: true,
    queryKey: "['customers', branch | owner:<ids> | staff:<branch>]",
    async run(ctx) {
      const rows = await fetchCustomers(selectedBranchOf(ctx), ctx.ownerBranchIds, isOwner(ctx), isOwner(ctx) ? null : ctx.profile.branch_id ?? null, ctx.signal);
      return { rows: rows.length };
    },
  },
  {
    id: 'suppliers', label: 'Suppliers', page: 'suppliers', route: '/suppliers', permission: 'suppliers',
    scope: 'branch', priority: 3, saveReads: true,
    queryKey: 'SupplierManagement.fetchSupplierList: suppliers (scope) + supplier_debts',
    async run(ctx) {
      const { suppliers } = await fetchSupplierList({ selectedBranch: selectedBranchOf(ctx), role: ctx.profile.role, branchId: ctx.profile.branch_id, ownerBranchIds: ctx.ownerBranchIds }, ctx.signal);
      return { rows: suppliers?.length ?? 0 };
    },
  },
  // ----- 4: Overview, Activity -----
  {
    id: 'overview.summary', label: 'Summary, stock alerts & charts (today)', page: 'overview', route: '/', permission: 'dashboard',
    scope: 'branch', priority: 4, saveReads: true,
    queryKey: "Dashboard.loadDashboardData(reportPeriod 'daily')",
    async run(ctx) {
      const result = await loadDashboardData({ profile: ctx.profile, selectedBranch: selectedBranchOf(ctx),
        userBranch: isOwner(ctx) ? null : ctx.profile.branch_id ?? null, reportPeriod: 'daily' }, ctx.signal);
      return { rows: result.stats.totalProducts };
    },
  },
  {
    id: 'overview.seasonal', label: 'Seasonal trends', page: 'overview', route: '/', permission: 'dashboard',
    scope: 'branch', priority: 4, saveReads: true,
    queryKey: 'useSeasonalPerformance (branch_items, medicines by 20, sale_items 12 months)',
    async run(ctx) {
      const ids = seasonalBranchIds(selectedBranchOf(ctx), ctx.profile, ctx.ownerBranchIds);
      return { rows: (await fetchSeasonalItems(ids, ctx.now.getMonth() + 1, ctx.signal)).length };
    },
  },
  {
    id: 'overview.smart', label: 'Inventory score', page: 'overview', route: '/', permission: 'dashboard',
    scope: 'branch', priority: 4, saveReads: true,
    queryKey: "['smart-inventory', branches, threshold] offline path (branch_items fallback; the RPC is never cached)",
    async run(ctx) {
      const ids = scopedBranchIds(ctx);
      if (!ids.length) return { rows: 0 };
      return { rows: (await fetchBranchItemsFallback(ids, ctx.signal)).length };
    },
  },
  {
    id: 'activity.feed', label: `Activity log (today + ${ACTIVITY_FEED_DAYS - 1} days)`, page: 'activity', route: '/activity',
    scope: 'user', priority: 4, saveReads: false,
    queryKey: 'useActivityFeed({ date }) → meta activity:<user>:feed:[…]',
    async run(ctx) {
      let rows = 0;
      for (let i = 0; i < ACTIVITY_FEED_DAYS; i++) {
        const options = { date: daysBack(ctx.now, i) };
        const data = await loadActivityFeed(ctx.userId, options, ctx.signal);
        await saveActivityCache(ctx.userId, activityFeedScope(ctx.userId, options), data);
        rows += data.length;
      }
      return { rows };
    },
  },
  {
    id: 'activity.counts', label: 'Activity counts', page: 'activity', route: '/activity', scope: 'user', priority: 4, saveReads: false,
    queryKey: 'useActivityCounts → meta activity:<user>:counts:<user>:<today>',
    async run(ctx) {
      await saveActivityCache(ctx.userId, activityCountsScope(ctx.userId), await loadActivityCounts(ctx.userId, ctx.signal));
    },
  },
  {
    id: 'activity.goals', label: 'Goals & progress', page: 'activity', route: '/activity', scope: 'user', priority: 4, saveReads: false,
    queryKey: "useStaffGoals → meta activity:<user>:goals; staff: useGoalProgress → activity:<user>:goalProgress:<goal>:<period>",
    async run(ctx) {
      const data = await loadStaffGoals(ctx.profile, ctx.signal);
      await saveActivityCache(ctx.userId, STAFF_GOALS_SCOPE, data);
      const mine = goalsForStaff(ctx.profile, data.goals, data.assignments);
      for (const goal of mine) {
        const period = goalPeriod(goal);
        await saveActivityCache(ctx.userId, goalProgressScope(goal.id, period.key), await loadGoalProgress(ctx.userId, goal.id, period, ctx.signal));
      }
      return { rows: data.goals.length };
    },
  },
  {
    id: 'activity.leaderboard', label: 'Team leaderboard (today)', page: 'activity', route: '/owner/activity', ownerOnly: true,
    scope: 'branch', priority: 4, saveReads: false,
    queryKey: "Leaderboard 'today' → meta activity:<user>:leaderboard:[branch|null,'today',…]",
    async run(ctx) {
      const customDate = ctx.now;
      const data = await loadLeaderboard(ctx.userId, selectedBranchOf(ctx), 'today', customDate, ctx.signal);
      await saveActivityCache(ctx.userId, leaderboardScope(selectedBranchOf(ctx), 'today', customDate), data);
      return { rows: data.staff.length };
    },
  },
  {
    id: 'activity.goalOptions', label: 'Goal options', page: 'activity', route: '/owner/activity', ownerOnly: true,
    scope: 'user', priority: 4, saveReads: false,
    queryKey: 'GoalManager → meta activity:<user>:goalOptions',
    async run(ctx) {
      const data = await loadGoalOptions(ctx.userId, ctx.signal);
      await saveActivityCache(ctx.userId, GOAL_OPTIONS_SCOPE, data);
      return { rows: data.staff.length };
    },
  },
];

/** Run preparation with the real registry. */
export function prepareOffline(opts: Omit<RunOptions, 'registry'> & { registry?: DatasetDef[] }) {
  return runPreparation({ ...opts, registry: opts.registry ?? PREPARE_REGISTRY });
}
/** Ask the background scheduler to run (it decides when; never blocks the caller). */
export function requestPreparation(force = false) {
  try { window.dispatchEvent(new CustomEvent(PREPARE_EVENT, { detail: { force } })); } catch { /* no window */ }
}

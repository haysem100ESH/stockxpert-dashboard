# Offline POS — part 1

Sales submits checkout through the existing `process_pos_sale` RPC. No migrations, table changes, function deployments, or connection changes were made.

## Verification

- Local rule and queue tests cover expired stock, reservation states, fully paid offline sales, forbidden debt deduction, persistent saves, duplicate transaction IDs, settlement, retention, and retry backoff.
- Submission tests use a mocked RPC to cover online success/rejection, unknown paid and credit outcomes, offline submission, and duplicate responses.
- Playwright verified a simulated cached staff session: Sales opens offline, customer selection is disabled, a fully paid sale commits to IndexedDB, stock decreases from 12 to 11, the pending sale survives reload, and Finance is blocked offline.
- Phone-sized viewport has no horizontal overflow. No browser page errors or preview service-worker registrations were observed.
- These checks are simulated, not a real authenticated server checkout. The original application's authenticated session was unavailable; server acceptance and actual reconnect synchronization remain unverified.
- Production app-shell caching requires a published top-level app. The editor/dev preview intentionally never registers its app-shell worker. Published offline startup remains unverified.

Offline branch/profile/permission/subscription metadata reflects the last verified online state. Offline sales are provisional; the server validates current authorization and stock on synchronization. Revocation on another device cannot be detected while disconnected. Synced records are retained for 30 days; unresolved records are not automatically deleted.

## Files created or changed

- `package.json`, `bun.lock`
- `AGENTS.md`, `roadmap.md`, `OFFLINE_POS.md`
- `index.html`, `vite.config.ts`, `src/main.tsx`, `src/vite-env.d.ts`
- `public/pwa-192.png`, `public/pwa-512.png`
- `src/components/Layout.tsx`
- `src/components/branch/BranchSelector.tsx`
- `src/components/sales/SalesManagement.tsx`, `CartSlider.tsx`, `OfflineStatusBadge.tsx`
- `src/components/subscription/SubscriptionGuard.tsx`
- `src/hooks/useAuth.tsx`, `useBranchContext.tsx`, `useOwnerBranchIds.tsx`, `useStaffPermissions.tsx`, `useSalesInventory.tsx`, `usePackaging.tsx`, `useOfflineSync.ts`
- `src/lib/offline/types.ts`, `db.ts`, `rules.ts`, `store.ts`, `network.ts`, `catalog.ts`, `queue.ts`, `effects.ts`, `submitSale.ts`, `cachedSession.ts`, `registerPwa.ts`
- `src/lib/offline/rules.test.ts`, `queue.test.ts`, `submitSale.test.ts`

Project memory records the user's frontend-only and offline stock/credit constraints. Existing `batchInventory.ts` is retained for other modules.

## Tests

Run submission mocks in a separate process to prevent mocked modules from affecting the queue tests:

```sh
bun test src/lib/offline/rules.test.ts src/lib/offline/queue.test.ts
bun test src/lib/offline/submitSale.test.ts
```
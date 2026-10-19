# Offline POS: operation and recovery

This frontend uses the existing StockXpert database connection. No migrations or function deployments are part of this implementation.

## Offline and online behavior

After signing in online and caching an allowed branch catalog, the published app can reopen Sales offline. Search, category filters, cached packaging/prices, cart, fully paid checkout and device sales/export work locally. Offline startup requires a previous verified cached profile, permissions and subscription; it is not a new sign-in. Customer selection, partial payment, credit and debt deduction are unavailable offline.

Finance, reports, attendance, purchasing, transfers, owner reconciliation and other modules remain online-only. A local sale is provisional: **Saved on device is not Confirmed by server**. On reconnect, the queue retries automatically, preserving transaction IDs. Needs-attention sales remain reserved until an authoritative resolution is visible to the cashier. Owners use `/sync-issues` online to retry, accept the charged price for PRICE_CHANGED only, or void with a required note. Resolved/voided history is read-only; quantities cannot be edited.

## Device storage

Dexie uses IndexedDB database `pharmaxpert-offline`:

| Table | Primary key / indexes | Contents |
| --- | --- | --- |
| catalog | id = branch_items.id; branchId, ownerKey | Allowed branch cards, medicine/packaging details, non-expired serverAvailable, cachedAt |
| sales | clientTxnId; status, branchId, userId, createdAt | Original payload, mode, status, attempts/errors, server/issue IDs, summary and timestamps |
| meta | key | Per-user profile, allowed branch IDs/details, permissions, subscription verification, catalog sync times and last successful sale sync |

Metadata is namespaced by user (for example `profile:<userId>` and `catalogSync:<userId>:<branchId>`). Catalog rows are filtered by user and branch; sales are filtered by user. No passwords or new auth tokens are stored in Dexie. Offline identity reads the existing auth SDK session; exports do not include that session or metadata.

Displayed availability is serverAvailable minus base quantities reserved by pending, syncing and needs_attention local sales. serverAvailable sums remaining quantities in non-expired batches; items with no batch rows use branch quantity. Synced and voided records do not reserve stock. Confirmed records are kept for 30 days. Unresolved records are never deleted automatically; explicit exported sign-out removes them along with the departing user's catalog, metadata and local history. Never sign out to fix a queue without exporting first.

Dexie version 2 retains the same tables, keys and indexes and adds optional discard note/actor/time fields. Device-only refusals (needs_attention with no issueId) allow unchanged Retry or required-note Discard. Discarded records release stock, remain visible in history, are included in exports and block sign-out cleanup until exported. They are never deleted automatically. Server-owned issues cannot be discarded locally.

## Existing server contract

`process_pos_sale(p_payload, p_mode)` owns sale processing in an atomic transaction: sales, sale_items, FIFO deduction of non-expired batches, sale_item_batches, branch quantity synchronization, and online customer credit. Unique `sales.client_txn_id` provides idempotency: repeating the same original payload/ID never creates a second sale. The server checks current permission/branch, quantity, totals, stock, expiry, price and packaging. Any live batch's selling price is accepted. Offline credit is refused.

Success returns synced (duplicate is also success); online validation returns rejected with no local save; offline conflicts are stored in `pos_sync_issues` and return needs_attention. Network/auth/timeouts/unknown errors keep the original sale queued for safe retry. Unknown online credit results stay in online mode; do not re-enter them.

Queued retries derive mode from the original payload: fully paid sales without debt deduction use offline, including legacy records stored as online; credit uses online. Branch/user authorization refusals return rejected in both modes without an issue row. Background rejection retains a device-only needs_attention record and its reservation. SQLSTATE classes 22/23, 42501, and 28000 with a valid session stop automatic retry and retain the exact server error for device review. Missing codes, network/abort/timeouts, PGRST codes, 40001, 40P01, 57014 and HTTP 5xx without SQLSTATE retain backoff. Unknown checkout errors are always persisted before returning, even when permanent.

`reconcile_pos_sync_issue(p_issue_id, p_action, p_note)` is the server-authorized owner reconciliation endpoint. Actions are retry, accept_price_retry (price conflicts only) and void (required note). It returns synced, needs_attention or voided. Existing RLS limits issue visibility to the owner's branches. The frontend owner gate is only presentation; no new permissions or policies are installed.

## Browser-storage limitations

- Clearing site data or browser storage removes local sales and caches permanently unless exported.
- Private browsing may restrict storage or delete it when the session closes.
- Browser/OS storage eviction and device loss can remove local data. This is not a backup service.
- One device/browser/origin is not another: another login does not automatically receive this device's queue.
- Revoked access cannot be detected while disconnected. Current server authorization is rechecked at sync and may produce a conflict.
- The PWA worker never registers in development, iframe or Lovable previews. Published top-level offline startup must be tested separately.

## Recovery procedure

1. Open Device sales and export pending sales to JSON before clearing data, signing out or replacing the device. Keep it securely: it contains sale payloads and may contain customer IDs.
2. On the same device, sign in as the original cashier, reconnect, choose Retry now / Sync now, and wait for confirmed results. Unknown outcomes always reuse the existing ID; never manually enter a second sale.
3. On a different device/login, online owner reconciliation can resolve issues already received by the server. Local-only pending records do not appear there until uploaded.
4. Keep exported JSON for recovery of local-only records. This release has **no JSON import/upload control**. An authorized support recovery must restore/replay each original payload with the same transaction ID, same original user and mode; do not recreate sales with fresh IDs. Never paste tokens into a recovery file.
5. Owners restock/fix the underlying issue then Retry, accept a price conflict where appropriate, or Void with a note. Refresh until the authoritative result is visible. Cashier local reservations release when the server resolution can be read.

## Device decommissioning

1. Reconnect and sync until 0 pending/sending **and 0 needs attention**.
2. Reconcile remaining conflicts; export a recovery copy and verify the download is safely retained.
3. Sign out. If unresolved records remain, export is mandatory before Sign out anyway; a new/changed unresolved record requires a fresh export.
4. Clear site data only after verifying server results or keeping an export.
5. Uninstall the PWA and remove downloaded customer/sale exports from the retired device according to your retention policy.

## Published-app manual acceptance checklist

- [ ] Sign in online as the actual cashier; load each allowed branch and confirm current catalog timestamps.
- [ ] Disconnect, close/reopen the installed published app, and open Sales without an auth spinner.
- [ ] Search and filter cached items locally; verify customer/partial-payment/debt controls are unavailable.
- [ ] Save a fully paid sale; verify local-only wording, original ID and immediate stock reservation.
- [ ] Refresh/restart the browser and device; confirm sale, stock reservation and queue persist.
- [ ] Reconnect and verify automatic sync plus server read-back of sale/items/stock and updated local status.
- [ ] Retry the same ID after an unknown outcome; verify exactly one server sale and no double deduction.
- [ ] Interrupt one request while processing several sales; confirm saved records are not lost and later retries retain IDs.
- [ ] Switch branch/user; confirm isolation of catalog, queue/export and server issue list; staff cannot open owner reconciliation.
- [ ] Create an insufficient-stock conflict from another device; verify needs-attention mapping/reservation and owner Retry after restock.
- [ ] Exercise PRICE_CHANGED accept-price retry, required-note Void, and read-only history; verify final cashier status.
- [ ] Export all unresolved statuses; inspect full payloads and absence of credentials. Confirm sign-out is disabled before export and invalidates export after a new sale.
- [ ] Sync to zero then sign out; verify the departing user's catalog/meta are gone and no unrelated user records are deleted.
- [ ] Recover on the original device/login; for a replacement device follow the export/support recovery procedure above.
- [ ] Exercise blocked/private storage and cleared-site-data behavior without using real unexported sales.

## Automated checks and verification limits

Run mock suites separately to isolate their mocked server modules:

```sh
bun test src/lib/offline/rules.test.ts src/lib/offline/queue.test.ts src/lib/offline/deviceSafety.test.ts
bun test src/lib/offline/submitSale.test.ts
bun test src/lib/offline/reconciliation.test.ts
```

Tests cover stock/credit rules, durable queue, original-ID retries, duplicate settlement, export filtering, export-gated isolated cleanup and reconciliation action rules. Browser fixtures verify UI flows with simulated cached identities/server responses; they do not prove live authorization or real server checkout. A real original-app session is unavailable here, and the app is not published: authenticated server acceptance and published offline startup remain manual checks.

Part 2 simulated browser checks verified a real local checkout/export with its original payload, disabled sign-out before export, enabled sign-out after export, and cleared sales/catalog/meta on completed offline sign-out. Mocked owner flows verified price acceptance, required-note voiding, refreshed read-only history, and no phone-width overflow or page errors.

## Part 2 files created / changed

- `AGENTS.md`, `roadmap.md`, `OFFLINE_POS.md`
- `src/App.tsx`
- `src/components/AppSidebar.tsx`, `src/components/Layout.tsx`
- `src/components/sales/OfflineStatusBadge.tsx`, `SalesManagement.tsx`, `PendingSalesSheet.tsx`, `DeviceSignOutDialog.tsx`
- `src/pages/SyncIssuesPage.tsx`
- `src/hooks/useAuth.tsx`, `useOfflineSync.ts`, `useSyncIssues.ts`
- `src/lib/offline/types.ts`, `cachedSession.ts`, `deviceSafety.ts`, `reconciliation.ts`, `deviceSafety.test.ts`, `reconciliation.test.ts`
- Project memory: `mem://features/offline-pos`
# Offline POS: operation and recovery

This frontend uses the existing StockXpert database connection. No migrations or function deployments are part of this implementation.

## Offline and online behavior

After signing in online and caching an allowed branch catalog, the published app can reopen Sales offline. Search, category filters, cached packaging/prices, cart, fully paid checkout and device sales/export work locally. Offline startup requires a previous verified cached profile, permissions and subscription; it is not a new sign-in. Customer selection, partial payment, credit and debt deduction are unavailable offline.

Finance, reports, attendance, purchasing, transfers, owner reconciliation and other modules remain online-only. A local sale is provisional: **Saved on device is not Confirmed by server**. On reconnect, the queue retries automatically, preserving transaction IDs. Needs-attention sales remain reserved until an authoritative resolution is visible to the cashier. Owners use `/sync-issues` online to retry, accept the charged price for PRICE_CHANGED only, or void with a required note. Resolved/voided history is read-only; quantities cannot be edited.

Activity Center is also available offline as a read-only view of exactly what the signed-in user previously loaded. Feeds are cached by date/range, staff/branch scope and limit; counts, goals, goal progress and owner leaderboard views are cached separately in `meta` under `activity:<userId>:...`. No new Dexie table or schema version is required. Missing dates show “This date was not loaded before going offline”; saved views show their saved time. Offline goal editing/completion is disabled. Normal sign-out preserves these caches; explicit retirement removes only the current user's caches.

New checkout payloads include `server_activity: true` and the device checkout timestamp. The existing server transaction creates the sale activity atomically and uniquely by transaction ID, retaining its device time subject to server clamping. Queued/restored legacy payloads are never amended; only unflagged, nonduplicate sales retain the existing client activity log. Credit-score behavior is unchanged. Pending, syncing, needs-attention and discarded activities are derived only from the signed-in user's local sales, selected by device timestamp (fallback: local creation time), and hidden when a loaded server activity has the same transaction ID. Synced/voided records are excluded. “+N pending” is separate from server counts and never advances goals. No separate activity queue exists.

## Device storage

Dexie uses IndexedDB database `pharmaxpert-offline`:

| Table | Primary key / indexes | Contents |
| --- | --- | --- |
| catalog | id = branch_items.id; branchId, ownerKey | Allowed branch cards, medicine/packaging details, non-expired serverAvailable, cachedAt |
| sales | clientTxnId; status, branchId, userId, createdAt | Original payload, mode, status, attempts/errors, server/issue IDs, summary and timestamps |
| meta | key | Per-user profile, allowed branch IDs/details, permissions, subscription verification, catalog sync times and last successful sale sync |

Metadata is namespaced by user (for example `profile:<userId>` and `catalogSync:<userId>:<branchId>`). Catalog rows are filtered by user and branch; sales are filtered by user. No passwords or new auth tokens are stored in Dexie. Offline identity reads the existing auth SDK session; exports do not include that session or metadata.

Displayed availability is serverAvailable minus base quantities reserved by ALL cashiers' pending, syncing and needs_attention local sales on this PC for the same branch/item, even after sign-out. serverAvailable sums remaining quantities in non-expired batches; items with no batch rows use branch quantity. Discarded, synced and voided records do not reserve stock. Settlement moves confirmed quantities into the catalog snapshot; subsequent server catalog replacement does not reserve synced records again. Confirmed records are kept for 30 days. Unresolved records are never deleted automatically. Normal sign-out preserves all sales (any status), cached catalog, access metadata, sync times, device ID and backup folder connection; no export is required.

Dexie version 2 retains the same tables, keys and indexes and adds optional discard note/actor/time fields. Device-only refusals (needs_attention with no issueId) allow unchanged Retry or required-note Discard. Discarded records release stock, remain visible in history, are included in exports and block explicit retirement cleanup until exported. They are never deleted automatically. Server-owned issues cannot be discarded locally.

## Sign-out and shared PCs

Normal sign-out, online or offline, clears the authentication session and displayed account state only. Saved sales and prices stay on this PC. Internet is required to sign in again: offline startup with no session is still denied. The offline sign-out dialog warns that nobody can sign in or make sales until internet returns and makes **Stay signed in** the primary choice.

When the same cashier signs in, interrupted `syncing` records reset to `pending` and resume normal automatic sync with their original IDs and payloads. Their saved catalog remains available until refreshed. Device-only refusals require Retry/review and discarded records remain history; these are not automatically sent.

If another cashier signs in, Sales shows only the count of other cashiers' unresolved records. No names, amounts or items are exposed. Those records never appear in the signed-in cashier's device list, exports, backup or totals, and sync only when their original cashier signs in. Their pending, syncing and needs_attention sales still reserve the shared physical stock for the same branch/item on this PC.

## Storage protection

On sign-in/app start, and again right before the first offline save of a session, the app calls `navigator.storage.persist()` if storage is not yet persisted and reads `navigator.storage.estimate()`. The header shows **Storage protected** (green) or **Storage NOT protected** (red).

- **Private-like window** (not persisted and quota under 300 MB — the Chrome/Edge incognito pattern) or unusable IndexedDB: offline checkout is blocked with "Offline sales are disabled in this window. Open PharmaXpert from its installed app icon (not a private window)." Online checkout is unaffected.
- **Not persisted, normal window:** offline sales are allowed, but once per session the cashier must acknowledge a red warning to install the app and open it from its icon.
- The Device sales panel shows storage used / available.

## Automatic backup (Chrome/Edge desktop)

Cashier setup (once per PC, per cashier):
1. Install the app (install icon in the address bar) and open it from that icon.
2. Click the status badge in the header → **Set up automatic backup**.
3. Choose or create the folder `Documents\PharmaXpert Backup` and allow editing.
4. The header shows "Backup up to date HH:MM".

Behavior: after every change to this cashier's local sales the app writes (2 s debounce; immediately after a new offline save) `pharmaxpert-backup-<first 8 of userId>-<deviceId>-latest.json` plus a dated copy `...-YYYY-MM-DD.json` (Addis Ababa date). Only the newest 7 dated copies of that exact cashier+device prefix are kept. Contents use the same field allowlist as Export (no tokens, no other cashiers), covering pending, syncing, needs-attention, discarded and synced-within-retention records, with header `format: pharmaxpert-backup`, `version: 1`, `userId`, `deviceId`, `generatedAt`. A backup failure never blocks checkout or sync; it only changes the indicator ("Backup paused — click to resume", "Backup failing: <reason>", "Backup not set up", "Backup not supported"). Browsers without the folder API hide backup setup and say "use Export daily".

## Restore from a backup file

1. The cashier who made the sales signs in (any PC).
2. Device sales panel → **Restore from backup file** → pick a `.json` backup or export.
3. Files from another cashier are refused ("This backup belongs to another cashier…"), so sales stay attributed to their real seller. Malformed files or unknown versions are refused.
4. Review the preview (count, dates, total, statuses) and confirm.
5. Only transaction IDs not already on the device are added, payloads unchanged. Unresolved records become pending (discarded stays discarded; issue/discard fields kept); synced records are skipped. Sync then sends them, and the server returns already-recorded sales as duplicates, so nothing is counted twice.
6. The result shows restored / already present / skipped (synced) / invalid counts.

Limitations: the backup lives on that PC unless the folder is on a USB drive or OneDrive; the browser may need one click per session ("Backup paused — click to resume") to grant folder access again; backups are not encrypted, so protect the folder.

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

1. Open Device sales and export pending sales to JSON before clearing/removing data or replacing the device. Normal sign-out does not delete records or require export. Keep recovery files securely: they contain sale payloads and may contain customer IDs.
2. On the same device, sign in as the original cashier, reconnect, choose Retry now / Sync now, and wait for confirmed results. Unknown outcomes always reuse the existing ID; never manually enter a second sale.
3. On a different device/login, online owner reconciliation can resolve issues already received by the server. Local-only pending records do not appear there until uploaded.
4. Keep exported JSON for recovery of local-only records. For automatic backup files, use **Restore from backup file** while signed in as the original cashier (see above). Keep transaction IDs and payloads unchanged; never recreate sales with fresh IDs or paste tokens into recovery files.
5. Owners restock/fix the underlying issue then Retry, accept a price conflict where appropriate, or Void with a note. Refresh until the authoritative result is visible. Cashier local reservations release when the server resolution can be read.

## Device decommissioning

1. Reconnect and sync until 0 pending/sending **and 0 needs attention**.
2. Reconcile remaining conflicts; export a recovery copy and verify the download is safely retained.
3. While still signed in, open Device sales → **Remove my data from this PC**. This is a separate, explicit retirement/handover action, never normal sign-out. If pending, syncing, needs_attention or discarded records remain, export is mandatory; any new/changed unresolved record requires a fresh export. Verify the download, then confirm removal.
4. Removal rechecks export coverage under the POS lock and deletes only your own sales, catalog and user-scoped metadata (including your backup folder connection), then signs you out. Other cashiers' records and backup files stay untouched. The shared device ID is retained. Each cashier must separately retire their own data before clearing all site data.
5. Clear site data only after all cashiers' records are confirmed or securely exported. Uninstall the PWA and remove downloaded customer/sale exports from the retired device according to your retention policy.

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
- [ ] Sign out online/offline without export; verify all sales, catalog/meta and backup connection stay. Offline sign-out warns that internet is required to sign in again.
- [ ] Sign in again as the same cashier; verify interrupted syncing records resume and cached catalog is reused. Without a session, offline startup remains denied.
- [ ] Sign in as another cashier; verify only the other-cashier count is visible, their records do not affect list/export/backup/totals, and same-branch pending/syncing/needs_attention sales still reserve shared stock.
- [ ] Export all unresolved statuses; inspect payloads and absence of credentials. Explicit **Remove my data from this PC** is blocked until current export, invalidates stale export, and removes only your own data after confirmation.
- [ ] Recover on the original device/login; for a replacement device follow the export/support recovery procedure above.
- [ ] Exercise blocked/private storage and cleared-site-data behavior without using real unexported sales.

## Automated checks and verification limits

Offline Activity Center and atomic activity: full `bun test` suite passed **135 tests, 0 failures, 394 assertions across 12 files**. Tests cover new online/offline payload flags and timestamps, immutable legacy payloads, flagged/legacy/duplicate sale effects, unchanged credit penalty, private date-filtered pending statuses, transaction-ID de-duplication, separate period counts, user/date-scoped cache round trips and close/reopen persistence. No browser/device or authenticated server verification was performed.

The initial test run had 132 passes and one failure caused by an incorrect expected text for the existing PRICE_CHANGED message; corrected to reuse `reasonMessage()` without changing production behavior. Failure output verbatim:
```text
error: expect(received).toEqual(expected)

  [
    "Pending sync",
    "Syncing",
-   "Needs attention: The price has changed. Refresh prices and try again.",
+   "Needs attention: The price has changed. Refresh the catalog and review the cart.",
    "Discarded — not recorded",
  ]
```

Shared-stock reservation fix: full `bun test` suite passed **119 tests, 0 failures, 352 assertions across 10 files**. Fake IndexedDB tests confirm a different cashier's 5 reserved units leave 7 of 12 available; pending/syncing/needs_attention reserve, discarded/synced/voided do not; another branch stays isolated; server catalog replacement after settlement does not double-subtract; private lists/export/backup remain user-scoped. No browser/device verification was performed.

Sign-out retention checks: full `bun test` suite passed **112 tests, 0 failures, 325 assertions across 10 files**. Fake IndexedDB tests cover authentication-only online/offline sign-out, all-status sales/catalog/meta retention, session clearing, same-user interrupted queue recovery with unchanged payload, count-only other-cashier isolation, and current-export retirement gates. No browser/device or authenticated server verification was performed for this change.

Run mock suites separately to isolate their mocked server modules:

```sh
bun test src/lib/offline/rules.test.ts src/lib/offline/queue.test.ts src/lib/offline/deviceSafety.test.ts
bun test src/lib/offline/submitSale.test.ts
bun test src/lib/offline/reconciliation.test.ts
```

Review-fix verification: the complete `bun test` suite passed 89 tests with 0 failures (227 assertions). Tests include legacy mode normalization, credit retries, background rejection, required-note discard/export protection and permanent/temporary SQLSTATE outcomes. Automatic preview build reports OK. No browser/device/offline verification was performed for this review; a separate production build is not verified by the preview result.

Tests cover stock/credit rules, durable queue, original-ID retries, duplicate settlement, export filtering, export-gated isolated cleanup and reconciliation action rules. Browser fixtures verify UI flows with simulated cached identities/server responses; they do not prove live authorization or real server checkout. A real original-app session is unavailable here, and the app is not published: authenticated server acceptance and published offline startup remain manual checks.

Earlier simulated sign-out checks described export-gated deletion; that behavior is superseded by sign-out retention and explicit retirement. No browser/device verification is claimed for this change; the checklist above must be exercised on the published app.

## Part 2 files created / changed

- `AGENTS.md`, `roadmap.md`, `OFFLINE_POS.md`
- `src/App.tsx`
- `src/components/AppSidebar.tsx`, `src/components/Layout.tsx`
- `src/components/sales/OfflineStatusBadge.tsx`, `SalesManagement.tsx`, `PendingSalesSheet.tsx`, `DeviceSignOutDialog.tsx`
- `src/pages/SyncIssuesPage.tsx`
- `src/hooks/useAuth.tsx`, `useOfflineSync.ts`, `useSyncIssues.ts`
- `src/lib/offline/types.ts`, `cachedSession.ts`, `deviceSafety.ts`, `reconciliation.ts`, `deviceSafety.test.ts`, `reconciliation.test.ts`
- Project memory: `mem://features/offline-pos`
## Offline read for main pages (Phase 1)

- One shared read cache (`src/lib/offline/readCache.ts`) wraps the existing database client's table-read fetch (installed in `src/lib/db.ts`; `client.ts` untouched). Successful GET/HEAD table reads are saved to Dexie table `readCache` (database version 3, key `[userId+scopeKey+queryKey]`, scope = viewed branch or `owner-all`). Offline, or when the network throws, the saved copy is served; another user's cache is never served; HTTP errors and thrown requests never overwrite it. RPCs, writes, auth and edge functions are never cached.
- Secret-like fields (`gemini_api_key`, any `*api_key*`, `*token*`, `*secret*`, `*password*`, security answers) are stripped before saving. Limits: 2 MB per entry, 25 MB per user with least-recently-used eviction (sales and catalog are never touched); date-ranged reads older than 30 days are not saved and expire after 30 days.
- Offline search/filter/sort/pagination is derived locally from a complete cached list of the same table (eq/neq/gt/gte/lt/lte/like/ilike/is/in/or/and, order, offset/limit, counts, single-row).
- In-scope offline pages: Overview, Inventory, Medicine Codes, Customers, Suppliers, Account (read-only, banner "Offline — showing data saved at HH:MM", "Not available offline — open it once while online on this PC" when something was never saved). Sales and Activity Center keep their own offline modes. Every other route shows "Needs internet — this page is not available offline."
- Offline, write controls on in-scope pages are marked disabled ("Needs internet") and clicks/submits — including in already-open dialogs — are blocked before any request is sent.
- Gates fail closed offline: cached profile, permissions, subscription and allowed branches only; never-verified → "Open this page once while online on this PC."; cached expired/inactive stays blocked. Owners' branch selector lists only allowed branches and disables branches never opened on this PC.
- Inventory offline stock = cached quantity minus unsynced sales of all cashiers for that branch (shared reservation helper); expiry status recomputed daily with the Addis Ababa date.
- Sign-out keeps the read cache; "Remove my data from this PC" deletes the current user's read cache with their other device data.
- Not available offline: edge-function reads, read RPCs, realtime updates (resume on reconnect), and datasets never opened online on this PC. On reconnect, visible data refreshes in the background.

Phase 1 verification: full `bun test` passed **164 tests, 0 failures, 511 assertions across 13 files**; production `vite build` succeeded. A Bun preload (`bunfig.toml` → `src/test/setupIndexedDb.ts`) now installs fake IndexedDB before Dexie loads. No device/browser offline verification was performed.


## Offline records Phase 2

Frontend-only: no migrations, SQL, RLS, function deployments, or protected client changes.

### Enabled offline controls

| Page | Controls | Allowed fields | Still internet-only |
| --- | --- | --- | --- |
| Customers | Add Customer, Edit, their submit buttons | name, phone, notes | credit limit, opening balance, payments, deletes, merges |
| Suppliers | Add Supplier, Edit, their submit buttons (including staff with cached edit permission offline) | name, contact_person, phone, email, address | purchases, payments, deletes, balances |
| Medicine Codes | New Code, Edit, Save | create: code, label, notes; edit: label, notes | code text on edit, assignments, deletes, merges |

Owners may edit; staff require previously verified cached edit permission (`customers`, `suppliers`, `inventory` respectively). Cached branch/profile/subscription checks fail closed and the server always revalidates. A specific allowed branch is required. Creates use device UUIDs; updates send changed allowed fields only and preserve the exact cached server `updated_at`. An older cached medicine-code record without updated_at must be loaded online before editing. Required names/labels, 200-character name/label, 30-character phone, 2000-character notes, 50-character code and email validation run locally. Cached duplicates warn without blocking; server decides.

Dexie **version 4** adds `ops` with key `opId` and indexes userId, branchId, entityId, status, deviceCreatedAt; existing sales/catalog/meta/readCache data is preserved. Ops retain original payload, IDs, base version, previous-op ID, device time, attempts/backoff, server result details and discard audit. The single existing POS-locked syncing loop interleaves sales and ops oldest-first, one at a time. Earlier unresolved entity operations are chained; blocked dependents are not sent, become DEPENDS_ON_UNSYNCED when their predecessor needs attention/is discarded, and are re-evaluated after resolution. Unknown outcomes retain immutable requests and the existing backoff/error classifier.

User-only overlays add provisional rows/badges to cached list reads and customer/supplier/code views, search and the sales customer picker. Stored readCache snapshots are not amended. Synced ops disappear into refreshed server data; discarded edits do not overwrite server fields. Discarded creates remain in Waiting to sync / Activity audit, not as usable records. Other-user ops are count-only in the Sales notice. No credit behavior is changed.

### Device and owner resolution

- Header pending/attention counts include sales and ops. **Waiting to sync** has Sales / Records tabs.
- Records: pending Retry; local rejection/DEPENDS_ON_UNSYNCED Retry or Discard with required note. Server issues say **Waiting for owner review**, never local discard.
- Owner **Sync issues → Records**, online only, reads needs_attention operations for allowed branches using existing server authorization. Shows submitter/time/branch, changed fields, server/offline comparison for version conflicts, and duplicate links. Retry; Keep offline change only for VERSION_CONFLICT/DUPLICATE_PHONE/DUPLICATE_NAME; Void requires a note.
- Cashier reconnect reads owner decisions: applied becomes synced; voided remains auditable as **Voided by owner: note**. Server creates activities; no client logging is sent for outbox operations. Pending Activity Center rows cover all six record operation types and deduplicate server client_txn_id/metadata.op_id. Goals still use server counts only.
- Backup format **v2** contains own sales and ops, including confirmed chain predecessors. Restore accepts v1 and v2, remains same-user, skips IDs already present, preserves synced ancestors (without sending them again), and resumes unresolved ops with original IDs/payloads. Export includes ops. Normal sign-out retains every op; explicit removal checks current export coverage for unresolved/discarded ops under the POS lock and removes only this user's data.

### Verification and limitations

No authenticated server, browser/device, real filesystem, or installed-app offline verification is claimed. DOM tests use happy-dom and mocked identity/backend responses; RPC tests simulate the contract. Duplicate links navigate to the matching page with the existing record ID in its query string; record-specific focusing depends on that page. Old snapshots without server updated_at cannot safely support updates until refreshed online. Automatic production compilation is reported separately; manual builds are disabled by the workspace harness.

Initial full-suite failure output (corrected):
```text
ReferenceError: location is not defined
      at brokeredPreviewStorage (/dev-server/src/integrations/supabase/previewAuthStorage.ts:43:16)
error: expect(received).toEqual(expected)
- [{ "id": "customers-1", "name": "customers" }]
+ []
error: expect(received).toEqual(expected)
- [{ "id": "c1" }]
+ []
```
DOM setup also initially failed with:
```text
TypeError: Argument 1 ('event') to EventTarget.dispatchEvent must be an instance of Event
 code: "ERR_INVALID_ARG_TYPE"
ReferenceError: ResizeObserver is not defined
AssertionError: Expected values to be strictly equal:
3 !== 0
```
The cache correction preserves already-server-filtered projected rows; the DOM correction uses isolated browser globals and counts writes rather than permitted read queries. Expanded six-submission DOM test timeout was raised:
```text
(fail) offline customer, supplier and medicine code forms send only allowed fields; credit/code edits and read permission block writes [5011.70ms]
  ^ this test timed out after 5000ms.
```


### Final Phase 2 verification

- Full `bun test`: **192 passed, 0 failed, 614 assertions across 16 files**. Final failures: none. Tests cover atomic writes/rollback, create→edit→edit chaining, blocked dependencies/re-evaluation, unknown-outcome immutable retry, all statuses, permanent/temporary classification, cached exact server versions, immutable snapshots, private overlays, permitted form submission fields, read-permission blocking, offline credit/code-text restrictions, backup v2/v1 restore, synced ancestor recovery, export gates, sign-out retention, owner voids and activity deduplication.
- Latest automatic compilation: **build OK (2026-10-28T11:46:57Z)**. A separate production build was not run: manual builds/typechecks are prohibited by the workspace harness. Production-mode build verification remains unavailable, not implied by automatic compilation.
- No live authenticated RPC/owner reconciliation, browser/device, installed PWA, or real folder verification. The rendered form checks are isolated happy-dom simulations, not device verification.
- Restore preserves device-only refused operations as needs_attention (not automatically retried), resets interrupted syncing to pending, and retains synced ancestors. A partial/tampered backup missing an ancestor is fail-closed as DEPENDS_ON_UNSYNCED, never sent ahead of it.

### Phase 2 files changed

New:
- `src/lib/offline/opTypes.ts`, `ops.ts`, `syncOp.ts`, `ops.test.ts`
- `src/hooks/useOfflineRecords.ts`
- `src/components/sales/PendingRecords.tsx`
- `src/components/offline/RecordSyncIssues.tsx`, `OfflineRecordForms.test.ts`
- `src/test/offlineRecordFormsRender.tsx`

Updated:
- `src/lib/offline/db.ts`, `store.ts`, `readCache.ts`, `readCache.test.ts`, `deviceSafety.ts`, `backup.ts`, `backup.test.ts`, `restore.ts`, `activity.ts`, `signOut.test.ts`
- `src/hooks/useOfflineSync.ts`, `useOfflineBackup.ts`, `usePendingActivities.ts`, `useCustomers.tsx`, `useMedicineCodes.tsx`, `useSalesInventory.tsx`, `useAuth.tsx` (in-memory ops reset only)
- `src/components/customers/AddCustomerDialog.tsx`, `EditCustomerDialog.tsx`, `CustomerManagement.tsx`, `CustomerDetailDialog.tsx`
- `src/components/suppliers/AddSupplierDialog.tsx`, `EditSupplierDialog.tsx`, `SupplierManagement.tsx`
- `src/components/inventory/MedicineCodes.tsx`
- `src/components/sales/PendingSalesSheet.tsx`, `DeviceSignOutDialog.tsx`, `OtherCashierSalesNotice.tsx`, `CartSlider.tsx`
- `src/components/offline/OfflineReadGuard.tsx`, `src/pages/SyncIssuesPage.tsx`, `src/test/offlineReadGuardRender.tsx`
- `AGENTS.md`, `roadmap.md`, `OFFLINE_POS.md`; project memory adds the owner-approved offline field scope.

Protected client and all backend files/settings unchanged. Existing online mutation paths remain intact; reads include server updated_at for safe offline edits.

## Offline stock Phase 3

Frontend-only extension of the existing `ops` outbox and POS-locked sync loop. No second queue, migrations, SQL, RLS changes, function deployments or protected client changes. Existing online Add Batch/Edit Batch and stock adjustment paths remain in place.

### Receive stock and delta adjustments

- Staff and owner Inventory use the shared inventory controls. Offline **Receive stock** and **Adjust stock** require previously verified inventory edit permission and allowed branch access. Read-only permission does not allow these saves.
- **Receive stock** applies to an existing item and generates a batch ID on the device. Fields include quantity (1–1,000,000), selling price, optional purchase price, expiry date, batch number, supplier, low-stock threshold and expiry-alert days. Expiry must be a valid date on or after the device's current Addis Ababa date.
- **Adjust stock** targets a batch, including a locally received batch, or an item without batches. Enter a signed, nonzero delta with magnitude at most 1,000,000. Damage and expired write-offs must decrease stock; count correction and other require a note. Local validation refuses reductions beyond available device stock.
- The offline form saves with **Save on this device** and states **Not yet confirmed by server**. Pending batches and adjustment badges also appear in the item's batch list. Absolute-quantity edits in the existing batch editor cannot be saved offline; use delta adjustments instead. Other inventory writes remain internet-only.
- Suppliers may be selected from cached records or this cashier's locally pending supplier creates. **Supplier purchase/payment is not recorded offline — record it online if needed.** Supplier purchases, payments, debt and expense entries remain online-only.

### Dependencies, stock and refresh

Dexie version **5** retains the existing tables and adds optional stock-operation fields and `dependsOn: opId[]`. A receipt referencing a local supplier waits for that supplier; an adjustment referencing a locally received batch waits for its receipt. Earlier same-entity operations also remain dependencies. Missing, needs-attention or discarded predecessors block sending with `DEPENDS_ON_UNSYNCED`; resolve the predecessor before retrying. Retries keep original operation IDs, payloads and device timestamps.

Shared stock on this PC, within the same branch/item, is:

```text
cached snapshot + unresolved receipts + unresolved signed adjustments
                - unresolved sale base quantities
```

Pending, syncing and needs-attention work contributes across all cashiers. Discarded, voided and synced work does not contribute again. Sellable availability excludes expired batches/receipts using the Addis date; batch-level sales reservations follow FEFO. Non-expired receipts are available to offline sales. Lists, activity, exports, backups and sync remain private to the signed-in cashier despite physical stock being shared.

Applied stock work settles once into the Sales catalog snapshot and triggers catalog refresh. A repeated result does not apply the delta again. Affected `branch_items` and `inventory_batches` shared read-cache entries are **marked stale, not deleted**: immediate refresh is not guaranteed for inactive views, so saved Inventory remains readable offline. Synced operations leave the provisional overlay. Until a successful online read replaces a stale snapshot, that view may still show its previous saved quantities; the next successful read clears the stale flag. Saved snapshots are not silently amended.

### Recovery, activity and backup

- Device **Waiting to sync → Records** labels stock work as receive/adjust operations. Server conflicts show **Waiting for owner review**. Device-only refused work allows unchanged Retry or Discard with a required note; never recreate an uncertain operation with a new ID.
- Owner **Sync issues → Records** remains online-only and server-authorized. `NEGATIVE_STOCK` offers **Write off what's left**; `SUPPLIER_NOT_FOUND` offers **Receive without supplier**. `NOT_FOUND` is **void-only**. Other stock errors do not offer a force action. Void requires a note; the server determines the outcome.
- Server processing owns stock history and activity: no client activity is logged for applied stock operations. Private provisional `receive_stock` / `adjust_stock` rows deduplicate against server operation IDs and never advance goals.
- Existing backup/export format v2 includes stock operations and dependencies; same-user restore preserves IDs and payloads. Normal sign-out keeps them. Explicit device retirement still requires current export coverage and removes only the current user's data.

### Final automated verification

- Full `bun test`: **207 passed, 0 failed, 678 expect() calls across 18 files**. Final failures: none. The isolated DOM fixture additionally uses Node assertions, which are not included in Bun's expect count.
- The added isolated happy-dom regression renders the actual batch editor under the offline guard, changes an absolute quantity, and verifies Save Batch Changes is blocked without any server call or queued work. It then renders the actual StockAdjustmentDialog offline, submits a -2 damage delta through OfflineStockDialog, and verifies exactly one `stock.adjust` enqueue, the saved callback and no online writes. Online forms were not modified.
- Existing stock tests cover allowlists, Addis-date validation, supplier/receipt dependencies, shared stock, expired receipts, idempotent settlement, stale cache, reason/force labels, permission gates, activity deduplication, backup/restore and version-5 close/reopen persistence. The persistence check is not a simulated migration from an actual version-4 database.
- Latest automatic preview check: **build OK (2026-10-31T06:27:04Z)**. No manual build or typecheck was run for these test/documentation-only changes; the preview harness performs those checks.
- No device, installed-app, authenticated server, owner reconciliation or real backup-folder verification is claimed.

### Files changed for the remaining steps

- `src/test/offlineStockFormsRender.tsx` (isolated actual-form DOM regression)
- `src/components/inventory/OfflineStockForms.test.ts` (Bun wrapper)
- `OFFLINE_POS.md`, `roadmap.md` (Phase 3 procedures and verification)

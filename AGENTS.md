# Project rules

- Keep the existing StockXpert client connection authoritative; offline POS must call its existing RPC and never create backend schema or deploy functions.
- Keep durable POS state in `src/lib/offline` and Dexie; server processing is idempotent and retries must retain the original payload and transaction ID.
- Serialize checkout, catalog replacement, and background queue processing with the same browser lock; local reservations and catalog snapshots must change atomically to avoid stock races.
- Cache access metadata per authenticated user and deny offline access without a previously verified cached result; server validation remains authoritative.
- Register the generated app-shell worker only through the guarded PWA wrapper; development and Lovable previews must never register it.
- Use Bun tests with fake IndexedDB for offline business rules; browser checks must distinguish simulated coverage from authenticated server verification.
- Normal sign-out is authentication-only; explicit device retirement rechecks export coverage and removes only the current user's records under the POS lock, preserving recoverable sales between sessions.
- Keep reconciliation online-only and rely on existing server RLS/RPC authorization; client owner checks only gate presentation, never grant privileges.
- Derive queued retry mode from the unchanged payload and keep RPC error classification in the offline sync module; this covers legacy records and makes permanent failures testable independently of React.
- Keep device-only discard audit fields in the versioned Dexie sale record and retirement export gate; this preserves recovery history without reserving stock.
- Keep storage-persistence checks and the File System Access backup in `src/lib/offline/storageGuard.ts`/`backup.ts`; backup is best-effort, serialized with retirement, and never throws into checkout or sync; restore accepts only the signed-in user's files to preserve seller attribution.
- Keep session-only sign-out in `src/lib/offline/signOut.ts`, interrupted-queue recovery in the queue module, and other-cashier notices count-only; testable helpers preserve identity and stock isolation across sign-ins.
- Load stock reservations by branch across all cashiers, while keeping account records and sync user-scoped; physical stock stays shared after sign-out.
- Store exact Activity Center query snapshots in user-namespaced Dexie metadata and derive provisional rows from sales; cached server counts alone drive goals, with no separate activity queue.
- Add atomic activity fields only at new checkout construction and keep queued payloads immutable; flagged sales use server activity, while unflagged legacy sales retain duplicate-safe client effects.
- Serve offline page reads only through the shared read cache installed on the client's REST fetch in `src/lib/db.ts`; it is user- and branch-scoped, strips secrets, and never caches writes or RPCs, so pages need no per-page caches.
- Classify offline-capable routes and write controls in `src/lib/offline/offlinePages.ts` and enforce them in `OfflineReadGuard`; offline gates use only cached verified values from `gates.ts` and fail closed.
- Preload fake IndexedDB via `bunfig.toml` so Dexie never loads before the test shim.

- Keep record operations in the versioned Dexie ops table, process them as work items in the existing POS-locked sync loop, and overlay private provisional fields without changing readCache snapshots; this preserves one queue engine and immutable retries.

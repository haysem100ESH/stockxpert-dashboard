# Project rules

- Keep the existing StockXpert client connection authoritative; offline POS must call its existing RPC and never create backend schema or deploy functions.
- Keep durable POS state in `src/lib/offline` and Dexie; server processing is idempotent and retries must retain the original payload and transaction ID.
- Serialize checkout, catalog replacement, and background queue processing with the same browser lock; local reservations and catalog snapshots must change atomically to avoid stock races.
- Cache access metadata per authenticated user and deny offline access without a previously verified cached result; server validation remains authoritative.
- Register the generated app-shell worker only through the guarded PWA wrapper; development and Lovable previews must never register it.
- Use Bun tests with fake IndexedDB for offline business rules; browser checks must distinguish simulated coverage from authenticated server verification.
- Export POS records through an explicit field allowlist; sign-out cleanup must recheck export coverage under the POS lock before deleting only the departing user's records.
- Keep reconciliation online-only and rely on existing server RLS/RPC authorization; client owner checks only gate presentation, never grant privileges.
- Derive queued retry mode from the unchanged payload and keep RPC error classification in the offline sync module; this covers legacy records and makes permanent failures testable independently of React.
- Keep device-only discard audit fields in the versioned Dexie sale record and export gate; this preserves recovery history without reserving stock.- Keep storage-persistence checks and the File System Access backup in `src/lib/offline/storageGuard.ts`/`backup.ts`; backup is best-effort and must never throw into checkout or sync, and restore only accepts files whose userId matches the signed-in user to preserve seller attribution.

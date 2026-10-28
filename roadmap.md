# Offline POS — part 1

## Offline records Phase 2
- [ ] Durable ops, shared ordered sync, chaining and overlay
- [ ] Limited offline forms with cached edit permission
- [ ] Device/owner resolution, pending activity and header counts
- [ ] Backup v2/v1 restore, export and retirement coverage
- [ ] Full tests and automatic production build results; no device verification

## Offline Activity Center and atomic sale activity
- [x] Flag new payloads and preserve legacy logging and credit effects
- [x] Cache loaded activity feeds, counts, goals and owner views per user; show local pending rows without duplication
- [x] Full Bun suite: 135 pass, 0 fail, 394 assertions; initial corrected test failure documented; no browser/device verification

## Shared-stock reservation fix
- [x] Reserve stock across all cashiers on this PC within the same branch
- [x] Test status/branch isolation, catalog refresh without double counting, and unchanged private records
- [x] Full Bun suite: 119 pass, 0 fail, 352 assertions; no browser/device verification

## Sign-out retention
- [x] Preserve all device data on normal sign-out; clear authentication only
- [x] Update sign-out dialog and add separate export-gated retirement action
- [x] Resume same-user queue; show other-cashier count with stock isolation
- [x] Update docs and run full Bun suite: 112 pass, 0 fail, 325 assertions (no browser/device verification)

## Review fixes
- [x] Payload-derived retry mode and permanent-error classification
- [x] Device-only refusal retry/discard and export-protected history
- [x] Full Bun suite: 89 pass, 0 fail; automatic build OK; no browser verification
- [ ] Separate production build verification — manual builds are disabled in this environment; automatic preview build passed

## Part 2
- [x] Pending sales sheet, retry and token-free export
- [x] Online owner reconciliation and sidebar count
- [x] Sign-out retention and separate export-gated retirement cleanup (supersedes export-gated sign-out)
- [x] Recovery/decommissioning docs and acceptance checklist
- [x] Rule tests and simulated browser verification

- [x] Local catalog, durable checkout queue and atomic RPC submission
- [x] Sales integration and offline payment restrictions
- [x] Single sync engine and header status
- [x] Cached sign-in/access fallback and online-only pages
- [x] Guarded PWA app shell and existing-brand icons
- [x] Rule tests and simulated offline browser verification
- [x] Document changed files and verification limitations
- [ ] Real authenticated server checkout and reconnect sync — blocked by unavailable original-app test session
- [ ] Published offline app-shell verification — requires publishing; development intentionally does not register a worker
- [x] Storage protection, automatic backup folder, restore from backup (frontend only)

## Offline read Phase 1
- [x] Shared read cache (Dexie v3 readCache), secrets stripped, size/LRU/30-day limits
- [x] Offline gates fail closed; owner branch selector limited to cached branches
- [x] In-scope pages read-only offline with banners; other routes show Needs internet
- [x] Inventory offline reservations + Addis expiry; Overview unconfirmed sales notice
- [x] Tests (164 pass) and production build
- [ ] Real device offline verification — not performed

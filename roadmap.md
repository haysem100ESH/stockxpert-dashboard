# Offline POS — part 1

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

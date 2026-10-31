# Background offline preparation

## Result
Prepare offline page data quietly after sign-in and reconnect, retaining the existing page designs, live connection, durable outbox and shared read cache. No server changes.

## Implementation
1. Inventory all staff and owner page reads. Extract inline reads into shared query functions; pages and preparation use identical query keys, selections, filters and page sizes. Publish the dataset-to-page/scope/query-key inventory and explicitly list any uncovered datasets.
2. Add one preparation registry: verified access data, active-branch Sales catalog, Inventory, Customers/Suppliers/Medicine Codes, Overview/Activity/Account, then remaining allowed owner branches. Filter denied pages before requesting data; never prepare out-of-scope pages.
3. Complete searchable lists through pagination, with a 20,000-row dataset cap and explicit capped status. Prepare today's activity plus the preceding seven days with the page's actual date descriptors, including counts, goals/progress and owner leaderboard. Pending activities never affect goals.
4. Start after first paint using idle scheduling with a three-second fallback. Run sequentially at low priority, yield to checkout and sync using the existing POS lock, cancel when offline or signed out, and resume on reconnect. Refresh entries after six hours, reconnect and relevant successfully synced changes.
5. Increase the shared read-entry budget to 150 MB per user. Keep eviction limited to LRU read entries, preserving sales, operations, catalog, metadata and backups. Stop lower-priority preparation above 85% estimated quota and show a warning.
6. Add the header indicator and local-only popover: progress, ready/incomplete state, per-page/branch saved times, failures/caps and Prepare now. Preserve missing-cache fallback messages; ready means all required datasets are saved successfully, not just fetched.
7. Add focused Bun tests with fake IndexedDB and mocked requests; run the full suite and inspect automatic preview compilation checks. Update documentation and report files, storage limits, query inventory, counts and failures. No real-device or authenticated-server verification claims.

## Technical safeguards
- Use the existing authoritative `src/lib/db.ts` client and REST cache; never edit protected connection files or use environment values to select a backend.
- Preparation must bind cache attribution to the requested user/branch without changing the visible page's global read scope. Reads completing after sign-out cannot be attributed to another user.
- Await durable cache writes before declaring an entry prepared; rejected, oversized, capped or missing required reads remain incomplete.
- Gate preparation on verified access and retain existing offline fail-closed behavior. Cached permissions never grant server privileges.
- Reuse the existing catalog fetch/replacement path; keep network-heavy low-priority work from holding the checkout lock across an entire registry run.
- This environment runs compilation checks automatically; inspect those results rather than manually invoking prohibited build/typecheck commands.

## Verification
Cover exact request/cache-key parity, registry completeness, ordering, permission filtering, full paging/caps, interruption and reconnect, six-hour freshness, read-only eviction, readiness states and opening a never-visited page offline from prepared data. Preserve all existing tests.
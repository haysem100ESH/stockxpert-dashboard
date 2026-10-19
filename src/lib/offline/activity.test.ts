import 'fake-indexeddb/auto';
import { beforeEach, afterAll, expect, test } from 'bun:test';
import { offlineDb } from './db';
import { newSaleActivityFields, pendingActivityRows, pendingActivityCounts, readActivityCache, saveActivityCache, offlineActivityMessage } from './activity';
import { sale } from './rules.test';
import type { ActivityRow } from '@/hooks/useActivityFeed';

beforeEach(async () => { await offlineDb.open(); await offlineDb.sales.clear(); await offlineDb.meta.clear(); });
afterAll(async () => { await offlineDb.delete(); });
const date = new Date('2026-10-19T08:00:00Z');
const range = { from: new Date('2026-10-19T00:00:00Z'), to: new Date('2026-10-20T00:00:00Z') };
test('new checkout fields request atomic server activity and use ISO device checkout time', () => {
  expect(newSaleActivityFields(date)).toEqual({ server_activity: true, device_created_at: '2026-10-19T08:00:00.000Z' });
});
test('pending activities are private per user and selected by device time rather than business sale date', () => {
  const own = sale('pending'); own.payload.sale_date = '2026-10-01';
  own.summary.items = [{ name: 'Medicine', quantity: 2, unit_price: 10, line_total: 20, sale_type: 'unit' }];
  const other = { ...sale('pending', 'other'), userId: 'other-user' };
  const tomorrow = sale('pending', 'tomorrow'); tomorrow.payload.device_created_at = '2026-10-20T08:00:00Z';
  const rows = pendingActivityRows([own, other, tomorrow], 'user', [], range);
  expect(rows.length).toBe(1);
  expect(rows[0]?.pendingBadge).toBe('Pending sync');
  expect(rows[0]?.metadata.items).toEqual(own.summary.items);
  expect(rows[0]?.created_at).toBe(own.payload.device_created_at);
  expect(rows[0]?.metadata.sale_date).toBe('2026-10-01');
});
test('legacy records missing device timestamp use local creation time', () => {
  const record = sale('pending'); record.payload.device_created_at = '';
  expect(pendingActivityRows([record], 'user', [], range)[0]?.created_at).toBe(record.createdAt);
});
test('pending, syncing, needs-attention and discarded have correct statuses; synced and voided are excluded', () => {
  const records = ['pending', 'syncing', 'needs_attention', 'discarded', 'synced', 'voided'].map(status => sale(status as Parameters<typeof sale>[0], status));
  const attention = records.find(record => record.status === 'needs_attention');
  if (attention) attention.reasonCode = 'PRICE_CHANGED';
  const rows = pendingActivityRows(records, 'user', [], range);
  expect(rows.map(row => row.pendingBadge)).toEqual(['Pending sync', 'Syncing', 'Needs attention: The price has changed. Refresh prices and try again.', 'Discarded — not recorded']);
  expect(rows.length).toBe(4);
});
test('metadata transaction ID hides the local pending row once its server row exists', () => {
  const local = pendingActivityRows([sale('pending')], 'user')[0];
  if (!local) throw new Error('Missing provisional row');
  const server: ActivityRow = { ...local, id: 'server', client_txn_id: undefined, pendingBadge: undefined };
  const pending = pendingActivityRows([sale('pending')], 'user', [server]);
  expect(pending.length).toBe(0);
  expect([...pending, server].length).toBe(1);
});
test('top-level server transaction ID hides a pending row even without metadata ID', () => {
  const local = pendingActivityRows([sale('pending')], 'user')[0];
  if (!local) throw new Error('Missing provisional row');
  expect(pendingActivityRows([sale('pending')], 'user', [{ ...local, id: 'server', metadata: {} }]).length).toBe(0);
});
test('pending counts remain separate for today, Monday-based week and month', () => {
  const today = sale('pending', 'today'); today.payload.device_created_at = '2026-10-21T08:00:00Z';
  const monday = sale('pending', 'monday');
  const earlier = sale('discarded', 'earlier'); earlier.payload.device_created_at = '2026-10-01T08:00:00Z';
  const old = sale('pending', 'old'); old.payload.device_created_at = '2026-09-01T08:00:00Z';
  expect(pendingActivityCounts(pendingActivityRows([today, monday, earlier, old], 'user'), new Date('2026-10-21T12:00:00Z')))
    .toEqual({ today: 1, week: 2, month: 3 });
});
test('feed counts and goals cache round-trip is user and date scoped', async () => {
  const rows = pendingActivityRows([sale('pending')], 'user');
  await saveActivityCache('user', 'feed:2026-10-19', rows, date.toISOString());
  await saveActivityCache('user', 'counts', { today: 3, week: 7, month: 9 }, date.toISOString());
  await saveActivityCache('user', 'goals', [{ id: 'goal', target_count: 10 }], date.toISOString());
  expect((await readActivityCache('user', 'feed:2026-10-19'))?.data).toEqual(rows);
  expect((await readActivityCache('user', 'counts'))?.data).toEqual({ today: 3, week: 7, month: 9 });
  expect((await readActivityCache('user', 'goals'))?.data).toEqual([{ id: 'goal', target_count: 10 }]);
  expect(await readActivityCache('other-user', 'feed:2026-10-19')).toBeUndefined();
  expect(await readActivityCache('user', 'feed:2026-10-20')).toBeUndefined();
});
test('offline banner selects the saved time or cache-miss state; online has no banner', async () => {
  await saveActivityCache('user', 'feed:date', [], date.toISOString());
  const cached = await readActivityCache('user', 'feed:date');
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  expect(offlineActivityMessage(false, cached?.savedAt)).toBe(`Offline — showing activity saved at ${time}`);
  expect(offlineActivityMessage(false)).toBe('This date was not loaded before going offline.');
  expect(offlineActivityMessage(true, cached?.savedAt)).toBeUndefined();
});
test('pending activities and cached views survive IndexedDB close and reopen without changing queued payloads', async () => {
  const record = sale('pending');
  await offlineDb.sales.put(record);
  await saveActivityCache('user', 'feed:date', [], date.toISOString());
  offlineDb.close(); await offlineDb.open();
  const records = await offlineDb.sales.toArray();
  expect(pendingActivityRows(records, 'user', [], range).length).toBe(1);
  expect(records[0]?.payload).toEqual(record.payload);
  expect(records[0]?.payload.server_activity).toBeUndefined();
  expect((await readActivityCache('user', 'feed:date'))?.savedAt).toBe(date.toISOString());
});
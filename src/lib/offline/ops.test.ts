import { beforeEach, afterAll, expect, mock, test } from 'bun:test';
mock.module('./network', () => ({
  withPosLock: (work: () => Promise<unknown>) => new Promise((resolve, reject) => setTimeout(() => { work().then(resolve, reject); }, 0)),
  validSession: async () => true, checkReachability: async () => true,
  callPos: async () => ({ data: null, error: new Error('Not configured') }),
}));
const { offlineDb, OfflineDatabase } = await import('./db');
const { enqueueOp, userOps, overlayRecords, discardOp, retryOp, canEnqueueOp, allowedOpPayload } = await import('./ops');
const { syncOp, recoverUserOps, settleOp, opRequest } = await import('./syncOp');
const { buildBackupDocument } = await import('./backup');
const { parseBackup, restoreBackup } = await import('./restore');
const { exportDocument, exportFingerprint, clearUserDeviceData } = await import('./deviceSafety');
const { pendingOpActivityRows } = await import('./activity');
import type { LocalOp, OpResult } from './opTypes';
const { saveReadEntry, describeRequest, overlayCachedBody } = await import('./readCache');

beforeEach(async () => {
  await offlineDb.open();
  await Promise.all([offlineDb.ops.clear(), offlineDb.sales.clear(), offlineDb.meta.clear(), offlineDb.readCache.clear(), offlineDb.catalog.clear()]);
  await offlineDb.meta.bulkPut([
    { key: 'profile:user', value: { id: 'user', role: 'staff', active: true } },
    { key: 'branches:user', value: ['branch'] }, { key: 'subscription:user', value: { status: 'active' } },
    { key: 'permissions:user', value: { customers: 'edit', suppliers: 'edit', inventory: 'edit' } },
  ]);
});
afterAll(async () => { await offlineDb.delete(); });
const create = (id = 'op', entityId = 'entity') => enqueueOp({ userId: 'user', branchId: 'branch', opType: 'customer.create', opId: id, entityId, values: { name: 'Customer', phone: '123', notes: 'Note', max_credit_limit: 999 } });
const reply = (result: OpResult) => ({ call: async () => ({ data: result, error: null }), sessionValid: async () => true });
test('enqueue commits atomically, accepts only allowed fields and preserves original ID', async () => {
  const op = await create(); expect((await offlineDb.ops.get('op'))?.payload).toEqual({ name: 'Customer', phone: '123', notes: 'Note' });
  expect(await create()).toEqual(op); expect(await offlineDb.ops.count()).toBe(1);
  await expect(enqueueOp({ userId: 'user', branchId: 'branch', opType: 'customer.create', values: { name: ' ' } })).rejects.toThrow('required');
  expect(await offlineDb.ops.count()).toBe(1);
});
test('failed transaction has no partial operation', async () => {
  const original = offlineDb.ops.add.bind(offlineDb.ops);
  offlineDb.ops.add = (...args) => original(...args).then(() => { throw new Error('disk failure'); });
  try { await expect(create()).rejects.toThrow('disk failure'); } finally { offlineDb.ops.add = original; }
  expect(await offlineDb.ops.count()).toBe(0);
});
test('create then two edits chain and sync strictly in order with unchanged prev_op_id', async () => {
  const first = await create('one');
  const second = await enqueueOp({ userId: 'user', branchId: 'branch', entityId: 'entity', opType: 'customer.update', values: { name: 'Second', phone: '123' }, previous: { name: 'Customer', phone: '123' } });
  const third = await enqueueOp({ userId: 'user', branchId: 'branch', entityId: 'entity', opType: 'customer.update', values: { notes: 'Third' }, previous: { notes: 'Note' } });
  expect(second.prevOpId).toBe(first.opId); expect(third.prevOpId).toBe(second.opId); expect(second.payload).toEqual({ name: 'Second' });
  const calls: string[] = []; const deps = { call: async (req: ReturnType<typeof opRequest>) => { calls.push(req.op_id); return { data: { status: 'applied', updated_at: '2026-10-28T12:00:00Z', op_id: req.op_id }, error: null }; }, sessionValid: async () => true };
  await syncOp(third, deps); expect(calls).toEqual([]);
  for (const op of [first, second, third]) await syncOp(op, deps);
  expect(calls).toEqual([first.opId, second.opId, third.opId]);
  expect(opRequest(second).prev_op_id).toBe(first.opId); expect((await userOps('user')).every(o => o.status === 'synced')).toBe(true);
});
for (const status of ['needs_attention', 'discarded'] as const) test(`dependent is not sent when previous is ${status}, then resumes after owner resolution`, async () => {
  const first = await create(); const second = await enqueueOp({ userId: 'user', branchId: 'branch', entityId: 'entity', opType: 'customer.update', values: { name: 'Changed' }, previous: { name: 'Customer' } });
  await offlineDb.ops.update(first.opId, { status }); let sent = 0;
  const deps = { call: async () => { sent++; return { data: { status: 'applied' }, error: null }; }, sessionValid: async () => true };
  await syncOp(second, deps); expect(sent).toBe(0); expect(await offlineDb.ops.get(second.opId)).toMatchObject({ status: 'needs_attention', reasonCode: 'DEPENDS_ON_UNSYNCED', serverIssue: false });
  await settleOp(first, { status: 'applied', updated_at: '2026-10-28T12:00:00Z' }); await syncOp(second, deps); expect(sent).toBe(1);
});
for (const [result, status, serverIssue] of [
  [{ status: 'applied', duplicate: true, updated_at: 'server-time' }, 'synced', false],
  [{ status: 'needs_attention', reason_code: 'VERSION_CONFLICT', details: { server: { name: 'Server' } } }, 'needs_attention', true],
  [{ status: 'rejected', reason_code: 'INVALID_INPUT', reason_detail: 'Invalid name' }, 'needs_attention', false],
] as const) test(`RPC ${result.status} maps to ${status} and owner review ${serverIssue}`, async () => {
  const op = await create(); await syncOp(op, reply(result)); expect(await offlineDb.ops.get(op.opId)).toMatchObject({ status, serverIssue });
});
test('retry after unknown outcome sends byte-identical request and duplicate result changes server once', async () => {
  const op = await create(); const requests: unknown[] = []; let serverWrites = 0; let first = true;
  const deps = { call: async (request: ReturnType<typeof opRequest>) => {
    requests.push(request); if (first) { first = false; serverWrites++; throw new TypeError('Failed to fetch'); }
    return { data: { status: 'applied', duplicate: true, updated_at: '2026-10-28T12:00:00Z' }, error: null };
  }, sessionValid: async () => true };
  await syncOp(op, deps); const retry = await offlineDb.ops.get(op.opId); expect(retry?.status).toBe('pending'); expect(retry?.attempts).toBe(1);
  if (!retry) throw new Error('Missing retry'); await syncOp(retry, deps);
  expect(requests[1]).toEqual(requests[0]); expect(serverWrites).toBe(1); expect((await offlineDb.ops.get(op.opId))?.status).toBe('synced');
});
for (const code of ['23505', '42501', '40001', 'PGRST301']) test(`record error ${code} uses existing classification`, async () => {
  const op = await create(); await syncOp(op, { call: async () => ({ data: null, error: { code, message: 'error' } }), sessionValid: async () => true });
  expect((await offlineDb.ops.get(op.opId))?.status).toBe(['23505', '42501'].includes(code) ? 'needs_attention' : 'pending');
});
test('overlay shows creates once, applies edits without changing cache, excludes others and removes synced ops', async () => {
  const op = await create(); const cache: { id: string; name: string; offlineBadge?: string }[] = [];
  const overlay = overlayRecords(cache, [op, { ...op, opId: 'other', entityId: 'other', userId: 'other' }], 'user', 'customer', ['branch']);
  expect(overlay.length).toBe(1); expect(overlay[0]?.name).toBe('Customer'); expect(cache).toEqual([]);
  expect(overlayRecords([{ id: 'entity', name: 'Server' }], [op], 'user', 'customer').length).toBe(1);
  expect(overlayRecords(cache, [{ ...op, status: 'synced' }], 'user', 'customer')).toEqual([]);
  expect(overlayRecords(cache, [{ ...op, branchId: 'other-branch' }], 'user', 'customer', ['branch'])).toEqual([]);
});
for (const entity of ['customer', 'supplier', 'medicine_code'] as const) test(`${entity} offline permission requires cached edit, not read, and active subscription`, async () => {
  expect(await canEnqueueOp('user', entity, 'branch')).toBe(true);
  await offlineDb.meta.put({ key: 'permissions:user', value: { customers: 'read', suppliers: 'read', inventory: 'read' } });
  expect(await canEnqueueOp('user', entity, 'branch')).toBe(false);
  await offlineDb.meta.put({ key: 'profile:user', value: { id: 'user', role: 'owner' } }); expect(await canEnqueueOp('user', entity, 'branch')).toBe(true);
  await offlineDb.meta.put({ key: 'subscription:user', value: { status: 'expired' } }); expect(await canEnqueueOp('user', entity, 'branch')).toBe(false);
  expect(await canEnqueueOp('other', entity, 'branch')).toBe(false);
});
test('field rules enforce exact limits and changed-only edits; medicine code text immutable offline', () => {
  expect(allowedOpPayload('customer.update', { name: 'Same', phone: 'new', max_credit_limit: 999 }, { name: 'Same', phone: 'old' })).toEqual({ phone: 'new' });
  expect(allowedOpPayload('medicine_code.update', { code: 'CHANGED', label: 'Label', notes: 'Notes', assignment: 'x' })).toEqual({ label: 'Label', notes: 'Notes' });
  for (const [field, size] of [['name', 200], ['phone', 30], ['notes', 2000]] as const) {
    expect(() => allowedOpPayload('customer.create', { name: 'Name', [field]: 'a'.repeat(size) })).not.toThrow();
    expect(() => allowedOpPayload('customer.create', { name: 'Name', [field]: 'a'.repeat(size + 1) })).toThrow('characters');
  }
  expect(() => allowedOpPayload('supplier.create', { name: 'Supplier', email: 'bad' })).toThrow('email');
  expect(() => allowedOpPayload('medicine_code.create', { code: 'x'.repeat(51), label: 'Label' })).toThrow('50');
});
test('backup v2 preserves own ops, v1 restores; duplicate IDs skipped; retirement requires current export', async () => {
  const op = await create(); const other = { ...op, opId: 'other', userId: 'other' }; await offlineDb.ops.add(other);
  const doc = buildBackupDocument([], 'user', 'device', new Date(), [op, other]); expect(doc.version).toBe(2); expect(doc.ops?.map(o => o.opId)).toEqual([op.opId]);
  const parsed = parseBackup(JSON.stringify(doc), 'user'); await offlineDb.ops.delete(op.opId);
  expect((await restoreBackup(parsed, 'user')).restored).toBe(1); expect((await restoreBackup(parsed, 'user')).present).toBe(1);
  expect((await restoreBackup(parseBackup(JSON.stringify({ ...doc, version: 1, ops: undefined }), 'user'), 'user')).restored).toBe(0);
  const records = await userOps('user'); expect(exportDocument([], 'user', [op, other]).ops.length).toBe(1);
  await expect(clearUserDeviceData('user')).rejects.toThrow('Export');
  await clearUserDeviceData('user', exportFingerprint([], records)); expect(await offlineDb.ops.get('other')).toEqual(other);
  expect(await userOps('user')).toEqual([]);
});
test('server issues cannot be discarded; local rejection requires note; owner void remains audit history', async () => {
  const op = await create(); await settleOp(op, { status: 'needs_attention', reason_code: 'DUPLICATE_PHONE' });
  await expect(discardOp('user', op.opId, 'note')).rejects.toThrow('locally'); await expect(retryOp('user', op.opId)).rejects.toThrow('owner');
  await settleOp(op, { status: 'rejected', reason_code: 'INVALID_INPUT' }); await expect(discardOp('user', op.opId, '')).rejects.toThrow('note');
  await discardOp('user', op.opId, 'Reviewed'); expect((await offlineDb.ops.get(op.opId))?.discardNote).toBe('Reviewed');
  await settleOp(op, { status: 'voided', resolution_note: 'Owner decision' }); expect(await offlineDb.ops.get(op.opId)).toMatchObject({ status: 'discarded', ownerVoided: true, discardNote: 'Owner decision' });
});
test('pending record activities are private, date filtered, and deduplicated by either server ID location', async () => {
  const op = await create(); const rows = pendingOpActivityRows([op, { ...op, opId: 'other', userId: 'other' }], 'user');
  expect(rows.length).toBe(1); expect(rows[0]?.activity_type).toBe('create_customer');
  expect(pendingOpActivityRows([op], 'user', [{ ...rows[0], client_txn_id: op.opId } as any])).toEqual([]);
  expect(pendingOpActivityRows([op], 'user', [{ ...rows[0], client_txn_id: null, metadata: { op_id: op.opId } } as any])).toEqual([]);
  expect(pendingOpActivityRows([{ ...op, status: 'synced' }], 'user')).toEqual([]);
  expect(pendingOpActivityRows([op], 'user', [], { to: new Date('2000-01-01') })).toEqual([]);
});
test('same-user recovery resets only own syncing ops and persists through database reopen', async () => {
  const op = await create(); await offlineDb.ops.put({ ...op, status: 'syncing' }); await offlineDb.ops.add({ ...op, opId: 'other', userId: 'other', status: 'syncing' });
  offlineDb.close(); await offlineDb.open(); await recoverUserOps('user');
  expect((await offlineDb.ops.get(op.opId))?.status).toBe('pending'); expect((await offlineDb.ops.get('other'))?.status).toBe('syncing');
  await syncOp(op, reply({ status: 'applied' })); expect((await offlineDb.ops.get(op.opId))?.status).toBe('synced');
});
test('Dexie v4 table coexists with all earlier stores', async () => {
  const db = new OfflineDatabase('phase2-schema-test'); await db.open(); expect(db.verno).toBe(4);
  expect(db.tables.map(t => t.name).sort()).toEqual(['catalog', 'meta', 'ops', 'readCache', 'sales']); await db.delete();
});
test('cached server updated_at is preserved exactly through chained edits and read overlay does not overwrite the snapshot', async () => {
  const updated_at = '2026-10-28T10:00:00.123456+00:00';
  const req = describeRequest('https://example.test/rest/v1/customers?select=*&branch_id=eq.branch&order=name');
  const data = JSON.stringify([{ id: 'entity', name: 'Old', phone: '123', branch_id: 'branch', updated_at }]);
  await saveReadEntry('user', 'branch', req, 200, data, null);
  const op = await enqueueOp({ userId: 'user', branchId: 'branch', opType: 'customer.update', entityId: 'entity', values: { name: 'New', phone: '123' }, previous: { name: 'Old', phone: '123' } });
  expect(op.baseUpdatedAt).toBe(updated_at); expect(opRequest(op).base_updated_at).toBe(updated_at);
  const overlay = JSON.parse(await overlayCachedBody(data, req, 'user', 'branch') ?? '[]');
  expect(overlay[0].name).toBe('New'); expect(overlay[0].offlineBadge).toBe('Pending sync');
  expect((await offlineDb.readCache.toArray())[0]?.data).toBe(data);
  expect(await overlayCachedBody(data, req, 'other', 'branch')).toBe(data);
});
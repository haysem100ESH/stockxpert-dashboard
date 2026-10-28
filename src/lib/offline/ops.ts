import { offlineDb, readMeta } from './db';
import { withPosLock } from './network';
import { OP_FIELDS, opBadge, type EntityType, type LocalOp, type OpType } from './opTypes';
import type { CachedProfile } from './types';
import { stockPayload, stockContext, stockOnDevice, batchAvailableOnDevice } from './stock';

export const entityPath = (entity: EntityType) => `/rest/v1/${entity === 'medicine_code' ? 'medicine_codes' : `${entity}s`}`;
export const entityForPath = (path: string): EntityType | undefined =>
  (['customer', 'supplier', 'medicine_code'] as EntityType[]).find(e => entityPath(e) === path);
export function allowedOpPayload(type: OpType, values: Record<string, unknown>, previous?: Record<string, unknown>) {
  if (type.startsWith('stock.')) return stockPayload(type, values);
  const [entity, action] = type.split('.') as [EntityType, string];
  const fields = OP_FIELDS[entity];
  if (!fields || !['create', 'update'].includes(action)) throw new Error('Unsupported operation.');
  const payload: Record<string, string | null> = {};
  for (const field of fields) {
    if (action === 'update' && field === 'code') continue;
    if (!(field in values)) continue;
    if (values[field] != null && typeof values[field] !== 'string') throw new Error(`${field} must be text.`);
    const value = typeof values[field] === 'string' ? values[field].trim() : '';
    const normalized = value || null;
    const before = typeof previous?.[field] === 'string' ? previous[field].trim() || null : previous?.[field] ?? null;
    if (action === 'update' && previous && normalized === before) continue;
    payload[field] = normalized;
  }
  for (const required of entity === 'medicine_code' ? ['code', 'label'] : ['name']) {
    if ((action === 'create' || required in payload) && !payload[required]) throw new Error(`${required === 'name' ? 'Name' : required} is required.`);
  }
  const limits: Record<string, number> = { name: 200, label: 200, phone: 30, notes: 2000, code: 50 };
  for (const [field, max] of Object.entries(limits)) if ((payload[field]?.length ?? 0) > max) throw new Error(`${field} must be ${max} characters or fewer.`);
  if (payload.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) throw new Error('Enter a valid email address.');
  if (!Object.keys(payload).length) throw new Error('No changed fields to save.');
  return payload;
}
export async function canEnqueueOp(userId: string, entity: EntityType, branchId: string) {
  const [profile, branches, subscription, permissions] = await Promise.all([
    readMeta<CachedProfile>(`profile:${userId}`), readMeta<string[]>(`branches:${userId}`),
    readMeta<{ status: string }>(`subscription:${userId}`), readMeta<Record<string, string>>(`permissions:${userId}`),
  ]);
  if (!profile || profile.id !== userId || profile.active === false || profile.manually_deactivated || !branches?.includes(branchId)
    || !subscription || !['active', 'expiring_soon'].includes(subscription.status)) return false;
  return profile.role === 'owner' || (profile.role === 'staff' && permissions?.[entity === 'medicine_code' || entity === 'stock' ? 'inventory' : `${entity}s`] === 'edit');
}
export async function cachedEntity(userId: string, entity: EntityType, entityId: string, branchId: string) {
  const entries = await offlineDb.readCache.where('[userId+path]').equals([userId, entityPath(entity)]).toArray();
  for (const entry of entries.sort((a, b) => b.savedAt.localeCompare(a.savedAt))) {
    try {
      const parsed = JSON.parse(entry.data); const rows = Array.isArray(parsed) ? parsed : [parsed];
      const row = rows.find(r => r?.id === entityId && (entity === 'medicine_code' || r.branch_id === branchId));
      if (row && typeof row.updated_at === 'string') return row as Record<string, unknown>;
    } catch { /* ignore malformed snapshots */ }
  }
}
export async function enqueueOp(input: { userId: string; branchId: string; opType: OpType; entityId?: string;
  values: Record<string, unknown>; previous?: Record<string, unknown>; opId?: string }, checkPermission = true) {
  const entityType = input.opType.split('.')[0] as EntityType;
  const entityId = input.entityId ?? crypto.randomUUID(); const opId = input.opId ?? crypto.randomUUID();
  return withPosLock(async () => {
    if (checkPermission && !await canEnqueueOp(input.userId, entityType, input.branchId)) throw new Error('Open this page online with edit permission before saving offline.');
    const context = entityType === 'stock' ? await stockContext(input.userId, String(input.values.branch_item_id ?? input.previous?.branch_item_id ?? ''), input.branchId) : undefined;
    const server = entityType === 'stock' ? undefined : await cachedEntity(input.userId, entityType, entityId, input.branchId);
    const payload = allowedOpPayload(input.opType, input.values, input.previous);
    return offlineDb.transaction('rw', offlineDb.ops, offlineDb.sales, offlineDb.catalog, offlineDb.readCache, async () => {
      const existing = await offlineDb.ops.get(opId);
      if (existing) {
        if (existing.userId !== input.userId || existing.entityId !== entityId || JSON.stringify(existing.payload) !== JSON.stringify(payload)) throw new Error('Operation ID already in use.');
        return existing;
      }
      const prior = (await offlineDb.ops.where('entityId').equals(entityId).toArray())
        .filter(o => o.userId === input.userId && o.entityType === entityType && o.branchId === input.branchId && ['pending', 'syncing', 'needs_attention'].includes(o.status))
        .sort((a, b) => b.deviceCreatedAt.localeCompare(a.deviceCreatedAt));
      const dependsOn: string[] = [];
      let itemId: string | undefined;
      if (entityType === 'stock') {
        if (!context?.item) throw new Error('Open this item online once before changing stock offline.');
        itemId = String(context.item.id);
        if (input.opType === 'stock.receive') {
          if (context.ops.some(o => o.entityId === entityId && o.opType === 'stock.receive')) throw new Error('This batch ID is already in use.');
          if (payload.supplier_id) {
            const supplier = (await offlineDb.ops.where('entityId').equals(String(payload.supplier_id)).toArray())
              .filter(o => o.userId === input.userId && o.branchId === input.branchId && o.opType === 'supplier.create' && o.status !== 'synced');
            dependsOn.push(...supplier.map(o => o.opId));
          }
        } else {
          if (!context.batchKnown) throw new Error('Open the batches online once before adjusting stock offline.');
          if (payload.branch_item_id && context.batches.length) throw new Error('This item has batches. Choose a batch.');
          const batch = payload.batch_id ? context.batches.find(b => b.id === payload.batch_id) : undefined;
          if (payload.batch_id && !batch) throw new Error('Open this batch online once before adjusting it offline.');
          if (entityId !== (payload.batch_id ?? payload.branch_item_id)) throw new Error('Stock adjustment target does not match its ID.');
          const available = batch ? batchAvailableOnDevice(batch.id, context.batches, context.sales, itemId, input.branchId) :
            stockOnDevice(Number(context.item.quantity), itemId, input.branchId, context.ops, context.sales);
          if (available + Number(payload.delta) < -0.00001) throw new Error(`Not enough stock on this PC: ${available} available.`);
          const receive = context.ops.find(o => o.entityId === entityId && o.opType === 'stock.receive' && o.status !== 'synced');
          if (receive) dependsOn.push(receive.opId);
        }
      }
      const baseUpdatedAt = typeof server?.updated_at === 'string' ? server.updated_at : prior[0]?.baseUpdatedAt;
      if (input.opType.endsWith('.update') && !baseUpdatedAt && !prior.some(o => o.opType.endsWith('.create'))) throw new Error('Open this record online once before editing it offline.');
      // Millisecond ties must not let a third edit chain to the first edit.
      const now = new Date(Math.max(Date.now(), prior[0] ? Date.parse(prior[0].deviceCreatedAt) + 1 : 0)).toISOString();
      const op: LocalOp = { opId, userId: input.userId, branchId: input.branchId, opType: input.opType, entityType, entityId,
        payload, baseUpdatedAt, prevOpId: prior[0]?.opId, ...(entityType === 'stock' ? { stockItemId: itemId } : {}),
        dependsOn: [...new Set([...dependsOn, ...(prior[0] ? [prior[0].opId] : [])])], deviceCreatedAt: now, updatedAt: now, status: 'pending', attempts: 0 };
      await offlineDb.ops.add(op); return op;
    });
  });
}
/** Pure, user-scoped overlay. Cached snapshots are never modified. Discards show an audit badge without applying their fields. */
export function overlayRecords<T extends { id: string }>(rows: T[], ops: LocalOp[], userId: string, entity: EntityType, branches?: string[]): T[] {
  const map = new Map(rows.map(r => [r.id, { ...r }]));
  for (const op of [...ops].sort((a, b) => a.deviceCreatedAt.localeCompare(b.deviceCreatedAt))) {
    if (op.userId !== userId || op.entityType !== entity || (branches && !branches.includes(op.branchId)) || op.status === 'synced') continue;
    const existing = map.get(op.entityId);
    if (op.status === 'discarded') {
      if (existing) map.set(op.entityId, { ...existing, offlineBadge: opBadge(op) });
      continue;
    }
    if (!existing && op.opType.endsWith('.update')) continue;
    map.set(op.entityId, { ...(existing ?? { id: op.entityId, branch_id: op.branchId, created_at: op.deviceCreatedAt,
      totalPurchases: 0, totalPaid: 0, totalDebt: 0, credit_score: 50, max_credit_limit: 0, max_credit_limit_raw: null }),
      ...op.payload, computed_debt: (existing as Record<string, unknown> | undefined)?.computed_debt ?? 0, offlineBadge: opBadge(op) } as T);
  }
  return [...map.values()];
}
export async function userOps(userId: string) { return offlineDb.ops.where('userId').equals(userId).sortBy('deviceCreatedAt'); }
export async function retryOp(userId: string, opId: string) {
  await withPosLock(async () => {
    const op = await offlineDb.ops.get(opId);
    if (!op || op.userId !== userId || op.ownerVoided || op.serverIssue || !['pending', 'needs_attention'].includes(op.status)) throw new Error('This change is waiting for owner review.');
    await offlineDb.ops.update(opId, { status: 'pending', attempts: 0, nextAttemptAt: Date.now(), updatedAt: new Date().toISOString() });
  });
}
export async function discardOp(userId: string, opId: string, note: string) {
  if (!note.trim()) throw new Error('Enter a note before discarding this change.');
  await withPosLock(async () => {
    const op = await offlineDb.ops.get(opId);
    if (!op || op.userId !== userId || op.serverIssue || op.status !== 'needs_attention') throw new Error('Only a locally refused change can be discarded.');
    const now = new Date().toISOString();
    await offlineDb.ops.update(opId, { status: 'discarded', discardNote: note.trim(), discardedAt: now, updatedAt: now });
  });
}
export async function duplicateWarning(userId: string, entity: EntityType, values: Record<string, unknown>, entityId?: string) {
  const entries = await offlineDb.readCache.where('[userId+path]').equals([userId, entityPath(entity)]).toArray();
  const rows = entries.flatMap(e => { try { const data = JSON.parse(e.data); return Array.isArray(data) ? data : [data]; } catch { return []; } });
  const local = overlayRecords(rows, await userOps(userId), userId, entity);
  const fields = entity === 'medicine_code' ? ['code'] : ['phone', 'name'];
  return fields.some(field => values[field] && local.some(r => r.id !== entityId && String(r[field] ?? '').trim().toLowerCase() === String(values[field]).trim().toLowerCase()))
    ? 'A matching record is saved on this PC. Saved anyway — the server will check for duplicates.' : undefined;
}
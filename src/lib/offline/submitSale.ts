import type { LocalSale, PosPayload, RpcResult, SaleSummary } from './types';
import { callPos, checkReachability, validSession, withPosLock } from './network';
import { offlineDb } from './db';
import { enqueueSale, settleSale } from './queue';
import { hasCredit, reasonMessage } from './rules';
import { saleEffects } from './effects';
import { fetchCatalog, replaceCatalog } from './catalog';
import { signalSync } from './store';

export type SubmitResult = { status: 'synced' | 'saved'; message?: string; saleId?: string };
export async function submitSale(payload: PosPayload, userId: string, summary: SaleSummary, creditScore?: number): Promise<SubmitResult> {
  return withPosLock(async () => {
    const existing = await offlineDb.sales.get(payload.client_txn_id);
    if (existing) {
      if (existing.status === 'synced') return { status: 'synced', saleId: existing.serverSaleId };
      if (existing.status === 'needs_attention' || existing.status === 'voided') throw new Error(existing.lastError ?? reasonMessage(existing.reasonCode));
      return { status: 'saved', message: hasCredit(existing.payload) ? 'Could not confirm credit sale — it will be retried; do not re-enter it' : 'Saved on this device — will sync automatically' };
    }
    const reachable = await checkReachability();
    const now = new Date().toISOString();
    const record: LocalSale = { clientTxnId: payload.client_txn_id, userId, branchId: payload.branch_id,
      payload, summary, creditScore, mode: reachable ? 'online' : 'offline', status: 'pending', attempts: 0, createdAt: now, updatedAt: now };
    if (!reachable) {
      await enqueueSale(record, true);
      signalSync();
      return { status: 'saved', message: 'Saved on this device (not yet confirmed by server)' };
    }
    if (!await validSession(userId)) throw new Error('Please sign in again before confirming this sale. Your cart has been kept.');
    let result: RpcResult | undefined;
    try {
      const { data, error } = await callPos(payload, 'online');
      if (error) throw error;
      if (!data || !['synced', 'rejected', 'needs_attention', 'voided'].includes(data.status)) throw new Error('Unknown server outcome');
      result = data as RpcResult;
    } catch (error) {
      // The server may already have committed. Persist the SAME payload/id.
      await enqueueSale({ ...record, lastError: error instanceof Error ? error.message : 'Could not confirm server outcome' }, false);
      signalSync();
      return { status: 'saved', message: hasCredit(payload)
        ? 'Could not confirm credit sale — it will be retried; do not re-enter it'
        : 'Saved on this device — will sync automatically' };
    }
    if (result.status === 'rejected') throw new Error(reasonMessage(result.reason_code, result.reason_detail));
    if (result.status !== 'synced') {
      await settleSale(record, result);
      signalSync();
      return { status: 'saved', message: reasonMessage(result.reason_code, result.reason_detail) };
    }
    // A confirmed server sale must clear the cart even if the device cache fails.
    try { await settleSale(record, result); } catch { /* Server is authoritative. */ }
    await saleEffects(record, result);
    try {
      const rows = await fetchCatalog([payload.branch_id], userId);
      await offlineDb.transaction('rw', offlineDb.catalog, offlineDb.meta, () => replaceCatalog([payload.branch_id], userId, rows));
    } catch { /* Conservative snapshot remains until next refresh. */ }
    signalSync();
    window.dispatchEvent(new Event('app:refresh'));
    return { status: 'synced', saleId: result.sale_id };
  });
}
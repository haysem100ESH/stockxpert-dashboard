import { offlineDb } from './db';
import { callPos, validSession } from './network';
import { errorCode, errorMessage, isPermanentPosError } from './errors';
import { settleSale } from './queue';
import { retryDelay, retryMode } from './rules';
import type { LocalSale, RpcResult } from './types';

// Caller holds the shared POS lock; dependencies allow exact retry tests without a session.
export async function syncSale(record: LocalSale, deps: {
  call: (payload: LocalSale['payload'], mode: LocalSale['mode']) => Promise<{ data: unknown; error: unknown }>;
  sessionValid: () => Promise<boolean>;
} = { call: callPos, sessionValid: () => validSession(record.userId) }): Promise<RpcResult | undefined> {
  await offlineDb.sales.update(record.clientTxnId, { status: 'syncing', updatedAt: new Date().toISOString() });
  let result: RpcResult;
  try {
    const { data, error } = await deps.call(record.payload, retryMode(record.payload));
    if (error) throw error;
    if (!data || typeof data !== 'object' || !('status' in data) || !['synced', 'needs_attention', 'voided', 'rejected'].includes(String(data.status))) throw new Error('Unknown server outcome');
    result = data as RpcResult;
  } catch (error) {
    const attempts = record.attempts + 1;
    const permanent = await isPermanentPosError(error, deps.sessionValid);
    await offlineDb.sales.update(record.clientTxnId, {
      status: permanent ? 'needs_attention' : 'pending', attempts,
      nextAttemptAt: permanent ? undefined : Date.now() + retryDelay(attempts),
      issueId: undefined, reasonCode: permanent ? errorCode(error) : undefined,
      reasonDetail: undefined, lastError: errorMessage(error), updatedAt: new Date().toISOString(),
    });
    return;
  }
  // Storage failures are not RPC failures and must not be classified as such.
  await settleSale(record, result);
  return result;
}
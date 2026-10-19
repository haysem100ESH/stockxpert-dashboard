import { logActivity } from '@/lib/activityLog';
import { updateCreditScore } from '@/hooks/useCreditScore';
import type { LocalSale, RpcResult } from './types';

export async function saleEffects(record: LocalSale, result: RpcResult) {
  // Idempotent RPC duplicates must not repeat credit penalties or activity.
  if (result.duplicate) return;
  const unpaid = record.payload.total_amount - record.payload.amount_paid;
  if (unpaid > 0.001 && record.payload.customer_id && record.creditScore !== undefined) {
    try {
      await updateCreditScore({ customerId: record.payload.customer_id, currentScore: record.creditScore,
        changeAmount: -5, reason: `New debt from sale (ETB ${unpaid.toFixed(2)} unpaid)`, createdBy: record.userId, branchId: record.branchId });
    } catch { /* Checkout is already confirmed; never retry it for a side effect. */ }
  }
  void logActivity({ type: 'sell_item', entityType: 'sale', entityId: result.sale_id,
    metadata: { ...record.summary, payment_method: record.payload.payment_method,
      discount: record.payload.discount_amount, sale_date: record.payload.sale_date, client_txn_id: record.clientTxnId } });
}
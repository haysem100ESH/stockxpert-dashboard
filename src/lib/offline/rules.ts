import type { LocalSale, PosPayload } from './types';

export const RESERVING_STATUSES = ['pending', 'syncing', 'needs_attention'] as const;
export const SYNCED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const hasCredit = (p: PosPayload) => p.amount_paid < p.total_amount || p.deduct_debt_amount > 0;
export const retryDelay = (attempts: number) => Math.min(300_000, 30_000 * 2 ** Math.max(0, attempts - 1));
export function availableStock(serverAvailable: number, itemId: string, records: LocalSale[]): number {
  const reserved = records.filter(s => RESERVING_STATUSES.some(status => status === s.status))
    .reduce((sum, s) => sum + s.payload.items.filter(i => i.branch_item_id === itemId)
      .reduce((n, i) => n + i.base_quantity, 0), 0);
  return Math.max(0, Number((serverAvailable - reserved).toFixed(4)));
}
export function batchAvailable(fallback: number, batches: Array<{ remaining_quantity: number; expiry_date: string | null }>, today: string): number {
  if (!batches.length) return fallback;
  return batches.reduce((sum, b) => sum + (b.remaining_quantity > 0 && (!b.expiry_date || b.expiry_date >= today) ? Number(b.remaining_quantity) : 0), 0);
}
const messages: Record<string, string> = {
  INSUFFICIENT_STOCK: 'Not enough sellable stock. Reduce the quantity or remove the item.',
  STOCK_EXPIRED: 'This stock has expired and cannot be sold.',
  PRICE_CHANGED: 'The price has changed. Refresh the catalog and review the cart.',
  PACKAGING_CHANGED: 'The packaging has changed. Remove this item and add it again.',
  ITEM_NOT_IN_BRANCH: 'An item is no longer available in this branch.',
  INVALID_TOTALS: 'The sale totals do not match. Review the discount and cart.',
  INVALID_LINE_TOTAL: 'An item total does not match its quantity and price. Add it again.',
  INVALID_QUANTITY: 'Enter a valid positive quantity for every item.',
  INVALID_PAYMENT: 'The payment amount is invalid. Review the amount received.',
  PAYMENT_METHOD_REQUIRED: 'Select a payment method before confirming.',
  FUTURE_SALE_DATE: 'The sale date cannot be in the future.',
  CREDIT_NOT_ALLOWED_OFFLINE: 'Offline sales must be fully paid. Customer credit and debt deduction need internet.',
  CUSTOMER_REQUIRED_FOR_CREDIT: 'Select a customer for a partially paid sale.',
  CUSTOMER_NOT_IN_PHARMACY: 'This customer does not belong to your pharmacy.',
  INVALID_DEBT_DEDUCTION: 'The debt deduction is invalid. Review the customer debt and change.',
  BRANCH_NOT_AUTHORIZED: 'You are not allowed to sell in this branch.',
  USER_NOT_ALLOWED_TO_SELL: 'Your account does not have permission to make sales.',
  EMPTY_SALE: 'Add at least one item to the cart.',
  MISSING_IDS: 'The sale is missing item or branch details. Refresh and try again.',
  UNKNOWN_SELLER: 'Your seller account could not be verified. Sign in again.',
};
export function reasonMessage(code?: string, detail?: Record<string, unknown>): string {
  const message = messages[code ?? ''] ?? 'This sale needs review. Contact the owner before entering it again.';
  const item = typeof detail?.item === 'string' ? ` Item: ${detail.item}.` : '';
  const available = typeof detail?.available === 'number' ? ` Available: ${detail.available}.` : '';
  const price = typeof detail?.current_unit_price === 'number' ? ` Current unit price: ${detail.current_unit_price.toFixed(2)}.` : '';
  return message + item + available + price;
}
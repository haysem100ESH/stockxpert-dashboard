import { describe, expect, test } from 'bun:test';
import { availableStock, batchAvailable, hasCredit, retryDelay, SYNCED_RETENTION_MS } from './rules';
import { pwaRefused } from './registerPwa';
import type { LocalSale, PosPayload } from './types';

export const payload: PosPayload = { client_txn_id: 'txn', branch_id: 'branch', sale_date: '2026-10-19',
  device_created_at: '2026-10-19T08:00:00Z', payment_method: 'Cash', discount_amount: 0,
  total_amount: 20, amount_paid: 20, change_action: null, extra_profit: 0, customer_id: null, deduct_debt_amount: 0,
  items: [{ branch_item_id: 'item', medicine_id: 'med', sale_type: 'strip', level_flow: true,
    quantity: 1, base_quantity: 2, unit_price: 20, total_price: 20, strip_quantity: 1, pack_quantity: 0, stripes_sold: 1000 }] };
export function sale(status: LocalSale['status'], id = 'txn'): LocalSale {
  return { clientTxnId: id, branchId: 'branch', userId: 'user', payload: { ...payload, client_txn_id: id },
    mode: 'offline', status, attempts: 0, summary: { total: 20, items: [] }, createdAt: '2026-10-19T08:00:00Z', updatedAt: '2026-10-19T08:00:00Z' };
}
describe('offline POS rules', () => {
  test('19 total units with 7 expired units means 12 sellable, not 19', () => {
    expect(batchAvailable(19, [{ remaining_quantity: 7, expiry_date: '2026-10-18' }, { remaining_quantity: 12, expiry_date: null }], '2026-10-19')).toBe(12);
  });
  test('today’s expiry remains sellable', () => {
    expect(batchAvailable(19, [{ remaining_quantity: 12, expiry_date: '2026-10-19' }], '2026-10-19')).toBe(12);
  });
  test('no batches uses branch quantity', () => { expect(batchAvailable(19, [], '2026-10-19')).toBe(19); });
  test('depleted batches never fall back to branch quantity', () => {
    expect(batchAvailable(19, [{ remaining_quantity: 0, expiry_date: null }], '2026-10-19')).toBe(0);
  });
  for (const status of ['pending', 'syncing', 'needs_attention'] as const) {
    test(`${status} reserves base quantity`, () => { expect(availableStock(12, 'item', [sale(status)])).toBe(10); });
  }
  for (const status of ['synced', 'voided', 'discarded'] as const) {
    test(`${status} no longer reserves`, () => { expect(availableStock(12, 'item', [sale(status)])).toBe(12); });
  }
  test('partial payment is a credit component', () => { expect(hasCredit({ ...payload, amount_paid: 19 })).toBe(true); });
  test('debt deduction is a credit component even when fully paid', () => { expect(hasCredit({ ...payload, deduct_debt_amount: 1 })).toBe(true); });
  test('fully paid sale without debt is not credit', () => { expect(hasCredit(payload)).toBe(false); });
  test('retry backoff caps at five minutes', () => { expect(retryDelay(1)).toBe(30_000); expect(retryDelay(9)).toBe(300_000); });
  test('synced retention is 30 days', () => { expect(SYNCED_RETENTION_MS).toBe(30 * 24 * 60 * 60 * 1000); });
  test('worker never registers in dev', () => { expect(pwaRefused(false, false, 'app.example.com', '')).toBe(true); });
  test('worker never registers inside iframe', () => { expect(pwaRefused(true, true, 'app.example.com', '')).toBe(true); });
  test('worker kill switch blocks registration', () => { expect(pwaRefused(true, false, 'app.example.com', '?sw=off')).toBe(true); });
  for (const host of ['id-preview--abc.lovable.app', 'preview--abc.lovable.app', 'lovableproject.com', 'x.lovableproject.com', 'x.lovableproject-dev.com', 'beta.lovable.dev', 'x.beta.lovable.dev']) {
    test(`worker refuses ${host}`, () => { expect(pwaRefused(true, false, host, '')).toBe(true); });
  }
  test('published top-level app can register', () => { expect(pwaRefused(true, false, 'app.example.com', '')).toBe(false); });
});
import { expect, test, mock } from 'bun:test';
mock.module('@/lib/db', () => ({ supabase: {} }));
const { validateReconcileAction } = await import('./reconciliation');
test('void requires a nonblank note', () => {
  expect(() => validateReconcileAction('INSUFFICIENT_STOCK', 'void', '   ')).toThrow('note');
  expect(() => validateReconcileAction('INSUFFICIENT_STOCK', 'void', 'Customer refunded')).not.toThrow();
});
test('accept charged price is restricted to PRICE_CHANGED', () => {
  expect(() => validateReconcileAction('PRICE_CHANGED', 'accept_price_retry', '')).not.toThrow();
  expect(() => validateReconcileAction('PACKAGING_CHANGED', 'accept_price_retry', '')).toThrow('price conflict');
});
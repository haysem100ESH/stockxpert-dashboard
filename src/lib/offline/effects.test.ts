import { expect, test } from 'bun:test';

// Existing checkout suites mock effects globally. Use a fresh Bun process to exercise the real module.
function checkEffects(flag: boolean, duplicate: boolean, credit: boolean) {
  const program = `
    import { mock } from 'bun:test';
    let logs = [], credits = [];
    mock.module('@/lib/activityLog', () => ({ logActivity: async input => { logs.push(input); } }));
    mock.module('@/hooks/useCreditScore', () => ({ updateCreditScore: async input => { credits.push(input); } }));
    const { saleEffects } = await import('./src/lib/offline/effects.ts');
    const payload = { server_activity: ${flag ? 'true' : 'undefined'}, total_amount: 20, amount_paid: ${credit ? 10 : 20},
      customer_id: ${credit ? "'customer'" : 'null'}, payment_method: 'Cash', discount_amount: 0, sale_date: '2026-10-19' };
    await saleEffects({ payload, userId: 'user', branchId: 'branch', clientTxnId: 'txn', creditScore: 50, summary: { total: 20, items: [] } },
      { status: 'synced', sale_id: 'sale-id', duplicate: ${duplicate} });
    console.log(JSON.stringify({ logs, credits }));
  `;
  const result = Bun.spawnSync(['bun', '-e', program], { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' });
  if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr));
  return JSON.parse(new TextDecoder().decode(result.stdout));
}
test('flagged sale effects never call client logActivity', () => {
  expect(checkEffects(true, false, false).logs).toEqual([]);
});
test('legacy unflagged sale effects still log exactly one sell_item', () => {
  const result = checkEffects(false, false, false);
  expect(result.logs.length).toBe(1);
  expect(result.logs[0].type).toBe('sell_item');
  expect(result.logs[0].metadata.client_txn_id).toBe('txn');
});
test('duplicate flagged and legacy sale effects skip logging and credit changes', () => {
  expect(checkEffects(true, true, true)).toEqual({ logs: [], credits: [] });
  expect(checkEffects(false, true, true)).toEqual({ logs: [], credits: [] });
});
test('flagged underpaid customer sale retains the unchanged credit-score penalty', () => {
  const result = checkEffects(true, false, true);
  expect(result.logs).toEqual([]);
  expect(result.credits.length).toBe(1);
  expect(result.credits[0].changeAmount).toBe(-5);
  expect(result.credits[0].reason).toBe('New debt from sale (ETB 10.00 unpaid)');
  expect(result.credits[0].createdBy).toBe('user');
});
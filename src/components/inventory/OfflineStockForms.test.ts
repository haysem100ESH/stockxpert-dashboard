import { expect, test } from 'bun:test';

// Isolate DOM/native detection and module mocks from the IndexedDB business suites.
test('offline Edit Batch cannot write absolute quantities; Adjust Stock queues a delta through the offline form', () => {
  const result = Bun.spawnSync(['bun', 'src/test/offlineStockFormsRender.tsx'], {
    cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe',
  });
  if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr));
  expect(new TextDecoder().decode(result.stdout)).toContain('Offline stock form regression passed');
}, 20_000);
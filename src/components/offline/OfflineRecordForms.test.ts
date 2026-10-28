import { test, expect } from 'bun:test';
test('offline customer and supplier forms enqueue allowed changes only; credit controls and read permission block writes', () => {
  const result = Bun.spawnSync(['bun', 'src/test/offlineRecordFormsRender.tsx'], { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' });
  if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr));
  expect(new TextDecoder().decode(result.stdout)).toContain('Offline record form rules passed');
});
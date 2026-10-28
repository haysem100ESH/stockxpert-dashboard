import { expect, test } from 'bun:test';

// A separate process prevents existing offline suites' module/window mocks from leaking
// into the DOM render, and keeps Radix's browser detection isolated from those suites.
test('cached route offline: device panel actions run, page dialog writes remain blocked', () => {
  const result = Bun.spawnSync(['bun', 'src/test/offlineReadGuardRender.tsx'], {
    cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe',
  });
  if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr));
  expect(new TextDecoder().decode(result.stdout)).toContain('Offline panel regression passed');
});
import { test, expect } from 'bun:test';

// Each role runs in its own process: the render check installs module mocks and DOM globals.
for (const role of ['staff', 'owner'] as const) {
  test(`${role}: every page read is prepared with the same cache key; never-visited pages open offline from prepared data; list paging completes and caps`, () => {
    const result = Bun.spawnSync(['bun', 'src/test/offlinePrepareRender.tsx'], { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe', env: { ...process.env, PREP_ROLE: role } });
    const out = new TextDecoder().decode(result.stdout);
    if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr).split('\n').filter(l => !/width\(0\)|please check the style|minWidth|height and width|Supabase batching/.test(l)).slice(-40).join('\n'));
    expect(out).toContain(`Offline preparation (${role}) passed`);
  }, 120_000);
}

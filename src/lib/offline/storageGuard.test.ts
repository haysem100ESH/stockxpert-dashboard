import { expect, test } from 'bun:test';
import { isPrivateLike, needsProtectionWarning, offlineBlockReason, OFFLINE_BLOCKED_MESSAGE, probeStorage } from './storageGuard';

const MB = 1024 * 1024;
test('already persisted does not request persistence again', async () => {
  let asked = 0;
  const info = await probeStorage({ persisted: async () => true, persist: async () => { asked++; return true; }, estimate: async () => ({ quota: 50 * MB, usage: 5 }) });
  expect(asked).toBe(0); expect(info).toEqual({ persisted: true, quota: 50 * MB, usage: 5, privateLike: false });
});
test('not persisted requests persist() and uses its answer', async () => {
  let asked = 0;
  const info = await probeStorage({ persisted: async () => false, persist: async () => { asked++; return true; }, estimate: async () => ({ quota: 10 * MB }) });
  expect(asked).toBe(1); expect(info.persisted).toBe(true); expect(info.privateLike).toBe(false);
});
test('missing storage API is unsupported, not private', async () => {
  expect(await probeStorage(undefined as never)).toEqual({ persisted: 'unsupported', quota: undefined, usage: undefined, privateLike: false });
});
test('privateLike heuristic: refused persistence and quota below 300 MB', () => {
  expect(isPrivateLike(false, 299 * MB)).toBe(true);
  expect(isPrivateLike(false, 300 * MB)).toBe(false);
  expect(isPrivateLike(true, 100 * MB)).toBe(false);
  expect(isPrivateLike('unsupported', 100 * MB)).toBe(false);
});
test('offline block and warning decisions', () => {
  expect(offlineBlockReason({ persisted: false, quota: 100 * MB, privateLike: true })).toBe(OFFLINE_BLOCKED_MESSAGE);
  expect(offlineBlockReason({ persisted: true, quota: 10e9, privateLike: false }, 'IndexedDB failed')).toBe(OFFLINE_BLOCKED_MESSAGE);
  expect(offlineBlockReason({ persisted: false, quota: 10e9, privateLike: false })).toBeUndefined();
  expect(needsProtectionWarning({ persisted: false, quota: 10e9, privateLike: false })).toBe(true);
  expect(needsProtectionWarning({ persisted: true, quota: 10e9, privateLike: false })).toBe(false);
  expect(needsProtectionWarning({ persisted: false, quota: 100 * MB, privateLike: true })).toBe(false);
});

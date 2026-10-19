import { expect, test } from 'bun:test';
import { errorMessage, isPermanentPosError } from './errors';

for (const code of ['22003', '22P02', '23503', '23505', '23514', '42501']) {
  test(`${code} is permanent without session validation`, async () => {
    let validations = 0;
    expect(await isPermanentPosError({ code }, async () => { validations++; return false; })).toBe(true);
    expect(validations).toBe(0);
  });
}
for (const valid of [true, false]) {
  test(`28000 is permanent only with valid session (${valid})`, async () => {
    let validations = 0;
    expect(await isPermanentPosError({ code: '28000' }, async () => { validations++; return valid; })).toBe(valid);
    expect(validations).toBe(1);
  });
}
for (const code of ['PGRST301', 'PGRST500', '40001', '40P01', '57014', undefined]) {
  test(`${code ?? 'no code'} is temporary`, async () => {
    expect(await isPermanentPosError({ code, message: 'Failure' }, async () => true)).toBe(false);
  });
}
for (const error of [new DOMException('Aborted', 'AbortError'), new Error('Timeout'), new TypeError('Failed to fetch'), { status: 503, message: 'Unavailable' }]) {
  test(`${error.message} without SQLSTATE is temporary`, async () => {
    expect(await isPermanentPosError(error, async () => true)).toBe(false);
  });
}
test('PostgREST plain-object messages are retained', () => {
  expect(errorMessage({ code: '23505', message: 'constraint failed' })).toBe('constraint failed');
});
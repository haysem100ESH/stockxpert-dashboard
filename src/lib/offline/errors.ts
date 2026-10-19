export function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return;
  return typeof error.code === 'string' ? error.code : undefined;
}
export function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') return error.message;
  return 'Could not confirm server outcome';
}
export async function isPermanentPosError(error: unknown, sessionValid: () => Promise<boolean>): Promise<boolean> {
  const code = errorCode(error);
  if (!code) return false;
  if (/^(22|23)[0-9A-Z]{3}$/.test(code) || code === '42501') return true;
  return code === '28000' ? sessionValid() : false;
}
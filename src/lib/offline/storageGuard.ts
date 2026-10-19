import { getOfflineState, setOfflineState } from './store';

export interface StorageInfo { persisted: boolean | 'unsupported'; quota?: number; usage?: number; privateLike: boolean }
type StorageLike = { persisted?: () => Promise<boolean>; persist?: () => Promise<boolean>; estimate?: () => Promise<{ quota?: number; usage?: number }> };

export const PRIVATE_QUOTA_BYTES = 300 * 1024 * 1024;
export const OFFLINE_BLOCKED_MESSAGE = 'Offline sales are disabled in this window. Open PharmaXpert from its installed app icon (not a private window).';
export const NOT_PROTECTED_WARNING = 'This browser has not protected your offline data. Install the app (install icon in the address bar) and open it from that icon.';

// Chrome/Edge incognito: never persisted and a small fixed quota.
export const isPrivateLike = (persisted: boolean | 'unsupported', quota?: number) =>
  persisted === false && typeof quota === 'number' && quota < PRIVATE_QUOTA_BYTES;

export async function probeStorage(storage: StorageLike | undefined = typeof navigator !== 'undefined' ? (navigator as Navigator & { storage?: StorageLike }).storage : undefined): Promise<StorageInfo> {
  let persisted: boolean | 'unsupported' = 'unsupported';
  try {
    if (storage?.persisted) {
      persisted = await storage.persisted();
      if (!persisted && storage.persist) persisted = await storage.persist();
    }
  } catch { persisted = storage?.persisted ? false : 'unsupported'; }
  let quota: number | undefined; let usage: number | undefined;
  try { const estimate = await storage?.estimate?.(); quota = estimate?.quota; usage = estimate?.usage; } catch { /* unknown */ }
  return { persisted, quota, usage, privateLike: isPrivateLike(persisted, quota) };
}

/** Returns a blocking message when offline checkout must not run, otherwise undefined. */
export function offlineBlockReason(info: StorageInfo | undefined, storageError?: string): string | undefined {
  return info?.privateLike || storageError ? OFFLINE_BLOCKED_MESSAGE : undefined;
}
/** Not protected but usable: the cashier must acknowledge a warning once per session. */
export const needsProtectionWarning = (info: StorageInfo | undefined) => !!info && info.persisted === false && !info.privateLike;

export async function refreshStorageProtection(storage?: StorageLike): Promise<StorageInfo> {
  const info = await probeStorage(storage ?? (typeof navigator !== 'undefined' ? (navigator as Navigator & { storage?: StorageLike }).storage : undefined));
  setOfflineState({ storage: info });
  return info;
}

let checkedThisSession = false;
/** Called right before an offline save; re-requests persistence once per session. */
export async function ensureOfflineSaveAllowed(storage?: StorageLike): Promise<string | undefined> {
  let info = getOfflineState().storage;
  if (!checkedThisSession || !info) { info = await refreshStorageProtection(storage); checkedThisSession = true; }
  return offlineBlockReason(info, getOfflineState().storageError);
}
export function resetStorageSession() { checkedThisSession = false; }

const ACK_KEY = 'pharmaxpert-storage-warning-ack';
export function warningAcknowledged() { try { return sessionStorage.getItem(ACK_KEY) === '1'; } catch { return false; } }
export function acknowledgeWarning() { try { sessionStorage.setItem(ACK_KEY, '1'); } catch { /* memory only */ } }

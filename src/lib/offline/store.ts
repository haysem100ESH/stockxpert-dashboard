import { useSyncExternalStore } from 'react';
import type { Connection, LocalSale } from './types';
import type { StorageInfo } from './storageGuard';

export type BackupStatus =
  | { state: 'unsupported' } | { state: 'not_set_up' } | { state: 'paused' }
  | { state: 'failing'; reason: string } | { state: 'ok'; at: string };
interface OfflineState {
  connection: Connection;
  reachable: boolean;
  pendingCount: number;
  needsAttentionCount: number;
  lastSuccessfulSync?: string;
  records: LocalSale[];
  storageError?: string;
  storage?: StorageInfo;
  backup: BackupStatus;
}
let state: OfflineState = {
  connection: typeof navigator !== 'undefined' && navigator.onLine ? 'online' : 'offline',
  reachable: typeof navigator !== 'undefined' && navigator.onLine,
  pendingCount: 0, needsAttentionCount: 0, records: [], backup: { state: 'not_set_up' },
};
const listeners = new Set<() => void>();
export const getOfflineState = () => state;
export function setOfflineState(patch: Partial<OfflineState>) {
  state = { ...state, ...patch };
  listeners.forEach(listener => listener());
}
export function useOfflineStatus() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, getOfflineState, getOfflineState);
}
export function signalSync() { window.dispatchEvent(new Event('pos:queue')); }
/** Ask the backup writer to flush now (after a new offline save). Never throws. */
export function signalBackupNow() { try { window.dispatchEvent(new Event('pos:backup-now')); } catch { /* backup is best effort */ } }

import { useSyncExternalStore } from 'react';
import type { Connection, LocalSale } from './types';

interface OfflineState {
  connection: Connection;
  reachable: boolean;
  pendingCount: number;
  needsAttentionCount: number;
  lastSuccessfulSync?: string;
  records: LocalSale[];
  storageError?: string;
}
let state: OfflineState = {
  connection: typeof navigator !== 'undefined' && navigator.onLine ? 'online' : 'offline',
  reachable: typeof navigator !== 'undefined' && navigator.onLine,
  pendingCount: 0, needsAttentionCount: 0, records: [],
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
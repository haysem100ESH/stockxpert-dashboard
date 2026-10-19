import { useEffect, useState, useCallback } from 'react';

const STORAGE_KEY = 'expiry_alert_days';
const DEFAULT_DAYS = 60; // 2 months

function readStored(): number {
  if (typeof window === 'undefined') return DEFAULT_DAYS;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_DAYS;
}

export function useExpiryThreshold() {
  const [days, setDaysState] = useState<number>(readStored);

  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setDaysState(readStored());
    };
    const local = () => setDaysState(readStored());
    window.addEventListener('storage', handler);
    window.addEventListener('expiry-threshold-changed', local as EventListener);
    return () => {
      window.removeEventListener('storage', handler);
      window.removeEventListener('expiry-threshold-changed', local as EventListener);
    };
  }, []);

  const setDays = useCallback((n: number) => {
    const clamped = Math.max(1, Math.min(365, Math.floor(n)));
    window.localStorage.setItem(STORAGE_KEY, String(clamped));
    setDaysState(clamped);
    window.dispatchEvent(new Event('expiry-threshold-changed'));
  }, []);

  return { days, setDays, defaultDays: DEFAULT_DAYS };
}

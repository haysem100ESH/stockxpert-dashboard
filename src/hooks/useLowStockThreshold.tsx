import { useEffect, useState, useCallback } from 'react';

const STORAGE_KEY = 'global_low_stock_threshold';
const DEFAULT_THRESHOLD = 10;
const EVENT_NAME = 'low-stock-threshold-changed';

function readStored(): number {
  if (typeof window === 'undefined') return DEFAULT_THRESHOLD;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  const n = raw ? parseFloat(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_THRESHOLD;
}

export function getGlobalLowStockThreshold(): number {
  return readStored();
}

export function useLowStockThreshold() {
  const [threshold, setThresholdState] = useState<number>(readStored);

  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setThresholdState(readStored());
    };
    const local = () => setThresholdState(readStored());
    window.addEventListener('storage', handler);
    window.addEventListener(EVENT_NAME, local as EventListener);
    return () => {
      window.removeEventListener('storage', handler);
      window.removeEventListener(EVENT_NAME, local as EventListener);
    };
  }, []);

  const setThreshold = useCallback((n: number) => {
    const clamped = Math.max(0, Math.min(100000, n));
    window.localStorage.setItem(STORAGE_KEY, String(clamped));
    setThresholdState(clamped);
    window.dispatchEvent(new Event(EVENT_NAME));
  }, []);

  return { threshold, setThreshold, defaultThreshold: DEFAULT_THRESHOLD };
}

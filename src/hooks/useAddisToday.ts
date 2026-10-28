import { useEffect, useState } from 'react';
import { addisDayString } from '@/lib/timezone';

/** Current Africa/Addis_Ababa day (YYYY-MM-DD); re-checks every minute so it rolls over at midnight. */
export function useAddisToday() {
  const [today, setToday] = useState(() => addisDayString());
  useEffect(() => {
    const timer = setInterval(() => setToday(prev => { const next = addisDayString(); return next === prev ? prev : next; }), 60_000);
    return () => clearInterval(timer);
  }, []);
  return today;
}

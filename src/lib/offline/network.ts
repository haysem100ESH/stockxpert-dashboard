import { supabase } from '@/lib/db';
import { setOfflineState } from './store';

export async function checkReachability(): Promise<boolean> {
  if (!navigator.onLine) { setOfflineState({ reachable: false, connection: 'offline' }); return false; }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const { error } = await supabase.from('pharmacy_branches').select('id').limit(1).abortSignal(controller.signal);
    // Auth errors prove reachability; session validation handles them separately.
    const reachable = !error || error.code === 'PGRST301' || error.code === 'PGRST303' || error.code === '42501';
    setOfflineState({ reachable, connection: reachable ? 'online' : 'offline' });
    return reachable;
  } catch { setOfflineState({ reachable: false, connection: 'offline' }); return false; }
  finally { clearTimeout(timer); }
}
export async function validSession(userId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session || data.session.user.id !== userId) throw new Error('Sign in required');
    if ((data.session.expires_at ?? 0) <= Math.floor(Date.now() / 1000) + 30) {
      const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError || refreshed.session?.user.id !== userId) throw new Error('Sign in required');
    }
    return true;
  } catch { setOfflineState({ connection: 'sign_in_required' }); return false; }
}
export async function callPos(payload: unknown, mode: 'online' | 'offline') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try { return await supabase.rpc('process_pos_sale', { p_payload: payload, p_mode: mode }).abortSignal(controller.signal); }
  finally { clearTimeout(timer); }
}
export async function withPosLock<T>(work: () => Promise<T>): Promise<T> {
  // Fallback covers browsers without Web Locks; Dexie serializes local writes.
  if (navigator.locks) return navigator.locks.request('pos-sync', work);
  return work();
}
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/db';

/** Read only the SDK's existing persisted session; never store another token. */
export function readPersistedSession(): Session | null {
  try {
    const host = new URL(supabase.supabaseUrl).hostname.split('.')[0];
    const raw = localStorage.getItem(`sb-${host}-auth-token`);
    if (!raw) return null;
    const candidate = JSON.parse(raw) as Partial<Session>;
    if (!candidate.user?.id || !candidate.access_token || !candidate.refresh_token) return null;
    return candidate as Session;
  } catch { return null; }
}
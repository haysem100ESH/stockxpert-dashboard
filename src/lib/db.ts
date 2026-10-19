// Type-bypass helper for Supabase queries that reference tables
// not yet reflected in the auto-generated types.ts (which only contains 'todos').
// All application tables live in the real database; this cast lets TypeScript compile.
import { supabase as _supabase } from '@/integrations/supabase/client';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db = _supabase as any;

// Re-export as `supabase` so files that import `db` and still use `supabase.xxx`
// can destructure it without another import.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const supabase = _supabase as any;


import { supabase } from '@/lib/db';
import type { PosPayload, RpcResult } from './types';
export type ReconcileAction = 'retry' | 'accept_price_retry' | 'void';
export interface SyncIssue {
  id: string; branch_id: string; submitted_by: string; created_at: string; status: string;
  reason_code: string; reason_detail?: Record<string, unknown>; payload: PosPayload;
  sale_id?: string; resolution_note?: string;
  branchName?: string; submitterName?: string; itemNames?: Record<string, string>;
}
export function validateReconcileAction(reason: string, action: ReconcileAction, note: string) {
  if (action === 'accept_price_retry' && reason !== 'PRICE_CHANGED') throw new Error('Charged-price retry is only available for a price conflict.');
  if (action === 'void' && !note.trim()) throw new Error('Enter a note before voiding this sale.');
}
export async function reconcileIssue(issue: SyncIssue, action: ReconcileAction, note = ''): Promise<RpcResult> {
  validateReconcileAction(issue.reason_code, action, note);
  const { data, error } = await supabase.rpc('reconcile_pos_sync_issue', { p_issue_id: issue.id, p_action: action, p_note: note.trim() || null });
  if (error) throw new Error('Could not confirm the result. Refresh the issues before trying again.');
  if (!data || !['synced', 'needs_attention', 'voided'].includes(data.status)) throw new Error('The server result could not be confirmed. Refresh the list.');
  return data as RpcResult;
}
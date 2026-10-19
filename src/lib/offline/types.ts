import type { SalesMedicine } from '@/hooks/useSalesInventory';
import type { Packaging } from '@/lib/packaging';

export type SaleStatus = 'pending' | 'syncing' | 'synced' | 'needs_attention' | 'voided';
export type Connection = 'online' | 'offline' | 'syncing' | 'needs_attention' | 'sign_in_required';
export interface PosItem {
  branch_item_id: string;
  medicine_id: string;
  sale_type: 'unit' | 'strip' | 'pack';
  level_flow: boolean;
  quantity: number;
  unit_price: number;
  total_price: number;
  base_quantity: number;
  strip_quantity: number;
  pack_quantity: number;
  stripes_sold: number | null;
}
export interface PosPayload {
  client_txn_id: string;
  branch_id: string;
  sale_date: string;
  device_created_at: string;
  payment_method: string;
  discount_amount: number;
  total_amount: number;
  amount_paid: number;
  change_action: 'keep_change' | 'give_change' | null;
  extra_profit: number;
  customer_id: string | null;
  deduct_debt_amount: number;
  items: PosItem[];
}
export interface SaleSummary {
  branch_name?: string;
  items: Array<{ name: string; quantity: number; line_total: number; unit_price: number; sale_type: string }>;
  total: number;
  customer_name?: string | null;
}
export interface LocalSale {
  clientTxnId: string;
  branchId: string;
  userId: string;
  payload: PosPayload;
  mode: 'online' | 'offline';
  status: SaleStatus;
  attempts: number;
  lastError?: string;
  reasonCode?: string;
  reasonDetail?: Record<string, unknown>;
  serverSaleId?: string;
  issueId?: string;
  summary: SaleSummary;
  createdAt: string;
  updatedAt: string;
  syncedAt?: string;
  nextAttemptAt?: number;
  creditScore?: number;
}
export interface CatalogItem extends SalesMedicine {
  branchId: string;
  ownerKey: string;
  packaging: Packaging | null;
  serverAvailable: number;
  cachedAt: string;
}
export interface CachedProfile {
  id: string;
  role: 'owner' | 'staff' | 'developer';
  branch_id?: string;
  full_name: string;
  pharmacy_name?: string;
  active?: boolean;
  manually_deactivated?: boolean;
}
export interface RpcResult {
  status: 'synced' | 'rejected' | 'needs_attention' | 'voided';
  sale_id?: string;
  duplicate?: boolean;
  issue_id?: string;
  reason_code?: string;
  reason_detail?: Record<string, unknown>;
}
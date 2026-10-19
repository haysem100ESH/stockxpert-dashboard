import { supabase } from '@/lib/db';

export interface InventoryBatch {
  id: string;
  branch_id: string;
  medicine_id: string;
  branch_item_id: string | null;
  supplier_id: string | null;
  batch_number: string | null;
  quantity: number;
  remaining_quantity: number;
  purchase_price: number;
  selling_price: number;
  expiry_date: string | null;
  created_by: string | null;
  created_at: string;
}

/**
 * Create a new inventory batch and sync branch_items.quantity
 */
export async function createBatch(params: {
  branchId: string;
  medicineId: string;
  branchItemId: string;
  supplierId?: string | null;
  batchNumber?: string | null;
  quantity: number;
  purchasePrice: number;
  sellingPrice: number;
  expiryDate?: string | null;
  createdBy?: string | null;
  minStockLevel?: number | null;
  expiryAlertDays?: number | null;
}): Promise<{ error: any; batch: any }> {
  const insertPayload: any = {
    branch_id: params.branchId,
    medicine_id: params.medicineId,
    branch_item_id: params.branchItemId,
    supplier_id: params.supplierId || null,
    batch_number: params.batchNumber || null,
    quantity: params.quantity,
    remaining_quantity: params.quantity,
    purchase_price: params.purchasePrice,
    selling_price: params.sellingPrice,
    expiry_date: params.expiryDate || null,
    created_by: params.createdBy || null,
  };
  if (params.minStockLevel != null) insertPayload.min_stock_level = params.minStockLevel;
  if (params.expiryAlertDays != null) insertPayload.expiry_alert_days = params.expiryAlertDays;

  const { data: batch, error } = await supabase
    .from('inventory_batches')
    .insert(insertPayload)
    .select()
    .single();


  if (error) return { error, batch: null };

  // Sync branch_items.quantity = SUM(remaining_quantity)
  await syncBranchItemQuantity(params.branchItemId);

  return { error: null, batch };
}

/**
 * Sync branch_items.quantity to be SUM of all batch remaining_quantities
 */
export async function syncBranchItemQuantity(branchItemId: string): Promise<void> {
  const { data: batches } = await supabase
    .from('inventory_batches')
    .select('remaining_quantity')
    .eq('branch_item_id', branchItemId)
    .gt('remaining_quantity', 0);

  const rawTotal = (batches || []).reduce((sum: number, b: any) => sum + Number(b.remaining_quantity), 0);
  // Snap tiny float drift back to integer (e.g. 19.9999 → 20).
  const rounded = Math.round(rawTotal);
  const totalQty = Math.abs(rawTotal - rounded) < 0.001 ? rounded : Number(rawTotal.toFixed(4));

  await supabase
    .from('branch_items')
    .update({ quantity: totalQty, updated_at: new Date().toISOString() })
    .eq('id', branchItemId);
}

/**
 * Get batches for a branch_item ordered by FIFO (earliest non-expired
 * expiry first, then earliest created_at). Expired batches are EXCLUDED
 * from sale so the next non-expired batch is automatically brought to the
 * front. Expired batch rows remain in the database for audit/visibility.
 */
export async function getFIFOBatches(branchItemId: string): Promise<InventoryBatch[]> {
  const today = new Date().toISOString().split('T')[0];
  const { data } = await supabase
    .from('inventory_batches')
    .select('*')
    .eq('branch_item_id', branchItemId)
    .gt('remaining_quantity', 0)
    .or(`expiry_date.is.null,expiry_date.gte.${today}`)
    .order('expiry_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });

  return (data || []) as InventoryBatch[];
}

/**
 * FIFO deduction: deducts quantity from oldest batches first.
 * Returns array of { batchId, quantity, purchasePrice } consumed.
 */
export async function deductFIFO(
  branchItemId: string,
  totalQtyToDeduct: number
): Promise<{ consumed: Array<{ batchId: string; quantity: number; purchasePrice: number }>; error: any }> {
  const batches = await getFIFOBatches(branchItemId);
  const consumed: Array<{ batchId: string; quantity: number; purchasePrice: number }> = [];
  let remaining = totalQtyToDeduct;

  // Snap-to-integer helper: eliminates float drift (e.g. 9.9999 → 10)
  // when callers deal in whole-unit quantities (tablets, strips, packs).
  const snap = (n: number) => {
    const r = Math.round(n);
    return Math.abs(n - r) < 0.001 ? r : Number(n.toFixed(4));
  };

  for (const batch of batches) {
    if (remaining <= 0) break;

    const batchRem = Number(batch.remaining_quantity);
    const deduct = Math.min(remaining, batchRem);
    const newRemaining = Math.max(0, snap(batchRem - deduct));

    const { error } = await supabase
      .from('inventory_batches')
      .update({ remaining_quantity: newRemaining, updated_at: new Date().toISOString() })
      .eq('id', batch.id);

    if (error) return { consumed, error };

    consumed.push({
      batchId: batch.id,
      quantity: deduct,
      purchasePrice: Number(batch.purchase_price),
    });

    remaining -= deduct;
  }

  // Sync branch_items.quantity
  await syncBranchItemQuantity(branchItemId);

  return { consumed, error: null };
}

/**
 * Record sale_item_batches after FIFO deduction
 */
export async function recordSaleItemBatches(
  saleItemId: string,
  consumed: Array<{ batchId: string; quantity: number; purchasePrice: number }>
): Promise<{ error: any }> {
  if (consumed.length === 0) return { error: null };

  const rows = consumed.map(c => ({
    sale_item_id: saleItemId,
    batch_id: c.batchId,
    quantity: c.quantity,
    purchase_price: c.purchasePrice,
  }));

  const { error } = await supabase.from('sale_item_batches').insert(rows);
  return { error };
}

/**
 * Get all batches for a branch item (for batch breakdown UI)
 */
export async function getBatchesForItem(branchItemId: string): Promise<InventoryBatch[]> {
  const { data } = await supabase
    .from('inventory_batches')
    .select('*')
    .eq('branch_item_id', branchItemId)
    .order('created_at', { ascending: false });

  return (data || []) as InventoryBatch[];
}

/**
 * Get expiring/expired batches across branches
 */
export async function getExpiryBatches(branchIds: string[]): Promise<{
  expired: InventoryBatch[];
  expiringSoon: InventoryBatch[];
}> {
  const now = new Date();
  const thirtyDaysFromNow = new Date();
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

  const { data: allBatches } = await supabase
    .from('inventory_batches')
    .select('*')
    .in('branch_id', branchIds)
    .gt('remaining_quantity', 0)
    .not('expiry_date', 'is', null)
    .order('expiry_date', { ascending: true });

  const batches = (allBatches || []) as InventoryBatch[];
  const today = now.toISOString().split('T')[0];
  const soon = thirtyDaysFromNow.toISOString().split('T')[0];

  return {
    expired: batches.filter(b => b.expiry_date && b.expiry_date <= today),
    expiringSoon: batches.filter(b => b.expiry_date && b.expiry_date > today && b.expiry_date <= soon),
  };
}

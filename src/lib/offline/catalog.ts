import { supabase } from '@/lib/db';
import { chunkedIn } from '@/lib/supabaseBatch';
import type { SalesMedicine } from '@/hooks/useSalesInventory';
import type { Packaging } from '@/lib/packaging';
import { offlineDb, readMeta } from './db';
import { batchAvailable } from './rules';
import { withPosLock } from './network';
import type { CatalogItem } from './types';

export interface CachedBranch { id: string; name: string; is_main_branch: boolean; branch_type: string }
export async function allowedBranches(userId: string): Promise<string[]> {
  return await readMeta<string[]>(`branches:${userId}`) ?? [];
}
export async function fetchCatalog(branchIds: string[], userId: string): Promise<CatalogItem[]> {
  const allowed = await allowedBranches(userId);
  if (!branchIds.every(id => allowed.includes(id))) throw new Error('Branch is not authorized on this device. Connect to refresh your access.');
  const items = await chunkedIn<any>(branchIds, ids => supabase.from('branch_items')
    .select('id, medicine_id, branch_id, selling_price, purchase_price, quantity, expiry_date')
    .in('branch_id', ids).order('created_at', { ascending: false }));
  if (!items.length) return [];
  const medicineIds = [...new Set<string>(items.map(item => item.medicine_id))];
  const [medicines, batches, packaging, branches] = await Promise.all([
    chunkedIn<any>(medicineIds, ids => supabase.from('medicines').select('id, name, generic_name, category, item_type, unit_label, units_per_pack, medicine_group, strength, packaging_mode, main_unit_name, unit_price').in('id', ids), 20),
    // Include depleted rows too: zero live batches is not a legacy fallback.
    chunkedIn<any>(items.map(item => item.id), ids => supabase.from('inventory_batches')
      .select('branch_item_id, remaining_quantity, expiry_date, selling_price, purchase_price, created_at').in('branch_item_id', ids), 20),
    chunkedIn<any>(medicineIds, ids => supabase.from('medicine_packaging').select('*').in('medicine_id', ids), 20),
    chunkedIn<any>(branchIds, ids => supabase.from('pharmacy_branches').select('id, name').in('id', ids)),
  ]);
  const medMap = new Map(medicines.map(m => [m.id, m]));
  const pkgMap = new Map(packaging.map(p => [p.medicine_id, p as Packaging]));
  const branchMap = new Map(branches.map(b => [b.id, b.name]));
  const cachedAt = new Date().toISOString();
  const today = cachedAt.split('T')[0];
  return items.map(item => {
    const med = medMap.get(item.medicine_id);
    if (!med) throw new Error('Some item details could not be loaded. Keeping the previous catalog.');
    const itemBatches = batches.filter(b => b.branch_item_id === item.id);
    const serverAvailable = batchAvailable(Number(item.quantity), itemBatches, today);
    const front = itemBatches.filter(b => b.remaining_quantity > 0 && (!b.expiry_date || b.expiry_date >= today))
      .sort((a, b) => (a.expiry_date ?? '9999').localeCompare(b.expiry_date ?? '9999') || a.created_at.localeCompare(b.created_at))[0];
    return {
      ...med, id: item.id, medicine_id: item.medicine_id,
      branch_id: item.branch_id, branchId: item.branch_id, ownerKey: userId,
      branch_name: branchMap.get(item.branch_id),
      selling_price: Number(front?.selling_price ?? item.selling_price),
      purchase_price: Number(front?.purchase_price ?? item.purchase_price),
      expiry_date: front ? front.expiry_date : item.expiry_date,
      stock_quantity: serverAvailable, serverAvailable, open_pack_units: 0,
      packaging: pkgMap.get(item.medicine_id) ?? null, cachedAt,
    } satisfies SalesMedicine & CatalogItem;
  });
}
export async function replaceCatalog(branchIds: string[], userId: string, rows: CatalogItem[]) {
  for (const branchId of branchIds) {
    await offlineDb.catalog.where('branchId').equals(branchId).and(row => row.ownerKey === userId).delete();
    await offlineDb.meta.put({ key: `catalogSync:${userId}:${branchId}`, value: new Date().toISOString() });
  }
  await offlineDb.catalog.bulkPut(rows);
}
export async function refreshCatalog(branchIds: string[], userId: string): Promise<void> {
  if (!branchIds.length) return;
  await withPosLock(async () => {
    const rows = await fetchCatalog(branchIds, userId);
    await offlineDb.transaction('rw', offlineDb.catalog, offlineDb.meta, () => replaceCatalog(branchIds, userId, rows));
  });
}
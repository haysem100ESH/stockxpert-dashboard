import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/db';
import { useBranchContext } from '@/hooks/useBranchContext';
import { Info } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  medicineId?: string | null;
  branchItemId?: string | null;
  /** Optional fallback values shown immediately while data loads */
  fallbackName?: string;
}

interface InfoData {
  name?: string;
  generic_name?: string | null;
  medicine_group?: string | null;
  strength?: string | null;
  manufacturer?: string | null;
  batch_number?: string | null;
  expiry_date?: string | null;
  category?: string | null;
  unit_label?: string | null;
  item_type?: string | null;
  active_ingredients?: { ingredient_name: string; strength: string | null }[];
  packaging_mode?: string | null;
  units_per_pack?: number | null;
  selling_price?: number | null;
  unit_price?: number | null;
}

export default function MedicineInfoDialog({ open, onOpenChange, medicineId, branchItemId, fallbackName }: Props) {
  const { branchType } = useBranchContext();
  const isPharmacy = branchType === 'pharmacy';
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<InfoData | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setData(null);
      try {
        let medId = medicineId || null;
        let branchSellingPrice: number | null = null;
        if (branchItemId) {
          // branch_items only stores medicine_id + selling_price; batch_number,
          // expiry_date and unit_label live on inventory_batches / medicines.
          const { data: bi } = await supabase
            .from('branch_items')
            .select('medicine_id, selling_price')
            .eq('id', branchItemId)
            .maybeSingle();
          if (bi) {
            medId = medId || bi.medicine_id;
            branchSellingPrice = bi.selling_price;
          }
        }

        let med: any = null;
        if (medId) {
          const { data: m } = await supabase
            .from('medicines')
            .select('name, generic_name, medicine_group, strength, manufacturer, category, item_type, unit_label, packaging_mode, units_per_pack, unit_price')
            .eq('id', medId)
            .maybeSingle();
          med = m;
        }

        // Latest active batch (if any) for batch number/expiry.
        // inventory_batches uses `remaining_quantity` (not quantity_remaining).
        let latestBatch: any = null;
        if (branchItemId) {
          const { data: b } = await supabase
            .from('inventory_batches')
            .select('batch_number, expiry_date, remaining_quantity')
            .eq('branch_item_id', branchItemId)
            .gt('remaining_quantity', 0)
            .order('expiry_date', { ascending: true })
            .limit(1);
          latestBatch = b?.[0] || null;
        }

        let ingredients: any[] = [];
        if (medId) {
          const { data: ing } = await supabase
            .from('medicine_active_ingredients')
            .select('ingredient_name, strength')
            .eq('medicine_id', medId);
          ingredients = ing || [];
        }

        if (cancelled) return;
        setData({
          name: med?.name || fallbackName,
          generic_name: med?.generic_name,
          medicine_group: med?.medicine_group,
          strength: med?.strength,
          manufacturer: med?.manufacturer,
          batch_number: latestBatch?.batch_number || null,
          expiry_date: latestBatch?.expiry_date || null,
          category: med?.category,
          unit_label: med?.unit_label,
          item_type: med?.item_type,
          active_ingredients: ingredients,
          packaging_mode: med?.packaging_mode,
          units_per_pack: med?.units_per_pack,
          selling_price: branchSellingPrice,
          unit_price: med?.unit_price,
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, medicineId, branchItemId, fallbackName]);

  const Row = ({ label, value }: { label: string; value: any }) => {
    if (value === null || value === undefined || value === '') return null;
    return (
      <div className="flex justify-between gap-3 text-sm py-1.5 border-b border-border/50 last:border-0">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium text-right">{value}</span>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Info className="h-5 w-5 text-primary" />
            {isPharmacy ? 'Medicine Info' : 'Item Info'}
          </DialogTitle>
          <DialogDescription>{data?.name || fallbackName || 'Details'}</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-8 flex items-center justify-center gap-2 text-muted-foreground text-sm">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            Loading...
          </div>
        ) : data ? (
          <div className="space-y-1">
            <Row label="Name" value={data.name} />
            {isPharmacy && <Row label="Generic Name" value={data.generic_name} />}
            {isPharmacy && <Row label="Group" value={data.medicine_group} />}
            {isPharmacy && <Row label="Strength" value={data.strength} />}
            <Row label="Manufacturer" value={data.manufacturer} />
            {isPharmacy && <Row label="Batch Number" value={data.batch_number} />}
            {isPharmacy && <Row label="Expiry Date" value={data.expiry_date ? new Date(data.expiry_date).toLocaleDateString() : null} />}
            <Row label="Category" value={data.category && <Badge variant="outline">{data.category}</Badge>} />
            <Row label="Unit" value={data.unit_label} />
            <Row label="Container" value={data.packaging_mode} />
            {isPharmacy && <Row label="Type" value={data.item_type} />}

            {/* Multi-level packaging summary */}
            {data.units_per_pack && (
              <div className="pt-2">
                <div className="text-sm text-muted-foreground mb-1">Packaging Hierarchy</div>
                <div className="text-sm bg-muted/50 rounded-md p-2 space-y-0.5">
                  <div>• 1 {data.packaging_mode || 'Pack'} = {data.units_per_pack} {data.unit_label || 'units'}</div>
                </div>
              </div>
            )}

            {/* Multi-level pricing */}
            {(data.selling_price != null || data.unit_price != null) && (
              <div className="pt-2">
                <div className="text-sm text-muted-foreground mb-1">Pricing</div>
                <div className="text-sm bg-muted/50 rounded-md p-2 space-y-0.5">
                  {data.selling_price != null && <div>• {data.packaging_mode || 'Pack'}: ETB {Number(data.selling_price).toFixed(2)}</div>}
                  {data.unit_price != null && <div>• {data.unit_label || 'Unit'}: ETB {Number(data.unit_price).toFixed(2)}</div>}
                </div>
              </div>
            )}

            {isPharmacy && data.active_ingredients && data.active_ingredients.length > 0 && (
              <div className="pt-2">
                <div className="text-sm text-muted-foreground mb-1">Active Ingredients</div>
                <div className="text-sm bg-muted/50 rounded-md p-2">
                  {data.active_ingredients.map((ing, i) => (
                    <div key={i}>• {ing.ingredient_name}{ing.strength ? ` ${ing.strength}` : ''}</div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="py-6 text-center text-sm text-muted-foreground">No information available.</div>
        )}
      </DialogContent>
    </Dialog>
  );
}

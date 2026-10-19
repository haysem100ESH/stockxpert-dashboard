import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Search, Globe, AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { formatStock, defaultPackaging, type Packaging } from '@/lib/packaging';

interface BranchStock {
  branch_id: string;
  branch_name: string;
  branch_type: string;
  quantity: number; // lowest-unit quantity (from branch_items)
}

interface GlobalItem {
  medicine_id: string;
  name: string;
  category: string;
  minimum_stock_level: number;
  packaging: Packaging;
  branches: BranchStock[];
  total: number; // lowest units
}

export default function GlobalInventoryView() {
  const [items, setItems] = useState<GlobalItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [showLowestUnit, setShowLowestUnit] = useState(false);
  const { toast } = useToast();
  const { profile } = useAuth();

  useEffect(() => { fetchData(); /* eslint-disable-next-line */ }, [profile?.id]);

  const fetchData = async () => {
    if (!profile?.id) return;
    try {
      // Scope to current owner only
      let ownerId = profile.id;
      if (profile.role === 'staff' && profile.branch_id) {
        const { data: b } = await supabase
          .from('pharmacy_branches')
          .select('pharmacy_owner_id')
          .eq('id', profile.branch_id)
          .maybeSingle();
        if (b?.pharmacy_owner_id) ownerId = b.pharmacy_owner_id;
      }

      const { data: branches } = await supabase
        .from('pharmacy_branches')
        .select('id, name, branch_type')
        .eq('pharmacy_owner_id', ownerId)
        .order('name');

      const branchIds = (branches || []).map((b: any) => b.id);
      if (branchIds.length === 0) { setItems([]); setLoading(false); return; }

      const branchMap: Record<string, { name: string; type: string }> = {};
      (branches || []).forEach((b: any) => { branchMap[b.id] = { name: b.name, type: b.branch_type }; });

      // Source of truth for Global Inventory display: branch_items.quantity
      // (kept in sync by the fulfill/sale RPCs which also update inventory_batches).
      const { data: bItems } = await supabase
        .from('branch_items')
        .select('id, medicine_id, branch_id, quantity')
        .in('branch_id', branchIds);

      const effective = (bItems || []).map((i: any) => ({
        branch_id: i.branch_id,
        medicine_id: i.medicine_id,
        quantity: Number(i.quantity || 0),
      }));

      const medIds = [...new Set(effective.map((i: any) => i.medicine_id))];
      if (medIds.length === 0) { setItems([]); setLoading(false); return; }

      const { chunkedInPartial } = await import('@/lib/supabaseBatch');
      console.log(`[Supabase batching] medicines + medicine_packaging (GlobalInventoryView): ${Math.ceil(medIds.length / 20)} batches for ${medIds.length} ids`);
      const [medsRes, packsRes] = await Promise.all([
        chunkedInPartial<any>(medIds as string[], (chunk) =>
          supabase
            .from('medicines')
            .select('id, name, category, minimum_stock_level, unit_label')
            .in('id', chunk)
        , 20),
        chunkedInPartial<any>(medIds as string[], (chunk) =>
          (supabase as any)
            .from('medicine_packaging')
            .select('*')
            .in('medicine_id', chunk)
        , 20),
      ]);
      const meds = medsRes.data;
      const packs = packsRes.data;

      const packMap: Record<string, Packaging> = {};
      (packs || []).forEach((p: any) => { packMap[p.medicine_id] = p; });

      // Group by medicine_id, aggregate by branch
      const grouped = new Map<string, GlobalItem>();
      (meds || []).forEach((m: any) => {
        grouped.set(m.id, {
          medicine_id: m.id,
          name: m.name,
          category: m.category || 'General',
          minimum_stock_level: Number(m.minimum_stock_level || 0),
          packaging: packMap[m.id] || { ...defaultPackaging(), unit_name: m.unit_label || 'unit' },
          branches: [],
          total: 0,
        });
      });

      (effective).forEach((bi: any) => {
        const item = grouped.get(bi.medicine_id);
        const binfo = branchMap[bi.branch_id];
        if (!item || !binfo) return;
        const qty = Number(bi.quantity || 0);
        const existing = item.branches.find(b => b.branch_id === bi.branch_id);
        if (existing) existing.quantity += qty;
        else item.branches.push({
          branch_id: bi.branch_id,
          branch_name: binfo.name,
          branch_type: binfo.type,
          quantity: qty,
        });
        item.total += qty;
      });

      setItems(Array.from(grouped.values()).sort((a, b) => a.name.localeCompare(b.name)));
    } catch (e) {
      toast({ title: 'Error', description: 'Failed to fetch global inventory', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const branchColumns = useMemo(() => {
    const map = new Map<string, string>();
    items.forEach(i => i.branches.forEach(b => map.set(b.branch_id, b.branch_name)));
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [items]);

  const filtered = items.filter(i => i.name.toLowerCase().includes(searchTerm.toLowerCase()));

  const renderQty = (qty: number, pkg: Packaging) =>
    showLowestUnit ? `${qty} ${pkg.unit_name || 'unit'}${qty === 1 ? '' : 's'}` : formatStock(qty, pkg);

  if (loading) return <div>Loading global inventory...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-2">
          <Globe className="h-6 w-6 text-primary" />
          <h2 className="text-2xl font-bold">Global Inventory</h2>
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Switch id="lowest-unit" checked={showLowestUnit} onCheckedChange={setShowLowestUnit} />
            <Label htmlFor="lowest-unit" className="text-sm cursor-pointer">View in lowest unit</Label>
          </div>
          <div className="relative w-72">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search items..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-8" />
          </div>
        </div>
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Globe className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p className="text-lg font-medium mb-2">No inventory data</p>
            <p>Create branches and add items to see the global view.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky left-0 bg-background z-10">Item</TableHead>
                    <TableHead>Category</TableHead>
                    {branchColumns.map(col => (
                      <TableHead key={col.id} className="text-center">{col.name}</TableHead>
                    ))}
                    <TableHead className="text-center font-bold">Total</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(item => {
                    const isLow = item.total > 0 && item.total <= item.minimum_stock_level;
                    const isOut = item.total === 0;
                    return (
                      <TableRow key={item.medicine_id}>
                        <TableCell className="sticky left-0 bg-background z-10 font-medium">{item.name}</TableCell>
                        <TableCell><Badge variant="outline">{item.category}</Badge></TableCell>
                        {branchColumns.map(col => {
                          const bs = item.branches.find(b => b.branch_id === col.id);
                          return (
                            <TableCell key={col.id} className="text-center text-xs">
                              {bs ? renderQty(bs.quantity, item.packaging) : '—'}
                            </TableCell>
                          );
                        })}
                        <TableCell className="text-center font-bold text-xs">
                          {renderQty(item.total, item.packaging)}
                        </TableCell>
                        <TableCell>
                          {isOut && <Badge variant="destructive" className="text-xs">Out</Badge>}
                          {isLow && (
                            <Badge variant="outline" className="text-xs text-yellow-600 border-yellow-400">
                              <AlertTriangle className="h-3 w-3 mr-1" />Low
                            </Badge>
                          )}
                          {!isOut && !isLow && <Badge variant="secondary" className="text-xs">OK</Badge>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

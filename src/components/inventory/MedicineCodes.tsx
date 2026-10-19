/**
 * MedicineCodes management page.
 * Lists owner-defined codes with linked medicine count + total combined stock.
 */
import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Plus, Edit, Trash2, ChevronDown, Tag, Search, Link2, Layers, AlertTriangle, CircleAlert, PackageX, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { useMedicineCodes, type MedicineCode } from '@/hooks/useMedicineCodes';
import { useBranchInventory } from '@/hooks/useBranchInventory';
import { formatStock, defaultPackaging, type Packaging } from '@/lib/packaging';
import {
  useMedicineCodeBatches,
  classifyExpiry,
  type ExpiryStatus,
} from '@/hooks/useMedicineCodeAnalytics';
import MedicineCodeBatchesDialog from './MedicineCodeBatchesDialog';
import MedicineCodeAnalytics from './MedicineCodeAnalytics';

interface LinkedMedicine {
  id: string;
  name: string;
  generic_name?: string | null;
  strength?: string | null;
  manufacturer?: string | null;
  total_units: number;
  minimum_stock_level: number;
  packaging: Packaging;
  worstStatus: ExpiryStatus;
}

export default function MedicineCodes() {
  const { codes, loading, create, update, remove } = useMedicineCodes();
  const { items } = useBranchInventory();
  const { toast } = useToast();

  const [search, setSearch] = useState('');
  const [packagings, setPackagings] = useState<Record<string, Packaging>>({});

  const [editing, setEditing] = useState<MedicineCode | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<MedicineCode | null>(null);
  const [form, setForm] = useState({ code: '', label: '', notes: '' });
  const [busy, setBusy] = useState(false);

  // Assign items dialog state
  const [assignFor, setAssignFor] = useState<MedicineCode | null>(null);
  const [assignSearch, setAssignSearch] = useState('');
  const [assignSelection, setAssignSelection] = useState<Set<string>>(new Set());
  const [assignBusy, setAssignBusy] = useState(false);

  // Pull packaging rows for all medicines so we can format stock.
  // Chunked into batches of 20 ids to keep URLs short — large id lists
  // (1000+) previously hit URL-length limits and triggered 400 / ERR_FAILED.
  useEffect(() => {
    const ids = [...new Set(items.map((i: any) => i.medicine_id).filter(Boolean))] as string[];
    if (ids.length === 0) return;
    (async () => {
      const { chunkedInPartial } = await import('@/lib/supabaseBatch');
      console.log(`[Supabase batching] medicine_packaging by medicine_id (MedicineCodes): ${Math.ceil(ids.length / 20)} batches for ${ids.length} ids`);
      const { data } = await chunkedInPartial<any>(ids, (chunk) =>
        (supabase as any)
          .from('medicine_packaging')
          .select('medicine_id, unit_name, strip_enabled, units_per_strip, strip_name, pack_enabled, strips_per_pack, pack_name, unit_selling_price, strip_selling_price, pack_selling_price')
          .in('medicine_id', chunk)
      , 20);
      const map: Record<string, Packaging> = {};
      data.forEach((r: any) => { map[r.medicine_id] = r; });
      setPackagings(map);
    })();
  }, [items]);

  // Batches scoped to current branch context (for expiry status + dashboard cards).
  const { batchesByMedicine, globalAlertDays } = useMedicineCodeBatches();

  // Build per-code aggregates.
  const aggregates = useMemo(() => {
    const byCode = new Map<string, LinkedMedicine[]>();
    for (const it of items as any[]) {
      const codeId = it.medicine_code_id;
      if (!codeId) continue;
      const pk = packagings[it.medicine_id] || defaultPackaging();
      const batches = batchesByMedicine.get(it.medicine_id) || [];
      // Worst expiry status across all batches with stock.
      let worst: ExpiryStatus = 'normal';
      for (const b of batches) {
        if (Number(b.remaining_quantity) <= 0) continue;
        const days = b.expiry_alert_days ?? globalAlertDays;
        const s = classifyExpiry(b.expiry_date, days);
        if (s === 'expired') { worst = 'expired'; break; }
        if (s === 'expiring' && (worst as ExpiryStatus) !== 'expired') worst = 'expiring';
      }
      const link: LinkedMedicine = {
        id: it.medicine_id,
        name: it.name,
        generic_name: it.generic_name,
        strength: it.strength,
        manufacturer: it.manufacturer,
        total_units: it.quantity || 0,
        minimum_stock_level: it.minimum_stock_level || 0,
        packaging: pk,
        worstStatus: worst,
      };
      if (!byCode.has(codeId)) byCode.set(codeId, []);
      byCode.get(codeId)!.push(link);
    }
    return byCode;
  }, [items, packagings, batchesByMedicine, globalAlertDays]);

  // Dashboard card aggregates (across all groups in scope).
  const dashboardStats = useMemo(() => {
    const totalGroups = codes.length;
    let lowStock = 0;
    let expiring = 0;
    let expired = 0;

    for (const it of items as any[]) {
      const min = Number(it.minimum_stock_level) || 0;
      const qty = Number(it.quantity) || 0;
      if (min > 0 && qty <= min) lowStock += 1;
    }
    for (const list of batchesByMedicine.values()) {
      for (const b of list) {
        if (Number(b.remaining_quantity) <= 0) continue;
        const days = b.expiry_alert_days ?? globalAlertDays;
        const s = classifyExpiry(b.expiry_date, days);
        if (s === 'expired') expired += 1;
        else if (s === 'expiring') expiring += 1;
      }
    }
    return { totalGroups, lowStock, expiring, expired };
  }, [codes, items, batchesByMedicine, globalAlertDays]);

  // medicine_id -> medicine_code_id (used by analytics hook)
  const medicineIdToCodeId = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const it of items as any[]) {
      m.set(it.medicine_id, it.medicine_code_id ?? null);
    }
    return m;
  }, [items]);

  // Level-3 dialog state
  const [batchesFor, setBatchesFor] = useState<{ name: string; batches: any[] } | null>(null);


  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return codes;
    return codes.filter((c) =>
      c.code.toLowerCase().includes(q) || c.label.toLowerCase().includes(q),
    );
  }, [codes, search]);

  const openCreate = () => { setForm({ code: '', label: '', notes: '' }); setCreating(true); };
  const openEdit = (c: MedicineCode) => {
    setEditing(c);
    setForm({ code: c.code, label: c.label, notes: c.notes || '' });
  };

  const handleSubmit = async () => {
    if (!form.code.trim() || !form.label.trim()) {
      toast({ title: 'Code and label are required', variant: 'destructive' });
      return;
    }
    setBusy(true);
    try {
      if (editing) {
        await update(editing.id, form);
        toast({ title: 'Code updated' });
      } else {
        await create(form);
        toast({ title: 'Code created' });
      }
      setEditing(null); setCreating(false);
    } catch (e: any) {
      toast({ title: 'Failed', description: e?.message || 'Unknown error', variant: 'destructive' });
    } finally { setBusy(false); }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    try {
      await remove(confirmDelete.id);
      toast({ title: 'Code deleted', description: 'Linked medicines were unlinked but kept.' });
    } catch (e: any) {
      toast({ title: 'Failed', description: e?.message || 'Unknown error', variant: 'destructive' });
    } finally { setConfirmDelete(null); }
  };

  // ----- Assign items helpers -----
  const uniqueMedicines = useMemo(() => {
    const map = new Map<string, { medicine_id: string; name: string; code_id: string | null }>();
    for (const it of items as any[]) {
      if (!map.has(it.medicine_id)) {
        map.set(it.medicine_id, {
          medicine_id: it.medicine_id,
          name: it.name,
          code_id: it.medicine_code_id ?? null,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [items]);

  const codeById = useMemo(() => {
    const m = new Map<string, MedicineCode>();
    codes.forEach((c) => m.set(c.id, c));
    return m;
  }, [codes]);

  const filteredAssignMeds = useMemo(() => {
    const q = assignSearch.trim().toLowerCase();
    if (!q) return uniqueMedicines;
    return uniqueMedicines.filter((m) => m.name.toLowerCase().includes(q));
  }, [uniqueMedicines, assignSearch]);

  const openAssign = (c: MedicineCode) => {
    setAssignFor(c);
    setAssignSearch('');
    const preset = new Set<string>(
      uniqueMedicines.filter((m) => m.code_id === c.id).map((m) => m.medicine_id),
    );
    setAssignSelection(preset);
  };

  const toggleAssignItem = (medicineId: string) => {
    setAssignSelection((prev) => {
      const next = new Set(prev);
      if (next.has(medicineId)) next.delete(medicineId);
      else next.add(medicineId);
      return next;
    });
  };

  const handleAssign = async () => {
    if (!assignFor) return;
    setAssignBusy(true);
    try {
      const targetId = assignFor.id;
      const currentlyInThisCode = new Set(
        uniqueMedicines.filter((m) => m.code_id === targetId).map((m) => m.medicine_id),
      );
      const toAssign = [...assignSelection].filter((id) => !currentlyInThisCode.has(id));
      const toUnassign = [...currentlyInThisCode].filter((id) => !assignSelection.has(id));

      // Snapshot previous code per medicine BEFORE the update.
      const prevCodeByMed = new Map<string, string | null>();
      uniqueMedicines.forEach((m) => prevCodeByMed.set(m.medicine_id, m.code_id));

      if (toAssign.length > 0) {
        const { error } = await (supabase as any)
          .from('medicines')
          .update({ medicine_code_id: targetId })
          .in('id', toAssign);
        if (error) throw error;
      }
      if (toUnassign.length > 0) {
        const { error } = await (supabase as any)
          .from('medicines')
          .update({ medicine_code_id: null })
          .in('id', toUnassign);
        if (error) throw error;
      }

      // Log per-medicine activity (assign/unassign with previous code label).
      const { logActivity } = await import('@/lib/activityLog');
      const codeLabel = `${assignFor.code} — ${assignFor.label}`;
      const labelFor = (codeId: string | null | undefined) => {
        if (!codeId) return null;
        const c = codeById.get(codeId);
        return c ? `${c.code} — ${c.label}` : codeId;
      };
      toAssign.forEach((mid) => {
        const med = uniqueMedicines.find((m) => m.medicine_id === mid);
        const prevLabel = labelFor(prevCodeByMed.get(mid) ?? null);
        logActivity({
          type: 'assign_item_to_code',
          entityType: 'medicine',
          entityId: mid,
          previous: { medicine_code: prevLabel },
          next: { medicine_code: codeLabel },
          metadata: {
            item_name: med?.name,
            medicine_name: med?.name,
            code: assignFor.code,
            label: assignFor.label,
            new_code: codeLabel,
            previous_code: prevLabel,
          },
        });
      });
      toUnassign.forEach((mid) => {
        const med = uniqueMedicines.find((m) => m.medicine_id === mid);
        const prevLabel = labelFor(prevCodeByMed.get(mid) ?? null) ?? codeLabel;
        logActivity({
          type: 'unassign_item_from_code',
          entityType: 'medicine',
          entityId: mid,
          previous: { medicine_code: prevLabel },
          next: { medicine_code: null },
          metadata: {
            item_name: med?.name,
            medicine_name: med?.name,
            code: assignFor.code,
            label: assignFor.label,
            previous_code: prevLabel,
          },
        });
      });

      toast({
        title: 'Assignments updated',
        description: `${toAssign.length} added, ${toUnassign.length} removed.`,
      });
      setAssignFor(null);
      window.dispatchEvent(new Event('app:refresh'));
    } catch (e: any) {
      toast({ title: 'Failed', description: e?.message || 'Unknown error', variant: 'destructive' });
    } finally {
      setAssignBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2"><Tag className="h-6 w-6" />Medicine Codes</h2>
          <p className="text-sm text-muted-foreground">
            Group variants of the same drug under a single code to see combined stock.
          </p>
        </div>
        <Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" />New Code</Button>
      </div>

      {/* Dashboard cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-md bg-primary/10 text-primary"><Layers className="h-5 w-5" /></div>
            <div>
              <div className="text-xs text-muted-foreground">Code Groups</div>
              <div className="text-2xl font-semibold">{dashboardStats.totalGroups}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-md bg-amber-500/10 text-amber-600"><PackageX className="h-5 w-5" /></div>
            <div>
              <div className="text-xs text-muted-foreground">Low Stock Items</div>
              <div className="text-2xl font-semibold">{dashboardStats.lowStock}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-md bg-orange-500/10 text-orange-600"><AlertTriangle className="h-5 w-5" /></div>
            <div>
              <div className="text-xs text-muted-foreground">Expiring Batches</div>
              <div className="text-2xl font-semibold">{dashboardStats.expiring}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-md bg-destructive/10 text-destructive"><CircleAlert className="h-5 w-5" /></div>
            <div>
              <div className="text-xs text-muted-foreground">Expired Batches</div>
              <div className="text-2xl font-semibold">{dashboardStats.expired}</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Analytics */}
      <MedicineCodeAnalytics codes={codes} medicineIdToCodeId={medicineIdToCodeId} />

      <div className="relative max-w-md">
        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search codes…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
      </div>

      {loading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No codes yet. Create one to start grouping medicine variants.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((c) => {
            const linked = aggregates.get(c.id) || [];
            const totalUnits = linked.reduce((s, l) => s + l.total_units, 0);
            // For combined display, use the first medicine's packaging as the basis.
            // Falls back to default if no medicines linked.
            const basis = linked[0]?.packaging || defaultPackaging();
            return (
              <Card key={c.id}>
                <Collapsible>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-3 min-w-0">
                        <Badge variant="outline" className="font-mono text-sm">{c.code}</Badge>
                        <div className="min-w-0">
                          <CardTitle className="text-base truncate">{c.label}</CardTitle>
                          {c.notes && <p className="text-xs text-muted-foreground mt-0.5">{c.notes}</p>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 sm:gap-2 flex-wrap justify-end">
                        <Badge variant="secondary">{linked.length} item{linked.length === 1 ? '' : 's'}</Badge>
                        <Badge>{formatStock(totalUnits, basis)}</Badge>
                        <Button variant="outline" size="sm" onClick={() => openAssign(c)} title="Assign items">
                          <Link2 className="h-4 w-4 sm:mr-1" />
                          <span className="hidden sm:inline">Assign</span>
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => openEdit(c)} title="Edit">
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => setConfirmDelete(c)} title="Delete">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                        <CollapsibleTrigger asChild>
                          <Button variant="ghost" size="icon" title="Show linked items">
                            <ChevronDown className="h-4 w-4" />
                          </Button>
                        </CollapsibleTrigger>
                      </div>
                    </div>
                  </CardHeader>
                  <CollapsibleContent>
                    <CardContent>
                      {linked.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No medicines linked to this code yet.</p>
                      ) : (
                        <div className="divide-y">
                          {linked.map((l) => {
                            const batches = batchesByMedicine.get(l.id) || [];
                            const isLow = l.minimum_stock_level > 0 && l.total_units <= l.minimum_stock_level;
                            const statusBadge =
                              l.worstStatus === 'expired'
                                ? <Badge variant="destructive" className="gap-1"><CircleAlert className="h-3 w-3" />Expired</Badge>
                                : l.worstStatus === 'expiring'
                                  ? <Badge className="gap-1 bg-orange-500 hover:bg-orange-500/90 text-white"><AlertTriangle className="h-3 w-3" />Expiring</Badge>
                                  : null;
                            return (
                              <button
                                key={l.id}
                                type="button"
                                onClick={() => setBatchesFor({ name: l.name, batches })}
                                className="w-full flex items-center justify-between py-2 text-sm gap-2 hover:bg-accent/40 transition-colors px-2 -mx-2 rounded text-left"
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2 truncate">
                                    <span className="truncate font-medium">{l.name}</span>
                                    {l.strength && <span className="text-xs text-muted-foreground">{l.strength}</span>}
                                  </div>
                                  <div className="text-xs text-muted-foreground truncate">
                                    {[l.generic_name, l.manufacturer].filter(Boolean).join(' · ') || '—'}
                                  </div>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  {isLow && <Badge variant="outline" className="gap-1 border-amber-500 text-amber-600"><PackageX className="h-3 w-3" />Low</Badge>}
                                  {statusBadge}
                                  <Badge variant="outline">{formatStock(l.total_units, l.packaging)}</Badge>
                                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </CardContent>
                  </CollapsibleContent>
                </Collapsible>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create / Edit dialog */}
      <Dialog open={creating || !!editing} onOpenChange={(v) => { if (!v) { setCreating(false); setEditing(null); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Code' : 'New Code'}</DialogTitle>
            <DialogDescription>
              Codes group medicines that are the same drug across batches, brands or manufacturers.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="code_code">Code *</Label>
              <Input id="code_code" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} placeholder="e.g. AMOX-500" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="code_label">Label *</Label>
              <Input id="code_label" value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} placeholder="e.g. Amoxicillin 500mg" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="code_notes">Notes</Label>
              <Textarea id="code_notes" rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCreating(false); setEditing(null); }}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        open={!!confirmDelete}
        onOpenChange={(v) => !v && setConfirmDelete(null)}
        title="Delete code?"
        description={confirmDelete ? `Delete code "${confirmDelete.code}"? Linked medicines will be unlinked but not deleted.` : ''}
        onConfirm={handleDelete}
      />

      {/* Assign items dialog */}
      <Dialog open={!!assignFor} onOpenChange={(v) => { if (!v) setAssignFor(null); }}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Assign Items</DialogTitle>
            <DialogDescription>
              {assignFor ? (
                <>Select medicines to group under <span className="font-mono">{assignFor.code}</span> — {assignFor.label}. Items already in another group appear faded; selecting one will move it to this group.</>
              ) : null}
            </DialogDescription>
          </DialogHeader>

          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search items…"
              value={assignSearch}
              onChange={(e) => setAssignSearch(e.target.value)}
              className="pl-8"
            />
          </div>

          <ScrollArea className="flex-1 min-h-[240px] max-h-[50vh] border rounded-md">
            {filteredAssignMeds.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                No items in this branch.
              </div>
            ) : (
              <div className="divide-y">
                {filteredAssignMeds.map((m) => {
                  const checked = assignSelection.has(m.medicine_id);
                  const otherCode = m.code_id && m.code_id !== assignFor?.id ? codeById.get(m.code_id) : null;
                  return (
                    <label
                      key={m.medicine_id}
                      htmlFor={`assign-${m.medicine_id}`}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-accent/40 transition-colors',
                        otherCode && !checked && 'opacity-50',
                      )}
                    >
                      <Checkbox
                        id={`assign-${m.medicine_id}`}
                        checked={checked}
                        onCheckedChange={() => toggleAssignItem(m.medicine_id)}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm truncate">{m.name}</div>
                        {otherCode && (
                          <div className="text-xs text-muted-foreground truncate">
                            In group: <span className="font-mono">{otherCode.code}</span> · {otherCode.label}
                          </div>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </ScrollArea>

          <div className="text-xs text-muted-foreground">
            {assignSelection.size} selected
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignFor(null)}>Cancel</Button>
            <Button onClick={handleAssign} disabled={assignBusy}>
              {assignBusy ? 'Saving…' : 'Save assignments'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Level-3 batches dialog */}
      <MedicineCodeBatchesDialog
        open={!!batchesFor}
        onOpenChange={(v) => { if (!v) setBatchesFor(null); }}
        medicineName={batchesFor?.name || ''}
        batches={batchesFor?.batches || []}
        globalAlertDays={globalAlertDays}
      />
    </div>
  );
}

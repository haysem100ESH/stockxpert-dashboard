import { useState, useEffect } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { supabase } from '@/lib/db';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { DataTable } from '@/components/ui/data-table';
import { Building2, Plus, Edit, MapPin, Phone, MoreHorizontal, Trash2 } from 'lucide-react';
import { usePlanLimits } from '@/hooks/usePlanLimits';

interface Branch {
  id: string;
  name: string;
  address?: string;
  phone?: string;
  manager_staff_id?: string;
  is_main_branch: boolean;
  branch_type: 'pharmacy' | 'general' | 'warehouse';
  created_at: string;
  manager_name?: string;
}

interface StaffMember { id: string; full_name: string; }

function BranchForm({
  branchName, setBranchName,
  branchAddress, setBranchAddress,
  branchPhone, setBranchPhone,
  branchType, setBranchType,
  isMainBranch, setIsMainBranch,
  onSubmit, submitLabel, disabled,
}: any) {
  return (
    <div className="space-y-4">
      <div>
        <Label>Branch Name *</Label>
        <Input value={branchName} onChange={e => setBranchName(e.target.value)} placeholder="Branch name" className="mt-2" />
      </div>
      <div>
        <Label>Branch Type *</Label>
        <Select value={branchType} onValueChange={(v: 'pharmacy' | 'general' | 'warehouse') => setBranchType(v)}>
          <SelectTrigger className="mt-2"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="pharmacy">Pharmacy Branch</SelectItem>
            <SelectItem value="general">General Inventory Branch</SelectItem>
            <SelectItem value="warehouse">Warehouse</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Address</Label>
        <Input value={branchAddress} onChange={e => setBranchAddress(e.target.value)} placeholder="Branch address" className="mt-2" />
      </div>
      <div>
        <Label>Phone</Label>
        <Input value={branchPhone} onChange={e => setBranchPhone(e.target.value)} placeholder="Branch phone" className="mt-2" />
      </div>
      <div className="flex items-center gap-2">
        <input type="checkbox" id="main-branch" checked={isMainBranch} onChange={e => setIsMainBranch(e.target.checked)} className="rounded" />
        <Label htmlFor="main-branch">Set as main branch</Label>
      </div>
      <Button onClick={onSubmit} disabled={disabled || !branchName} className="w-full">
        {submitLabel}
      </Button>
    </div>
  );
}

export default function BranchManagement() {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const { planLimits, refetch: refetchPlanLimits } = usePlanLimits();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingBranch, setDeletingBranch] = useState<Branch | null>(null);

  const [branchName, setBranchName] = useState('');
  const [branchAddress, setBranchAddress] = useState('');
  const [branchPhone, setBranchPhone] = useState('');
  const [branchType, setBranchType] = useState<'pharmacy' | 'general' | 'warehouse'>('general');
  const [isMainBranch, setIsMainBranch] = useState(false);

  useEffect(() => {
    if (user && profile?.role === 'owner') { fetchBranches(); }
  }, [user, profile]);

  const fetchBranches = async () => {
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from('pharmacy_branches')
        .select('*')
        .eq('pharmacy_owner_id', user!.id)
        .order('is_main_branch', { ascending: false })
        .order('created_at', { ascending: true });
      if (error) throw error;

      const withManagers = await Promise.all(
        (data || []).map(async (branch: any) => {
          let manager_name = 'Unassigned';
          if (branch.manager_staff_id) {
            const { data: m } = await (supabase as any)
              .from('profiles').select('full_name').eq('id', branch.manager_staff_id).single();
            if (m) manager_name = m.full_name;
          }
          return { ...branch, branch_type: branch.branch_type as 'pharmacy' | 'general', manager_name };
        })
      );
      setBranches(withManagers);
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setBranchName(''); setBranchAddress(''); setBranchPhone('');
    setBranchType('general'); setIsMainBranch(false); setEditingBranch(null);
  };

  const handleCreate = async () => {
    if (planLimits && !planLimits.canAddBranch) {
      toast({ title: 'Plan Limit Reached', description: `Limit of ${planLimits.branchesLimit} branches reached.`, variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const { data: newBranch, error } = await (supabase as any).from('pharmacy_branches').insert({
        pharmacy_owner_id: user!.id, name: branchName,
        address: branchAddress || null, phone: branchPhone || null,
        branch_type: branchType, is_main_branch: isMainBranch,
      }).select().single();
      if (error) throw error;

      // Auto-create linked location entry for stock movements/transfers
      if (newBranch) {
        await (supabase as any).from('locations').insert({
          pharmacy_owner_id: user!.id,
          name: branchName,
          type: branchType === 'pharmacy' ? 'pharmacy' : 'store',
          branch_id: newBranch.id,
        });
      }

      toast({ title: 'Success', description: 'Branch created successfully' });
      resetForm(); setShowCreateDialog(false);
      fetchBranches(); refetchPlanLimits();
      window.dispatchEvent(new Event('branches-updated'));
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async () => {
    if (!editingBranch) return;
    setSaving(true);
    try {
      const { error } = await (supabase as any).from('pharmacy_branches')
        .update({ name: branchName, address: branchAddress || null, phone: branchPhone || null, branch_type: branchType, is_main_branch: isMainBranch })
        .eq('id', editingBranch.id);
      if (error) throw error;

      // Auto-sync: create location entry if missing, or update name/type
      const { data: existingLoc } = await (supabase as any)
        .from('locations').select('id').eq('branch_id', editingBranch.id).maybeSingle();
      if (existingLoc) {
        await (supabase as any).from('locations').update({
          name: branchName,
          type: branchType === 'pharmacy' ? 'pharmacy' : 'store',
        }).eq('id', existingLoc.id);
      } else {
        await (supabase as any).from('locations').insert({
          pharmacy_owner_id: user!.id,
          name: branchName,
          type: branchType === 'pharmacy' ? 'pharmacy' : 'store',
          branch_id: editingBranch.id,
        });
      }

      toast({ title: 'Success', description: 'Branch updated successfully' });
      setShowEditDialog(false); resetForm(); fetchBranches();
      window.dispatchEvent(new Event('branches-updated'));
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingBranch) return;
    setSaving(true);
    try {
      // Unassign staff from this branch first (avoid FK constraint blocking delete)
      const { error: profErr } = await (supabase as any).from('profiles')
        .update({ branch_id: null })
        .eq('branch_id', deletingBranch.id);
      if (profErr) throw profErr;

      // Clear manager reference on the branch itself
      const { error: mgrErr } = await (supabase as any).from('pharmacy_branches')
        .update({ manager_staff_id: null })
        .eq('id', deletingBranch.id);
      if (mgrErr) throw mgrErr;

      // Detach linked location(s) from the branch. Try to delete first; if other
      // tables (stock_movements, transfer_requests, etc.) still reference the
      // location, fall back to nulling out branch_id so the branch FK is freed
      // without destroying historical movement data.
      const { error: locDelErr } = await (supabase as any)
        .from('locations').delete().eq('branch_id', deletingBranch.id);
      if (locDelErr) {
        const { error: locNullErr } = await (supabase as any)
          .from('locations').update({ branch_id: null }).eq('branch_id', deletingBranch.id);
        if (locNullErr) throw locNullErr;
      }

      const { error } = await (supabase as any).from('pharmacy_branches').delete().eq('id', deletingBranch.id);
      if (error) throw error;
      toast({ title: 'Success', description: 'Branch deleted successfully' });
      setDeletingBranch(null);
      fetchBranches(); refetchPlanLimits();
      window.dispatchEvent(new Event('branches-updated'));
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (branch: Branch) => {
    setEditingBranch(branch);
    setBranchName(branch.name);
    setBranchAddress(branch.address || '');
    setBranchPhone(branch.phone || '');
    setBranchType(branch.branch_type || 'pharmacy');
    setIsMainBranch(branch.is_main_branch);
    setShowEditDialog(true);
  };

  const columns: ColumnDef<Branch>[] = [
    {
      accessorKey: 'name',
      header: 'Branch Name',
      cell: ({ row }) => (
        <div className="font-medium flex items-center gap-2">
          {row.original.name}
          {row.original.is_main_branch && <Badge variant="default" className="text-xs">Main</Badge>}
        </div>
      ),
    },
    {
      accessorKey: 'address',
      header: 'Address',
      cell: ({ row }) => row.original.address
        ? <div className="flex items-center gap-1"><MapPin className="h-3 w-3 text-muted-foreground" />{row.original.address}</div>
        : <span className="text-muted-foreground">—</span>,
    },
    {
      accessorKey: 'phone',
      header: 'Phone',
      cell: ({ row }) => row.original.phone
        ? <div className="flex items-center gap-1"><Phone className="h-3 w-3 text-muted-foreground" />{row.original.phone}</div>
        : <span className="text-muted-foreground">—</span>,
    },
    {
      accessorKey: 'branch_type',
      header: 'Type',
      cell: ({ row }) => (
        <Badge variant={row.original.branch_type === 'pharmacy' ? 'secondary' : row.original.branch_type === 'warehouse' ? 'default' : 'outline'}>
          {row.original.branch_type === 'pharmacy' ? '💊 Pharmacy' : row.original.branch_type === 'warehouse' ? '🏭 Warehouse' : '📦 General'}
        </Badge>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => startEdit(row.original)}>
              <Edit className="mr-2 h-4 w-4" /> Edit Branch
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => setDeletingBranch(row.original)}
            >
              <Trash2 className="mr-2 h-4 w-4" /> Delete Branch
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  if (profile?.role !== 'owner') {
    return (
      <Card><CardContent className="pt-6">
        <p className="text-muted-foreground">Branch management is only available for pharmacy owners.</p>
      </CardContent></Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Branch Management</h2>
          <p className="text-muted-foreground">Manage your pharmacy branches</p>
        </div>
        <Button onClick={() => { resetForm(); setShowCreateDialog(true); }}>
          <Plus className="mr-2 h-4 w-4" /> Add Branch
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Your Branches ({branches.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={branches}
            searchKey="name"
            searchPlaceholder="Search branches..."
            loading={loading}
            emptyMessage="No branches yet. Create your first branch."
          />
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Branch</DialogTitle>
            <DialogDescription>Add a new branch to your network</DialogDescription>
          </DialogHeader>
          <BranchForm
            branchName={branchName} setBranchName={setBranchName}
            branchAddress={branchAddress} setBranchAddress={setBranchAddress}
            branchPhone={branchPhone} setBranchPhone={setBranchPhone}
            branchType={branchType} setBranchType={setBranchType}
            isMainBranch={isMainBranch} setIsMainBranch={setIsMainBranch}
            onSubmit={handleCreate} submitLabel="Create Branch" disabled={saving}
          />
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Branch</DialogTitle>
            <DialogDescription>Update branch information</DialogDescription>
          </DialogHeader>
          <BranchForm
            branchName={branchName} setBranchName={setBranchName}
            branchAddress={branchAddress} setBranchAddress={setBranchAddress}
            branchPhone={branchPhone} setBranchPhone={setBranchPhone}
            branchType={branchType} setBranchType={setBranchType}
            isMainBranch={isMainBranch} setIsMainBranch={setIsMainBranch}
            onSubmit={handleUpdate} submitLabel="Update Branch" disabled={saving}
          />
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <ConfirmationDialog
        open={!!deletingBranch}
        onOpenChange={(open) => { if (!open) setDeletingBranch(null); }}
        onConfirm={handleDelete}
        title="Delete Branch"
        description={`Are you sure you want to delete "${deletingBranch?.name}"? This will remove all associated data (inventory, sales, staff assignments) and cannot be undone.`}
        confirmText="Delete"
      />
    </div>
  );
}

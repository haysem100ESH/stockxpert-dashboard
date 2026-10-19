import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowRightLeft, Plus, ArrowRight } from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useBranchContext } from '@/hooks/useBranchContext';
import StockMovementForm from './StockMovementForm';

interface Movement {
  id: string;
  medicine_name: string;
  from_location: string;
  to_location: string;
  quantity: number;
  movement_type: string;
  status: string;
  notes?: string;
  created_by_name?: string;
  created_at: string;
}

export default function StockMovementHistory() {
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const { toast } = useToast();
  const { profile } = useAuth();
  const { selectedBranch } = useBranchContext();

  useEffect(() => { fetchMovements(); }, [typeFilter, selectedBranch]);

  const fetchMovements = async () => {
    if (!profile?.id) return;
    try {
      // Get the owner's location IDs to scope movements
      const ownerId = profile.role === 'owner' ? profile.id : undefined;
      let ownerLocationIds: string[] = [];

      if (ownerId) {
        // Owner: get locations belonging to this owner
        const { data: locs } = await supabase
          .from('locations')
          .select('id, branch_id')
          .eq('pharmacy_owner_id', ownerId);
        ownerLocationIds = (locs || []).map((l: any) => l.id);

        // If a specific branch is selected, narrow to that branch's locations
        if (selectedBranch) {
          const branchLocIds = (locs || []).filter((l: any) => l.branch_id === selectedBranch).map((l: any) => l.id);
          ownerLocationIds = branchLocIds;
        }
      } else if (profile.branch_id) {
        // Staff: get locations for their branch
        const { data: locs } = await supabase
          .from('locations')
          .select('id')
          .eq('branch_id', profile.branch_id);
        ownerLocationIds = (locs || []).map((l: any) => l.id);
      }

      if (ownerLocationIds.length === 0) {
        setMovements([]);
        setLoading(false);
        return;
      }

      // Fetch movements where from or to location belongs to the owner's locations
      let query = supabase
        .from('stock_movements')
        .select('*')
        .or(`from_location_id.in.(${ownerLocationIds.join(',')}),to_location_id.in.(${ownerLocationIds.join(',')})`)
        .order('created_at', { ascending: false })
        .limit(100);

      if (typeFilter !== 'all') query = query.eq('movement_type', typeFilter);

      const { data, error } = await query;
      if (error) throw error;

      // Fetch related names
      const medIds = [...new Set((data || []).map(m => m.medicine_id))];
      const locIds = [...new Set((data || []).flatMap(m => [m.from_location_id, m.to_location_id]).filter(Boolean))];
      const userIds = [...new Set((data || []).map(m => m.created_by).filter(Boolean))];

      const [medsRes, branchesRes, usersRes] = await Promise.all([
        medIds.length ? supabase.from('medicines').select('id, name').in('id', medIds) : { data: [] },
        locIds.length ? supabase.from('locations').select('id, name').in('id', locIds) : { data: [] },
        userIds.length ? supabase.from('profiles').select('id, full_name').in('id', userIds) : { data: [] },
      ]);

      const medMap: Record<string, string> = {};
      (medsRes.data || []).forEach((m: any) => { medMap[m.id] = m.name; });
      const locMap: Record<string, string> = {};
      (branchesRes.data || []).forEach((l: any) => { locMap[l.id] = l.name; });
      const userMap: Record<string, string> = {};
      (usersRes.data || []).forEach((u: any) => { userMap[u.id] = u.full_name; });

      setMovements((data || []).map(m => ({
        id: m.id,
        medicine_name: medMap[m.medicine_id] || 'Unknown',
        from_location: m.from_location_id ? locMap[m.from_location_id] || 'Unknown' : '—',
        to_location: m.to_location_id ? locMap[m.to_location_id] || 'Unknown' : '—',
        quantity: m.quantity,
        movement_type: m.movement_type,
        status: m.status,
        notes: m.notes,
        created_by_name: m.created_by ? userMap[m.created_by] : undefined,
        created_at: m.created_at,
      })));
    } catch {
      toast({ title: 'Error', description: 'Failed to fetch movements', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const typeBadge = (type: string) => {
    const colors: Record<string, string> = {
      TRANSFER: 'default',
      SUPPLY: 'secondary',
      RETURN: 'outline',
      ADJUSTMENT: 'destructive',
    };
    return <Badge variant={(colors[type] || 'default') as any}>{type}</Badge>;
  };

  const statusBadge = (status: string) => {
    if (status === 'completed') return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Completed</Badge>;
    if (status === 'pending') return <Badge variant="outline">Pending</Badge>;
    if (status === 'in_transit') return <Badge variant="secondary">In Transit</Badge>;
    return <Badge variant="destructive">Cancelled</Badge>;
  };

  if (loading) return <div>Loading stock movements...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h2 className="text-2xl font-bold">Stock Movements</h2>
        <div className="flex items-center gap-3">
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="TRANSFER">Transfer</SelectItem>
              <SelectItem value="SUPPLY">Supply</SelectItem>
              <SelectItem value="RETURN">Return</SelectItem>
              <SelectItem value="ADJUSTMENT">Adjustment</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => setShowForm(true)}><Plus className="h-4 w-4 mr-2" />New Movement</Button>
        </div>
      </div>

      {movements.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <ArrowRightLeft className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p className="text-lg font-medium mb-2">No stock movements yet</p>
            <p>Record your first stock transfer, supply, or adjustment.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Item</TableHead>
                    <TableHead>From → To</TableHead>
                    <TableHead>Qty</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>By</TableHead>
                    <TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movements.map(m => (
                    <TableRow key={m.id}>
                      <TableCell className="whitespace-nowrap">{format(new Date(m.created_at), 'MMM dd, yyyy HH:mm')}</TableCell>
                      <TableCell className="font-medium">{m.medicine_name}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 text-sm">
                          <span>{m.from_location}</span>
                          <ArrowRight className="h-3 w-3 text-muted-foreground" />
                          <span>{m.to_location}</span>
                        </div>
                      </TableCell>
                      <TableCell>{m.quantity}</TableCell>
                      <TableCell>{typeBadge(m.movement_type)}</TableCell>
                      <TableCell>{statusBadge(m.status)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{m.created_by_name || '—'}</TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[150px] truncate">{m.notes || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <StockMovementForm open={showForm} onOpenChange={setShowForm} onSuccess={fetchMovements} />
    </div>
  );
}

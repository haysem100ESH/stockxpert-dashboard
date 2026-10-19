import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ClipboardList, Plus, Check, X, Package } from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import TransferRequestForm from './TransferRequestForm';

interface RequestRow {
  id: string;
  requesting_location: string;
  source_location: string;
  status: string;
  notes?: string;
  created_by_name?: string;
  approved_by_name?: string;
  items: { medicine_name: string; requested_quantity: number; approved_quantity: number }[];
  created_at: string;
}

export default function TransferRequestList() {
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const { toast } = useToast();
  const { profile, user } = useAuth();
  const isOwner = profile?.role === 'owner';

  useEffect(() => { fetchRequests(); }, [statusFilter]);

  const fetchRequests = async () => {
    try {
      let query = supabase.from('transfer_requests').select('*').order('created_at', { ascending: false });
      if (statusFilter !== 'all') query = query.eq('status', statusFilter);
      const { data, error } = await query;
      if (error) throw error;

      if (!data || data.length === 0) { setRequests([]); setLoading(false); return; }

      const reqIds = data.map(r => r.id);
      const locIds = [...new Set(data.flatMap(r => [r.requesting_location_id, r.source_location_id]).filter(Boolean))];
      const userIds = [...new Set(data.flatMap(r => [r.created_by, r.approved_by]).filter(Boolean))];

      const [itemsRes, locationsRes, usersRes] = await Promise.all([
        supabase.from('transfer_request_items').select('*').in('request_id', reqIds),
        locIds.length ? supabase.from('locations').select('id, name, branch_id').in('id', locIds) : { data: [] },
        userIds.length ? supabase.from('profiles').select('id, full_name').in('id', userIds) : { data: [] },
      ]);

      // Resolve location → branch name
      const locMap: Record<string, string> = {};
      const locBranchIds = [...new Set((locationsRes.data || []).map((l: any) => l.branch_id).filter(Boolean))];
      const branchMap: Record<string, string> = {};
      if (locBranchIds.length) {
        const { data: branches } = await supabase.from('pharmacy_branches').select('id, name').in('id', locBranchIds);
        (branches || []).forEach((b: any) => { branchMap[b.id] = b.name; });
      }
      (locationsRes.data || []).forEach((l: any) => {
        locMap[l.id] = (l.branch_id && branchMap[l.branch_id]) || l.name;
      });
      const userMap: Record<string, string> = {};
      (usersRes.data || []).forEach((u: any) => { userMap[u.id] = u.full_name; });

      // Fetch medicine names for items
      const medIds = [...new Set((itemsRes.data || []).map((i: any) => i.medicine_id))];
      const medsRes = medIds.length ? await supabase.from('medicines').select('id, name').in('id', medIds) : { data: [] };
      const medMap: Record<string, string> = {};
      (medsRes.data || []).forEach((m: any) => { medMap[m.id] = m.name; });

      setRequests(data.map(r => ({
        id: r.id,
        requesting_location: locMap[r.requesting_location_id] || 'Unknown',
        source_location: r.source_location_id ? locMap[r.source_location_id] || 'Unknown' : 'Auto',
        status: r.status,
        notes: r.notes,
        created_by_name: r.created_by ? userMap[r.created_by] : undefined,
        approved_by_name: r.approved_by ? userMap[r.approved_by] : undefined,
        items: (itemsRes.data || []).filter((i: any) => i.request_id === r.id).map((i: any) => ({
          medicine_name: medMap[i.medicine_id] || 'Unknown',
          requested_quantity: i.requested_quantity,
          approved_quantity: i.approved_quantity || 0,
        })),
        created_at: r.created_at,
      })));
    } catch {
      toast({ title: 'Error', description: 'Failed to fetch requests', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateStatus = async (requestId: string, newStatus: 'approved' | 'rejected') => {
    try {
      const { data, error } = await supabase.functions.invoke('manage-transfer-request', {
        body: { action: newStatus === 'approved' ? 'approve' : 'reject', requestId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast({ title: 'Success', description: `Request ${newStatus}` });
      fetchRequests();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Failed to update request', variant: 'destructive' });
    }
  };

  const handleFulfill = async (request: RequestRow) => {
    try {
      const { data, error } = await supabase.functions.invoke('manage-transfer-request', {
        body: { action: 'fulfill', requestId: request.id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast({ title: 'Success', description: 'Transfer fulfilled — stock and expenses updated' });
      fetchRequests();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Failed to fulfill request', variant: 'destructive' });
    }
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case 'pending': return <Badge variant="outline" className="bg-yellow-50 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400">Pending</Badge>;
      case 'approved': return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">Approved</Badge>;
      case 'rejected': return <Badge variant="destructive">Rejected</Badge>;
      case 'fulfilled': return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">Fulfilled</Badge>;
      default: return <Badge>{status}</Badge>;
    }
  };

  if (loading) return <div>Loading transfer requests...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h2 className="text-2xl font-bold">Transfer Requests</h2>
        <div className="flex items-center gap-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
              <SelectItem value="fulfilled">Fulfilled</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => setShowForm(true)}><Plus className="h-4 w-4 mr-2" />New Request</Button>
        </div>
      </div>

      {requests.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <ClipboardList className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p className="text-lg font-medium mb-2">No transfer requests</p>
            <p>Create a request to transfer stock from a warehouse to your branch.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {requests.map(req => (
            <Card key={req.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between flex-wrap gap-3 mb-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      {statusBadge(req.status)}
                      <span className="text-sm text-muted-foreground">{format(new Date(req.created_at), 'MMM dd, yyyy HH:mm')}</span>
                    </div>
                    <p className="text-sm"><strong>From:</strong> {req.source_location} → <strong>To:</strong> {req.requesting_location}</p>
                    {req.created_by_name && <p className="text-xs text-muted-foreground">By: {req.created_by_name}</p>}
                    {req.notes && <p className="text-xs text-muted-foreground mt-1">{req.notes}</p>}
                  </div>
                  {isOwner && req.status === 'pending' && (
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => handleUpdateStatus(req.id, 'approved')}>
                        <Check className="h-3 w-3 mr-1" />Approve
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => handleUpdateStatus(req.id, 'rejected')}>
                        <X className="h-3 w-3 mr-1" />Reject
                      </Button>
                    </div>
                  )}
                  {isOwner && req.status === 'approved' && (
                    <Button size="sm" onClick={() => handleFulfill(req)}>
                      <Package className="h-3 w-3 mr-1" />Fulfill
                    </Button>
                  )}
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead>Requested</TableHead>
                      <TableHead>Approved</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {req.items.map((item, idx) => (
                      <TableRow key={idx}>
                        <TableCell>{item.medicine_name}</TableCell>
                        <TableCell>{item.requested_quantity}</TableCell>
                        <TableCell>{item.approved_quantity}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <TransferRequestForm open={showForm} onOpenChange={setShowForm} onSuccess={fetchRequests} />
    </div>
  );
}

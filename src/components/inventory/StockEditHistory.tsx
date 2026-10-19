import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, History, Filter } from 'lucide-react';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useBranchContext } from '@/hooks/useBranchContext';

interface HistoryEntry {
  id: string;
  medicine_id: string;
  branch_id?: string;
  action_type: string;
  field_name?: string;
  old_value?: string;
  new_value?: string;
  reason?: string;
  done_by?: string;
  done_by_name?: string;
  item_name: string;
  branch_name?: string;
  created_at: string;
}

export default function StockEditHistory() {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [actionFilter, setActionFilter] = useState('all');
  const { toast } = useToast();
  const { profile } = useAuth();
  const { selectedBranch } = useBranchContext();

  useEffect(() => {
    fetchHistory();
  }, [selectedBranch]);

  const fetchHistory = async () => {
    try {
      let ownerBranchIds: string[] = [];
      if (!selectedBranch && profile?.role === 'owner' && profile?.id) {
        const { data: ownerBranches } = await supabase
          .from('pharmacy_branches')
          .select('id')
          .eq('pharmacy_owner_id', profile.id);
        ownerBranchIds = (ownerBranches || []).map((b: any) => b.id);
      }

      if (!selectedBranch && ownerBranchIds.length === 0 && profile?.role === 'owner') {
        setHistory([]);
        setLoading(false);
        return;
      }

      let query = (supabase as any)
        .from('stock_edit_history')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);

      if (selectedBranch) {
        query = query.eq('branch_id', selectedBranch);
      } else if (ownerBranchIds.length > 0) {
        query = query.in('branch_id', ownerBranchIds);
      }

      const { data, error } = await query;
      if (error) throw error;
      setHistory(data || []);
    } catch (error) {
      console.error('Error fetching stock edit history:', error);
      toast({ title: 'Error', description: 'Failed to fetch stock edit history', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const filteredHistory = history.filter(entry => {
    const matchesSearch = entry.item_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (entry.done_by_name || '').toLowerCase().includes(searchTerm.toLowerCase());
    const matchesAction = actionFilter === 'all' || entry.action_type === actionFilter;
    return matchesSearch && matchesAction;
  });

  const getActionBadgeVariant = (action: string): 'default' | 'secondary' | 'destructive' | 'outline' => {
    switch (action) {
      case 'Item Created': return 'default';
      case 'Item Modified': return 'secondary';
      case 'Stock Increased': return 'default';
      case 'Stock Decreased': return 'destructive';
      case 'New Batch Added': return 'default';
      case 'Open Pack Units Adjusted': return 'outline';
      case 'Open Pack Units Added': return 'secondary';
      case 'Open Pack Units Removed': return 'destructive';
      default: return 'outline';
    }
  };

  const uniqueActions = [...new Set(history.map(h => h.action_type))].sort();

  if (loading) return <div>Loading history...</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by item name or user..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-8"
          />
        </div>
        <div className="flex items-center space-x-2">
          <Filter className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <Select value={actionFilter} onValueChange={setActionFilter}>
            <SelectTrigger className="w-full sm:w-52">
              <SelectValue placeholder="Filter by action" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Actions</SelectItem>
              {uniqueActions.map(action => (
                <SelectItem key={action} value={action}>{action}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {filteredHistory.length === 0 ? (
        <Card>
          <CardContent className="text-center py-8">
            <History className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No History</h3>
            <p className="text-muted-foreground">No stock edit history found.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredHistory.map(entry => (
            <Card key={entry.id}>
              <CardContent className="p-4">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{entry.item_name}</span>
                      <Badge variant={getActionBadgeVariant(entry.action_type)} className="text-xs">
                        {entry.action_type}
                      </Badge>
                    </div>
                    {entry.field_name && (
                      <p className="text-sm text-muted-foreground">Field: {entry.field_name}</p>
                    )}
                    <div className="flex items-center gap-3 text-sm">
                      {entry.old_value !== null && entry.old_value !== undefined && (
                        <span>Old: <span className="font-medium text-destructive">{entry.old_value}</span></span>
                      )}
                      {entry.new_value !== null && entry.new_value !== undefined && (
                        <span>New: <span className="font-medium text-primary">{entry.new_value}</span></span>
                      )}
                    </div>
                    {entry.reason && (
                      <p className="text-sm"><span className="text-muted-foreground">Reason:</span> {entry.reason}</p>
                    )}
                    {entry.branch_name && (
                      <p className="text-xs text-muted-foreground">Branch: {entry.branch_name}</p>
                    )}
                  </div>
                  <div className="text-right text-xs text-muted-foreground space-y-1">
                    <p>{entry.done_by_name || 'Unknown'}</p>
                    <p>{new Date(entry.created_at).toLocaleString()}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

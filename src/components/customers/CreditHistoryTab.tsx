import { useState, useEffect } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/lib/db';
import { ArrowUp, ArrowDown, Minus } from 'lucide-react';

interface CreditLog {
  id: string;
  previous_score: number;
  new_score: number;
  change_amount: number;
  reason: string;
  notes: string | null;
  created_at: string;
}

interface CreditHistoryTabProps {
  customerId: string;
}

export default function CreditHistoryTab({ customerId }: CreditHistoryTabProps) {
  const [logs, setLogs] = useState<CreditLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLogs();
  }, [customerId]);

  const fetchLogs = async () => {
    setLoading(true);
    const { data } = await (supabase as any)
      .from('credit_logs')
      .select('id, previous_score, new_score, change_amount, reason, notes, created_at')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(50);
    setLogs(data || []);
    setLoading(false);
  };

  if (loading) return <div className="py-4 text-center text-muted-foreground text-sm">Loading...</div>;

  if (logs.length === 0) {
    return <div className="py-4 text-center text-muted-foreground text-sm">No credit score changes yet</div>;
  }

  const ChangeIcon = ({ change }: { change: number }) => (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${
      change > 0 ? 'text-green-600' : change < 0 ? 'text-destructive' : 'text-muted-foreground'
    }`}>
      {change > 0 ? <ArrowUp className="h-3 w-3" /> : change < 0 ? <ArrowDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
      {change > 0 ? '+' : ''}{change}
    </span>
  );

  return (
    <>
      {/* Mobile card layout */}
      <div className="space-y-2 sm:hidden">
        {logs.map(log => (
          <div key={log.id} className="border rounded-lg p-3 bg-card space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{new Date(log.created_at).toLocaleDateString()}</span>
              <ChangeIcon change={log.change_amount} />
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Score</span>
              <span className="font-medium">{log.previous_score} → {log.new_score}</span>
            </div>
            <p className="text-xs text-muted-foreground leading-snug">{log.reason}</p>
            {log.notes && <p className="text-xs text-muted-foreground/70">{log.notes}</p>}
          </div>
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Change</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Notes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.map(log => (
              <TableRow key={log.id}>
                <TableCell className="text-xs">{new Date(log.created_at).toLocaleDateString()}</TableCell>
                <TableCell><ChangeIcon change={log.change_amount} /></TableCell>
                <TableCell className="text-xs">{log.previous_score} → {log.new_score}</TableCell>
                <TableCell className="text-xs">{log.reason}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{log.notes || '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

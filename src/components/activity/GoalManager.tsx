import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useStaffGoals, type StaffGoal } from '@/hooks/useStaffGoals';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Trash2, Plus } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

interface StaffOption { id: string; full_name: string | null; branch_id: string | null }
interface BranchOption { id: string; name: string }

export default function GoalManager() {
  const { profile } = useAuth();
  const { goals, assignments, create, remove, refetch } = useStaffGoals();
  const [open, setOpen] = useState(false);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);

  const [form, setForm] = useState({
    name: '',
    goal_type: 'daily' as StaffGoal['goal_type'],
    target_count: 100,
    start_date: '',
    end_date: '',
    assignment_scope: 'all' as StaffGoal['assignment_scope'],
    branch_id: '',
    staff_ids: [] as string[],
  });

  useEffect(() => {
    if (!profile || profile.role !== 'owner') return;
    (async () => {
      const { data: br } = await (supabase as any)
        .from('pharmacy_branches')
        .select('id, name')
        .eq('pharmacy_owner_id', profile.id);
      setBranches((br || []).map((b: any) => ({ id: b.id, name: b.name })));
      const branchIds = (br || []).map((b: any) => b.id);
      if (branchIds.length === 0) return;
      const { data: pe } = await (supabase as any)
        .from('profiles')
        .select('id, full_name, branch_id')
        .eq('role', 'staff')
        .in('branch_id', branchIds);
      setStaff((pe || []) as StaffOption[]);
    })();
  }, [profile]);

  const submit = async () => {
    try {
      if (!form.name.trim()) return toast({ title: 'Name required', variant: 'destructive' });
      if (form.target_count < 1) return toast({ title: 'Target must be at least 1', variant: 'destructive' });
      if (form.goal_type === 'custom' && (!form.start_date || !form.end_date)) {
        return toast({ title: 'Custom goals need start & end dates', variant: 'destructive' });
      }
      if (form.assignment_scope === 'branch' && !form.branch_id) {
        return toast({ title: 'Pick a branch', variant: 'destructive' });
      }
      if (form.assignment_scope === 'staff' && form.staff_ids.length === 0) {
        return toast({ title: 'Pick at least one staff', variant: 'destructive' });
      }
      await create({
        name: form.name.trim(),
        goal_type: form.goal_type,
        target_count: Number(form.target_count),
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        assignment_scope: form.assignment_scope,
        branch_id: form.assignment_scope === 'branch' ? form.branch_id : null,
        staff_ids: form.assignment_scope === 'staff' ? form.staff_ids : [],
      });
      toast({ title: 'Goal created' });
      setOpen(false);
      setForm({ name: '', goal_type: 'daily', target_count: 100, start_date: '', end_date: '', assignment_scope: 'all', branch_id: '', staff_ids: [] });
    } catch (e: any) {
      toast({ title: 'Failed to create goal', description: e.message, variant: 'destructive' });
    }
  };

  const onDelete = async (id: string) => {
    try {
      await remove(id);
      toast({ title: 'Goal deleted' });
    } catch (e: any) {
      toast({ title: 'Failed', description: e.message, variant: 'destructive' });
    }
  };

  const describeAssignment = (g: StaffGoal) => {
    if (g.assignment_scope === 'all') return 'All staff';
    if (g.assignment_scope === 'branch') return `Branch: ${branches.find((b) => b.id === g.branch_id)?.name || '—'}`;
    const names = assignments.filter((a) => a.goal_id === g.id).map((a) => staff.find((s) => s.id === a.staff_id)?.full_name || '?').filter(Boolean);
    return `Staff: ${names.join(', ') || '—'}`;
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold">Staff Goals</h3>
            <p className="text-xs text-muted-foreground">Create activity targets and motivate your team.</p>
          </div>
          <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" /> New Goal</Button>
        </div>

        <div className="space-y-2">
          {goals.length === 0 && <div className="text-sm text-muted-foreground py-4 text-center">No goals yet. Create one to get started.</div>}
          {goals.map((g) => (
            <div key={g.id} className="flex items-center justify-between rounded-md border bg-card p-3">
              <div>
                <div className="font-medium flex items-center gap-2">
                  {g.name}
                  <Badge variant="outline" className="capitalize">{g.goal_type}</Badge>
                  <Badge variant="secondary">{g.target_count} activities</Badge>
                </div>
                <div className="text-xs text-muted-foreground">{describeAssignment(g)}</div>
              </div>
              <Button variant="ghost" size="icon" onClick={() => onDelete(g.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
            </div>
          ))}
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>New Staff Goal</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Goal Name</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Daily Productivity" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Type</Label>
                  <Select value={form.goal_type} onValueChange={(v) => setForm({ ...form, goal_type: v as any })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="custom">Custom Range</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Target Activities</Label>
                  <Input type="number" min={1} value={form.target_count} onChange={(e) => setForm({ ...form, target_count: Number(e.target.value) })} />
                </div>
              </div>
              {form.goal_type === 'custom' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Start Date</Label>
                    <Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
                  </div>
                  <div>
                    <Label>End Date</Label>
                    <Input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
                  </div>
                </div>
              )}
              <div>
                <Label>Assign To</Label>
                <Select value={form.assignment_scope} onValueChange={(v) => setForm({ ...form, assignment_scope: v as any })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Staff</SelectItem>
                    <SelectItem value="branch">Branch</SelectItem>
                    <SelectItem value="staff">Specific Staff</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.assignment_scope === 'branch' && (
                <div>
                  <Label>Branch</Label>
                  <Select value={form.branch_id} onValueChange={(v) => setForm({ ...form, branch_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Pick a branch" /></SelectTrigger>
                    <SelectContent>
                      {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {form.assignment_scope === 'staff' && (
                <div>
                  <Label>Staff</Label>
                  <div className="max-h-40 overflow-y-auto rounded-md border p-2 space-y-1">
                    {staff.map((s) => {
                      const checked = form.staff_ids.includes(s.id);
                      return (
                        <label key={s.id} className="flex items-center gap-2 text-sm cursor-pointer">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => setForm({
                              ...form,
                              staff_ids: e.target.checked
                                ? [...form.staff_ids, s.id]
                                : form.staff_ids.filter((x) => x !== s.id),
                            })}
                          />
                          {s.full_name || s.id.slice(0, 8)}
                        </label>
                      );
                    })}
                    {staff.length === 0 && <div className="text-xs text-muted-foreground">No staff available.</div>}
                  </div>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={submit}>Create Goal</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

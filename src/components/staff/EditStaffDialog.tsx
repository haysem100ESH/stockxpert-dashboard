import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';

interface EditStaffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  staff: any | null;
  onStaffUpdated: () => void;
}

export default function EditStaffDialog({
  open,
  onOpenChange,
  staff,
  onStaffUpdated
}: EditStaffDialogProps) {
  const [formData, setFormData] = useState({
    full_name: '',
    phone: '',
    branch_id: '',
    salary_type: 'percentage' as 'percentage' | 'fixed',
    salary_percentage: '0',
    salary_fixed_amount: '0'
  });
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (staff && open) {
      setFormData({
        full_name: staff.full_name,
        phone: staff.phone || '',
        branch_id: staff.branch_id || '',
        salary_type: staff.salary_type || 'percentage',
        salary_percentage: String(staff.salary_percentage || 0),
        salary_fixed_amount: String(staff.salary_fixed_amount || 0)
      });
      fetchBranches();
    }
  }, [staff, open]);

  const fetchBranches = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from('pharmacy_branches')
      .select('id, name')
      .eq('pharmacy_owner_id', user.id)
      .order('is_main_branch', { ascending: false })
      .order('name');

    if (data) setBranches(data);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!staff) return;
    
    setLoading(true);

    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: formData.full_name,
          phone: formData.phone || null,
          branch_id: formData.branch_id || null,
          salary_type: formData.salary_type,
          salary_percentage: formData.salary_type === 'percentage' ? (parseFloat(formData.salary_percentage) || 0) : 0,
          salary_fixed_amount: formData.salary_type === 'fixed' ? (parseFloat(formData.salary_fixed_amount) || 0) : 0
        })
        .eq('id', staff.id);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Staff member updated successfully"
      });

      onStaffUpdated();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update staff member",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Staff Member</DialogTitle>
          <DialogDescription>
            Update the staff member information below.
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="full_name">Full Name *</Label>
            <Input
              id="full_name"
              value={formData.full_name}
              onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone">Phone</Label>
            <Input
              id="phone"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label>Salary Type</Label>
            <Select
              value={formData.salary_type}
              onValueChange={(value) => setFormData({ ...formData, salary_type: value as 'percentage' | 'fixed' })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="percentage">Percentage of Sales</SelectItem>
                <SelectItem value="fixed">Fixed Amount</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {formData.salary_type === 'percentage' ? (
            <div className="space-y-2">
              <Label htmlFor="salary_percentage">Salary Percentage (%)</Label>
              <Input
                id="salary_percentage"
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={formData.salary_percentage}
                onChange={(e) => setFormData({ ...formData, salary_percentage: e.target.value })}
                placeholder="e.g. 10"
              />
              <p className="text-xs text-muted-foreground">Percentage of individual monthly sales</p>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="salary_fixed_amount">Fixed Salary Amount (ETB)</Label>
              <Input
                id="salary_fixed_amount"
                type="number"
                min="0"
                step="0.01"
                value={formData.salary_fixed_amount}
                onChange={(e) => setFormData({ ...formData, salary_fixed_amount: e.target.value })}
                placeholder="e.g. 5000"
              />
              <p className="text-xs text-muted-foreground">Fixed monthly salary amount in ETB</p>
            </div>
          )}

          {branches.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="branch_id">Assigned Branch</Label>
              <Select
                value={formData.branch_id}
                onValueChange={(value) => setFormData({ ...formData, branch_id: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select branch" />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((branch) => (
                    <SelectItem key={branch.id} value={branch.id}>
                      {branch.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex gap-2 pt-4">
            <Button type="submit" disabled={loading} className="flex-1">
              {loading ? "Updating..." : "Update Staff Member"}
            </Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

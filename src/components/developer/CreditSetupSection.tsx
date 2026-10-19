import { useState, useEffect } from 'react';
import { supabase } from '@/lib/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { Plus, Trash2, Edit, Loader2, DollarSign } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';

interface SubscriptionPlan {
  id: string;
  name: string;
  description: string;
  branches_limit: number | null;
  staff_limit: number | null;
  created_at: string;
  updated_at: string;
}

interface UniversalCreditPlan {
  id: string;
  days: number;
  price: number;
  created_at: string;
  updated_at: string;
}

export default function CreditSetupSection() {
  const [subscriptionPlans, setSubscriptionPlans] = useState<SubscriptionPlan[]>([]);
  const [plans, setPlans] = useState<UniversalCreditPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<UniversalCreditPlan | null>(null);
  const [formData, setFormData] = useState({ days: 30, price: 50 });
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    fetchPlans();
    fetchSubscriptionPlans();
  }, []);

  const fetchSubscriptionPlans = async () => {
    try {
      const { data, error } = await supabase
        .from('subscription_plans')
        .select('*')
        .order('branches_limit', { ascending: true });

      if (error) throw error;
      // Sort manually to put unlimited (null) at the end
      const sorted = (data || []).sort((a: any, b: any) => {
        if (a.branches_limit === null) return 1;
        if (b.branches_limit === null) return -1;
        return 0;
      });
      setSubscriptionPlans(sorted);
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to fetch subscription plans",
        variant: "destructive"
      });
    }
  };

  const fetchPlans = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('universal_credit_plans')
        .select('*')
        .order('days', { ascending: true });

      if (error) throw error;
      setPlans(data || []);
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to fetch credit plans",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAddPlan = async () => {
    if (formData.days <= 0 || formData.price <= 0) {
      toast({
        title: "Error",
        description: "Days and price must be greater than 0",
        variant: "destructive"
      });
      return;
    }

    try {
      setSubmitting(true);
      const { error } = await supabase
        .from('universal_credit_plans')
        .insert({ days: formData.days, price: formData.price });

      if (error) throw error;

      toast({
        title: "Success",
        description: "Credit plan added successfully"
      });

      setFormData({ days: 30, price: 50 });
      setAddDialogOpen(false);
      fetchPlans();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to add credit plan",
        variant: "destructive"
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditPlan = async () => {
    if (!selectedPlan) return;
    
    if (formData.days <= 0 || formData.price <= 0) {
      toast({
        title: "Error",
        description: "Days and price must be greater than 0",
        variant: "destructive"
      });
      return;
    }

    try {
      setSubmitting(true);
      const { error } = await supabase
        .from('universal_credit_plans')
        .update({ days: formData.days, price: formData.price })
        .eq('id', selectedPlan.id);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Credit plan updated successfully"
      });

      setEditDialogOpen(false);
      setSelectedPlan(null);
      fetchPlans();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update credit plan",
        variant: "destructive"
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeletePlan = async (planId: string) => {
    if (!confirm('Are you sure you want to delete this credit plan?')) return;

    try {
      const { error } = await supabase
        .from('universal_credit_plans')
        .delete()
        .eq('id', planId);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Credit plan deleted successfully"
      });

      fetchPlans();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to delete credit plan",
        variant: "destructive"
      });
    }
  };

  const openEditDialog = (plan: UniversalCreditPlan) => {
    setSelectedPlan(plan);
    setFormData({ days: plan.days, price: plan.price });
    setEditDialogOpen(true);
  };

  if (loading) {
    return <div className="flex justify-center items-center h-32">Loading...</div>;
  }

  return (
    <>
      {/* Subscription Plans Section */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Subscription Plans</CardTitle>
          <CardDescription>
            View subscription tiers with branch and staff limits
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {subscriptionPlans.map((plan) => (
              <Card key={plan.id} className="border-2">
                <CardHeader>
                  <CardTitle className="text-lg">{plan.name}</CardTitle>
                  <CardDescription className="text-xs">
                    {plan.description}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Branches:</span>
                    <span className="font-semibold">
                      {plan.branches_limit === null ? '∞ Unlimited' : plan.branches_limit}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Staff:</span>
                    <span className="font-semibold">
                      {plan.staff_limit === null ? '∞ Unlimited' : plan.staff_limit}
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Universal Credit Plans Section */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" />
              Universal Credit Setup
            </CardTitle>
            <CardDescription>
              Manage credit plans that apply to all new business owner accounts
            </CardDescription>
          </div>
        <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add Credit Plan
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Credit Plan</DialogTitle>
              <DialogDescription>
                Create a new universal credit plan for all new business owners
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="add-days">Days</Label>
                <Input
                  id="add-days"
                  type="number"
                  value={formData.days}
                  onChange={(e) => setFormData({ ...formData, days: parseInt(e.target.value) || 0 })}
                  placeholder="30"
                />
              </div>
              <div>
                <Label htmlFor="add-price">Price ($)</Label>
                <Input
                  id="add-price"
                  type="number"
                  value={formData.price}
                  onChange={(e) => setFormData({ ...formData, price: parseFloat(e.target.value) || 0 })}
                  placeholder="50"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleAddPlan} disabled={submitting}>
                {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Add Plan
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Days</TableHead>
              <TableHead>Price</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {plans.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-muted-foreground">
                  No credit plans configured
                </TableCell>
              </TableRow>
            ) : (
              plans.map((plan) => (
                <TableRow key={plan.id}>
                  <TableCell>{plan.days} days</TableCell>
                  <TableCell>${plan.price}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEditDialog(plan)}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeletePlan(plan.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        {/* Edit Dialog */}
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Credit Plan</DialogTitle>
              <DialogDescription>
                Update the credit plan details
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="edit-days">Days</Label>
                <Input
                  id="edit-days"
                  type="number"
                  value={formData.days}
                  onChange={(e) => setFormData({ ...formData, days: parseInt(e.target.value) || 0 })}
                  placeholder="30"
                />
              </div>
              <div>
                <Label htmlFor="edit-price">Price ($)</Label>
                <Input
                  id="edit-price"
                  type="number"
                  value={formData.price}
                  onChange={(e) => setFormData({ ...formData, price: parseFloat(e.target.value) || 0 })}
                  placeholder="50"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleEditPlan} disabled={submitting}>
                {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Update Plan
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
    </>
  );
}

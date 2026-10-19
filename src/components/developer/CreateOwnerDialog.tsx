import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/db';
import { Plus, Loader2, Trash2 } from 'lucide-react';

interface CreateOwnerDialogProps {
  onOwnerCreated: () => void;
}

export default function CreateOwnerDialog({ onOwnerCreated }: CreateOwnerDialogProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    full_name: '',
    email: '',
    password: '',
    phone: '',
    pharmacy_name: '',
    pharmacy_address: '',
    subscription_plan_id: ''
  });
  const [creditPlans, setCreditPlans] = useState<Array<{ days: number; price: number }>>([]);
  const [universalPlans, setUniversalPlans] = useState<Array<{ id: string; days: number; price: number }>>([]);
  const [subscriptionPlans, setSubscriptionPlans] = useState<Array<{ id: string; name: string }>>([]);
  const { toast } = useToast();

  // Fetch universal credit plans and subscription plans on mount
  useEffect(() => {
    fetchUniversalCreditPlans();
    fetchSubscriptionPlans();
  }, []);

  const fetchSubscriptionPlans = async () => {
    try {
      const { data, error } = await supabase
        .from('subscription_plans')
        .select('id, name')
        .order('branches_limit', { ascending: true });

      if (error) throw error;
      
      if (data && data.length > 0) {
        // Sort manually to put unlimited (null) at the end
        const sorted = data.sort((a: any, b: any) => {
          if (a.branches_limit === null) return 1;
          if (b.branches_limit === null) return -1;
          return 0;
        });
        setSubscriptionPlans(sorted);
        // Set default to Basic plan
        const basicPlan = sorted.find(p => p.name === 'Basic');
        if (basicPlan) {
          setFormData(prev => ({ ...prev, subscription_plan_id: basicPlan.id }));
        }
      }
    } catch (error: any) {
      console.error('Error fetching subscription plans:', error);
    }
  };

  const fetchUniversalCreditPlans = async () => {
    try {
      const { data, error } = await supabase
        .from('universal_credit_plans')
        .select('*')
        .order('days', { ascending: true });

      if (error) throw error;
      
      if (data && data.length > 0) {
        setUniversalPlans(data);
        // Set the credit plans from universal plans
        setCreditPlans(data.map(plan => ({ days: plan.days, price: plan.price })));
      } else {
        // Fallback to default if no universal plans exist
        setCreditPlans([{ days: 30, price: 50 }]);
      }
    } catch (error: any) {
      console.error('Error fetching universal credit plans:', error);
      // Fallback to default
      setCreditPlans([{ days: 30, price: 50 }]);
    }
  };

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const addCreditPlan = () => {
    setCreditPlans([...creditPlans, { days: 30, price: 50 }]);
  };

  const removeCreditPlan = (index: number) => {
    if (creditPlans.length > 1) {
      setCreditPlans(creditPlans.filter((_, i) => i !== index));
    }
  };

  const updateCreditPlan = (index: number, field: 'days' | 'price', value: number) => {
    const updated = [...creditPlans];
    updated[index] = { ...updated[index], [field]: value };
    setCreditPlans(updated);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.full_name || !formData.email || !formData.password || !formData.subscription_plan_id) {
      toast({
        title: "Error",
        description: "Please fill in all required fields including subscription plan",
        variant: "destructive"
      });
      return;
    }

    if (formData.password.length < 6) {
      toast({
        title: "Error",
        description: "Password must be at least 6 characters long",
        variant: "destructive"
      });
      return;
    }

    setLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke('create-pharmacy-owner', {
        body: { ...formData, creditPlans }
      });

      if (error) throw error;

      toast({
        title: "Success",
        description: "Business owner account created successfully"
      });

      setFormData({
        full_name: '',
        email: '',
        password: '',
        phone: '',
        pharmacy_name: '',
        pharmacy_address: '',
        subscription_plan_id: subscriptionPlans.find(p => p.name === 'Basic')?.id || ''
      });
      // Reset to universal plans
      await fetchUniversalCreditPlans();
      
      setOpen(false);
      onOwnerCreated();
    } catch (error: any) {
      console.error('Error creating owner:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to create business owner account",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          Create Owner Account
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Business Owner Account</DialogTitle>
          <DialogDescription>
            Create a new business owner account with full access credentials
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="full_name">Owner Name *</Label>
            <Input
              id="full_name"
              value={formData.full_name}
              onChange={(e) => handleInputChange('full_name', e.target.value)}
              placeholder="Enter owner's full name"
              required
            />
          </div>

          <div>
            <Label htmlFor="email">Email *</Label>
            <Input
              id="email"
              type="email"
              value={formData.email}
              onChange={(e) => handleInputChange('email', e.target.value)}
              placeholder="owner@business.com"
              required
            />
          </div>

          <div>
            <Label htmlFor="password">Password *</Label>
            <Input
              id="password"
              type="password"
              value={formData.password}
              onChange={(e) => handleInputChange('password', e.target.value)}
              placeholder="Minimum 6 characters"
              required
              minLength={6}
            />
          </div>

          <div>
            <Label htmlFor="phone">Phone Number (for Telegram Reports)</Label>
            <Input
              id="phone"
              type="tel"
              value={formData.phone}
              onChange={(e) => handleInputChange('phone', e.target.value)}
              placeholder="+251912345678"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Enter the phone number to receive daily reports via Telegram
            </p>
          </div>

          <div>
            <Label htmlFor="pharmacy_name">Business Name</Label>
            <Input
              id="pharmacy_name"
              value={formData.pharmacy_name}
              onChange={(e) => handleInputChange('pharmacy_name', e.target.value)}
              placeholder="ABC Store"
            />
          </div>

          <div>
            <Label htmlFor="pharmacy_address">Business Address</Label>
            <Textarea
              id="pharmacy_address"
              value={formData.pharmacy_address}
              onChange={(e) => handleInputChange('pharmacy_address', e.target.value)}
              placeholder="123 Main St, City, State 12345"
              rows={3}
            />
          </div>

          <div>
            <Label htmlFor="subscription_plan">Subscription Plan *</Label>
            <Select
              value={formData.subscription_plan_id}
              onValueChange={(value) => handleInputChange('subscription_plan_id', value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a plan" />
              </SelectTrigger>
              <SelectContent>
                {subscriptionPlans.map((plan) => (
                  <SelectItem key={plan.id} value={plan.id}>
                    {plan.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <Label>Credit Plans {universalPlans.length > 0 && <span className="text-xs text-muted-foreground ml-2">(from Universal Setup)</span>}</Label>
              <Button type="button" variant="outline" size="sm" onClick={addCreditPlan}>
                <Plus className="h-4 w-4 mr-1" />
                Add Plan
              </Button>
            </div>
            <div className="space-y-2 mt-2">
              {creditPlans.map((plan, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    type="number"
                    placeholder="Days"
                    value={plan.days}
                    onChange={(e) => updateCreditPlan(index, 'days', parseInt(e.target.value) || 0)}
                    className="w-20"
                  />
                  <span className="text-sm text-muted-foreground">days →</span>
                  <span className="text-sm">$</span>
                  <Input
                    type="number"
                    placeholder="Price"
                    value={plan.price}
                    onChange={(e) => updateCreditPlan(index, 'price', parseFloat(e.target.value) || 0)}
                    className="w-20"
                  />
                  {creditPlans.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeCreditPlan(index)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create Account
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
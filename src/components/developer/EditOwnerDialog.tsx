import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/db';
import { Loader2 } from 'lucide-react';

interface PharmacyOwner {
  id: string;
  full_name: string;
  email: string;
  phone?: string;
  pharmacy_address?: string;
  active: boolean;
  subscription: {
    subscription_credit: number;
    status: string;
    deposit_amount: number;
    plan_id?: string;
  } | null;
}

interface EditOwnerDialogProps {
  owner: PharmacyOwner | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOwnerUpdated: () => void;
}

export default function EditOwnerDialog({ owner, open, onOpenChange, onOwnerUpdated }: EditOwnerDialogProps) {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    full_name: '',
    phone: '',
    pharmacy_address: '',
    active: true,
    subscription_plan_id: '',
    gemini_api_key: ''
  });
  const [subscriptionPlans, setSubscriptionPlans] = useState<Array<{ id: string; name: string }>>([]);
  const { toast } = useToast();

  useEffect(() => {
    fetchSubscriptionPlans();
  }, []);

  useEffect(() => {
    if (owner) {
      // Fetch gemini_api_key for this owner
      const fetchApiKey = async () => {
        const { data } = await supabase
          .from('profiles')
          .select('gemini_api_key')
          .eq('id', owner.id)
          .single();
        setFormData({
          full_name: owner.full_name || '',
          phone: owner.phone || '',
          pharmacy_address: owner.pharmacy_address || '',
          active: owner.active,
          subscription_plan_id: owner.subscription?.plan_id || '',
          gemini_api_key: data?.gemini_api_key || ''
        });
      };
      fetchApiKey();
    }
  }, [owner]);

  const fetchSubscriptionPlans = async () => {
    try {
      const { data, error } = await supabase
        .from('subscription_plans')
        .select('id, name')
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
      console.error('Error fetching subscription plans:', error);
    }
  };

  const handleInputChange = (field: string, value: string | boolean) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!owner || !formData.full_name) {
      toast({
        title: "Error",
        description: "Owner name is required",
        variant: "destructive"
      });
      return;
    }

    setLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke('update-owner-profile', {
        body: {
          owner_id: owner.id,
          full_name: formData.full_name,
          phone: formData.phone,
          pharmacy_address: formData.pharmacy_address,
          gemini_api_key: formData.gemini_api_key,
          subscription_plan_id: formData.subscription_plan_id && formData.subscription_plan_id !== owner.subscription?.plan_id
            ? formData.subscription_plan_id
            : undefined
        }
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast({
        title: "Success",
        description: "Owner information updated successfully"
      });
      
      onOpenChange(false);
      onOwnerUpdated();
    } catch (error: any) {
      console.error('Error updating owner:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to update owner information",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  if (!owner) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Owner: {owner.full_name}</DialogTitle>
          <DialogDescription>
            Update business owner information and account status
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
            <Label htmlFor="email">Email (Read-only)</Label>
            <Input
              id="email"
              value={owner.email}
              disabled
              className="bg-muted"
            />
          </div>

          <div>
            <Label htmlFor="phone">Phone Number</Label>
            <Input
              id="phone"
              type="tel"
              value={formData.phone}
              onChange={(e) => handleInputChange('phone', e.target.value)}
              placeholder="+1 (555) 123-4567"
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
            <Label htmlFor="subscription_plan">Subscription Plan</Label>
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
            <Label htmlFor="gemini_api_key">Gemini API Key</Label>
            <Input
              id="gemini_api_key"
              type="password"
              value={formData.gemini_api_key}
              onChange={(e) => handleInputChange('gemini_api_key', e.target.value)}
              placeholder="AIzaSy..."
            />
            <p className="text-xs text-muted-foreground mt-1">
              Owner's personal Gemini API key for StockXpert AI assistant
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
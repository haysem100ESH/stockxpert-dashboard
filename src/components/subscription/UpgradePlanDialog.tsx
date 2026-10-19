import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/db';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Check, ArrowRight } from 'lucide-react';

interface UpgradePlanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentPlan: string;
  onUpgradeComplete: () => void;
}

interface Plan {
  id: string;
  name: string;
  description: string;
  branches_limit: number | null;
  staff_limit: number | null;
}

export default function UpgradePlanDialog({
  open,
  onOpenChange,
  currentPlan,
  onUpgradeComplete,
}: UpgradePlanDialogProps) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState(false);
  const { user } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      fetchPlans();
    }
  }, [open]);

  const fetchPlans = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('subscription_plans')
        .select('*')
        .order('branches_limit', { ascending: true });

      if (error) throw error;

      // Filter to show only higher-tier plans and sort manually
      const planOrder = ['Basic', 'Advanced', 'Premium', 'Premium Plus'];
      const currentIndex = planOrder.indexOf(currentPlan);
      let availablePlans = (data || []).filter(
        (plan) => planOrder.indexOf(plan.name) > currentIndex
      );
      
      // Sort to put unlimited at the end
      availablePlans = availablePlans.sort((a: any, b: any) => {
        if (a.branches_limit === null) return 1;
        if (b.branches_limit === null) return -1;
        return 0;
      });

      setPlans(availablePlans);
    } catch (error: any) {
      toast({
        title: 'Error loading plans',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleUpgrade = async (planId: string, planName: string) => {
    try {
      setUpgrading(true);

      // Update subscription plan
      const { error } = await supabase
        .from('pharmacy_subscriptions')
        .update({ plan_id: planId })
        .eq('pharmacy_owner_id', user!.id);

      if (error) throw error;

      toast({
        title: 'Plan upgraded successfully!',
        description: `Your plan has been upgraded to ${planName}.`,
      });

      onUpgradeComplete();
      onOpenChange(false);
    } catch (error: any) {
      toast({
        title: 'Upgrade failed',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setUpgrading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Upgrade Your Subscription Plan</DialogTitle>
          <DialogDescription>
            Choose a higher tier to unlock more branches and staff members
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="text-center py-8">Loading available plans...</div>
        ) : plans.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            You're already on the highest plan! 🎉
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {plans.map((plan) => (
              <Card key={plan.id} className="relative border-2 hover:border-primary transition-colors">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    {plan.name}
                    {plan.name === 'Premium Plus' && (
                      <Badge variant="default" className="ml-2">
                        Popular
                      </Badge>
                    )}
                  </CardTitle>
                  <CardDescription className="text-sm">
                    {plan.description}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm">
                      <Check className="h-4 w-4 text-green-600" />
                      <span>
                        <strong>
                          {plan.branches_limit === null
                            ? 'Unlimited'
                            : plan.branches_limit}
                        </strong>{' '}
                        {plan.branches_limit === 1 ? 'Branch' : 'Branches'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Check className="h-4 w-4 text-green-600" />
                      <span>
                        <strong>
                          {plan.staff_limit === null ? 'Unlimited' : plan.staff_limit}
                        </strong>{' '}
                        Staff Members
                      </span>
                    </div>
                  </div>
                  <Button
                    onClick={() => handleUpgrade(plan.id, plan.name)}
                    disabled={upgrading}
                    className="w-full gap-2"
                  >
                    Upgrade to {plan.name}
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

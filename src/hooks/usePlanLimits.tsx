import { useState, useEffect } from 'react';
import { supabase } from '@/lib/db';
import { useAuth } from '@/hooks/useAuth';

interface PlanLimits {
  planName: string;
  branchesLimit: number | null;
  staffLimit: number | null;
  currentBranches: number;
  currentStaff: number;
  canAddBranch: boolean;
  canAddStaff: boolean;
}

export function usePlanLimits() {
  const { user, profile } = useAuth();
  const [planLimits, setPlanLimits] = useState<PlanLimits | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user && profile?.role === 'owner') {
      fetchPlanLimits();
    } else {
      setLoading(false);
    }
  }, [user, profile]);

  const fetchPlanLimits = async () => {
    try {
      setLoading(true);
      
      // Get subscription with plan details
      const { data: subscription, error: subError } = await supabase
        .from('pharmacy_subscriptions')
        .select(`
          *,
          subscription_plans (
            name,
            branches_limit,
            staff_limit
          )
        `)
        .eq('pharmacy_owner_id', user!.id)
        .single();

      if (subError) throw subError;

      // Get current branches count
      const { data: branchesData, error: branchError } = await supabase
        .rpc('get_branches_count', { owner_id: user!.id });

      if (branchError) throw branchError;

      // Get current staff count
      const { data: staffData, error: staffError } = await supabase
        .rpc('get_staff_count', { owner_id: user!.id });

      if (staffError) throw staffError;

      // Check if can add more
      const { data: canAddBranchData, error: branchCheckError } = await supabase
        .rpc('can_add_branch', { owner_id: user!.id });

      if (branchCheckError) throw branchCheckError;

      const { data: canAddStaffData, error: staffCheckError } = await supabase
        .rpc('can_add_staff', { owner_id: user!.id });

      if (staffCheckError) throw staffCheckError;

      const plan = subscription.subscription_plans as any;
      
      setPlanLimits({
        planName: plan?.name || 'Basic',
        branchesLimit: plan?.branches_limit ?? null,
        staffLimit: plan?.staff_limit ?? null,
        currentBranches: branchesData || 0,
        currentStaff: staffData || 0,
        canAddBranch: canAddBranchData,
        canAddStaff: canAddStaffData,
      });
    } catch (error) {
      console.error('Error fetching plan limits:', error);
    } finally {
      setLoading(false);
    }
  };

  return {
    planLimits,
    loading,
    refetch: fetchPlanLimits,
  };
}

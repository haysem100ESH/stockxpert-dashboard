import { useState, useEffect } from 'react';
import { supabase } from '@/lib/db';
import { useAuth } from '@/hooks/useAuth';

interface SubscriptionData {
  id: string;
  subscription_credit: number;
  status: 'active' | 'expiring_soon' | 'expired' | 'inactive';
  deposit_amount: number;
  created_at: string;
  updated_at: string;
}

export function useSubscription() {
  const { user, profile } = useAuth();
  const [subscription, setSubscription] = useState<SubscriptionData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user && (profile?.role === 'owner' || profile?.role === 'staff')) {
      fetchSubscription();
    } else {
      setLoading(false);
    }
  }, [user, profile]);

  const fetchSubscription = async () => {
    try {
      setLoading(true);
      
      let ownerId = user!.id;
      
      // For staff, get owner via their branch
      if (profile?.role === 'staff' && profile?.branch_id) {
        const { data: branchData } = await supabase
          .from('pharmacy_branches')
          .select('pharmacy_owner_id')
          .eq('id', profile.branch_id)
          .single();
        
        if (branchData?.pharmacy_owner_id) {
          ownerId = branchData.pharmacy_owner_id;
        }
      }
      
      const { data, error } = await supabase
        .from('pharmacy_subscriptions')
        .select('*')
        .eq('pharmacy_owner_id', ownerId)
        .maybeSingle();

      if (error) throw error;
      
      setSubscription(data);
    } catch (error) {
      console.error('Error fetching subscription:', error);
    } finally {
      setLoading(false);
    }
  };

  const isSubscriptionActive = () => {
    if (!subscription) return false;
    return subscription.status === 'active' || subscription.status === 'expiring_soon';
  };

  const isSubscriptionExpired = () => {
    if (!subscription) return true;
    return subscription.status === 'expired';
  };

  const isSubscriptionExpiring = () => {
    if (!subscription) return false;
    return subscription.status === 'expiring_soon';
  };

  const getDaysRemaining = () => {
    if (!subscription) return 0;
    return subscription.subscription_credit;
  };

  const triggerCreditDeduction = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('daily-credit-deduction', {
        body: { manual: true }
      });

      if (error) throw error;
      
      // Refresh subscription data
      await fetchSubscription();
      
      return { success: true, data };
    } catch (error: any) {
      console.error('Error triggering credit deduction:', error);
      return { success: false, error: error.message };
    }
  };

  return {
    subscription,
    loading,
    isSubscriptionActive,
    isSubscriptionExpired,
    isSubscriptionExpiring,
    getDaysRemaining,
    triggerCreditDeduction,
    refetch: fetchSubscription
  };
}
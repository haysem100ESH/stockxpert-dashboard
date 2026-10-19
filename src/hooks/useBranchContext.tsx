import { createContext, useContext, useState, useEffect } from 'react';
import { useAuth } from './useAuth';
import { supabase } from '@/lib/db';

export type BranchType = 'pharmacy' | 'general';

interface BranchContextType {
  selectedBranch: string | null;
  setSelectedBranch: (branchId: string | null) => void;
  userBranch: string | null;
  branchType: BranchType;
}

const BranchContext = createContext<BranchContextType | undefined>(undefined);

const STORAGE_KEY = 'selectedBranchId';

export function BranchProvider({ children }: { children: React.ReactNode }) {
  const [selectedBranch, setSelectedBranchState] = useState<string | null>(null);
  const [userBranch, setUserBranch] = useState<string | null>(null);
  const [branchType, setBranchType] = useState<BranchType>('general');
  const { profile, user } = useAuth();

  // Persist selection to localStorage (owner only)
  const setSelectedBranch = (branchId: string | null) => {
    setSelectedBranchState(branchId);
    if (profile?.role === 'owner') {
      if (branchId) {
        localStorage.setItem(STORAGE_KEY, branchId);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
  };

  useEffect(() => {
    const fetchUserBranch = async () => {
      if (profile?.role === 'staff' && user?.id) {
        try {
          if (profile.branch_id) {
            setUserBranch(profile.branch_id);
            setSelectedBranchState(profile.branch_id); // Staff can only see their branch
          }
        } catch (error) {
          console.error('Error fetching user branch:', error);
        }
      } else if (profile?.role === 'owner' && profile?.id) {
        // Restore persisted branch selection, or default to "All Branches" (null)
        const persisted = localStorage.getItem(STORAGE_KEY);
        if (persisted) {
          // Validate that the persisted branch still belongs to this owner
          const { data: match } = await supabase
            .from('pharmacy_branches')
            .select('id, branch_type')
            .eq('id', persisted)
            .eq('pharmacy_owner_id', profile.id)
            .maybeSingle();
          if (match) {
            setSelectedBranchState(match.id);
            setBranchType((match as any).branch_type || 'pharmacy');
          } else {
            // Branch no longer valid — clear and fall back to All Branches
            localStorage.removeItem(STORAGE_KEY);
            setSelectedBranchState(null);
          }
        } else {
          // Default: "All Branches"
          setSelectedBranchState(null);
        }
        setUserBranch(null);
      }
    };

    fetchUserBranch();
  }, [profile, user]);

  // Fetch branch type whenever selectedBranch changes
  useEffect(() => {
    const fetchBranchType = async () => {
      if (!selectedBranch) {
        setBranchType('general'); // default to StockXpert when viewing all branches
        return;
      }
      const { data } = await supabase
        .from('pharmacy_branches')
        .select('branch_type')
        .eq('id', selectedBranch)
        .single();
      if (data) {
        setBranchType((data as any).branch_type || 'pharmacy');
      }
    };
    fetchBranchType();
  }, [selectedBranch]);

  return (
    <BranchContext.Provider value={{ 
      selectedBranch, 
      setSelectedBranch: profile?.role === 'staff' ? () => {} : setSelectedBranch,
      userBranch,
      branchType
    }}>
      {children}
    </BranchContext.Provider>
  );
}

export function useBranchContext() {
  const context = useContext(BranchContext);
  if (context === undefined) {
    throw new Error('useBranchContext must be used within a BranchProvider');
  }
  return context;
}

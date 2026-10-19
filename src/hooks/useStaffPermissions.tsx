import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { supabase } from '@/lib/db';
import { useAuth } from '@/hooks/useAuth';

export type PermissionLevel = 'no_access' | 'read' | 'edit';

export const ALL_PAGES = [
  'dashboard',
  'inventory',
  'sales',
  'customers',
  'finance',
  'suppliers',
  'attendance',
  'smart_inventory',
  'transfers',
  'global_inventory',
  'account',
] as const;

export type PageName = typeof ALL_PAGES[number];

export const PAGE_LABELS: Record<PageName, string> = {
  dashboard: 'Dashboard',
  inventory: 'Inventory / Stock',
  sales: 'Sales',
  customers: 'Customers',
  finance: 'Finance',
  suppliers: 'Suppliers',
  attendance: 'Attendance',
  smart_inventory: 'Smart Inventory',
  transfers: 'Transfer Requests',
  global_inventory: 'Global Inventory',
  account: 'Account / Settings',
};

// Map routes to page names
const ROUTE_TO_PAGE: Record<string, PageName> = {
  '/': 'dashboard',
  '/inventory': 'inventory',
  '/sales': 'sales',
  '/customers': 'customers',
  '/finance': 'finance',
  '/suppliers': 'suppliers',
  '/staff': 'attendance',
  '/smart-inventory': 'smart_inventory',
  '/transfer-requests': 'transfers',
  '/stock-movements': 'global_inventory',
  '/account': 'account',
};

interface StaffPermissionsContextType {
  permissions: Record<PageName, PermissionLevel>;
  loading: boolean;
  getPermission: (page: PageName) => PermissionLevel;
  getPermissionForRoute: (route: string) => PermissionLevel;
  canAccess: (page: PageName) => boolean;
  isReadOnly: (page: PageName) => boolean;
  refreshPermissions: () => Promise<void>;
}

const StaffPermissionsContext = createContext<StaffPermissionsContextType | undefined>(undefined);

const DEFAULT_PERMISSIONS: Record<PageName, PermissionLevel> = Object.fromEntries(
  ALL_PAGES.map(p => [p, 'edit' as PermissionLevel])
) as Record<PageName, PermissionLevel>;

export function StaffPermissionsProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const [permissions, setPermissions] = useState<Record<PageName, PermissionLevel>>(DEFAULT_PERMISSIONS);
  const [loading, setLoading] = useState(true);

  const fetchPermissions = useCallback(async () => {
    if (!profile) {
      setLoading(false);
      return;
    }

    // Owners and developers always have full access
    if (profile.role !== 'staff') {
      setPermissions(DEFAULT_PERMISSIONS);
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('staff_permissions')
        .select('page_name, permission_level')
        .eq('staff_id', profile.id);

      if (error) {
        console.error('Failed to fetch staff permissions:', error);
        // Default to edit on error for backward compatibility
        setPermissions(DEFAULT_PERMISSIONS);
        setLoading(false);
        return;
      }

      // Start with defaults (edit for all), then override with DB values
      const merged = { ...DEFAULT_PERMISSIONS };
      if (data) {
        for (const row of data) {
          if (ALL_PAGES.includes(row.page_name as PageName)) {
            merged[row.page_name as PageName] = row.permission_level as PermissionLevel;
          }
        }
      }
      setPermissions(merged);
    } catch (err) {
      console.error('Permission fetch error:', err);
      setPermissions(DEFAULT_PERMISSIONS);
    } finally {
      setLoading(false);
    }
  }, [profile?.id, profile?.role]);

  useEffect(() => {
    fetchPermissions();
  }, [fetchPermissions]);

  const getPermission = (page: PageName): PermissionLevel => permissions[page] || 'edit';
  
  const getPermissionForRoute = (route: string): PermissionLevel => {
    const page = ROUTE_TO_PAGE[route];
    if (!page) return 'edit';
    return getPermission(page);
  };

  const canAccess = (page: PageName): boolean => getPermission(page) !== 'no_access';
  const isReadOnly = (page: PageName): boolean => getPermission(page) === 'read';

  return (
    <StaffPermissionsContext.Provider value={{
      permissions,
      loading,
      getPermission,
      getPermissionForRoute,
      canAccess,
      isReadOnly,
      refreshPermissions: fetchPermissions,
    }}>
      {children}
    </StaffPermissionsContext.Provider>
  );
}

export function useStaffPermissions() {
  const context = useContext(StaffPermissionsContext);
  if (!context) {
    throw new Error('useStaffPermissions must be used within StaffPermissionsProvider');
  }
  return context;
}

// Hook for route-level page name lookup
export function getPageNameForRoute(route: string): PageName | undefined {
  return ROUTE_TO_PAGE[route];
}

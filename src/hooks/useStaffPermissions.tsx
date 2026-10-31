import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { supabase } from '@/lib/db';
import { cacheMeta, readMeta } from '@/lib/offline/db';
import { useOfflineStatus } from '@/lib/offline/store';
import { useAuth } from '@/hooks/useAuth';
import { loadOfflinePermissions } from '@/lib/offline/gates';
import { withSignal } from '@/lib/offline/readCache';

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
  /** True when offline and this user's permissions were never verified on this PC. */
  uncachedOffline: boolean;
  getPermission: (page: PageName) => PermissionLevel;
  getPermissionForRoute: (route: string) => PermissionLevel;
  canAccess: (page: PageName) => boolean;
  isReadOnly: (page: PageName) => boolean;
  refreshPermissions: () => Promise<void>;
}

const StaffPermissionsContext = createContext<StaffPermissionsContextType | undefined>(undefined);

const DENIED_PERMISSIONS = Object.fromEntries(ALL_PAGES.map(page => [page, 'no_access'])) as Record<PageName, PermissionLevel>;

const DEFAULT_PERMISSIONS: Record<PageName, PermissionLevel> = Object.fromEntries(
  ALL_PAGES.map(p => [p, 'edit' as PermissionLevel])
) as Record<PageName, PermissionLevel>;

/**
 * Shared by the provider and offline preparation: same request, same merge, same cached value.
 * Returns null (and caches nothing) when the server read fails.
 */
export async function fetchAndCacheStaffPermissions(staffId: string, signal?: AbortSignal): Promise<Record<PageName, PermissionLevel> | null> {
  const { data, error } = await withSignal(supabase
    .from('staff_permissions')
    .select('page_name, permission_level')
    .eq('staff_id', staffId), signal);
  if (error) {
    console.error('Failed to fetch staff permissions:', error);
    return null;
  }
  // Start with defaults (edit for all), then override with DB values
  const merged = { ...DEFAULT_PERMISSIONS };
  for (const row of data ?? []) {
    if (ALL_PAGES.includes(row.page_name as PageName)) {
      merged[row.page_name as PageName] = row.permission_level as PermissionLevel;
    }
  }
  await cacheMeta(`permissions:${staffId}`, merged);
  return merged;
}

export function StaffPermissionsProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const { reachable } = useOfflineStatus();
  const [permissions, setPermissions] = useState<Record<PageName, PermissionLevel>>(DENIED_PERMISSIONS);
  const [loading, setLoading] = useState(true);
  const [uncachedOffline, setUncachedOffline] = useState(false);

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

    setLoading(true);
    const fallback = async () => {
      const cached = await loadOfflinePermissions(profile.id, DENIED_PERMISSIONS);
      setPermissions(cached.permissions);
      setUncachedOffline(cached.uncached);
    };
    try {
      if (!reachable) { await fallback(); return; }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const merged = await fetchAndCacheStaffPermissions(profile.id, controller.signal);
      clearTimeout(timer);

      if (!merged) {
        // Cached verified permissions only; uncached offline access is denied.
        await fallback();
        setLoading(false);
        return;
      }

      setPermissions(merged);
      setUncachedOffline(false);
    } catch (err) {
      console.error('Permission fetch error:', err);
      await fallback();
    } finally {
      setLoading(false);
    }
  }, [profile?.id, profile?.role, reachable]);

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
      uncachedOffline,
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

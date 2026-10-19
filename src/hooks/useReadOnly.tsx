import { useAuth } from '@/hooks/useAuth';
import { useStaffPermissions, getPageNameForRoute } from '@/hooks/useStaffPermissions';
import { useLocation } from 'react-router-dom';

/**
 * Returns true if the current user is in read-only mode for the current page.
 * Owners/developers always return false.
 */
export function useReadOnly(): boolean {
  const { profile } = useAuth();
  const { getPermissionForRoute } = useStaffPermissions();
  const location = useLocation();

  if (!profile || profile.role !== 'staff') return false;
  return getPermissionForRoute(location.pathname) === 'read';
}

import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useStaffPermissions, type PageName } from '@/hooks/useStaffPermissions';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ShieldAlert } from 'lucide-react';

interface PermissionGuardProps {
  page: PageName;
  children: ReactNode;
}

export default function PermissionGuard({ page, children }: PermissionGuardProps) {
  const { profile } = useAuth();
  const { getPermission, loading } = useStaffPermissions();

  // Owners/developers bypass
  if (!profile || profile.role !== 'staff') return <>{children}</>;
  if (loading) return null;

  const level = getPermission(page);

  if (level === 'no_access') {
    return <Navigate to="/" replace />;
  }

  if (level === 'read') {
    const blockEvent = (e: React.SyntheticEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-readonly-allow]')) return;
      const btn = target.closest('button, [role="menuitem"]') as HTMLElement | null;
      if (!btn) return;
      // Allow tabs, dialog/popover close, sidebar/nav, search
      const role = btn.getAttribute('role');
      if (role === 'tab') return;
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
      if (aria.includes('close') || aria.includes('toggle') || aria.includes('menu')) return;
      const type = btn.getAttribute('type');
      // Block submit, add, edit, delete, save buttons
      e.preventDefault();
      e.stopPropagation();
      toastReadOnly();
    };

    return (
      <>
        <Alert className="mb-4 border-warning/50 bg-warning/10">
          <ShieldAlert className="h-4 w-4" />
          <AlertDescription className="text-sm font-medium">
            Read Only Mode — You can view this page but cannot make changes.
          </AlertDescription>
        </Alert>
        <div onClickCapture={blockEvent} onSubmitCapture={blockEvent}>
          {children}
        </div>
      </>
    );
  }

  return <>{children}</>;
}

let lastToastAt = 0;
function toastReadOnly() {
  const now = Date.now();
  if (now - lastToastAt < 2000) return;
  lastToastAt = now;
  // Lightweight inline toast via window event (avoid extra imports)
  import('@/hooks/use-toast').then(({ toast }) => {
    toast({
      title: 'Read Only',
      description: 'You do not have permission to make changes on this page.',
      variant: 'destructive',
    });
  });
}

import { ReactNode, useState, useEffect } from 'react';
import { Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/AppSidebar';
import { LogOut, Settings, Sun, Moon, Zap } from 'lucide-react';
import { Loader2 } from 'lucide-react';
import DeviceSignOutDialog from '@/components/sales/DeviceSignOutDialog';
import SubscriptionStatus from '@/components/subscription/SubscriptionStatus';
import ExpiringMedicinesAlert from '@/components/inventory/ExpiringMedicinesAlert';
import InventoryAlertBadge from '@/components/inventory/InventoryAlertBadge';
import { BranchProvider } from '@/hooks/useBranchContext';
import SmartAssistant from '@/components/chat/SmartAssistant';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import BranchSelector from '@/components/branch/BranchSelector';
import { useBranchContext } from '@/hooks/useBranchContext';
import { useBranding } from '@/hooks/useBranding';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useTheme } from 'next-themes';
import { useAdvancedMode } from '@/hooks/useAdvancedMode';
import { Switch } from '@/components/ui/switch';
import { useOfflineSync } from '@/hooks/useOfflineSync';
import { useOfflineStatus } from '@/lib/offline/store';
import OfflineStatusBadge from '@/components/sales/OfflineStatusBadge';
import { Card, CardContent } from '@/components/ui/card';

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const { user, profile, signOut, loading } = useAuth();
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  useOfflineSync();
  const { reachable } = useOfflineStatus();
  const location = useLocation();

  // Native-feeling pull-to-refresh on touch devices.
  usePullToRefresh(!!user);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  if (!profile) return <div className="min-h-screen flex items-center justify-center p-4"><Card><CardContent className="p-6">Connect to the internet to verify your account before using Sales on this device.</CardContent></Card></div>;

  const handleSignOut = () => {
    setShowSignOutConfirm(true);
  };

  const confirmSignOut = async (exported?: string) => {
    await signOut(exported);
    setShowSignOutConfirm(false);
  };

  return (
    <BranchProvider>
      <SidebarProvider>
        <div className="min-h-screen flex w-full">
          <AppSidebar />
          
          <div className="flex-1 flex flex-col min-w-0 overflow-x-hidden">
            <LayoutHeader 
              profile={profile} 
              user={user} 
              onSignOut={handleSignOut} 
            />
            
            <main className="flex-1 overflow-x-hidden overflow-y-auto p-2 sm:p-4 max-w-full">
              {reachable && (profile?.role === 'owner' || profile?.role === 'staff') && <SubscriptionStatus />}
              {reachable && <ExpiringMedicinesAlert />}
              {!reachable && location.pathname !== '/sales' ? <Card><CardContent className="p-6">This page needs an internet connection</CardContent></Card> : children}
            </main>
            
            {/* AI Smart Assistant */}
            {reachable && profile?.role !== 'developer' && <SmartAssistant />}
          </div>
        </div>
        
        <DeviceSignOutDialog
          userId={user.id}
          open={showSignOutConfirm}
          onOpenChange={setShowSignOutConfirm}
          onConfirm={confirmSignOut}
        />
      </SidebarProvider>
    </BranchProvider>
  );
}

function AdvancedModeToggle() {
  const { isAdvancedMode, toggleAdvancedMode } = useAdvancedMode();
  return (
    <div className="flex items-center space-x-1.5">
      <Zap className={`h-3.5 w-3.5 transition-colors ${isAdvancedMode ? 'text-warning' : 'text-muted-foreground'}`} />
      <span className="text-xs font-medium hidden sm:inline text-muted-foreground">Advanced</span>
      <Switch
        checked={isAdvancedMode}
        onCheckedChange={toggleAdvancedMode}
        className="scale-75"
      />
    </div>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8"
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      aria-label="Toggle theme"
    >
      <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
    </Button>
  );
}

function LayoutHeader({ profile, user, onSignOut }: { profile: any, user: any, onSignOut: () => void }) {
  const { selectedBranch, setSelectedBranch } = useBranchContext();
  const branding = useBranding();
  const navigate = useNavigate();
  const { reachable } = useOfflineStatus();

  useEffect(() => {
    document.title = branding.systemName;
  }, [branding.systemName]);
  
  return (
    <header className="border-b bg-card min-h-14 flex flex-wrap items-center justify-between gap-2 px-2 py-2 sm:px-4">
      <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-4">
        <SidebarTrigger className="ml-0" />
        <OfflineStatusBadge />
        
        {/* Branch Selector for Owners */}
        {profile?.role === 'owner' && (
          <BranchSelector
            selectedBranch={selectedBranch}
            onBranchChange={setSelectedBranch}
            showAllOption={true}
          />
        )}
      </div>
      
      <div className="flex items-center space-x-2 sm:space-x-3">
        <AdvancedModeToggle />
        {reachable && profile?.role !== 'developer' && <InventoryAlertBadge />}
        <ThemeToggle />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="flex items-center space-x-2 rounded-full p-1 h-auto">
              <Avatar className="h-8 w-8">
                <AvatarFallback>
                  {profile?.full_name?.charAt(0).toUpperCase() || 'U'}
                </AvatarFallback>
              </Avatar>
              <span className="text-sm font-medium hidden sm:block">
                {profile?.full_name || user.email}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium">{profile?.full_name}</p>
                <p className="text-xs text-muted-foreground">{user.email}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate('/account')}>
              <Settings className="mr-2 h-4 w-4" />
              Open Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onSignOut}>
              <LogOut className="mr-2 h-4 w-4" />
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
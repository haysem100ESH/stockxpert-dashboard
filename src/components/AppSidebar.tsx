import { NavLink, useLocation } from "react-router-dom";
import { useIsMobile } from "@/hooks/use-mobile";
import { 
  LayoutDashboard, 
  Package, 
  ShoppingCart, 
  DollarSign, 
  Truck, 
  Users,
  Settings,
  Building2,
  Shield,
  UserCheck,
  MapPin,
  ArrowRightLeft,
  ClipboardList,
  Globe,
  Brain,
  Tag,
  Activity
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/useAuth";
import { useBranchContext } from "@/hooks/useBranchContext";
import { useBranding } from "@/hooks/useBranding";
import { useAdvancedMode } from "@/hooks/useAdvancedMode";
import { Badge } from "@/components/ui/badge";
import { useStaffPermissions, getPageNameForRoute } from "@/hooks/useStaffPermissions";

export function AppSidebar() {
  const { state, setOpenMobile } = useSidebar();
  const location = useLocation();
  const isMobile = useIsMobile();
  const { profile } = useAuth();
  const { branchType } = useBranchContext();
  const branding = useBranding();
  const { isAdvancedMode } = useAdvancedMode();
  const { canAccess } = useStaffPermissions();
  const currentPath = location.pathname;

  const isPharmacy = branchType === 'pharmacy';

  const ownerNavItems = [
    { title: "Overview", url: "/", icon: LayoutDashboard },
    { title: isPharmacy ? "Inventory" : "Stock", url: "/inventory", icon: Package },
    { title: "Global Inventory", url: "/stock-movements", icon: Globe },
    { title: "Smart Inventory", url: "/smart-inventory", icon: Brain },
    { title: "Medicine Codes", url: "/medicine-codes", icon: Tag },
    { title: "Sales", url: "/sales", icon: ShoppingCart },
    { title: "Finance", url: "/finance", icon: DollarSign },
    { title: "Customers", url: "/customers", icon: UserCheck },
    { title: "Suppliers", url: "/suppliers", icon: Truck },
    { title: "Staff", url: "/staff", icon: Users },
    { title: "Branches", url: "/branches", icon: Building2 },
    
    { title: "Transfer Requests", url: "/transfer-requests", icon: ClipboardList },
    { title: "Activity Center", url: "/owner/activity", icon: Activity },
    { title: "Account", url: "/account", icon: Settings },
  ];

  const staffNavItems = [
    { title: "Overview", url: "/", icon: LayoutDashboard },
    { title: "Sales", url: "/sales", icon: ShoppingCart },
    { title: isPharmacy ? "Inventory" : "Stock", url: "/inventory", icon: Package },
    { title: "Smart Inventory", url: "/smart-inventory", icon: Brain },
    { title: "Medicine Codes", url: "/medicine-codes", icon: Tag },
    { title: "Customers", url: "/customers", icon: UserCheck },
    { title: "Suppliers", url: "/suppliers", icon: Truck },
    { title: "Attendance", url: "/staff", icon: MapPin },
    { title: "Transfer Requests", url: "/transfer-requests", icon: ClipboardList },
    { title: "Activity Center", url: "/activity", icon: Activity },
    { title: "Account", url: "/account", icon: Settings },
  ];

  const developerNavItems = [
    { title: "Developer Portal", url: "/developer", icon: Shield },
    { title: "Account", url: "/account", icon: Settings },
  ];

  const getNavItems = () => {
    if (profile?.role === 'developer') return developerNavItems;
    if (profile?.role === 'owner') return ownerNavItems;
    return staffNavItems;
  };

  // Pages hidden in simple mode
  const hiddenInSimpleMode = ['/smart-inventory', '/staff', '/transfer-requests', '/stock-movements'];
  
  const navItems = getNavItems().filter(item => {
    if (!isAdvancedMode && hiddenInSimpleMode.includes(item.url)) return false;
    // For staff, filter by permissions
    if (profile?.role === 'staff') {
      const pageName = getPageNameForRoute(item.url);
      if (pageName && !canAccess(pageName)) return false;
    }
    return true;
  });
  const isCollapsed = state === "collapsed";

  const isActive = (path: string) => {
    if (path === "/") {
      return currentPath === "/" || currentPath === "";
    }
    return currentPath.startsWith(path);
  };

  const getNavCls = (path: string) =>
    isActive(path) 
      ? "bg-primary/10 text-primary font-medium border-r-2 border-primary" 
      : "hover:bg-muted/50 text-muted-foreground hover:text-foreground";

  return (
    <Sidebar
      className={isCollapsed ? "w-14" : "w-64"}
      collapsible="icon"
    >
      <SidebarHeader className={`border-b p-4 ${branding.sidebarColor}`}>
        <div className="flex items-center space-x-2">
          <div className="flex items-center justify-center w-15 h-15 rounded-md overflow-hidden">
            <img src={branding.logoSrc} alt={branding.logoAlt} className="w-15 h-15 object-cover" />
          </div>
          {!isCollapsed && (
            <div>
              <h1 className="text-lg font-bold text-white">{branding.systemName}</h1>
              {profile && (
                <Badge
                  variant={profile.role === 'owner' ? 'default' : profile.role === 'developer' ? 'destructive' : 'secondary'}
                  className="text-xs"
                >
                  {profile.role === 'owner' ? 'Owner' : profile.role === 'developer' ? 'Developer' : 'Staff'}
                </Badge>
              )}
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink 
                      to={item.url} 
                      end={item.url === "/"}
                      className={getNavCls(item.url)}
                      onClick={() => { if (isMobile) setOpenMobile(false); }}
                    >
                      <item.icon className="h-4 w-4" />
                      {!isCollapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
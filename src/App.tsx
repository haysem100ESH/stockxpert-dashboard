import React from 'react';
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "next-themes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { AdvancedModeProvider } from "@/hooks/useAdvancedMode";
import { StaffPermissionsProvider } from "@/hooks/useStaffPermissions";
import Layout from "@/components/Layout";
import SubscriptionGuard from "@/components/subscription/SubscriptionGuard";
import PermissionGuard from "@/components/permissions/PermissionGuard";
import Dashboard from "./pages/Dashboard";
import InventoryPage from "./pages/InventoryPage";
import SalesPage from "./pages/SalesPage";
import FinancePage from "./pages/FinancePage";
import SuppliersPage from "./pages/SuppliersPage";
import StaffPage from "./pages/StaffPage";
import AccountPage from "./pages/AccountPage";
import DeveloperPage from "./pages/DeveloperPage";
import BranchPage from "./pages/BranchPage";
import CustomersPage from "./pages/CustomersPage";

import StockMovementsPage from "./pages/StockMovementsPage";
import TransferRequestsPage from "./pages/TransferRequestsPage";
import SmartInventoryPage from "./pages/SmartInventoryPage";
import MedicineCodesPage from "./pages/MedicineCodesPage";
import ActivityCenterPage from "./pages/ActivityCenterPage";
import OwnerActivityCenterPage from "./pages/OwnerActivityCenterPage";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";

// Component to handle role-based dashboard routing
const DashboardRouter = () => {
  const { profile } = useAuth();
  
  if (!profile) {
    return <div>Loading...</div>;
  }
  
  // Redirect developers to their portal
  if (profile.role === 'developer') {
    return <Navigate to="/developer" replace />;
  }
  
  // Show regular dashboard for owners and staff
  return <Dashboard />;
};

import { useState } from 'react';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 1,
    },
  },
});

const App = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
      <AdvancedModeProvider>
      <AuthProvider>
      <StaffPermissionsProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <Routes>
              <Route path="/auth" element={<Auth />} />
              <Route path="/" element={<Layout><SubscriptionGuard><PermissionGuard page="dashboard"><DashboardRouter /></PermissionGuard></SubscriptionGuard></Layout>} />
              <Route path="/inventory" element={<Layout><SubscriptionGuard><PermissionGuard page="inventory"><InventoryPage /></PermissionGuard></SubscriptionGuard></Layout>} />
              <Route path="/sales" element={<Layout><SubscriptionGuard><PermissionGuard page="sales"><SalesPage /></PermissionGuard></SubscriptionGuard></Layout>} />
              <Route path="/finance" element={<Layout><SubscriptionGuard><PermissionGuard page="finance"><FinancePage /></PermissionGuard></SubscriptionGuard></Layout>} />
              <Route path="/suppliers" element={<Layout><SubscriptionGuard><PermissionGuard page="suppliers"><SuppliersPage /></PermissionGuard></SubscriptionGuard></Layout>} />
              <Route path="/customers" element={<Layout><SubscriptionGuard><PermissionGuard page="customers"><CustomersPage /></PermissionGuard></SubscriptionGuard></Layout>} />
              <Route path="/staff" element={<Layout><SubscriptionGuard><PermissionGuard page="attendance"><StaffPage /></PermissionGuard></SubscriptionGuard></Layout>} />
              <Route path="/branches" element={<Layout><SubscriptionGuard><BranchPage /></SubscriptionGuard></Layout>} />
              
              <Route path="/stock-movements" element={<Layout><SubscriptionGuard><PermissionGuard page="global_inventory"><StockMovementsPage /></PermissionGuard></SubscriptionGuard></Layout>} />
              <Route path="/transfer-requests" element={<Layout><SubscriptionGuard><PermissionGuard page="transfers"><TransferRequestsPage /></PermissionGuard></SubscriptionGuard></Layout>} />
              <Route path="/smart-inventory" element={<Layout><SubscriptionGuard><PermissionGuard page="smart_inventory"><SmartInventoryPage /></PermissionGuard></SubscriptionGuard></Layout>} />
              <Route path="/medicine-codes" element={<Layout><SubscriptionGuard><PermissionGuard page="inventory"><MedicineCodesPage /></PermissionGuard></SubscriptionGuard></Layout>} />
              <Route path="/activity" element={<Layout><SubscriptionGuard><ActivityCenterPage /></SubscriptionGuard></Layout>} />
              <Route path="/owner/activity" element={<Layout><SubscriptionGuard><OwnerActivityCenterPage /></SubscriptionGuard></Layout>} />
              <Route path="/developer" element={<Layout><DeveloperPage /></Layout>} />
              <Route path="/account" element={<Layout><AccountPage /></Layout>} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </StaffPermissionsProvider>
      </AuthProvider>
      </AdvancedModeProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
};

export default App;

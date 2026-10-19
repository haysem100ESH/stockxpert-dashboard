import { useAuth } from "@/hooks/useAuth";
import { Navigate } from "@/lib/router-compat";
import Dashboard from "@/views/Dashboard";

// Developers go to their portal; owners and staff see the regular dashboard.
export default function DashboardRouter() {
  const { profile } = useAuth();
  if (!profile) return <div>Loading...</div>;
  if (profile.role === "developer") return <Navigate to="/developer" replace />;
  return <Dashboard />;
}

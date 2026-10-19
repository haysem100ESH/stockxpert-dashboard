import { createFileRoute } from "@tanstack/react-router";
import Layout from "@/components/Layout";
import SubscriptionGuard from "@/components/subscription/SubscriptionGuard";
import PermissionGuard from "@/components/permissions/PermissionGuard";
import DashboardRouter from "@/components/DashboardRouter";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Dashboard | StockXpert" },
      { name: "description", content: "StockXpert dashboard — pharmacy and shop stock management." },
      { property: "og:title", content: "Dashboard | StockXpert" },
      { property: "og:description", content: "StockXpert dashboard — pharmacy and shop stock management." },
    ],
  }),
  component: () => (
    <Layout>
      <SubscriptionGuard><PermissionGuard page="dashboard"><DashboardRouter /></PermissionGuard></SubscriptionGuard>
    </Layout>
  ),
});

import { createFileRoute } from "@tanstack/react-router";
import Layout from "@/components/Layout";
import SubscriptionGuard from "@/components/subscription/SubscriptionGuard";
import PermissionGuard from "@/components/permissions/PermissionGuard";
import StockMovementsPage from "@/views/StockMovementsPage";

export const Route = createFileRoute("/stock-movements")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "StockMovements | StockXpert" },
      { name: "description", content: "StockXpert stockmovements — pharmacy and shop stock management." },
      { property: "og:title", content: "StockMovements | StockXpert" },
      { property: "og:description", content: "StockXpert stockmovements — pharmacy and shop stock management." },
    ],
  }),
  component: () => (
    <Layout>
      <SubscriptionGuard><PermissionGuard page="global_inventory"><StockMovementsPage /></PermissionGuard></SubscriptionGuard>
    </Layout>
  ),
});

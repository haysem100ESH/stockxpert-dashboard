import { createFileRoute } from "@tanstack/react-router";
import Layout from "@/components/Layout";
import SubscriptionGuard from "@/components/subscription/SubscriptionGuard";
import PermissionGuard from "@/components/permissions/PermissionGuard";
import InventoryPage from "@/views/InventoryPage";

export const Route = createFileRoute("/inventory")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Inventory | StockXpert" },
      { name: "description", content: "StockXpert inventory — pharmacy and shop stock management." },
      { property: "og:title", content: "Inventory | StockXpert" },
      { property: "og:description", content: "StockXpert inventory — pharmacy and shop stock management." },
    ],
  }),
  component: () => (
    <Layout>
      <SubscriptionGuard><PermissionGuard page="inventory"><InventoryPage /></PermissionGuard></SubscriptionGuard>
    </Layout>
  ),
});

import { createFileRoute } from "@tanstack/react-router";
import Layout from "@/components/Layout";
import SubscriptionGuard from "@/components/subscription/SubscriptionGuard";
import PermissionGuard from "@/components/permissions/PermissionGuard";
import SmartInventoryPage from "@/views/SmartInventoryPage";

export const Route = createFileRoute("/smart-inventory")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "SmartInventory | StockXpert" },
      { name: "description", content: "StockXpert smartinventory — pharmacy and shop stock management." },
      { property: "og:title", content: "SmartInventory | StockXpert" },
      { property: "og:description", content: "StockXpert smartinventory — pharmacy and shop stock management." },
    ],
  }),
  component: () => (
    <Layout>
      <SubscriptionGuard><PermissionGuard page="smart_inventory"><SmartInventoryPage /></PermissionGuard></SubscriptionGuard>
    </Layout>
  ),
});

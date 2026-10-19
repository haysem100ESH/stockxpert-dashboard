import { createFileRoute } from "@tanstack/react-router";
import Layout from "@/components/Layout";
import SubscriptionGuard from "@/components/subscription/SubscriptionGuard";
import PermissionGuard from "@/components/permissions/PermissionGuard";
import SalesPage from "@/views/SalesPage";

export const Route = createFileRoute("/sales")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sales | StockXpert" },
      { name: "description", content: "StockXpert sales — pharmacy and shop stock management." },
      { property: "og:title", content: "Sales | StockXpert" },
      { property: "og:description", content: "StockXpert sales — pharmacy and shop stock management." },
    ],
  }),
  component: () => (
    <Layout>
      <SubscriptionGuard><PermissionGuard page="sales"><SalesPage /></PermissionGuard></SubscriptionGuard>
    </Layout>
  ),
});

import { createFileRoute } from "@tanstack/react-router";
import Layout from "@/components/Layout";
import SubscriptionGuard from "@/components/subscription/SubscriptionGuard";
import PermissionGuard from "@/components/permissions/PermissionGuard";
import FinancePage from "@/views/FinancePage";

export const Route = createFileRoute("/finance")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Finance | StockXpert" },
      { name: "description", content: "StockXpert finance — pharmacy and shop stock management." },
      { property: "og:title", content: "Finance | StockXpert" },
      { property: "og:description", content: "StockXpert finance — pharmacy and shop stock management." },
    ],
  }),
  component: () => (
    <Layout>
      <SubscriptionGuard><PermissionGuard page="finance"><FinancePage /></PermissionGuard></SubscriptionGuard>
    </Layout>
  ),
});

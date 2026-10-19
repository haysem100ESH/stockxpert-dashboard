import { createFileRoute } from "@tanstack/react-router";
import Layout from "@/components/Layout";
import SubscriptionGuard from "@/components/subscription/SubscriptionGuard";
import PermissionGuard from "@/components/permissions/PermissionGuard";
import CustomersPage from "@/views/CustomersPage";

export const Route = createFileRoute("/customers")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Customers | StockXpert" },
      { name: "description", content: "StockXpert customers — pharmacy and shop stock management." },
      { property: "og:title", content: "Customers | StockXpert" },
      { property: "og:description", content: "StockXpert customers — pharmacy and shop stock management." },
    ],
  }),
  component: () => (
    <Layout>
      <SubscriptionGuard><PermissionGuard page="customers"><CustomersPage /></PermissionGuard></SubscriptionGuard>
    </Layout>
  ),
});

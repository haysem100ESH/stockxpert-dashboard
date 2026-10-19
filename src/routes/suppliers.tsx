import { createFileRoute } from "@tanstack/react-router";
import Layout from "@/components/Layout";
import SubscriptionGuard from "@/components/subscription/SubscriptionGuard";
import PermissionGuard from "@/components/permissions/PermissionGuard";
import SuppliersPage from "@/views/SuppliersPage";

export const Route = createFileRoute("/suppliers")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Suppliers | StockXpert" },
      { name: "description", content: "StockXpert suppliers — pharmacy and shop stock management." },
      { property: "og:title", content: "Suppliers | StockXpert" },
      { property: "og:description", content: "StockXpert suppliers — pharmacy and shop stock management." },
    ],
  }),
  component: () => (
    <Layout>
      <SubscriptionGuard><PermissionGuard page="suppliers"><SuppliersPage /></PermissionGuard></SubscriptionGuard>
    </Layout>
  ),
});

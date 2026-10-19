import { createFileRoute } from "@tanstack/react-router";
import Layout from "@/components/Layout";
import SubscriptionGuard from "@/components/subscription/SubscriptionGuard";
import PermissionGuard from "@/components/permissions/PermissionGuard";
import StaffPage from "@/views/StaffPage";

export const Route = createFileRoute("/staff")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Staff | StockXpert" },
      { name: "description", content: "StockXpert staff — pharmacy and shop stock management." },
      { property: "og:title", content: "Staff | StockXpert" },
      { property: "og:description", content: "StockXpert staff — pharmacy and shop stock management." },
    ],
  }),
  component: () => (
    <Layout>
      <SubscriptionGuard><PermissionGuard page="attendance"><StaffPage /></PermissionGuard></SubscriptionGuard>
    </Layout>
  ),
});

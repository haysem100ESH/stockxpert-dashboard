import { createFileRoute } from "@tanstack/react-router";
import Layout from "@/components/Layout";
import SubscriptionGuard from "@/components/subscription/SubscriptionGuard";
import PermissionGuard from "@/components/permissions/PermissionGuard";
import TransferRequestsPage from "@/views/TransferRequestsPage";

export const Route = createFileRoute("/transfer-requests")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "TransferRequests | StockXpert" },
      { name: "description", content: "StockXpert transferrequests — pharmacy and shop stock management." },
      { property: "og:title", content: "TransferRequests | StockXpert" },
      { property: "og:description", content: "StockXpert transferrequests — pharmacy and shop stock management." },
    ],
  }),
  component: () => (
    <Layout>
      <SubscriptionGuard><PermissionGuard page="transfers"><TransferRequestsPage /></PermissionGuard></SubscriptionGuard>
    </Layout>
  ),
});

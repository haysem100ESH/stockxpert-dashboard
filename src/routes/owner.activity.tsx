import { createFileRoute } from "@tanstack/react-router";
import Layout from "@/components/Layout";
import SubscriptionGuard from "@/components/subscription/SubscriptionGuard";
import OwnerActivityCenterPage from "@/views/OwnerActivityCenterPage";

export const Route = createFileRoute("/owner/activity")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "OwnerActivityCenter | StockXpert" },
      { name: "description", content: "StockXpert owneractivitycenter — pharmacy and shop stock management." },
      { property: "og:title", content: "OwnerActivityCenter | StockXpert" },
      { property: "og:description", content: "StockXpert owneractivitycenter — pharmacy and shop stock management." },
    ],
  }),
  component: () => (
    <Layout>
      <SubscriptionGuard><OwnerActivityCenterPage /></SubscriptionGuard>
    </Layout>
  ),
});

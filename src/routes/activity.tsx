import { createFileRoute } from "@tanstack/react-router";
import Layout from "@/components/Layout";
import SubscriptionGuard from "@/components/subscription/SubscriptionGuard";
import ActivityCenterPage from "@/views/ActivityCenterPage";

export const Route = createFileRoute("/activity")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "ActivityCenter | StockXpert" },
      { name: "description", content: "StockXpert activitycenter — pharmacy and shop stock management." },
      { property: "og:title", content: "ActivityCenter | StockXpert" },
      { property: "og:description", content: "StockXpert activitycenter — pharmacy and shop stock management." },
    ],
  }),
  component: () => (
    <Layout>
      <SubscriptionGuard><ActivityCenterPage /></SubscriptionGuard>
    </Layout>
  ),
});

import { createFileRoute } from "@tanstack/react-router";
import Layout from "@/components/Layout";
import SubscriptionGuard from "@/components/subscription/SubscriptionGuard";
import BranchPage from "@/views/BranchPage";

export const Route = createFileRoute("/branches")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Branch | StockXpert" },
      { name: "description", content: "StockXpert branch — pharmacy and shop stock management." },
      { property: "og:title", content: "Branch | StockXpert" },
      { property: "og:description", content: "StockXpert branch — pharmacy and shop stock management." },
    ],
  }),
  component: () => (
    <Layout>
      <SubscriptionGuard><BranchPage /></SubscriptionGuard>
    </Layout>
  ),
});

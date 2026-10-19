import { createFileRoute } from "@tanstack/react-router";
import Layout from "@/components/Layout";
import DeveloperPage from "@/views/DeveloperPage";

export const Route = createFileRoute("/developer")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Developer | StockXpert" },
      { name: "description", content: "StockXpert developer — pharmacy and shop stock management." },
      { property: "og:title", content: "Developer | StockXpert" },
      { property: "og:description", content: "StockXpert developer — pharmacy and shop stock management." },
    ],
  }),
  component: () => (
    <Layout>
      <DeveloperPage />
    </Layout>
  ),
});

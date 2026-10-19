import { createFileRoute } from "@tanstack/react-router";
import Layout from "@/components/Layout";
import AccountPage from "@/views/AccountPage";

export const Route = createFileRoute("/account")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Account | StockXpert" },
      { name: "description", content: "StockXpert account — pharmacy and shop stock management." },
      { property: "og:title", content: "Account | StockXpert" },
      { property: "og:description", content: "StockXpert account — pharmacy and shop stock management." },
    ],
  }),
  component: () => (
    <Layout>
      <AccountPage />
    </Layout>
  ),
});

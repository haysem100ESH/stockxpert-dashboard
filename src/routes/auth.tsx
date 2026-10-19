import { createFileRoute } from "@tanstack/react-router";
import Auth from "@/views/Auth";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in | StockXpert" },
      { name: "description", content: "Sign in to StockXpert to manage your pharmacy or shop inventory, sales and staff." },
      { property: "og:title", content: "Sign in | StockXpert" },
      { property: "og:description", content: "Sign in to StockXpert to manage your pharmacy or shop inventory, sales and staff." },
    ],
  }),
  component: Auth,
});

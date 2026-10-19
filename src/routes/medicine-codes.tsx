import { createFileRoute } from "@tanstack/react-router";
import Layout from "@/components/Layout";
import SubscriptionGuard from "@/components/subscription/SubscriptionGuard";
import PermissionGuard from "@/components/permissions/PermissionGuard";
import MedicineCodesPage from "@/views/MedicineCodesPage";

export const Route = createFileRoute("/medicine-codes")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Medicine Codes | StockXpert" },
      { name: "description", content: "StockXpert medicine codes — pharmacy and shop stock management." },
      { property: "og:title", content: "Medicine Codes | StockXpert" },
      { property: "og:description", content: "StockXpert medicine codes — pharmacy and shop stock management." },
    ],
  }),
  component: () => (
    <Layout>
      <SubscriptionGuard><PermissionGuard page="inventory"><MedicineCodesPage /></PermissionGuard></SubscriptionGuard>
    </Layout>
  ),
});

import SalesManagement from '@/components/sales/SalesManagement';
import OtherCashierSalesNotice from '@/components/sales/OtherCashierSalesNotice';

export default function SalesPage() {
  return <div className="space-y-4"><OtherCashierSalesNotice /><SalesManagement /></div>;
}
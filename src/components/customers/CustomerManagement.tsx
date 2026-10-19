import { useState } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DataTable } from '@/components/ui/data-table';
import { Plus, Users, DollarSign, AlertTriangle, Edit, CreditCard, Eye, MoreHorizontal, FileText } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useBranchContext } from '@/hooks/useBranchContext';
import { useCustomers, type CustomerRow } from '@/hooks/useCustomers';
import CreditScoreBadge from './CreditScoreBadge';
import DebtProgressBar from './DebtProgressBar';
import AddCustomerDialog from './AddCustomerDialog';
import EditCustomerDialog from './EditCustomerDialog';
import RecordPaymentDialog from './RecordPaymentDialog';
import CustomerDetailDialog from './CustomerDetailDialog';
import CustomerLedgerDialog from './CustomerLedgerDialog';
import DebtorExpandableList from './DebtorExpandableList';
import { useReadOnly } from '@/hooks/useReadOnly';

type Customer = CustomerRow;

type PaymentStatus = 'No Sales' | 'Paid' | 'Partial' | 'Unpaid';

const statusVariant: Record<PaymentStatus, 'secondary' | 'default' | 'outline' | 'destructive'> = {
  'No Sales': 'secondary',
  'Paid': 'default',
  'Partial': 'outline',
  'Unpaid': 'destructive',
};

function getPaymentStatus(c: Customer): PaymentStatus {
  if (c.totalPurchases === 0) return 'No Sales';
  if (c.totalDebt === 0) return 'Paid';
  if (c.totalPaid > 0) return 'Partial';
  return 'Unpaid';
}

export default function CustomerManagement() {
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [showLedgerDialog, setShowLedgerDialog] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const { selectedBranch } = useBranchContext();
  const { toast } = useToast();
  const readOnly = useReadOnly();

  // Cache-first fetch via TanStack Query — instant hydration on revisit.
  const { customers, loading, refetch } = useCustomers();
  const fetchCustomers = () => { refetch(); };

  const openEdit = (c: Customer) => { setSelectedCustomer(c); setShowEditDialog(true); };
  const openPayment = (c: Customer) => { setSelectedCustomer(c); setShowPaymentDialog(true); };
  const openDetail = (c: Customer) => { setSelectedCustomer(c); setShowDetailDialog(true); };
  const openLedger = (c: Customer) => { setSelectedCustomer(c); setShowLedgerDialog(true); };

  const allColumns: ColumnDef<Customer>[] = [
    { accessorKey: 'name', header: 'Name', cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
    { accessorKey: 'phone', header: 'Phone', cell: ({ row }) => row.original.phone || <span className="text-muted-foreground">—</span> },
    {
      accessorKey: 'credit_score',
      header: 'Credit Score',
      cell: ({ row }) => <CreditScoreBadge score={row.original.credit_score} />,
    },
    {
      accessorKey: 'totalDebt',
      header: 'Debt / Limit',
      cell: ({ row }) => (
        <div className="min-w-[160px]">
          <DebtProgressBar currentDebt={row.original.totalDebt} maxCreditLimit={row.original.max_credit_limit} />
        </div>
      ),
    },
    {
      accessorKey: 'totalPurchases',
      header: 'Purchases',
      cell: ({ row }) => `ETB ${row.original.totalPurchases.toFixed(2)}`,
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const status = getPaymentStatus(row.original);
        return <Badge variant={statusVariant[status]}>{status}</Badge>;
      },
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => {
        const c = row.original;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => openDetail(c)}>
                <Eye className="mr-2 h-4 w-4" /> View Details
              </DropdownMenuItem>
              {!readOnly && (
                <DropdownMenuItem onClick={() => openEdit(c)}>
                  <Edit className="mr-2 h-4 w-4" /> Edit
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => openLedger(c)}>
                <FileText className="mr-2 h-4 w-4" /> Ledger
              </DropdownMenuItem>
              {!readOnly && c.totalDebt > 0 && (
                <DropdownMenuItem onClick={() => openPayment(c)}>
                  <CreditCard className="mr-2 h-4 w-4" /> Record Payment
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  const debtorColumns: ColumnDef<Customer>[] = [
    { accessorKey: 'name', header: 'Name', cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
    { accessorKey: 'phone', header: 'Phone', cell: ({ row }) => row.original.phone || '—' },
    {
      accessorKey: 'totalDebt',
      header: 'Outstanding',
      cell: ({ row }) => <span className="text-destructive font-semibold">ETB {row.original.totalDebt.toFixed(2)}</span>,
    },
    {
      accessorKey: 'lastPurchaseDate',
      header: 'Last Purchase',
      cell: ({ row }) => row.original.lastPurchaseDate
        ? new Date(row.original.lastPurchaseDate).toLocaleDateString()
        : '—',
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => readOnly ? null : (
        <Button size="sm" variant="outline" onClick={() => openPayment(row.original)}>
          <CreditCard className="h-3 w-3 mr-1" /> Record Payment
        </Button>
      ),
    },
  ];

  const totalOutstanding = customers.reduce((s, c) => s + c.totalDebt, 0);
  const customersWithDebt = customers.filter(c => c.totalDebt > 0).length;
  const debtors = [...customers].filter(c => c.totalDebt > 0).sort((a, b) => b.totalDebt - a.totalDebt);

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Customers</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold">{customers.length}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Outstanding Debt</CardTitle>
            <DollarSign className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">ETB {totalOutstanding.toFixed(2)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Customers with Debt</CardTitle>
            <AlertTriangle className="h-4 w-4 text-warning" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold">{customersWithDebt}</div></CardContent>
        </Card>
      </div>

      <Tabs defaultValue="all" className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <TabsList>
            <TabsTrigger value="all">All Customers</TabsTrigger>
            <TabsTrigger value="debtors">Debtors ({debtors.length})</TabsTrigger>
          </TabsList>
          <Button onClick={() => {
            if (readOnly) return;
            if (!selectedBranch) {
              toast({ title: 'Branch Required', description: 'Please select a specific branch before creating a customer.', variant: 'destructive' });
              return;
            }
            setShowAddDialog(true);
          }} size="sm" disabled={readOnly}>
            <Plus className="h-4 w-4 mr-1" /> Add Customer
          </Button>
        </div>

        <TabsContent value="all">
          <Card>
            <CardContent className="pt-4">
              <DataTable
                columns={allColumns}
                data={customers}
                searchKey="name"
                searchPlaceholder="Search customers..."
                loading={loading}
                emptyMessage="No customers found."
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="debtors">
          <Card>
            <CardContent className="pt-4">
              <DebtorExpandableList
                debtors={debtors}
                loading={loading}
                onRecordPayment={(d) => openPayment(d as Customer)}
                onViewLedger={(d) => openLedger(d as Customer)}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <AddCustomerDialog open={showAddDialog} onOpenChange={setShowAddDialog} onCustomerAdded={fetchCustomers} />
      <EditCustomerDialog open={showEditDialog} onOpenChange={setShowEditDialog} customer={selectedCustomer} onCustomerUpdated={fetchCustomers} />
      {selectedCustomer && (
        <>
          <RecordPaymentDialog
            open={showPaymentDialog}
            onOpenChange={setShowPaymentDialog}
            customerId={selectedCustomer.id}
            customerName={selectedCustomer.name}
            outstandingAmount={selectedCustomer.totalDebt}
            creditScore={selectedCustomer.credit_score}
            onPaymentRecorded={fetchCustomers}
          />
          <CustomerDetailDialog
            open={showDetailDialog}
            onOpenChange={setShowDetailDialog}
            customerId={selectedCustomer.id}
            customerName={selectedCustomer.name}
          />
          <CustomerLedgerDialog
            open={showLedgerDialog}
            onOpenChange={setShowLedgerDialog}
            customerId={selectedCustomer.id}
            customerName={selectedCustomer.name}
          />
        </>
      )}
    </div>
  );
}

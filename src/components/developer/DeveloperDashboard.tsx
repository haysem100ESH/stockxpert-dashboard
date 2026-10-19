import { useState, useEffect } from 'react';
import { supabase } from '@/lib/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Users, Building, CreditCard, AlertTriangle, Edit, UserX, UserCheck, DollarSign, Calendar, TrendingUp, Send, Key } from 'lucide-react';
import CreateOwnerDialog from './CreateOwnerDialog';
import EditOwnerDialog from './EditOwnerDialog';
import CreditSetupSection from './CreditSetupSection';
import SubscriptionPlanStats from './SubscriptionPlanStats';
import CatalogManagement from './CatalogManagement';

interface PharmacyOwner {
  id: string;
  full_name: string;
  email: string;
  phone?: string;
  telegram_chat_id?: string;
  pharmacy_name?: string;
  pharmacy_address?: string;
  active: boolean;
  manually_deactivated?: boolean;
  has_gemini_api_key: boolean;
  subscription: {
    subscription_credit: number;
    status: string;
    deposit_amount: number;
    last_credit_deduction: string;
    plan_name?: string;
  } | null;
  branch_count: number;
}

interface Transaction {
  id: string;
  pharmacy_owner_id: string;
  amount_collected: number;
  credit_days_added: number;
  transaction_type: string;
  processed_by: string;
  created_at: string;
  notes?: string;
  owner_name?: string;
  pharmacy_name?: string;
  pharmacy_address?: string;
}

export default function DeveloperDashboard() {
  const [owners, setOwners] = useState<PharmacyOwner[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOwner, setSelectedOwner] = useState<PharmacyOwner | null>(null);
  const [editOwner, setEditOwner] = useState<PharmacyOwner | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [creditAmount, setCreditAmount] = useState<number>(30);
  const [depositAmount, setDepositAmount] = useState<number>(0);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [showTransactions, setShowTransactions] = useState(false);
  const [selectedOwnerForCredit, setSelectedOwnerForCredit] = useState<PharmacyOwner | null>(null);
  const [creditDialogOpen, setCreditDialogOpen] = useState(false);
  const [ownerCreditPlans, setOwnerCreditPlans] = useState<any[]>([]);
  const [filterPharmacyName, setFilterPharmacyName] = useState('');
  const [filterMonth, setFilterMonth] = useState('');
  const [filterCreditAdded, setFilterCreditAdded] = useState('');
  const [searchOwnerName, setSearchOwnerName] = useState('');
  const [searchPharmacyName, setSearchPharmacyName] = useState('');
  const [sendingReport, setSendingReport] = useState(false);
  const [selectedOwnersForReport, setSelectedOwnersForReport] = useState<string[]>([]);
  const [showReportDialog, setShowReportDialog] = useState(false);
  const [reportType, setReportType] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const { toast } = useToast();

  useEffect(() => {
    fetchPharmacyOwners();
    fetchTransactions();
  }, []);

  const fetchTransactions = async () => {
    try {
      const { data: transactionData, error } = await supabase
        .from('transactions')
        .select(`
          id,
          pharmacy_owner_id,
          amount_collected,
          credit_days_added,
          transaction_type,
          processed_by,
          created_at,
          notes
        `)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      // Fetch owner details for each transaction
      const transactionsWithDetails = await Promise.all(
        (transactionData || []).map(async (transaction: any) => {
          const { data: profileData } = await supabase
            .from('profiles')
            .select('full_name, pharmacy_name, pharmacy_address')
            .eq('id', transaction.pharmacy_owner_id)
            .single();

          return {
            ...transaction,
            owner_name: profileData?.full_name || 'Unknown',
            pharmacy_name: profileData?.pharmacy_name || 'N/A',
            pharmacy_address: profileData?.pharmacy_address || 'N/A'
          };
        })
      );

      setTransactions(transactionsWithDetails);
    } catch (error: any) {
      console.error('Error fetching transactions:', error);
    }
  };

  const fetchPharmacyOwners = async () => {
    try {
      setLoading(true);
      
      // Get all business owners with their email using RPC call
      const { data: profilesWithEmail, error: profilesError } = await supabase
        .rpc('get_owners_with_email') as { data: any[] | null, error: any };

      if (profilesError) {
        console.error('RPC error:', profilesError);
        throw profilesError;
      }

      if (!profilesWithEmail || profilesWithEmail.length === 0) {
        console.log('No business owners found');
        setOwners([]);
        return;
      }

      // Get additional data for each owner
      const ownersWithData = await Promise.all(
        profilesWithEmail.map(async (profile: any) => {
          // Get subscription data with plan name - use maybeSingle to handle cases where no subscription exists
          const { data: subscription } = await supabase
            .from('pharmacy_subscriptions')
            .select(`
              subscription_credit, 
              status, 
              deposit_amount, 
              last_credit_deduction,
              subscription_plans (
                name
              )
            `)
            .eq('pharmacy_owner_id', profile.id)
            .maybeSingle();

          // Get branch count and first branch name as business name
          const { data: branches, count: branchCount } = await supabase
            .from('pharmacy_branches')
            .select('id, name', { count: 'exact' })
            .eq('pharmacy_owner_id', profile.id)
            .order('created_at')
            .limit(5);

          // Use the first branch name as business name, or join multiple
          const branchNames = (branches || []).map((b: any) => b.name);
          const pharmacyName = profile.pharmacy_name || (branchNames.length > 0 ? branchNames.join(', ') : 'N/A');

          // Get gemini_api_key status
          const { data: profileExtra } = await supabase
            .from('profiles')
            .select('gemini_api_key')
            .eq('id', profile.id)
            .single();

          return {
            id: profile.id,
            full_name: profile.full_name,
            email: profile.email,
            phone: profile.phone,
            telegram_chat_id: profile.telegram_chat_id,
            pharmacy_name: pharmacyName,
            pharmacy_address: profile.pharmacy_address || 'N/A',
            active: profile.active,
            manually_deactivated: profile.manually_deactivated,
            has_gemini_api_key: !!profileExtra?.gemini_api_key,
            subscription: subscription ? {
              subscription_credit: subscription.subscription_credit,
              status: subscription.status,
              deposit_amount: subscription.deposit_amount,
              last_credit_deduction: subscription.last_credit_deduction,
              plan_name: subscription.subscription_plans?.name || 'N/A'
            } : {
              subscription_credit: 0,
              status: 'expired',
              deposit_amount: 0,
              last_credit_deduction: new Date().toISOString(),
              plan_name: 'N/A'
            },
            branch_count: branchCount || 0
          };
        })
      );

      console.log('Fetched business owners:', ownersWithData);
      setOwners(ownersWithData);
    } catch (error: any) {
      console.error('Error fetching pharmacy owners:', error);
      toast({
        title: "Error",
        description: "Failed to fetch business owners",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const addCredit = async (ownerId: string, days: number, amount: number) => {
    try {
      // Get current subscription info
      const { data: currentSub, error: fetchError } = await supabase
        .from('pharmacy_subscriptions')
        .select('subscription_credit')
        .eq('pharmacy_owner_id', ownerId)
        .maybeSingle();

      if (fetchError) throw fetchError;

      const newCreditTotal = (currentSub?.subscription_credit || 0) + days;
      let newStatus: 'active' | 'expiring_soon' | 'expired';
      
      if (newCreditTotal <= 0) {
        newStatus = 'expired';
      } else if (newCreditTotal <= 7) {
        newStatus = 'expiring_soon';
      } else {
        newStatus = 'active';
      }

      // Update subscription
      const { error: updateError } = await supabase
        .from('pharmacy_subscriptions')
        .upsert({
          pharmacy_owner_id: ownerId,
          subscription_credit: newCreditTotal,
          status: newStatus,
          deposit_amount: amount
        }, {
          onConflict: 'pharmacy_owner_id'
        });

      if (updateError) throw updateError;

      // Get current user ID
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) throw new Error('No authenticated user found');

      // Log transaction
      const { error: transactionError } = await supabase
        .from('transactions')
        .insert({
          pharmacy_owner_id: ownerId,
          amount_collected: amount,
          credit_days_added: days,
          transaction_type: 'credit_payment',
          processed_by: user.id,
          notes: `Added ${days} days credit for $${amount}`
        });

      if (transactionError) throw transactionError;

      toast({
        title: "Success",
        description: `Added ${days} days credit successfully. Account ${newStatus === 'active' || newStatus === 'expiring_soon' ? 'activated' : 'remains deactivated'}.`
      });

      fetchPharmacyOwners();
      fetchTransactions();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const updateDeposit = async (ownerId: string, amount: number) => {
    try {
      const { error } = await supabase
        .from('pharmacy_subscriptions')
        .upsert({
          pharmacy_owner_id: ownerId,
          deposit_amount: amount
        }, {
          onConflict: 'pharmacy_owner_id'
        });

      if (error) throw error;

      toast({
        title: "Success",
        description: "Deposit amount updated successfully"
      });

      fetchPharmacyOwners();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const triggerDailyDeduction = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('daily-credit-deduction', {
        body: { manual: true }
      });

      if (error) throw error;

      toast({
        title: "Success",
        description: "Daily credit deduction triggered successfully"
      });

      fetchPharmacyOwners();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const triggerTelegramReport = async (type: 'daily' | 'weekly' | 'monthly', selectedOwnerIds?: string[]) => {
    try {
      setSendingReport(true);
      
      const reportTypeLabel = type.charAt(0).toUpperCase() + type.slice(1);
      const description = selectedOwnerIds && selectedOwnerIds.length > 0
        ? `Sending ${reportTypeLabel} reports to ${selectedOwnerIds.length} selected owner(s)...`
        : `Sending ${reportTypeLabel} reports to all owners with Telegram linked...`;
      
      toast({
        title: "Sending Reports",
        description
      });

      const functionName = `telegram-${type}-report`;
      const { data, error } = await supabase.functions.invoke(functionName, {
        body: selectedOwnerIds && selectedOwnerIds.length > 0 
          ? { ownerIds: selectedOwnerIds } 
          : {}
      });

      if (error) throw error;

      toast({
        title: "Success",
        description: `${reportTypeLabel} reports sent successfully: ${data.results?.length || 0} reports delivered`
      });
      
      setShowReportDialog(false);
      setSelectedOwnersForReport([]);
    } catch (error: any) {
      console.error('Telegram report error:', error);
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setSendingReport(false);
    }
  };

  const triggerQuickReport = async (type: 'daily' | 'weekly' | 'monthly') => {
    try {
      setSendingReport(true);
      const reportTypeLabel = type.charAt(0).toUpperCase() + type.slice(1);
      
      toast({
        title: "Sending Reports",
        description: `Sending ${reportTypeLabel} reports to all owners with Telegram linked...`
      });

      const functionName = `telegram-${type}-report`;
      const { data, error } = await supabase.functions.invoke(functionName, {
        body: {}
      });

      if (error) throw error;

      toast({
        title: "Success",
        description: `${reportTypeLabel} reports sent successfully: ${data.results?.length || 0} reports delivered`
      });
    } catch (error: any) {
      console.error('Telegram report error:', error);
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setSendingReport(false);
    }
  };

  const toggleOwnerSelection = (ownerId: string) => {
    setSelectedOwnersForReport(prev => 
      prev.includes(ownerId) 
        ? prev.filter(id => id !== ownerId)
        : [...prev, ownerId]
    );
  };

  const handleAccountStatusChange = async (ownerId: string, status: string) => {
    const newStatus = status === "active";
    
    try {
      // Update profile status
      const { error: profileError } = await supabase
        .from('profiles')
        .update({ 
          active: newStatus,
          manually_deactivated: !newStatus
        })
        .eq('id', ownerId);

      if (profileError) throw profileError;

      toast({
        title: "Success",
        description: `Account status updated to ${status}`
      });

      fetchPharmacyOwners();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || `Failed to update account status`,
        variant: "destructive"
      });
    }
  };

  const handleSubscriptionStatusChange = async (ownerId: string, status: string) => {
    try {
      // Update subscription status
      const { error: subscriptionError } = await supabase
        .from('pharmacy_subscriptions')
        .update({ status: status as 'active' | 'expiring_soon' | 'expired' | 'inactive' })
        .eq('pharmacy_owner_id', ownerId);

      if (subscriptionError) throw subscriptionError;

      // If setting to expired, also set credit to 0
      if (status === 'expired') {
        await supabase
          .from('pharmacy_subscriptions')
          .update({ subscription_credit: 0 })
          .eq('pharmacy_owner_id', ownerId);
      }

      toast({
        title: "Success",
        description: `Subscription status updated to ${status}`
      });

      fetchPharmacyOwners();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || `Failed to update subscription status`,
        variant: "destructive"
      });
    }
  };

  const openCreditDialog = async (owner: PharmacyOwner) => {
    setSelectedOwnerForCredit(owner);
    
    // Fetch credit plans for this owner
    const { data: creditPlans, error } = await supabase
      .from('credit_plans')
      .select('*')
      .eq('pharmacy_owner_id', owner.id)
      .order('days', { ascending: true });

    if (error) {
      console.error('Error fetching credit plans:', error);
      setOwnerCreditPlans([]);
    } else {
      setOwnerCreditPlans(creditPlans || []);
    }
    
    setCreditDialogOpen(true);
  };

  const addCreditToOwner = async (planId: string, days: number, amount: number) => {
    if (!selectedOwnerForCredit) return;

    try {
      // Get current user ID
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No authenticated user found');

      // Log the transaction
      const { error: transactionError } = await supabase
        .from('transactions')
        .insert({
          pharmacy_owner_id: selectedOwnerForCredit.id,
          amount_collected: amount,
          credit_days_added: days,
          transaction_type: 'credit_payment',
          processed_by: user.id,
          notes: `Added ${days} days credit for $${amount}`
        });

      if (transactionError) throw transactionError;

      // Add the credit days
      const { error: creditError } = await supabase
        .from('pharmacy_subscriptions')
        .upsert({
          pharmacy_owner_id: selectedOwnerForCredit.id,
          subscription_credit: (selectedOwnerForCredit.subscription?.subscription_credit || 0) + days,
          status: 'active'
        }, {
          onConflict: 'pharmacy_owner_id'
        });

      if (creditError) throw creditError;

      toast({
        title: "Success",
        description: `Added ${days} days credit to ${selectedOwnerForCredit.full_name}'s account`
      });

      setCreditDialogOpen(false);
      setSelectedOwnerForCredit(null);
      fetchPharmacyOwners();
      fetchTransactions();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to add credit",
        variant: "destructive"
      });
    }
  };

  const handleEditOwner = (owner: PharmacyOwner) => {
    setEditOwner(owner);
    setEditDialogOpen(true);
  };

  const getStatusBadge = (status: string | null) => {
    switch (status) {
      case 'active':
        return <Badge className="bg-green-500/15 text-green-500 border-green-500/30">Active</Badge>;
      case 'expiring_soon':
        return <Badge className="bg-yellow-500/15 text-yellow-500 border-yellow-500/30">Expiring Soon</Badge>;
      case 'expired':
        return <Badge className="bg-red-500/15 text-red-500 border-red-500/30">Expired</Badge>;
      case 'inactive':
        return <Badge className="bg-muted text-muted-foreground">Inactive</Badge>;
      default:
        return <Badge className="bg-muted text-muted-foreground">No Subscription</Badge>;
    }
  };

  const getAccountStatusBadge = (active: boolean, manuallyDeactivated?: boolean, subscriptionStatus?: string) => {
    if (!active) {
      if (subscriptionStatus === 'inactive') {
        return <Badge className="bg-muted text-muted-foreground">Inactive</Badge>;
      } else if (manuallyDeactivated) {
        return <Badge className="bg-red-500/15 text-red-500 border-red-500/30">Deactivated</Badge>;
      } else if (subscriptionStatus === 'expired') {
        return <Badge className="bg-orange-500/15 text-orange-500 border-orange-500/30">Expired</Badge>;
      } else {
        return <Badge className="bg-red-500/15 text-red-500 border-red-500/30">Deactivated</Badge>;
      }
    }
    return <Badge className="bg-green-500/15 text-green-500 border-green-500/30">Active</Badge>;
  };

  if (loading) {
    return <div className="flex justify-center items-center h-64">Loading...</div>;
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Developer Dashboard</h1>
          <p className="text-muted-foreground">Manage business owners and subscriptions</p>
        </div>
        <div className="flex gap-2">
          <Dialog open={showReportDialog} onOpenChange={setShowReportDialog}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Send className="mr-2 h-4 w-4" />
                Send Telegram Reports
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Send Telegram Reports</DialogTitle>
                <DialogDescription>
                  Select report type and owners to send reports to, or send to all owners with Telegram linked.
                  Note: Only owners with "Linked" status will receive reports.
                </DialogDescription>
              </DialogHeader>
              
              <div className="space-y-4">
                <div>
                  <Label htmlFor="report-type">Report Type</Label>
                  <Select value={reportType} onValueChange={(value: 'daily' | 'weekly' | 'monthly') => setReportType(value)}>
                    <SelectTrigger id="report-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Daily Report</SelectItem>
                      <SelectItem value="weekly">Weekly Report</SelectItem>
                      <SelectItem value="monthly">Monthly Report</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex justify-between items-center">
                  <p className="text-sm text-muted-foreground">
                    {selectedOwnersForReport.length > 0 
                      ? `${selectedOwnersForReport.length} owner(s) selected`
                      : 'No owners selected (will send to all)'}
                  </p>
                  <div className="flex gap-2">
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => setSelectedOwnersForReport(owners.map(o => o.id))}
                    >
                      Select All
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => setSelectedOwnersForReport([])}
                    >
                      Clear
                    </Button>
                  </div>
                </div>

                <div className="border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">Select</TableHead>
                        <TableHead>Owner</TableHead>
                        <TableHead>Business</TableHead>
                        <TableHead>Telegram Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {owners.map((owner) => (
                        <TableRow key={owner.id}>
                          <TableCell>
                            <input
                              type="checkbox"
                              checked={selectedOwnersForReport.includes(owner.id)}
                              onChange={() => toggleOwnerSelection(owner.id)}
                              className="h-4 w-4 rounded border-gray-300"
                            />
                          </TableCell>
                          <TableCell>
                            <div>
                              <p className="font-medium">{owner.full_name}</p>
                              <p className="text-sm text-muted-foreground">{owner.email}</p>
                            </div>
                          </TableCell>
                          <TableCell>{owner.pharmacy_name || 'N/A'}</TableCell>
                          <TableCell>
                            {owner.telegram_chat_id ? (
                              <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/30">
                                <UserCheck className="mr-1 h-3 w-3" />
                                Linked
                              </Badge>
                            ) : owner.phone ? (
                              <Badge variant="outline" className="bg-yellow-500/10 text-yellow-500 border-yellow-500/30">
                                <AlertTriangle className="mr-1 h-3 w-3" />
                                Phone Added
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="bg-muted text-muted-foreground">
                                <UserX className="mr-1 h-3 w-3" />
                                Not Setup
                              </Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <div className="flex justify-end gap-2">
                  <Button 
                    variant="outline" 
                    onClick={() => setShowReportDialog(false)}
                    disabled={sendingReport}
                  >
                    Cancel
                  </Button>
                  <Button 
                    onClick={() => triggerTelegramReport(reportType, selectedOwnersForReport.length > 0 ? selectedOwnersForReport : undefined)}
                    disabled={sendingReport}
                  >
                    <Send className="mr-2 h-4 w-4" />
                    {sendingReport ? "Sending..." : `Send ${reportType.charAt(0).toUpperCase() + reportType.slice(1)} Reports`}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
          <CreateOwnerDialog onOwnerCreated={fetchPharmacyOwners} />
          <Button variant="outline" onClick={fetchPharmacyOwners}>Refresh Data</Button>
        </div>
      </div>

      {/* Universal Credit Setup Section */}
      <CreditSetupSection />

      {/* Item Catalog Management */}
      <Card>
        <CardHeader>
          <CardTitle>Item Catalog & Group Management</CardTitle>
          <CardDescription>Manage the master item catalog, item groups, and owner assignments</CardDescription>
        </CardHeader>
        <CardContent>
          <CatalogManagement />
        </CardContent>
      </Card>

      {/* Subscription Plan Statistics */}
      <SubscriptionPlanStats />

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Owners</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{owners.length}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Subscriptions</CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {owners.filter(o => o.subscription?.status === 'active').length}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Expiring Soon</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {owners.filter(o => o.subscription?.status === 'expiring_soon').length}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Expired Subscriptions</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {owners.filter(o => o.subscription?.status === 'expired').length}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Deactivated Accounts</CardTitle>
            <UserX className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {owners.filter(o => !o.active || o.subscription?.status === 'inactive').length}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Branches</CardTitle>
            <Building className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {owners.reduce((sum, o) => sum + o.branch_count, 0)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Business Owners Table */}
      <Card>
        <CardHeader>
          <CardTitle>Business Owners</CardTitle>
          <CardDescription>Manage owner accounts, subscriptions, and activation status</CardDescription>
        </CardHeader>
        <CardContent>
          {/* Search Filters */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <Label htmlFor="search-owner">Search by Owner Name</Label>
              <Input
                id="search-owner"
                placeholder="Search owner name..."
                value={searchOwnerName}
                onChange={(e) => setSearchOwnerName(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="search-pharmacy">Search by Business Name</Label>
              <Input
                id="search-pharmacy"
                placeholder="Search business name..."
                value={searchPharmacyName}
                onChange={(e) => setSearchPharmacyName(e.target.value)}
              />
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Owner Name</TableHead>
                <TableHead>Business Name</TableHead>
                <TableHead>AI Key</TableHead>
                <TableHead>Account Status</TableHead>
                <TableHead>Subscription</TableHead>
                <TableHead>Subscription Plan</TableHead>
                <TableHead>Credit (Days)</TableHead>
                <TableHead>Branches</TableHead>
                <TableHead>Deposit</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {owners
                .filter((owner) => {
                  const matchesOwnerName = !searchOwnerName || 
                    owner.full_name.toLowerCase().includes(searchOwnerName.toLowerCase()) ||
                    owner.email.toLowerCase().includes(searchOwnerName.toLowerCase());
                  
                  const matchesPharmacyName = !searchPharmacyName || 
                    owner.pharmacy_name?.toLowerCase().includes(searchPharmacyName.toLowerCase());
                  
                  return matchesOwnerName && matchesPharmacyName;
                })
                .map((owner) => (
                <TableRow key={owner.id}>
                  <TableCell>
                    <div>
                      <div className="font-medium">{owner.full_name}</div>
                      <div className="text-sm text-muted-foreground">{owner.email}</div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{owner.pharmacy_name || 'N/A'}</div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-center" title={owner.has_gemini_api_key ? 'API key configured' : 'No API key'}>
                      <Key className={`h-4 w-4 ${owner.has_gemini_api_key ? 'text-green-500' : 'text-red-400'}`} />
                    </div>
                  </TableCell>
                  <TableCell>
                    <Select 
                      value={owner.active ? "active" : "inactive"} 
                      onValueChange={(value) => handleAccountStatusChange(owner.id, value)}
                    >
                      <SelectTrigger className="w-28">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="inactive">Inactive</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Select 
                      value={owner.subscription?.status || "expired"} 
                      onValueChange={(value) => handleSubscriptionStatusChange(owner.id, value)}
                    >
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="inactive">Inactive</SelectItem>
                        <SelectItem value="expired">Expired</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="font-medium">
                      {owner.subscription?.plan_name || 'N/A'}
                    </Badge>
                  </TableCell>
                  <TableCell>{owner.subscription?.subscription_credit || 0}</TableCell>
                  <TableCell>{owner.branch_count}</TableCell>
                  <TableCell>${owner.subscription?.deposit_amount || 0}</TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => handleEditOwner(owner)}
                      >
                        <Edit className="h-4 w-4 mr-1" />
                        Edit
                      </Button>
                      
                      <Button 
                        variant="default"
                        className="bg-green-600 hover:bg-green-700"
                        size="sm"
                        onClick={() => openCreditDialog(owner)}
                      >
                        <DollarSign className="h-4 w-4 mr-1" />
                        Add Credit
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* System Actions */}
      <Card>
        <CardHeader>
          <CardTitle>System Actions</CardTitle>
          <CardDescription>Developer tools and system maintenance</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-medium mb-2">Credit Management</h3>
              <div className="flex gap-2">
                <Button onClick={triggerDailyDeduction} variant="outline">
                  <AlertTriangle className="h-4 w-4 mr-2" />
                  Trigger Daily Credit Deduction
                </Button>
                <Button onClick={() => setShowTransactions(!showTransactions)} variant="outline">
                  <TrendingUp className="h-4 w-4 mr-2" />
                  {showTransactions ? 'Hide' : 'Show'} Transaction Logs
                </Button>
              </div>
            </div>
            
            <div>
              <h3 className="text-sm font-medium mb-2">Telegram Report Testing</h3>
              <p className="text-sm text-muted-foreground mb-2">
                Send test reports to all owners with linked Telegram accounts
              </p>
              <div className="flex gap-2 flex-wrap">
                <Button 
                  onClick={() => triggerQuickReport('daily')} 
                  variant="outline"
                  disabled={sendingReport}
                  className="bg-blue-500/10 hover:bg-blue-500/20 text-blue-500 border-blue-500/30"
                >
                  <Send className="h-4 w-4 mr-2" />
                  Test Daily Report
                </Button>
                <Button 
                  onClick={() => triggerQuickReport('weekly')} 
                  variant="outline"
                  disabled={sendingReport}
                  className="bg-green-500/10 hover:bg-green-500/20 text-green-500 border-green-500/30"
                >
                  <Send className="h-4 w-4 mr-2" />
                  Test Weekly Report
                </Button>
                <Button 
                  onClick={() => triggerQuickReport('monthly')} 
                  variant="outline"
                  disabled={sendingReport}
                  className="bg-purple-500/10 hover:bg-purple-500/20 text-purple-500 border-purple-500/30"
                >
                  <Send className="h-4 w-4 mr-2" />
                  Test Monthly Report
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Transaction Logs */}
      {showTransactions && (
        <Card>
          <CardHeader>
            <CardTitle>Transaction Logs</CardTitle>
            <CardDescription>Payment history and credit additions</CardDescription>
          </CardHeader>
          <CardContent>
            {/* Filters */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div>
              <Label htmlFor="filter-pharmacy">Filter by Business Name</Label>
              <Input
                id="filter-pharmacy"
                placeholder="Search business..."
                  value={filterPharmacyName}
                  onChange={(e) => setFilterPharmacyName(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="filter-month">Filter by Month</Label>
                <Input
                  id="filter-month"
                  type="month"
                  value={filterMonth}
                  onChange={(e) => setFilterMonth(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="filter-credit">Filter by Credit Added</Label>
                <Input
                  id="filter-credit"
                  type="number"
                  placeholder="e.g., 30"
                  value={filterCreditAdded}
                  onChange={(e) => setFilterCreditAdded(e.target.value)}
                />
              </div>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date & Time</TableHead>
                  <TableHead>Business Name</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Amount Collected</TableHead>
                  <TableHead>Credit Added</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions
                  .filter((transaction) => {
                    const matchesPharmacy = !filterPharmacyName || 
                      transaction.pharmacy_name?.toLowerCase().includes(filterPharmacyName.toLowerCase());
                    
                    const matchesMonth = !filterMonth || 
                      new Date(transaction.created_at).toISOString().slice(0, 7) === filterMonth;
                    
                    const matchesCredit = !filterCreditAdded || 
                      transaction.credit_days_added === parseInt(filterCreditAdded);

                    return matchesPharmacy && matchesMonth && matchesCredit;
                  })
                  .map((transaction) => (
                    <TableRow key={transaction.id}>
                      <TableCell>
                        {new Date(transaction.created_at).toLocaleString('en-US', {
                          year: 'numeric',
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                          hour12: false
                        })}
                      </TableCell>
                      <TableCell>{transaction.pharmacy_name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {transaction.pharmacy_address}
                      </TableCell>
                      <TableCell>{transaction.owner_name}</TableCell>
                      <TableCell>${transaction.amount_collected}</TableCell>
                      <TableCell>{transaction.credit_days_added} days</TableCell>
                      <TableCell>{transaction.notes}</TableCell>
                    </TableRow>
                  ))}
                {transactions.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground">
                      No transactions found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Add Credit Dialog */}
      <Dialog open={creditDialogOpen} onOpenChange={setCreditDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Credit to {selectedOwnerForCredit?.full_name}</DialogTitle>
            <DialogDescription>
              Select a credit plan to add to this owner's account
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            {ownerCreditPlans.length > 0 ? (
              <div>
                <Label>Available Credit Plans</Label>
                <div className="space-y-2 mt-2">
                  {ownerCreditPlans.map((plan) => (
                    <div key={plan.id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div>
                        <span className="font-medium">{plan.days} days</span>
                        <span className="text-muted-foreground"> → ${plan.price}</span>
                      </div>
                      <Button 
                        size="sm"
                        onClick={() => addCreditToOwner(plan.id, plan.days, plan.price)}
                      >
                        Select
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center py-4">
                <p className="text-muted-foreground">No credit plans found for this owner.</p>
                <p className="text-sm text-muted-foreground mt-1">Credit plans should be set up when creating the owner account.</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Owner Dialog */}
      {editOwner && (
        <EditOwnerDialog
          owner={editOwner}
          open={editDialogOpen}
          onOpenChange={setEditDialogOpen}
          onOwnerUpdated={fetchPharmacyOwners}
        />
      )}
    </div>
  );
}
import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, Users, Phone, Mail, Edit, Trash2, Search, KeyRound, MapPin, BarChart3, UserCircle2, Shield } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useBranchContext } from '@/hooks/useBranchContext';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import EditStaffDialog from './EditStaffDialog';
import CreateStaffDialog from './CreateStaffDialog';
import { usePlanLimits } from '@/hooks/usePlanLimits';
import SalaryOverview from './SalaryOverview';
import SalaryHistory from './SalaryHistory';
import AssignStoreLocation from './attendance/AssignStoreLocation';
import RecordAttendance from './attendance/RecordAttendance';
import AttendanceDashboard from './attendance/AttendanceDashboard';
import PerformanceDashboard from './performance/PerformanceDashboard';
import FaceRegistration from './face/FaceRegistration';
import StaffPermissionsEditor from './StaffPermissionsEditor';

interface StaffMember {
  id: string;
  full_name: string;
  email?: string;
  role: 'owner' | 'staff' | 'developer';
  phone?: string;
  branch_id?: string;
  created_at: string;
  pharmacy_branches?: {
    name: string;
  } | null;
}

export default function StaffManagement() {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [filteredStaff, setFilteredStaff] = useState<StaffMember[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showResetPasswordDialog, setShowResetPasswordDialog] = useState(false);
  const [selectedStaff, setSelectedStaff] = useState<StaffMember | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [resettingPassword, setResettingPassword] = useState(false);
  const [faceRegStaff, setFaceRegStaff] = useState<StaffMember | null>(null);
  const [permissionsStaff, setPermissionsStaff] = useState<StaffMember | null>(null);
  const { toast } = useToast();
  const { profile } = useAuth();
  const { selectedBranch } = useBranchContext();
  const { planLimits } = usePlanLimits();

  useEffect(() => {
    fetchStaff();
  }, [selectedBranch]);

  useEffect(() => {
    const filtered = staff.filter(member =>
      member.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      member.phone?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      member.email?.toLowerCase().includes(searchTerm.toLowerCase())
    );
    setFilteredStaff(filtered);
  }, [staff, searchTerm]);

  const fetchStaff = async () => {
    try {
      setLoading(true);
      
      const { data: ownerBranches, error: branchesError } = await supabase
        .from('pharmacy_branches')
        .select('id')
        .eq('pharmacy_owner_id', profile?.id);

      if (branchesError) throw branchesError;

      const branchIds = ownerBranches?.map((b: any) => b.id) || [];

      let query = supabase
        .from('profiles')
        .select('id, full_name, role, phone, branch_id, created_at, pharmacy_branches!profiles_branch_id_fkey(name)')
        .eq('role', 'staff')
        .in('branch_id', branchIds)
        .order('created_at');

      if (selectedBranch) {
        query = query.eq('branch_id', selectedBranch);
      }

      const { data: profilesData, error } = await query;
      if (error) throw error;
      
      // Fetch emails for staff members via edge function
      const staffWithEmail: StaffMember[] = (profilesData || []).map((s: any) => ({ ...s, email: undefined }));
      
      if (staffWithEmail.length > 0) {
        try {
          const staffIds = staffWithEmail.map(s => s.id);

          const applyEmails = (payload: any) => {
            // Supports both { emails: { [id]: email } } and { data: [{ id, email }] }
            const emailMap: Record<string, string> = payload?.emails
              ? payload.emails
              : Array.isArray(payload?.data)
                ? payload.data.reduce((acc: Record<string, string>, row: any) => {
                    if (row?.id && row?.email) acc[row.id] = row.email;
                    return acc;
                  }, {})
                : {};

            for (const s of staffWithEmail) {
              s.email = emailMap[s.id] || undefined;
            }
          };

          const { data: emailData, error: emailError } = await supabase.functions.invoke('get-staff-emails', {
            body: { staffIds }
          });

          if (!emailError) {
            applyEmails(emailData);
          } else {
            // Fallback for legacy/deployed CORS configs that block x-client-info
            const sessionRes = await supabase.auth.getSession();
            const token = sessionRes.data.session?.access_token;
            if (!token) throw emailError;

            const fnUrl = `https://tcqlsxmgazrftpbumauk.supabase.co/functions/v1/get-staff-emails`;
            const response = await fetch(fnUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
              },
              body: JSON.stringify({ staffIds }),
            });

            if (!response.ok) throw new Error(`Fallback failed: ${response.status}`);
            const fallbackData = await response.json();
            applyEmails(fallbackData);
          }
        } catch (err) {
          console.error('Failed to fetch staff emails:', err);
        }
      }
      
      setStaff(staffWithEmail);
    } catch (error) {
      console.error('Staff fetch error:', error);
      toast({
        title: "Error",
        description: "Failed to fetch staff members",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const handleEditStaff = (staff: StaffMember) => {
    setSelectedStaff(staff);
    setShowEditDialog(true);
  };

  const handleStaffUpdated = () => {
    fetchStaff();
    setShowEditDialog(false);
    setSelectedStaff(null);
  };

  const handleDeleteClick = (staff: StaffMember) => {
    if (!profile || profile.role !== 'owner') {
      toast({ title: "Error", description: "Only owners can delete staff members", variant: "destructive" });
      return;
    }
    setSelectedStaff(staff);
    setShowDeleteDialog(true);
  };

  const handleDeleteConfirm = async () => {
    if (!selectedStaff) return;

    try {
      const { data, error } = await supabase.functions.invoke('delete-staff-account', {
        body: { staffId: selectedStaff.id, staffUserId: selectedStaff.id },
      });

      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);

      toast({ title: "Success", description: `${selectedStaff.full_name} has been removed successfully` });
      setShowDeleteDialog(false);
      setSelectedStaff(null);
      fetchStaff();
    } catch (error: any) {
      console.error('Delete staff error:', error);
      toast({ title: "Error", description: error?.message || "Failed to remove staff member", variant: "destructive" });
    }
  };

  const handleResetPasswordClick = (member: StaffMember) => {
    setSelectedStaff(member);
    setNewPassword('');
    setShowResetPasswordDialog(true);
  };

  const handleResetPassword = async () => {
    if (!selectedStaff || !newPassword) return;
    if (newPassword.length < 6) {
      toast({ title: "Error", description: "Password must be at least 6 characters", variant: "destructive" });
      return;
    }

    setResettingPassword(true);
    try {
      const { data, error } = await supabase.functions.invoke('reset-staff-password', {
        body: { staffId: selectedStaff.id, newPassword },
      });

      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);

      toast({ title: "Success", description: `Password reset for ${selectedStaff.full_name}` });
      setShowResetPasswordDialog(false);
      setSelectedStaff(null);
      setNewPassword('');
    } catch (error: any) {
      console.error('Reset password error:', error);
      toast({ title: "Error", description: error?.message || "Failed to reset password", variant: "destructive" });
    } finally {
      setResettingPassword(false);
    }
  };

  if (loading) {
    return <div>Loading staff members...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Staff Management</h2>
          {planLimits && (
            <p className="text-sm text-muted-foreground mt-1">
              {planLimits.staffLimit == null 
                ? `Unlimited staff on ${planLimits.planName} plan`
                : `${planLimits.currentStaff} / ${planLimits.staffLimit} staff used on ${planLimits.planName} plan`
              }
            </p>
          )}
        </div>
        
        {profile?.role === 'owner' && (
          <Button 
            onClick={() => setShowCreateDialog(true)}
            disabled={planLimits && !planLimits.canAddStaff}
          >
            <Plus className="h-4 w-4 mr-2" />
            Create Staff Account
          </Button>
        )}
      </div>
      
      {planLimits && !planLimits.canAddStaff && profile?.role === 'owner' && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="pt-6">
            <p className="text-sm text-destructive">
              You have reached your plan limit. Upgrade to add more staff members.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center space-x-4">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search staff by name, phone, or email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-8"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredStaff.map((member) => (
          <Card key={member.id}>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="flex items-center space-x-2">
                    <Users className="h-5 w-5" />
                    <span>{member.full_name}</span>
                  </CardTitle>
                  <div className="flex items-center space-x-2 mt-1">
                    <Badge variant={member.role === 'owner' ? 'default' : 'secondary'}>
                      {member.role === 'owner' ? 'Owner' : 'Staff'}
                    </Badge>
                  </div>
                </div>
                {profile?.role === 'owner' && (
                  <div className="flex space-x-1">
                    <Button variant="ghost" size="sm" onClick={() => handleResetPasswordClick(member)} title="Reset Password">
                      <KeyRound className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleEditStaff(member)}>
                      <Edit className="h-4 w-4" />
                    </Button>
                    {member.role !== 'owner' && (
                      <Button variant="ghost" size="sm" onClick={() => handleDeleteClick(member)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
                <div className="space-y-3">
                  {member.email && (
                    <div className="flex items-center space-x-2 text-sm">
                      <Mail className="h-4 w-4 text-muted-foreground" />
                      <span>{member.email}</span>
                    </div>
                  )}
                  {member.phone && (
                    <div className="flex items-center space-x-2 text-sm">
                      <Phone className="h-4 w-4 text-muted-foreground" />
                      <span>{member.phone}</span>
                    </div>
                  )}
                  
                  {member.pharmacy_branches?.name && (
                    <div className="flex items-center space-x-2 text-sm">
                      <span className="text-muted-foreground font-medium">Branch:</span>
                      <span>{member.pharmacy_branches.name}</span>
                    </div>
                  )}

                  <div className="text-xs text-muted-foreground">
                    Joined: {new Date(member.created_at).toLocaleDateString()}
                  </div>
                </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filteredStaff.length === 0 && (
        <div className="text-center py-8">
          <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">No staff members found.</p>
        </div>
      )}

      {/* Salary, Attendance & Performance Section */}
      <Tabs defaultValue={profile?.role === 'staff' ? 'record-attendance' : 'salary-overview'} className="space-y-4">
        <TabsList className="flex-wrap h-auto gap-1">
          {profile?.role === 'owner' && (
            <>
              <TabsTrigger value="salary-overview">Salary Overview</TabsTrigger>
              <TabsTrigger value="salary-history">Salary History</TabsTrigger>
              <TabsTrigger value="store-location">
                <MapPin className="h-4 w-4 mr-1" />
                Store Location
              </TabsTrigger>
            </>
          )}
          <TabsTrigger value="record-attendance">Record Attendance</TabsTrigger>
          <TabsTrigger value="attendance-dashboard">Attendance History</TabsTrigger>
          {profile?.role === 'owner' && (
            <>
              <TabsTrigger value="face-registration">
                <UserCircle2 className="h-4 w-4 mr-1" />
                Face Registration
              </TabsTrigger>
              <TabsTrigger value="performance">
                <BarChart3 className="h-4 w-4 mr-1" />
                Performance
              </TabsTrigger>
              <TabsTrigger value="access-control">
                <Shield className="h-4 w-4 mr-1" />
                Access Control
              </TabsTrigger>
            </>
          )}
        </TabsList>
        {profile?.role === 'owner' && (
          <>
            <TabsContent value="salary-overview">
              <SalaryOverview />
            </TabsContent>
            <TabsContent value="salary-history">
              <SalaryHistory />
            </TabsContent>
            <TabsContent value="store-location">
              <AssignStoreLocation />
            </TabsContent>
          </>
        )}
        <TabsContent value="record-attendance">
          <RecordAttendance />
        </TabsContent>
        <TabsContent value="attendance-dashboard">
          <AttendanceDashboard />
        </TabsContent>
        {profile?.role === 'owner' && (
          <>
            <TabsContent value="face-registration">
              <Card>
                <CardHeader>
                  <CardTitle>Select Staff for Face Registration</CardTitle>
                  <CardDescription>Choose a staff member to register or update their face data</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {staff.map((member) => (
                      <Button
                        key={member.id}
                        variant={faceRegStaff?.id === member.id ? 'default' : 'outline'}
                        className="justify-start h-auto py-3"
                        onClick={() => setFaceRegStaff(member)}
                      >
                        <UserCircle2 className="h-4 w-4 mr-2 shrink-0" />
                        <span className="truncate">{member.full_name}</span>
                      </Button>
                    ))}
                  </div>
                  {faceRegStaff && (
                    <FaceRegistration
                      staffId={faceRegStaff.id}
                      staffName={faceRegStaff.full_name}
                    />
                  )}
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="performance">
              <PerformanceDashboard />
            </TabsContent>
            <TabsContent value="access-control">
              <Card>
                <CardHeader>
                  <CardTitle>Select Staff for Access Control</CardTitle>
                  <CardDescription>Choose a staff member to manage their page-level permissions</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {staff.map((member) => (
                      <Button
                        key={member.id}
                        variant={permissionsStaff?.id === member.id ? 'default' : 'outline'}
                        className="justify-start h-auto py-3"
                        onClick={() => setPermissionsStaff(member)}
                      >
                        <Shield className="h-4 w-4 mr-2 shrink-0" />
                        <span className="truncate">{member.full_name}</span>
                      </Button>
                    ))}
                  </div>
                  {permissionsStaff && (
                    <StaffPermissionsEditor
                      staffId={permissionsStaff.id}
                      staffName={permissionsStaff.full_name}
                    />
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </>
        )}
      </Tabs>

      <EditStaffDialog
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        staff={selectedStaff}
        onStaffUpdated={handleStaffUpdated}
      />

      <CreateStaffDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onStaffCreated={fetchStaff}
      />

      <ConfirmationDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        title="Delete Staff Member"
        description={`Are you sure you want to remove ${selectedStaff?.full_name}? This action cannot be undone.`}
        onConfirm={handleDeleteConfirm}
        confirmText="Delete"
        cancelText="Cancel"
      />

      {/* Reset Password Dialog */}
      <Dialog open={showResetPasswordDialog} onOpenChange={setShowResetPasswordDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
            <DialogDescription>
              Set a new password for {selectedStaff?.full_name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="newPassword">New Password *</Label>
              <Input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Min 6 characters"
                minLength={6}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleResetPassword} disabled={resettingPassword || newPassword.length < 6} className="flex-1">
                {resettingPassword ? 'Resetting...' : 'Reset Password'}
              </Button>
              <Button variant="outline" onClick={() => setShowResetPasswordDialog(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

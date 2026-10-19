import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, User, Lock, Shield, Mail } from 'lucide-react';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';

// Security questions list
const SECURITY_QUESTIONS = [
  "What was the name of your first pet?",
  "What is your mother's maiden name?",
  "What was the name of your first school?",
  "What city were you born in?",
  "What is your favorite book?",
  "What was your childhood nickname?"
];

// Simple hash function for security answers
const hashAnswer = (answer: string) => {
  let hash = 0;
  for (let i = 0; i < answer.length; i++) {
    const char = answer.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString();
};

export default function AccountSettings() {
  const { user, profile, refreshProfile } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  
  // Profile form state
  const [profileData, setProfileData] = useState({
    full_name: '',
    phone: ''
  });

  // Password form state  
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });

  // Email update form state
  const [emailData, setEmailData] = useState({
    newEmail: '',
    confirmEmail: ''
  });

  // Security question form state
  const [securityData, setSecurityData] = useState({
    question: '',
    answer: ''
  });

  useEffect(() => {
    if (profile) {
      setProfileData({
        full_name: profile.full_name || '',
        phone: profile.phone || ''
      });
      setSecurityData({
        question: profile.security_question || '',
        answer: ''
      });
    }
  }, [profile]);

  const handleProfileUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Update profile information and select to verify it actually updated
      const { data: updatedData, error: profileError } = await supabase
        .from('profiles')
        .update({
          full_name: profileData.full_name,
          phone: profileData.phone
        })
        .eq('id', user?.id)
        .select()
        .single();

      if (profileError) throw profileError;

      if (!updatedData) {
        toast({
          title: "Error",
          description: "Failed to update profile - no changes were saved",
          variant: "destructive"
        });
        setLoading(false);
        return;
      }

      // Update local state with the confirmed data from DB
      setProfileData({
        full_name: updatedData.full_name || '',
        phone: updatedData.phone || ''
      });

      await refreshProfile();

      toast({
        title: "Success",
        description: "Profile updated successfully"
      });
    } catch (error) {
      // Revert form to actual profile data
      if (profile) {
        setProfileData({
          full_name: profile.full_name || '',
          phone: profile.phone || ''
        });
      }
      toast({
        title: "Error",
        description: "Failed to update profile",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const handleEmailUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (emailData.newEmail !== emailData.confirmEmail) {
      toast({
        title: "Error",
        description: "Email addresses do not match",
        variant: "destructive"
      });
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase.auth.updateUser({
        email: emailData.newEmail
      });

      if (error) throw error;

      toast({
        title: "Success",
        description: "Email update initiated. Please check your new email for confirmation."
      });

      setEmailData({
        newEmail: '',
        confirmEmail: ''
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update email",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (passwordData.newPassword !== passwordData.confirmPassword) {
      toast({
        title: "Error",
        description: "New passwords do not match",
        variant: "destructive"
      });
      return;
    }

    if (passwordData.newPassword.length < 6) {
      toast({
        title: "Error",
        description: "Password must be at least 6 characters long",
        variant: "destructive"
      });
      return;
    }

    if (!passwordData.currentPassword) {
      toast({
        title: "Error",
        description: "Please enter your current password",
        variant: "destructive"
      });
      return;
    }

    setLoading(true);

    try {
      // Verify current password by attempting to sign in
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user?.email || '',
        password: passwordData.currentPassword
      });

      if (signInError) {
        toast({
          title: "Error",
          description: "Current password is incorrect.",
          variant: "destructive"
        });
        setLoading(false);
        return;
      }

      const { error } = await supabase.auth.updateUser({
        password: passwordData.newPassword
      });

      if (error) throw error;

      toast({
        title: "Success",
        description: "Password updated successfully"
      });

      setPasswordData({
        currentPassword: '',
        newPassword: '',
        confirmPassword: ''
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update password",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSecurityQuestionUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!securityData.question || !securityData.answer) {
      toast({
        title: "Error",
        description: "Please select a question and provide an answer",
        variant: "destructive"
      });
      return;
    }

    setLoading(true);

    try {
      const hashedAnswer = hashAnswer(securityData.answer.toLowerCase().trim());
      
      const { error } = await supabase
        .from('profiles')
        .update({
          security_question: securityData.question,
          security_answer_hash: hashedAnswer
        })
        .eq('id', user?.id);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Security question updated successfully"
      });

      setSecurityData({
        ...securityData,
        answer: ''
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update security question",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  if (!user || !profile) {
    return <div>Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Account Settings</h2>
        <p className="text-muted-foreground">Manage your account information and security</p>
      </div>

      <Tabs defaultValue="profile" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="password">Password</TabsTrigger>
          <TabsTrigger value="email">Email</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <User className="h-5 w-5" />
                <span>Profile Information</span>
              </CardTitle>
              <CardDescription>
                Update your personal information
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleProfileUpdate} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="full_name">Full Name</Label>
                  <Input
                    id="full_name"
                    value={profileData.full_name}
                    onChange={(e) => setProfileData({...profileData, full_name: e.target.value})}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    value={user.email || ''}
                    disabled
                    className="bg-muted"
                  />
                  <p className="text-xs text-muted-foreground">
                    Use the Email tab to change your email address
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone (Optional)</Label>
                  <Input
                    id="phone"
                    value={profileData.phone}
                    onChange={(e) => setProfileData({...profileData, phone: e.target.value})}
                    placeholder="Enter phone number"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Role</Label>
                  <Input
                    value={profile.role === 'owner' ? 'Owner' : 'Staff Member'}
                    disabled
                    className="bg-muted"
                  />
                </div>
                <Button type="submit" disabled={loading}>
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Update Profile
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="password">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Lock className="h-5 w-5" />
                <span>Change Password</span>
              </CardTitle>
              <CardDescription>
                Update your account password
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handlePasswordUpdate} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="current_password">Current Password</Label>
                  <Input
                    id="current_password"
                    type="password"
                    value={passwordData.currentPassword}
                    onChange={(e) => setPasswordData({...passwordData, currentPassword: e.target.value})}
                    placeholder="Enter current password"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new_password">New Password</Label>
                  <Input
                    id="new_password"
                    type="password"
                    value={passwordData.newPassword}
                    onChange={(e) => setPasswordData({...passwordData, newPassword: e.target.value})}
                    required
                    placeholder="Enter new password"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm_password">Confirm New Password</Label>
                  <Input
                    id="confirm_password"
                    type="password"
                    value={passwordData.confirmPassword}
                    onChange={(e) => setPasswordData({...passwordData, confirmPassword: e.target.value})}
                    required
                    placeholder="Confirm new password"
                  />
                </div>
                <Button type="submit" disabled={loading}>
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Change Password
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="email">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Mail className="h-5 w-5" />
                <span>Change Email</span>
              </CardTitle>
              <CardDescription>
                Update your email address
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleEmailUpdate} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="current_email">Current Email</Label>
                  <Input
                    id="current_email"
                    value={user.email || ''}
                    disabled
                    className="bg-muted"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new_email">New Email</Label>
                  <Input
                    id="new_email"
                    type="email"
                    value={emailData.newEmail}
                    onChange={(e) => setEmailData({...emailData, newEmail: e.target.value})}
                    required
                    placeholder="Enter new email address"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm_email">Confirm New Email</Label>
                  <Input
                    id="confirm_email"
                    type="email"
                    value={emailData.confirmEmail}
                    onChange={(e) => setEmailData({...emailData, confirmEmail: e.target.value})}
                    required
                    placeholder="Confirm new email address"
                  />
                </div>
                <Button type="submit" disabled={loading}>
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Update Email
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Shield className="h-5 w-5" />
                <span>Security Question</span>
              </CardTitle>
              <CardDescription>
                Set up a security question for password recovery
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSecurityQuestionUpdate} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="security_question">Security Question</Label>
                  <Select value={securityData.question} onValueChange={(value) => setSecurityData({...securityData, question: value})}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a security question" />
                    </SelectTrigger>
                    <SelectContent>
                      {SECURITY_QUESTIONS.map((question) => (
                        <SelectItem key={question} value={question}>
                          {question}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="security_answer">Answer</Label>
                  <Input
                    id="security_answer"
                    type="text"
                    value={securityData.answer}
                    onChange={(e) => setSecurityData({...securityData, answer: e.target.value})}
                    required
                    placeholder="Enter your answer"
                  />
                  <p className="text-xs text-muted-foreground">
                    This answer will be used to verify your identity when resetting your password
                  </p>
                </div>
                <Button type="submit" disabled={loading}>
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {profile.security_question ? 'Update' : 'Set'} Security Question
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
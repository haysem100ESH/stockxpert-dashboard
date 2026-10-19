import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';

interface CreateStaffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStaffCreated: () => void;
}

interface Branch {
  id: string;
  name: string;
  is_main_branch: boolean;
}

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

export default function CreateStaffDialog({ open, onOpenChange, onStaffCreated }: CreateStaffDialogProps) {
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    fullName: '',
    phone: '',
    role: 'staff' as 'owner' | 'staff',
    branchId: '',
    securityQuestion: '',
    securityAnswer: ''
  });
  const [branches, setBranches] = useState<Branch[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();

  useEffect(() => {
    if (open) {
      fetchBranches();
    }
  }, [open]);

  const fetchBranches = async () => {
    try {
      const { data, error } = await supabase
        .from('pharmacy_branches')
        .select('id, name, is_main_branch')
        .eq('pharmacy_owner_id', user?.id)
        .order('is_main_branch', { ascending: false })
        .order('created_at', { ascending: true });

      if (error) throw error;
      setBranches(data || []);
    } catch (error) {
      console.error('Error fetching branches:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.email || !formData.password || !formData.fullName) {
      toast({
        title: "Error",
        description: "Please fill in all required fields",
        variant: "destructive"
      });
      return;
    }

    if (formData.role === 'staff' && !formData.branchId) {
      toast({
        title: "Error",
        description: "Please select a branch for the staff member",
        variant: "destructive"
      });
      return;
    }

    if (formData.password.length < 6) {
      toast({
        title: "Error",
        description: "Password must be at least 6 characters long",
        variant: "destructive"
      });
      return;
    }

    if (!formData.securityQuestion || !formData.securityAnswer) {
      toast({
        title: "Error",
        description: "Please set up a security question and answer",
        variant: "destructive"
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const { data, error } = await supabase.functions.invoke('create-staff-account', {
        body: {
          email: formData.email,
          password: formData.password,
          fullName: formData.fullName,
          phone: formData.phone,
          role: formData.role,
          branchId: formData.role === 'staff' ? formData.branchId : null,
          securityQuestion: formData.securityQuestion,
          securityAnswer: formData.securityAnswer
        }
      });

      if (error) {
        // supabase.functions.invoke swallows the response body on non-2xx.
        // Extract the real server message from error.context (a Response).
        let serverMsg = error.message;
        try {
          const ctx: any = (error as any).context;
          if (ctx && typeof ctx.json === 'function') {
            const body = await ctx.json();
            if (body?.error) serverMsg = body.error;
          }
        } catch { /* ignore */ }
        throw new Error(serverMsg);
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      toast({
        title: "Success",
        description: data.message || "Staff account created successfully"
      });

      onStaffCreated();
      onOpenChange(false);
      
      // Reset form
      setFormData({
        email: '',
        password: '',
        fullName: '',
        phone: '',
        role: 'staff',
        branchId: '',
        securityQuestion: '',
        securityAnswer: ''
      });
    } catch (error: any) {
      console.error('Error creating staff account:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to create staff account",
        variant: "destructive"
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Staff Account</DialogTitle>
          <DialogDescription>
            Create a new staff member account with login credentials
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email *</Label>
            <Input
              id="email"
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              required
              placeholder="Enter email address"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password *</Label>
            <Input
              id="password"
              type="password"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              required
              minLength={6}
              placeholder="Enter password (min 6 characters)"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="fullName">Full Name *</Label>
            <Input
              id="fullName"
              type="text"
              value={formData.fullName}
              onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
              required
              placeholder="Enter full name"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone">Phone (Optional)</Label>
            <Input
              id="phone"
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              placeholder="Enter phone number"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="role">Role *</Label>
            <Select value={formData.role} onValueChange={(value: 'owner' | 'staff') => setFormData({ ...formData, role: value })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="staff">Staff Member</SelectItem>
                <SelectItem value="owner">Owner</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {formData.role === 'staff' && (
            <div className="space-y-2">
              <Label htmlFor="branchId">Branch Assignment *</Label>
              <Select value={formData.branchId} onValueChange={(value) => setFormData({ ...formData, branchId: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a branch" />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((branch) => (
                    <SelectItem key={branch.id} value={branch.id}>
                      {branch.name} {branch.is_main_branch && '(Main)'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="securityQuestion">Security Question *</Label>
            <Select value={formData.securityQuestion} onValueChange={(value) => setFormData({ ...formData, securityQuestion: value })}>
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
            <Label htmlFor="securityAnswer">Security Answer *</Label>
            <Input
              id="securityAnswer"
              type="text"
              value={formData.securityAnswer}
              onChange={(e) => setFormData({ ...formData, securityAnswer: e.target.value })}
              required
              placeholder="Enter security answer"
            />
          </div>

          <div className="flex space-x-2 pt-4">
            <Button type="submit" disabled={isSubmitting} className="flex-1">
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Account
            </Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="flex-1">
              Cancel
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Loader2, Eye, EyeOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

// Forgot Password Component
function ForgotPasswordForm({ onResetComplete }: { onResetComplete?: () => void }) {
  const [step, setStep] = useState<"email" | "question" | "reset">("email");
  const [email, setEmail] = useState("");
  const [securityQuestion, setSecurityQuestion] = useState("");
  const [securityAnswer, setSecurityAnswer] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [userId, setUserId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const { toast } = useToast();

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const { data, error } = await supabase.functions.invoke("password-reset", {
        body: { email, step: "verify_email" },
      });

      if (error) {
        let errorMessage = "Failed to verify email address";
        try {
          const errorBody = error?.context ? await error.context.json() : null;
          if (errorBody?.error) errorMessage = errorBody.error;
        } catch { /* fallback */ }
        toast({ title: "Error", description: errorMessage, variant: "destructive" });
        setIsSubmitting(false);
        return;
      }

      if (data?.error) {
        toast({ title: "Error", description: data.error, variant: "destructive" });
        setIsSubmitting(false);
        return;
      }

      setSecurityQuestion(data.security_question);
      setUserId(data.user_id);
      setStep("question");
    } catch (err: any) {
      toast({
        title: "Error",
        description: err?.message || "Failed to verify email address",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSecurityAnswer = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const { data, error } = await supabase.functions.invoke("password-reset", {
        body: { email, securityAnswer, step: "verify_answer" },
      });

      if (error) {
        let errorMessage = "Failed to verify security answer";
        try {
          const errorBody = error?.context ? await error.context.json() : null;
          if (errorBody?.error) errorMessage = errorBody.error;
        } catch { /* fallback */ }
        toast({ title: "Error", description: errorMessage, variant: "destructive" });
        setIsSubmitting(false);
        return;
      }

      if (data?.error) {
        toast({ title: "Error", description: data.error, variant: "destructive" });
        setIsSubmitting(false);
        return;
      }

      setStep("reset");
    } catch (err: any) {
      toast({
        title: "Error",
        description: err?.message || "Failed to verify security answer",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();

    if (newPassword !== confirmPassword) {
      toast({ title: "Error", description: "Passwords do not match", variant: "destructive" });
      return;
    }

    if (newPassword.length < 6) {
      toast({
        title: "Error",
        description: "Password must be at least 6 characters long",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const { data, error } = await supabase.functions.invoke("password-reset", {
        body: { email, newPassword, step: "reset_password" },
      });

      if (error) {
        let errorMessage = "Failed to reset password";
        try {
          const errorBody = error?.context ? await error.context.json() : null;
          if (errorBody?.error) errorMessage = errorBody.error;
        } catch {
          // fallback
        }
        toast({ title: "Error", description: errorMessage, variant: "destructive" });
        return;
      }

      if (data?.error) {
        toast({ title: "Error", description: data.error, variant: "destructive" });
        return;
      }

      toast({ title: "Success", description: "Password reset successfully. Please sign in with your new password." });

      // Reset form and redirect to sign-in
      setStep("email");
      setEmail("");
      setSecurityQuestion("");
      setSecurityAnswer("");
      setNewPassword("");
      setConfirmPassword("");
      setUserId("");
      onResetComplete?.();
    } catch {
      toast({
        title: "Error",
        description: "Failed to reset password",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (step === "email") {
    return (
      <form onSubmit={handleEmailSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="forgot-email">Email Address</Label>
          <Input
            id="forgot-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="Enter your email address"
          />
        </div>
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Continue
        </Button>
      </form>
    );
  }

  if (step === "question") {
    return (
      <form onSubmit={handleSecurityAnswer} className="space-y-4">
        <div className="space-y-2">
          <Label>Security Question</Label>
          <p className="text-sm font-medium p-2 bg-muted rounded">{securityQuestion}</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="security-answer">Your Answer</Label>
          <Input
            id="security-answer"
            type="text"
            value={securityAnswer}
            onChange={(e) => setSecurityAnswer(e.target.value)}
            required
            placeholder="Enter your answer"
          />
        </div>
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Verify Answer
        </Button>
        <Button type="button" variant="outline" className="w-full" onClick={() => setStep("email")}>
          Back
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={handlePasswordReset} className="space-y-4">
      <div className="space-y-2 relative">
        <Label htmlFor="new-password">New Password</Label>
        <Input
          id="new-password"
          type={showNewPassword ? "text" : "password"}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
          placeholder="Enter new password"
          minLength={6}
          className="pr-10"
        />
        <button
          type="button"
          onClick={() => setShowNewPassword(!showNewPassword)}
          className="absolute right-3 top-9 text-gray-400 hover:text-gray-600"
        >
          {showNewPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
        </button>
      </div>
      <div className="space-y-2 relative">
        <Label htmlFor="confirm-password">Confirm Password</Label>
        <Input
          id="confirm-password"
          type={showConfirmPassword ? "text" : "password"}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          placeholder="Confirm new password"
          minLength={6}
          className="pr-10"
        />
        <button
          type="button"
          onClick={() => setShowConfirmPassword(!showConfirmPassword)}
          className="absolute right-3 top-9 text-gray-400 hover:text-gray-600"
        >
          {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
        </button>
      </div>
      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Reset Password
      </Button>
      <Button type="button" variant="outline" className="w-full" onClick={() => setStep("question")}>
        Back
      </Button>
    </form>
  );
}

// Main Auth Component
export default function Auth() {
  const { user, signIn, loading } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [activeTab, setActiveTab] = useState("signin");

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (user) return <Navigate to="/" replace />;

  const handleSignIn = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);

    const formData = new FormData(e.currentTarget);
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;

    await signIn(email, password);
    setIsSubmitting(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md shadow-xl rounded-2xl border border-border">
        {/* Header */}
        <CardHeader className="text-center space-y-2 pb-6">
          <div className="flex flex-col items-center">
            <div className="w-32 h-32 flex items-center justify-center bg-card rounded-full shadow-md mb-3 transition-transform duration-300 hover:scale-105 border border-border">
              <img
                src="/stocxpert-uploads/SIcon.svg"
                alt="System Logo"
                /* w-3/4 ensures the logo only takes up 75% of the circle's width, 
                   leaving plenty of space so nothing gets cut off */
                className="w-3/4 h-3/4 object-contain"
              />
            </div>

            <CardTitle className="text-3xl font-extrabold text-foreground">Welcome</CardTitle>
            <CardDescription className="text-muted-foreground">
              Sign in to your management account
            </CardDescription>
          </div>
        </CardHeader>

        {/* Tabs & Forms */}
        <CardContent className="px-6 pb-6">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-6 rounded-xl p-1">
              <TabsTrigger
                value="signin"
                className="data-[state=active]:bg-background data-[state=active]:shadow-md data-[state=active]:font-semibold rounded-lg transition"
              >
                Sign In
              </TabsTrigger>
              <TabsTrigger
                value="forgot"
                className="data-[state=active]:bg-background data-[state=active]:shadow-md data-[state=active]:font-semibold rounded-lg transition"
              >
                Forgot Password
              </TabsTrigger>
            </TabsList>

            {/* Sign In Form */}
            <TabsContent value="signin">
              <form onSubmit={handleSignIn} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="signin-email">Email</Label>
                  <Input
                    id="signin-email"
                    name="email"
                    type="email"
                    required
                    placeholder="Enter your email"
                    className="rounded-xl"
                  />
                </div>

                <div className="space-y-2 relative">
                  <Label htmlFor="signin-password">Password</Label>
                  <Input
                    id="signin-password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    required
                    placeholder="Enter your password"
                    className="rounded-xl pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-9 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>

                <Button type="submit" className="w-full rounded-xl font-medium" disabled={isSubmitting}>
                  {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Sign In
                </Button>
              </form>
            </TabsContent>

            {/* Forgot Password Form */}
            <TabsContent value="forgot">
              <ForgotPasswordForm onResetComplete={() => setActiveTab("signin")} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/db';
import { useAuth } from '@/hooks/useAuth';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { AlertTriangle, Lock, Upload, CheckCircle, Loader2 } from 'lucide-react';
import { cacheMeta, readMeta } from '@/lib/offline/db';
import { useOfflineStatus } from '@/lib/offline/store';
import { useToast } from '@/hooks/use-toast';
import { loadOfflineSubscription, OPEN_ONCE_ONLINE, type CachedSubscription } from '@/lib/offline/gates';
import { withSignal } from '@/lib/offline/readCache';

/**
 * Shared by the guard and offline preparation. `verified: false` means the account has no
 * resolvable owner (shown as expired, nothing cached). Throws on read failures.
 */
export async function fetchAndCacheSubscription(userId: string, profile: { role: string; branch_id?: string | null }, signal?: AbortSignal)
  : Promise<{ verified: boolean; status: CachedSubscription['status']; credit: number }> {
  let ownerId = userId;
  if (profile.role === 'staff') {
    if (!profile.branch_id) return { verified: false, status: 'expired', credit: 0 };
    const { data, error } = await withSignal(supabase.from('pharmacy_branches').select('pharmacy_owner_id').eq('id', profile.branch_id).single(), signal);
    if (error) throw error;
    if (!data?.pharmacy_owner_id) return { verified: false, status: 'expired', credit: 0 };
    ownerId = data.pharmacy_owner_id;
  }
  const { data, error } = await withSignal(supabase.from('pharmacy_subscriptions').select('subscription_credit, status').eq('pharmacy_owner_id', ownerId).maybeSingle(), signal);
  if (error) throw error;
  const status = data?.status ?? 'expired';
  const credit = Number(data?.subscription_credit ?? 0);
  await cacheMeta(`subscription:${userId}`, { status, credit });
  return { verified: true, status, credit };
}

interface SubscriptionGuardProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export default function SubscriptionGuard({ children, fallback }: SubscriptionGuardProps) {
  const { user, profile } = useAuth();
  const { reachable } = useOfflineStatus();
  const { toast } = useToast();
  const [subscriptionStatus, setSubscriptionStatus] = useState<'active' | 'expiring_soon' | 'expired' | 'inactive' | 'loading' | 'uncached'>('loading');
  const [daysRemaining, setDaysRemaining] = useState<number>(0);

  // Payment form state
  const [amount, setAmount] = useState('');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user || !profile) { setSubscriptionStatus('expired'); return; }
    let disposed = false;
    const id = user.id;
    const check = async () => {
      setSubscriptionStatus('loading');
      const fallback = async () => {
        // Fail closed: never-verified on this PC → deny; cached expired/inactive stays blocked.
        const cached = await loadOfflineSubscription(id);
        if (!disposed) { setSubscriptionStatus(cached.status); setDaysRemaining(cached.credit); }
      };
      if (profile.role === 'developer') { setSubscriptionStatus('active'); return; }
      if (!reachable) { await fallback(); return; }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        const result = await fetchAndCacheSubscription(id, profile, controller.signal);
        if (!result.verified) { setSubscriptionStatus('expired'); return; }
        if (!disposed) { setSubscriptionStatus(result.status); setDaysRemaining(result.credit); }
      } catch { await fallback(); }
      finally { clearTimeout(timer); }
    };
    void check();
    return () => { disposed = true; };
  }, [user?.id, profile?.role, profile?.branch_id, reachable]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setReceiptFile(file);
      const objectUrl = URL.createObjectURL(file);
      setReceiptPreview(objectUrl);
    }
  };

  const handleSubmitPayment = async () => {
    if (!amount || !receiptFile) {
      toast({ title: 'Missing fields', description: 'Please enter amount and upload receipt screenshot.', variant: 'destructive' });
      return;
    }

    setSubmitting(true);
    try {
      // Convert file to base64
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(',')[1]); // Remove data:image/...;base64, prefix
        };
        reader.onerror = reject;
        reader.readAsDataURL(receiptFile);
      });

      const { error } = await supabase.functions.invoke('send-payment-receipt', {
        body: {
          amount,
          ownerName: profile?.full_name || 'Unknown',
          ownerEmail: user?.email || 'Unknown',
          receiptBase64: base64,
          fileName: receiptFile.name,
        },
      });

      if (error) throw error;

      setSubmitted(true);
      toast({ title: 'Payment submitted!', description: 'Your receipt has been sent to admin for verification.' });
    } catch (error: any) {
      console.error('Error submitting payment:', error);
      toast({ title: 'Submission failed', description: error.message || 'Please try again.', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  if (subscriptionStatus === 'loading') {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (subscriptionStatus === 'uncached') {
    return <Card className="max-w-lg mx-auto mt-8"><CardContent className="p-6 flex items-center gap-2"><Lock className="h-4 w-4" />{OPEN_ONCE_ONLINE}</CardContent></Card>;
  }

  // If subscription is expired or inactive, show blocked access with payment option
  if (subscriptionStatus === 'expired' || subscriptionStatus === 'inactive') {
    const isInactive = subscriptionStatus === 'inactive';
    const blockedContent = fallback || (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="max-w-lg mx-auto w-full">
          <CardHeader className="text-center">
            <div className="mx-auto w-12 h-12 bg-destructive/10 rounded-full flex items-center justify-center">
              <Lock className="h-6 w-6 text-destructive" />
            </div>
            <CardTitle className="text-destructive">
              {isInactive ? 'Account Deactivated' : 'Subscription Expired'}
            </CardTitle>
            <CardDescription>
              {isInactive
                ? 'Your account has been deactivated by the system administrator.'
                : 'Your subscription has expired. Pay to renew your subscription.'
              }
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {!isInactive && !submitted && (
              <div className="space-y-4 p-4 rounded-lg border border-border bg-muted/30">
                <h4 className="font-semibold text-sm text-foreground">💳 Submit Payment</h4>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Amount (ETB)</label>
                  <Input
                    type="number"
                    placeholder="Enter amount paid"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Payment Receipt Screenshot</label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    {receiptFile ? receiptFile.name : 'Upload Receipt Screenshot'}
                  </Button>
                  {receiptPreview && (
                    <img
                      src={receiptPreview}
                      alt="Receipt preview"
                      className="w-full max-h-48 object-contain rounded-md border border-border mt-2"
                    />
                  )}
                </div>

                <Button
                  className="w-full"
                  onClick={handleSubmitPayment}
                  disabled={submitting || !amount || !receiptFile}
                >
                  {submitting ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Sending...</>
                  ) : (
                    'Submit Payment'
                  )}
                </Button>
              </div>
            )}

            {submitted && (
              <div className="text-center p-4 rounded-lg border border-green-500/30 bg-green-500/10">
                <CheckCircle className="h-8 w-8 text-green-500 mx-auto mb-2" />
                <p className="font-semibold text-green-500">Payment Submitted!</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Your receipt has been sent to admin. Your subscription will be activated shortly.
                </p>
              </div>
            )}

            <div className="text-center space-y-2 text-sm text-muted-foreground">
              <p>Need help? Contact support:</p>
              <p><strong>Email:</strong> insightstockxpert@gmail.com</p>
              <p><strong>Phone:</strong> +251-987794086</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );

    return <>{blockedContent}</>;
  }

  return <>{children}</>;
}

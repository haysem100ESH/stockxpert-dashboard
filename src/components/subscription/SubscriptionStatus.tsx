import { useSubscription } from '@/hooks/useSubscription';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle, Lock, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';

export default function SubscriptionStatus() {
  const { subscription, isSubscriptionExpired, isSubscriptionExpiring, getDaysRemaining } = useSubscription();
  const navigate = useNavigate();
  const [hasShownWarning, setHasShownWarning] = useState(false);

  // Reset warning shown status when subscription changes
  useEffect(() => {
    setHasShownWarning(false);
  }, [subscription?.subscription_credit]);

  useEffect(() => {
    if ((isSubscriptionExpiring() || isSubscriptionExpired()) && !hasShownWarning) {
      setHasShownWarning(true);
    }
  }, [isSubscriptionExpiring, isSubscriptionExpired, hasShownWarning]);

  if (!subscription || !hasShownWarning) return null;

  if (isSubscriptionExpired()) {
    return (
      <Alert variant="destructive" className="mb-2 py-1.5 px-3 [&>svg]:left-2 [&>svg]:top-2 [&>svg~*]:pl-5">
        <Lock className="h-3.5 w-3.5" />
        <AlertDescription className="flex items-center justify-between gap-2">
          <span className="text-xs truncate">🚫 Subscription expired.</span>
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => navigate('/account')}
            className="h-6 px-2 text-xs flex-shrink-0"
          >
            Renew
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (isSubscriptionExpiring()) {
    const daysLeft = getDaysRemaining();
    return (
      <Alert variant="default" className="mb-2 py-1.5 px-3 border-amber-500 bg-amber-50 text-amber-800 [&>svg]:left-2 [&>svg]:top-2 [&>svg~*]:pl-5">
        <AlertTriangle className="h-3.5 w-3.5" />
        <AlertDescription className="text-xs">
          ⚠ Expires in {daysLeft} day{daysLeft !== 1 ? 's' : ''}.
        </AlertDescription>
      </Alert>
    );
  }

  return null;
}
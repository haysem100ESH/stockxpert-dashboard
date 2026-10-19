import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Building2, Users, ArrowUpCircle } from 'lucide-react';
import { usePlanLimits } from '@/hooks/usePlanLimits';
import { useState } from 'react';
import UpgradePlanDialog from './UpgradePlanDialog';

export default function SubscriptionPlanCard() {
  const { planLimits, loading, refetch } = usePlanLimits();
  const [upgradeDialogOpen, setUpgradeDialogOpen] = useState(false);

  if (loading) {
    return (
      <Card>
        <CardContent className="py-6">
          <div className="text-center text-muted-foreground">Loading plan details...</div>
        </CardContent>
      </Card>
    );
  }

  if (!planLimits) return null;

  const getBranchesText = () => {
    if (planLimits.branchesLimit === null) return '∞';
    return `${planLimits.currentBranches}/${planLimits.branchesLimit}`;
  };

  const getStaffText = () => {
    if (planLimits.staffLimit === null) return '∞';
    return `${planLimits.currentStaff}/${planLimits.staffLimit}`;
  };

  const getBranchesColor = () => {
    if (planLimits.branchesLimit === null) return 'text-green-600';
    const usage = planLimits.currentBranches / planLimits.branchesLimit;
    if (usage >= 1) return 'text-destructive';
    if (usage >= 0.8) return 'text-amber-600';
    return 'text-green-600';
  };

  const getStaffColor = () => {
    if (planLimits.staffLimit === null) return 'text-green-600';
    const usage = planLimits.currentStaff / planLimits.staffLimit;
    if (usage >= 1) return 'text-destructive';
    if (usage >= 0.8) return 'text-amber-600';
    return 'text-green-600';
  };

  return (
    <>
      <Card className="border-2">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                Your Subscription Plan
                <Badge variant="secondary" className="text-sm">
                  {planLimits.planName}
                </Badge>
              </CardTitle>
              <CardDescription className="mt-1">
                Monitor your plan usage and upgrade anytime
              </CardDescription>
            </div>
            <Button
              onClick={() => setUpgradeDialogOpen(true)}
              variant="outline"
              size="sm"
              className="gap-2"
            >
              <ArrowUpCircle className="h-4 w-4" />
              Upgrade Plan
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex items-center gap-3 p-4 border rounded-lg">
              <Building2 className="h-8 w-8 text-primary" />
              <div className="flex-1">
                <p className="text-sm text-muted-foreground">Branches</p>
                <p className={`text-2xl font-bold ${getBranchesColor()}`}>
                  {getBranchesText()}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-4 border rounded-lg">
              <Users className="h-8 w-8 text-primary" />
              <div className="flex-1">
                <p className="text-sm text-muted-foreground">Staff Members</p>
                <p className={`text-2xl font-bold ${getStaffColor()}`}>
                  {getStaffText()}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <UpgradePlanDialog
        open={upgradeDialogOpen}
        onOpenChange={setUpgradeDialogOpen}
        currentPlan={planLimits.planName}
        onUpgradeComplete={refetch}
      />
    </>
  );
}

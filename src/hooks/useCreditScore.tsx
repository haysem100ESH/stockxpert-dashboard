import { supabase } from '@/lib/db';

// Credit limit tiers based on score
export function getCreditLimit(score: number): number {
  if (score >= 90) return 50000;
  if (score >= 80) return 30000;
  if (score >= 70) return 20000;
  if (score >= 60) return 10000;
  if (score >= 50) return 5000;
  if (score >= 30) return 2000;
  return 0; // Score < 30 = Cash Only
}

export function getCreditScoreColor(score: number): string {
  if (score >= 80) return 'text-green-600';
  if (score >= 50) return 'text-yellow-600';
  if (score >= 30) return 'text-orange-500';
  return 'text-red-600';
}

export function getCreditScoreBg(score: number): string {
  if (score >= 80) return 'bg-green-100 text-green-800 border-green-300';
  if (score >= 50) return 'bg-yellow-100 text-yellow-800 border-yellow-300';
  if (score >= 30) return 'bg-orange-100 text-orange-800 border-orange-300';
  return 'bg-red-100 text-red-800 border-red-300';
}

export function getCreditScoreLabel(score: number): string {
  if (score >= 80) return 'Excellent';
  if (score >= 50) return 'Good';
  if (score >= 30) return 'Fair';
  return 'Poor';
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, score));
}

interface ScoreUpdateParams {
  customerId: string;
  currentScore: number;
  changeAmount: number;
  reason: string;
  notes?: string;
  createdBy?: string;
  branchId?: string;
}

export async function updateCreditScore({
  customerId, currentScore, changeAmount, reason, notes, createdBy, branchId
}: ScoreUpdateParams) {
  // Fetch latest score AND limit. We only touch max_credit_limit when the
  // customer is in "auto" mode (stored value is NULL). Custom (>0) and
  // unlimited (-1) overrides are preserved.
  const { data: freshCustomer } = await (supabase as any)
    .from('customers')
    .select('credit_score, max_credit_limit')
    .eq('id', customerId)
    .single();

  const actualCurrentScore = freshCustomer?.credit_score ?? currentScore;
  const newScore = clampScore(actualCurrentScore + changeAmount);
  const isAutoMode = freshCustomer?.max_credit_limit === null || freshCustomer?.max_credit_limit === undefined;
  const newLimit = getCreditLimit(newScore);

  const update: Record<string, any> = { credit_score: newScore };
  if (isAutoMode) update.max_credit_limit = newLimit;

  await (supabase as any).from('customers').update(update).eq('id', customerId);

  // Log the change
  await (supabase as any).from('credit_logs').insert({
    customer_id: customerId,
    previous_score: actualCurrentScore,
    new_score: newScore,
    change_amount: changeAmount,
    reason,
    notes: notes || null,
    created_by: createdBy || null,
    branch_id: branchId || null,
  });

  return { newScore, newLimit: isAutoMode ? newLimit : freshCustomer.max_credit_limit };
}

// Scoring rules applied after a payment event
export function calculateScoreChange(params: {
  paidOnTime: boolean;
  daysEarly?: number;
  daysLate?: number;
  isPartialPayment?: boolean;
  partialPercent?: number;
}): { change: number; reason: string } {
  const { paidOnTime, daysEarly, daysLate, isPartialPayment, partialPercent } = params;

  if (paidOnTime) {
    if (daysEarly && daysEarly >= 3) {
      return { change: 15, reason: `Paid ${daysEarly} days early (+15)` };
    }
    return { change: 10, reason: 'Paid on time (+10)' };
  }

  if (daysLate && daysLate > 0) {
    if (daysLate >= 8) {
      return { change: -25, reason: `Paid ${daysLate} days late (-25)` };
    }
    return { change: -10, reason: `Paid ${daysLate} days late (-10)` };
  }

  if (isPartialPayment && partialPercent && partialPercent >= 50) {
    return { change: 2, reason: `Partial payment (${partialPercent.toFixed(0)}%) (+2)` };
  }

  return { change: 0, reason: 'No score change' };
}

export function canExtendCredit(creditScore: number, currentDebt: number, newOrderAmount: number, overrideLimit?: number): {
  allowed: boolean;
  maxLimit: number;
  availableCredit: number;
  reason?: string;
} {
  const maxLimit = overrideLimit !== undefined ? overrideLimit : getCreditLimit(creditScore);
  if (!isFinite(maxLimit)) {
    return { allowed: true, maxLimit, availableCredit: Number.POSITIVE_INFINITY };
  }
  if (maxLimit === 0) {
    return { allowed: false, maxLimit: 0, availableCredit: 0, reason: 'Credit score too low — Cash Only' };
  }
  const availableCredit = Math.max(0, maxLimit - currentDebt);
  if (newOrderAmount > availableCredit) {
    return {
      allowed: false, maxLimit, availableCredit,
      reason: `Order (ETB ${newOrderAmount.toFixed(2)}) exceeds available credit (ETB ${availableCredit.toFixed(2)})`
    };
  }
  return { allowed: true, maxLimit, availableCredit };
}

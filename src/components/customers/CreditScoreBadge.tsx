import { getCreditScoreBg, getCreditScoreLabel } from '@/hooks/useCreditScore';
import { Shield } from 'lucide-react';

interface CreditScoreBadgeProps {
  score: number;
  showLabel?: boolean;
  size?: 'sm' | 'md';
}

export default function CreditScoreBadge({ score, showLabel = true, size = 'sm' }: CreditScoreBadgeProps) {
  const bgClass = getCreditScoreBg(score);
  const label = getCreditScoreLabel(score);
  const sizeClass = size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-sm px-3 py-1';

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border font-semibold ${bgClass} ${sizeClass}`}>
      <Shield className={size === 'sm' ? 'h-3 w-3' : 'h-4 w-4'} />
      {score}
      {showLabel && <span className="font-normal">· {label}</span>}
    </span>
  );
}

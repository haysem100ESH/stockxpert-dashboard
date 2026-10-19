import { useEffect } from 'react';
import confetti from 'canvas-confetti';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Trophy } from 'lucide-react';
import type { StaffGoal } from '@/hooks/useStaffGoals';

interface Props {
  goal: StaffGoal | null;
  onClose: () => void;
}

export default function GoalCompletionModal({ goal, onClose }: Props) {
  useEffect(() => {
    if (!goal) return;
    const end = Date.now() + 1200;
    const frame = () => {
      confetti({ particleCount: 4, angle: 60,  spread: 70, origin: { x: 0,   y: 0.7 } });
      confetti({ particleCount: 4, angle: 120, spread: 70, origin: { x: 1,   y: 0.7 } });
      if (Date.now() < end) requestAnimationFrame(frame);
    };
    frame();
    confetti({ particleCount: 120, spread: 90, origin: { y: 0.6 } });
  }, [goal]);

  return (
    <Dialog open={!!goal} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="text-center">
        <DialogHeader>
          <div className="mx-auto mb-2 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-emerald-500 text-white shadow-lg">
            <Trophy className="h-8 w-8" />
          </div>
          <DialogTitle className="text-2xl">Congratulations!</DialogTitle>
          <DialogDescription>
            You have completed your <span className="font-semibold text-foreground">{goal?.name}</span>.
            <br />
            Keep going to earn bonus activities.
          </DialogDescription>
        </DialogHeader>
        <Button onClick={onClose} className="mx-auto mt-2">Awesome!</Button>
      </DialogContent>
    </Dialog>
  );
}

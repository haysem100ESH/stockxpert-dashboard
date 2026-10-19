import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/db';
import { toast } from '@/hooks/use-toast';
import { MessageCircle, ExternalLink } from 'lucide-react';

export function TelegramConnectionDialog() {
  const { profile } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [isChecking, setIsChecking] = useState(false);

  // Show dialog only for owners without telegram_chat_id
  useEffect(() => {
    if (profile?.role === 'owner' && !profile?.telegram_chat_id) {
      // Delay showing the dialog slightly after login
      const timer = setTimeout(() => {
        setIsOpen(true);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [profile]);

  // Poll for telegram_chat_id updates
  useEffect(() => {
    if (!isOpen || !profile?.id) return;

    const checkInterval = setInterval(async () => {
      setIsChecking(true);
      const { data, error } = await supabase
        .from('profiles')
        .select('telegram_chat_id')
        .eq('id', profile.id)
        .single();

      if (!error && data && 'telegram_chat_id' in data && data.telegram_chat_id) {
        setIsOpen(false);
        toast({
          title: "✅ Telegram Bot Connected!",
          description: "Your Telegram bot is now linked to your account. You'll receive daily reports at 10:00 PM.",
          duration: 5000,
        });
        clearInterval(checkInterval);
      }
      setIsChecking(false);
    }, 3000); // Check every 3 seconds

    return () => clearInterval(checkInterval);
  }, [isOpen, profile?.id]);

  const handleOpenTelegram = () => {
    const botUrl = `https://t.me/haysem_bot?start=${profile?.id}`;
    window.open(botUrl, '_blank');
  };

  const handleDismiss = () => {
    setIsOpen(false);
  };

  if (profile?.role !== 'owner' || profile?.telegram_chat_id) {
    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-2">
            <MessageCircle className="h-6 w-6 text-primary" />
            <DialogTitle>Connect Telegram Bot</DialogTitle>
          </div>
          <DialogDescription className="text-left space-y-3 pt-2">
            <p>
              📊 Get automated daily reports delivered straight to your Telegram!
            </p>
            <p className="text-sm">
              Connect your account to receive:
            </p>
            <ul className="text-sm space-y-1 pl-4">
              <li>• 📈 Daily sales summaries</li>
              <li>• 💰 Income and expense reports</li>
              <li>• 🔥 Top-selling medicines</li>
              <li>• 📅 Weekly and monthly analytics</li>
            </ul>
            <div className="bg-muted p-3 rounded-md text-sm">
              <p className="font-medium mb-1">How to connect:</p>
              <ol className="space-y-1 pl-4">
                <li>1. Click "Open Telegram Bot" below</li>
                <li>2. Press "Start" in the chat</li>
                <li>3. Your account will be connected automatically!</li>
              </ol>
            </div>
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 pt-4">
          <Button 
            onClick={handleOpenTelegram}
            className="w-full"
            size="lg"
          >
            <ExternalLink className="mr-2 h-4 w-4" />
            Open Telegram Bot
          </Button>
          {isChecking && (
            <p className="text-xs text-muted-foreground text-center">
              Waiting for connection...
            </p>
          )}
          <Button 
            onClick={handleDismiss}
            variant="ghost"
            className="w-full"
          >
            Maybe Later
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

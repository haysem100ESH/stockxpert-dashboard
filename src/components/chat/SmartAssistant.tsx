import { useState, useRef, useEffect } from 'react';
import { X, Send, Loader2, Sparkles, Trash2, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import { useBranchContext } from '@/hooks/useBranchContext';
import { useBranding } from '@/hooks/useBranding';
import { useSubscription } from '@/hooks/useSubscription';
import { supabase } from '@/lib/db';
import ReactMarkdown from 'react-markdown';
import { useToast } from '@/hooks/use-toast';

type Msg = { role: 'user' | 'assistant'; content: string };

const QUICK_QUERIES = [
  { label: '📦 Low stock items', query: 'What items are low in stock?' },
  { label: '💰 Today\'s sales', query: 'What are today\'s sales?' },
  { label: '🏆 Top selling', query: 'Show top selling items this month.' },
  { label: '💳 Customer debts', query: 'Which customers have unpaid debts?' },
  { label: '🏢 Best suppliers', query: 'Who are the best suppliers?' },
];

const PHARMACY_QUERIES = [
  { label: '⏰ Expiring medicines', query: 'Which medicines will expire soon?' },
];

export default function SmartAssistant() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [branchIds, setBranchIds] = useState<string[]>([]);
  // Position: side ('left' | 'right') + vertical offset from bottom in px
  const [side, setSide] = useState<'left' | 'right'>(() => (localStorage.getItem('chatSide') as 'left' | 'right') || 'right');
  const [bottomOffset, setBottomOffset] = useState<number>(() => Number(localStorage.getItem('chatBottom') || 24));
  const [dragging, setDragging] = useState(false);
  const dragState = useRef<{ startY: number; startX: number; startBottom: number; moved: boolean } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { user, profile } = useAuth();
  const { selectedBranch, branchType } = useBranchContext();
  const branding = useBranding();
  const { isSubscriptionExpired } = useSubscription();
  const { toast } = useToast();
  const subscriptionExpired = isSubscriptionExpired();

  // Fetch branch IDs for owner
  useEffect(() => {
    const fetchBranches = async () => {
      if (profile?.role === 'owner' && profile?.id) {
        const { data } = await supabase
          .from('pharmacy_branches')
          .select('id')
          .eq('pharmacy_owner_id', profile.id);
        setBranchIds((data || []).map((b: any) => b.id));
      } else if (profile?.branch_id) {
        setBranchIds([profile.branch_id]);
      }
    };
    fetchBranches();
  }, [profile]);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const getActiveBranchIds = (): string[] => {
    if (!selectedBranch || selectedBranch === 'all') return branchIds;
    return [selectedBranch];
  };

  const streamChat = async (allMessages: Msg[]) => {
    const url = `https://tcqlsxmgazrftpbumauk.supabase.co/functions/v1/smart-assistant`;
    const session = (await supabase.auth.getSession()).data.session;
    if (!session) throw new Error('Not authenticated');

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        apikey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRjcWxzeG1nYXpyZnRwYnVtYXVrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTYyODk0ODEsImV4cCI6MjA3MTg2NTQ4MX0.BZd-jIdwMVCn2AdKEl5QU6qgcFMrhgpp2SO3e2NXS20',
      },
      body: JSON.stringify({
        messages: allMessages,
        branchIds: getActiveBranchIds(),
        branchType,
      }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(err.error || `Error ${resp.status}`);
    }
    if (!resp.body) throw new Error('No response body');

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let textBuffer = '';
    let assistantSoFar = '';
    let streamDone = false;

    while (!streamDone) {
      const { done, value } = await reader.read();
      if (done) break;
      textBuffer += decoder.decode(value, { stream: true });

      let newlineIndex: number;
      while ((newlineIndex = textBuffer.indexOf('\n')) !== -1) {
        let line = textBuffer.slice(0, newlineIndex);
        textBuffer = textBuffer.slice(newlineIndex + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        if (line.startsWith(':') || line.trim() === '') continue;
        if (!line.startsWith('data: ')) continue;

        const jsonStr = line.slice(6).trim();
        if (jsonStr === '[DONE]') { streamDone = true; break; }

        try {
          const parsed = JSON.parse(jsonStr);
          const content = parsed.choices?.[0]?.delta?.content as string | undefined;
          if (content) {
            assistantSoFar += content;
            setMessages(prev => {
              const last = prev[prev.length - 1];
              if (last?.role === 'assistant') {
                return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: assistantSoFar } : m);
              }
              return [...prev, { role: 'assistant', content: assistantSoFar }];
            });
          }
        } catch {
          textBuffer = line + '\n' + textBuffer;
          break;
        }
      }
    }
  };

  const send = async (text: string) => {
    if (!text.trim() || isLoading) return;
    const userMsg: Msg = { role: 'user', content: text.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);

    try {
      await streamChat(newMessages);
    } catch (e: any) {
      const msg = e.message || '';
      const isRateLimit = msg.includes('429') || msg.toLowerCase().includes('rate') || msg.toLowerCase().includes('quota');
      const friendlyMsg = isRateLimit
        ? "🚫 Today's AI credit has been exhausted. Please try again later or contact your administrator to update your API key."
        : `❌ ${msg}`;
      toast({ title: isRateLimit ? 'AI Limit Reached' : 'AI Assistant Error', description: isRateLimit ? friendlyMsg : msg, variant: 'destructive' });
      setMessages(prev => [...prev, { role: 'assistant', content: friendlyMsg }]);
    } finally {
      setIsLoading(false);
    }
  };

  const quickQueries = [
    ...QUICK_QUERIES,
    ...(branchType === 'pharmacy' ? PHARMACY_QUERIES : []),
  ];

  if (!user) return null;

  // ── Drag handlers (vertical movement + horizontal snap to nearest edge) ──
  const positionStyle: React.CSSProperties = {
    bottom: `${bottomOffset}px`,
    [side]: '24px',
    transition: dragging ? 'none' : 'left 0.25s ease, right 0.25s ease',
  };

  // Keep the chat panel within the viewport even if the launcher button was dragged near the top
  const PANEL_HEIGHT = 560;
  const [viewportH, setViewportH] = useState<number>(() =>
    typeof window !== 'undefined' ? window.innerHeight : 800
  );
  useEffect(() => {
    const onResize = () => setViewportH(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const panelBottom = Math.max(16, Math.min(bottomOffset, viewportH - PANEL_HEIGHT - 16));
  const panelStyle: React.CSSProperties = {
    ...positionStyle,
    bottom: `${panelBottom}px`,
  };


  const justDraggedRef = useRef(false);

  const makeDragHandlers = (opts: { headerOnly?: boolean } = {}) => ({
    onPointerDown: (e: React.PointerEvent) => {
      // For the panel header, ignore drags initiated on inner buttons (close/clear).
      if (opts.headerOnly && (e.target as HTMLElement).closest('button')) return;
      const el = e.currentTarget as HTMLElement;
      el.setPointerCapture(e.pointerId);
      const rect = el.getBoundingClientRect();
      dragState.current = {
        startY: e.clientY,
        startX: e.clientX,
        startBottom: bottomOffset,
        moved: false,
        height: rect.height,
      } as any;
      setDragging(true);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!dragState.current) return;
      const dy = e.clientY - dragState.current.startY;
      const dx = e.clientX - dragState.current.startX;
      if (Math.abs(dy) > 3 || Math.abs(dx) > 3) dragState.current.moved = true;
      const h = (dragState.current as any).height || 60;
      const maxBottom = Math.max(8, window.innerHeight - h - 8);
      const newBottom = Math.max(8, Math.min(maxBottom, dragState.current.startBottom - dy));
      setBottomOffset(newBottom);
    },
    onPointerUp: (e: React.PointerEvent) => {
      if (!dragState.current) return;
      const wasMoved = dragState.current.moved;
      const newSide: 'left' | 'right' = e.clientX < window.innerWidth / 2 ? 'left' : 'right';
      setSide(newSide);
      localStorage.setItem('chatSide', newSide);
      localStorage.setItem('chatBottom', String(bottomOffset));
      dragState.current = null;
      setDragging(false);
      if (wasMoved) {
        justDraggedRef.current = true;
        setTimeout(() => { justDraggedRef.current = false; }, 50);
      }
    },
  });

  const buttonDrag = makeDragHandlers();
  const headerDrag = makeDragHandlers({ headerOnly: true });

  return (
    <>
      {/* Floating button */}
      {!open && (
        <button
          {...buttonDrag}
          onClick={(e) => {
            if (justDraggedRef.current) { e.preventDefault(); return; }
            if (subscriptionExpired) {
              toast({ title: 'Subscription Expired', description: 'AI Assistant is disabled. Please renew your subscription.', variant: 'destructive' });
              return;
            }
            setOpen(true);
          }}
          style={positionStyle}
          className={`fixed z-50 h-14 w-14 rounded-full shadow-lg flex items-center justify-center hover:scale-105 touch-none select-none ${
            subscriptionExpired
              ? 'bg-muted text-muted-foreground cursor-not-allowed'
              : 'bg-primary text-primary-foreground hover:bg-primary/90 cursor-grab active:cursor-grabbing'
          }`}
          aria-label="Open AI Assistant"
        >
          {subscriptionExpired ? <Lock className="h-6 w-6" /> : <Sparkles className="h-6 w-6" />}
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div
          style={panelStyle}
          className="fixed z-50 w-[380px] max-w-[calc(100vw-2rem)] h-[560px] max-h-[calc(100vh-4rem)] bg-card border rounded-2xl shadow-2xl flex flex-col overflow-hidden"

        >
          {/* Header (drag handle) */}
          <div
            {...headerDrag}
            className="flex items-center justify-between px-4 py-3 border-b bg-primary text-primary-foreground rounded-t-2xl cursor-grab active:cursor-grabbing touch-none select-none"
          >
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              <div>
                <p className="font-semibold text-sm">StockXpert AI</p>
                <p className="text-xs opacity-80">Smart Assistant</p>
              </div>
            </div>
            <div className="flex gap-1">
              <button onClick={() => setMessages([])} className="p-1.5 rounded-md hover:bg-primary-foreground/20 transition-colors" title="Clear chat">
                <Trash2 className="h-4 w-4" />
              </button>
              <button onClick={() => setOpen(false)} className="p-1.5 rounded-md hover:bg-primary-foreground/20 transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3" ref={scrollRef}>
            {messages.length === 0 && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground text-center pt-4">
                  👋 Hi {profile?.full_name?.split(' ')[0]}! Ask me anything about your {branchType === 'pharmacy' ? 'pharmacy' : 'inventory'}.
                </p>
                <div className="flex flex-wrap gap-2 justify-center">
                  {quickQueries.map((q) => (
                    <button
                      key={q.label}
                      onClick={() => send(q.query)}
                      className="text-xs px-3 py-1.5 rounded-full border bg-muted hover:bg-accent transition-colors text-foreground"
                    >
                      {q.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                    msg.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-foreground'
                  }`}
                >
                  {msg.role === 'assistant' ? (
                    <div className="prose prose-sm dark:prose-invert max-w-none [&_p]:my-1 [&_ul]:my-1 [&_li]:my-0.5 [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  ) : (
                    msg.content
                  )}
                </div>
              </div>
            ))}

            {isLoading && messages[messages.length - 1]?.role !== 'assistant' && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-xl px-3 py-2">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="p-3 border-t">
            <form
              onSubmit={(e) => { e.preventDefault(); send(input); }}
              className="flex gap-2"
            >
              <Input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about inventory, sales..."
                disabled={isLoading}
                className="flex-1 text-sm"
              />
              <Button type="submit" size="icon" disabled={isLoading || !input.trim()}>
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

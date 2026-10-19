import { useState, useEffect, createContext, useContext, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/db';
import { cacheMeta, readMeta } from '@/lib/offline/db';
import type { CachedProfile } from '@/lib/offline/types';
import { useToast } from '@/hooks/use-toast';

interface Profile {
  id: string;
  full_name: string;
  role: 'owner' | 'staff' | 'developer';
  pharmacy_name?: string;
  phone?: string;
  branch_id?: string;
  security_question?: string;
  security_answer_hash?: string;
  active?: boolean;
  manually_deactivated?: boolean;
  telegram_chat_id?: string | null;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  signUp: (email: string, password: string, fullName: string, role?: 'owner' | 'staff' | 'developer') => Promise<{ error: any }>;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    let disposed = false;
    let generation = 0;
    const hydrate = async (nextSession: Session | null) => {
      const current = ++generation;
      setLoading(true);
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      if (!nextSession?.user) {
        setProfile(null); setLoading(false); return;
      }
      const id = nextSession.user.id;
      try {
        let nextProfile: Profile | null = null;
        if (!navigator.onLine) nextProfile = await readMeta<CachedProfile>(`profile:${id}`) ?? null;
        else {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 5000);
          try {
            const { data, error } = await supabase.from('profiles').select('*').eq('id', id).single().abortSignal(controller.signal);
            if (error) {
              // Only connection failures use the cached profile, never access denials.
              if (!error.code || error.message?.includes('fetch') || controller.signal.aborted) nextProfile = await readMeta<CachedProfile>(`profile:${id}`) ?? null;
            } else if (data) {
              nextProfile = data;
              const { full_name, role, branch_id, pharmacy_name, active, manually_deactivated } = data;
              await cacheMeta(`profile:${id}`, { id, full_name, role, branch_id, pharmacy_name, active, manually_deactivated });
            }
          } catch { nextProfile = await readMeta<CachedProfile>(`profile:${id}`) ?? null; }
          finally { clearTimeout(timer); }
        }
        if (!disposed && current === generation) setProfile(nextProfile);
      } finally { if (!disposed && current === generation) setLoading(false); }
    };
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      // Avoid making auth calls from the auth callback's locked scope.
      setTimeout(() => { if (!disposed) void hydrate(nextSession); }, 0);
    });
    void supabase.auth.getSession().then(({ data: { session: nextSession } }) => { if (!disposed) void hydrate(nextSession); })
      .catch(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; subscription.unsubscribe(); };
  }, []);

  const signUp = async (email: string, password: string, fullName: string, role: 'owner' | 'staff' | 'developer' = 'staff') => {
    const redirectUrl = `${window.location.origin}/`;
    
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
        data: {
          full_name: fullName,
          role: role
        }
      }
    });

    if (error) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    } else {
      toast({
        title: "Success",
        description: "Please check your email to confirm your account.",
      });
    }

    return { error };
  };

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
      return { error };
    }

    // Check if the user account is active
    if (data.user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('active, role, manually_deactivated')
        .eq('id', data.user.id)
        .single();

      if (profile && !profile.active) {
        // Check subscription status for owners
        if (profile.role === 'owner') {
          const { data: subscription } = await supabase
            .from('pharmacy_subscriptions')
            .select('status')
            .eq('pharmacy_owner_id', data.user.id)
            .single();

          // If subscription is inactive (manually deactivated by admin)
          if (subscription?.status === 'inactive') {
            await supabase.auth.signOut();
            const deactivatedError = new Error('🚫 Your account has been deactivated by the system administrator. Please contact support.');
            toast({
              title: "Account Inactive",
              description: "🚫 Your account has been deactivated by the system administrator. Please contact support.",
              variant: "destructive"
            });
            return { error: deactivatedError };
          }
        }

        // Sign out the user immediately for other deactivation reasons
        await supabase.auth.signOut();
        const deactivatedError = new Error('🚫 Your account has been deactivated. Please contact support.');
        toast({
          title: "Account Deactivated",
          description: "🚫 Your account has been deactivated. Please contact support.",
          variant: "destructive"
        });
        return { error: deactivatedError };
      }
    }

    return { error };
  };

  const signOut = async () => {
    return new Promise<void>((resolve) => {
      const handleSignOut = async () => {
        await supabase.auth.signOut();
        setUser(null);
        setSession(null);
        setProfile(null);
        resolve();
      };
      handleSignOut();
    });
  };

  const refreshProfile = async () => {
    if (!user) return;
    const { data: profileData } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();
    if (profileData) setProfile(profileData);
  };

  return (
    <AuthContext.Provider value={{
      user,
      session,
      profile,
      loading,
      signUp,
      signIn,
      signOut,
      refreshProfile
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
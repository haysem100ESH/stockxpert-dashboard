import { useState, useEffect, createContext, useContext, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';

interface Profile {
  id: string;
  full_name: string;
  role: 'owner' | 'staff' | 'developer';
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
    // Set up auth state listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        
        if (session?.user) {
          // Fetch user profile
          setTimeout(async () => {
            const { data: profileData } = await supabase
              .from('profiles')
              .select('*')
              .eq('id', session.user.id)
              .single();
            
            setProfile(profileData);
          }, 0);
        } else {
          setProfile(null);
        }
        
        setLoading(false);
      }
    );

    // Check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      
      if (session?.user) {
        // Fetch user profile
        setTimeout(async () => {
          const { data: profileData } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', session.user.id)
            .single();
          
          setProfile(profileData);
          setLoading(false);
        }, 0);
      } else {
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
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
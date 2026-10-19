import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.56.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Simple hash function for security answers
const hashAnswer = (answer: string) => {
  let hash = 0;
  for (let i = 0; i < answer.length; i++) {
    const char = answer.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString();
};

interface PasswordResetRequest {
  email: string;
  securityAnswer?: string;
  newPassword?: string;
  step: 'verify_email' | 'verify_answer' | 'reset_password';
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    // Create admin client
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const { email, securityAnswer, newPassword, step }: PasswordResetRequest = await req.json();

    console.log(`Password reset step: ${step} for email: ${email}`);

    if (step === 'verify_email') {
      // Get profile by email
      const { data: profileData, error: profileError } = await supabaseAdmin
        .rpc('get_profile_by_email', { user_email: email });

      if (profileError || !profileData || profileData.length === 0) {
        console.log('No profile found for email:', email);
        return new Response(
          JSON.stringify({ error: 'No account found with this email address' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const profile = profileData[0];

      if (!profile.security_question || !profile.security_answer_hash) {
        console.log('No security question set for user:', email);
        return new Response(
          JSON.stringify({ error: 'No security question set for this account' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          security_question: profile.security_question,
          user_id: profile.id 
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (step === 'verify_answer') {
      if (!securityAnswer) {
        return new Response(
          JSON.stringify({ error: 'Security answer is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Get profile by email
      const { data: profileData, error: profileError } = await supabaseAdmin
        .rpc('get_profile_by_email', { user_email: email });

      if (profileError || !profileData || profileData.length === 0) {
        return new Response(
          JSON.stringify({ error: 'Account not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const profile = profileData[0];
      const hashedAnswer = hashAnswer(securityAnswer.toLowerCase().trim());

      if (hashedAnswer !== profile.security_answer_hash) {
        console.log('Security answer mismatch for user:', email);
        return new Response(
          JSON.stringify({ error: 'Incorrect security answer' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, user_id: profile.id }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (step === 'reset_password') {
      if (!newPassword || newPassword.length < 6) {
        return new Response(
          JSON.stringify({ error: 'Password must be at least 6 characters long' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Get profile by email
      const { data: profileData, error: profileError } = await supabaseAdmin
        .rpc('get_profile_by_email', { user_email: email });

      if (profileError || !profileData || profileData.length === 0) {
        return new Response(
          JSON.stringify({ error: 'Account not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const profile = profileData[0];

      // Update user password using admin client
      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
        profile.id,
        { password: newPassword }
      );

      if (updateError) {
        console.error('Failed to update password:', updateError);
        return new Response(
          JSON.stringify({ error: 'Failed to update password' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log('Password updated successfully for user:', email);

      return new Response(
        JSON.stringify({ success: true, message: 'Password updated successfully' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Invalid step' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error in password-reset function:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
};

serve(handler);
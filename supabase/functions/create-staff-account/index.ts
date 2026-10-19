import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.56.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

interface CreateStaffRequest {
  email: string;
  password: string;
  fullName: string;
  phone?: string;
  role: 'owner' | 'staff';
  branchId?: string;
  securityQuestion: string;
  securityAnswer: string;
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

    const { email, password, fullName, phone, role, branchId, securityQuestion, securityAnswer }: CreateStaffRequest = await req.json();

    console.log(`Creating ${role} account for email: ${email}`);

    if (!email || !password || !fullName || !securityQuestion || !securityAnswer) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (password.length < 6) {
      return new Response(
        JSON.stringify({ error: 'Password must be at least 6 characters long' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create the user account
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      user_metadata: {
        full_name: fullName,
        role
      },
      email_confirm: true // Auto-confirm email for admin-created accounts
    });

    if (authError || !authData?.user) {
      console.error('Auth error:', authError);
      const raw = authError?.message || 'Failed to create user';
      const lower = raw.toLowerCase();
      let friendly = raw;
      if (lower.includes('already') || lower.includes('registered') || lower.includes('exists') || lower.includes('duplicate')) {
        friendly = `An account with email "${email}" already exists.`;
      } else if (lower.includes('password')) {
        friendly = raw;
      } else if (lower.includes('email') && lower.includes('invalid')) {
        friendly = 'The email address is invalid.';
      }
      return new Response(
        JSON.stringify({ error: friendly }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Hash the security answer
    const hashedAnswer = hashAnswer(securityAnswer.toLowerCase().trim());

    // Update the profile with additional information
    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .update({
        phone: phone || null,
        branch_id: branchId || null,
        security_question: securityQuestion,
        security_answer_hash: hashedAnswer
      })
      .eq('id', authData.user.id);

    if (profileError) {
      console.error('Profile error:', profileError);
      // Try to delete the created user if profile update fails
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      return new Response(
        JSON.stringify({ error: `Failed to update profile information: ${profileError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Successfully created ${role} account for: ${email}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `${role === 'owner' ? 'Owner' : 'Staff member'} account created successfully`,
        user_id: authData.user.id 
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error in create-staff-account function:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
};

serve(handler);
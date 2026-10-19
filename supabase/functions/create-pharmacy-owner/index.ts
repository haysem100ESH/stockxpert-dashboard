import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.56.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CreateOwnerRequest {
  full_name: string;
  email: string;
  password: string;
  phone?: string;
  pharmacy_name?: string;
  pharmacy_address?: string;
  creditPlans?: Array<{ days: number; price: number }>;
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !serviceKey) {
      throw new Error('Missing required environment variables');
    }

    // Create admin client
    const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    const requestBody = await req.json() as CreateOwnerRequest;
    const { full_name, email, password, phone, pharmacy_name, pharmacy_address, creditPlans } = requestBody;

    // Validate required fields
    if (!full_name || !email || !password) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: full_name, email, password' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (password.length < 6) {
      return new Response(
        JSON.stringify({ error: 'Password must be at least 6 characters long' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Creating user with email:', email);

    // Create the user
    const { data: user, error: userError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      user_metadata: {
        full_name,
        role: 'owner'
      },
      email_confirm: true // Auto-confirm email
    });

    if (userError) {
      console.error('Error creating user:', userError);
      return new Response(
        JSON.stringify({ error: userError.message }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('User created successfully, updating profile...');

    // Update the profile with additional information
    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .update({
        full_name,
        phone,
        pharmacy_name,
        pharmacy_address,
        role: 'owner',
        active: true
      })
      .eq('id', user.user.id);

    if (profileError) {
      console.error('Error updating profile:', profileError);
      // If profile update fails, delete the user to maintain consistency
      await supabaseAdmin.auth.admin.deleteUser(user.user.id);
      return new Response(
        JSON.stringify({ error: 'Failed to create profile: ' + profileError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create credit plans if provided
    if (creditPlans && creditPlans.length > 0) {
      const creditPlanInserts = creditPlans.map((plan: any) => ({
        pharmacy_owner_id: user.user.id,
        days: plan.days,
        price: plan.price
      }));

      const { error: creditPlanError } = await supabaseAdmin
        .from('credit_plans')
        .insert(creditPlanInserts);

      if (creditPlanError) {
        console.error('Credit plan creation error:', creditPlanError);
      } else {
        console.log('Credit plans created successfully');
      }
    }

    console.log('Pharmacy owner created successfully');

    return new Response(
      JSON.stringify({ 
        message: 'Pharmacy owner created successfully',
        user_id: user.user.id,
        email: user.user.email
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error: ' + error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
};

serve(handler);
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.56.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const handler = async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user: caller }, error: callerError } = await userClient.auth.getUser();
    if (callerError || !caller) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify caller is an owner
    const { data: callerProfile } = await supabaseAdmin
      .from('profiles')
      .select('role, id')
      .eq('id', caller.id)
      .single();

    if (!callerProfile || callerProfile.role !== 'owner') {
      return new Response(JSON.stringify({ error: 'Only owners can reset staff passwords' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { staffId, newPassword } = await req.json();
    if (!staffId || !newPassword) {
      return new Response(JSON.stringify({ error: 'Missing staffId or newPassword' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (newPassword.length < 6) {
      return new Response(JSON.stringify({ error: 'Password must be at least 6 characters' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify the staff belongs to owner's branches
    const { data: staffProfile } = await supabaseAdmin
      .from('profiles')
      .select('id, role, branch_id')
      .eq('id', staffId)
      .single();

    if (!staffProfile || staffProfile.role !== 'staff') {
      return new Response(JSON.stringify({ error: 'Staff member not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (staffProfile.branch_id) {
      const { data: branch } = await supabaseAdmin
        .from('pharmacy_branches')
        .select('pharmacy_owner_id')
        .eq('id', staffProfile.branch_id)
        .single();

      if (!branch || branch.pharmacy_owner_id !== callerProfile.id) {
        return new Response(JSON.stringify({ error: 'Permission denied' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Reset password using admin API
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(staffId, {
      password: newPassword,
    });

    if (updateError) {
      console.error('Password reset error:', updateError);
      throw updateError;
    }

    return new Response(JSON.stringify({ success: true, message: 'Password reset successfully' }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Error in reset-staff-password:', error);
    return new Response(JSON.stringify({ error: error.message || 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
};

serve(handler);

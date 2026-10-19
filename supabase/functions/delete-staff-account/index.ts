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

    // Verify the caller is authenticated and is an owner
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
      return new Response(JSON.stringify({ error: 'Only owners can delete staff accounts' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const staffId = body.staffId || body.staffUserId;
    if (!staffId) {
      return new Response(JSON.stringify({ error: 'Missing staffId' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify the staff belongs to one of the owner's branches
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

    // Verify the staff's branch belongs to this owner
    if (staffProfile.branch_id) {
      const { data: branch } = await supabaseAdmin
        .from('pharmacy_branches')
        .select('pharmacy_owner_id')
        .eq('id', staffProfile.branch_id)
        .single();

      if (!branch || branch.pharmacy_owner_id !== callerProfile.id) {
        return new Response(JSON.stringify({ error: 'Permission denied: staff not in your branch' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Nullify common FK references that would block deletion (best-effort)
    const nullifyTargets: Array<{ table: string; column: string }> = [
      { table: 'sales', column: 'sold_by' },
      { table: 'sales', column: 'staff_id' },
      { table: 'sales', column: 'created_by' },
      { table: 'medicines', column: 'created_by' },
      { table: 'customers', column: 'created_by' },
      { table: 'customer_payments', column: 'created_by' },
      { table: 'stock_movements', column: 'created_by' },
      { table: 'inventory_batches', column: 'created_by' },
      { table: 'expenses', column: 'created_by' },
      { table: 'credit_logs', column: 'created_by' },
      { table: 'transfer_requests', column: 'requested_by' },
      { table: 'transfer_requests', column: 'fulfilled_by' },
      { table: 'transfer_requests', column: 'created_by' },
      { table: 'transfer_requests', column: 'approved_by' },
      { table: 'branch_items', column: 'created_by' },
      { table: 'pharmacy_branches', column: 'manager_staff_id' },
      { table: 'payment_requests', column: 'approved_by' },
      { table: 'salary_expenses', column: 'created_by' },
    ];
    for (const t of nullifyTargets) {
      try {
        const { error } = await supabaseAdmin.from(t.table).update({ [t.column]: null }).eq(t.column, staffId);
        if (error) console.warn(`Could not clear ${t.table}.${t.column}:`, error.message);
      } catch (_) { /* ignore - column/table may not exist */ }
    }

    // Delete staff-owned settings/biometric/attendance rows (best-effort)
    const deleteTargets: Array<{ table: string; column: string }> = [
      { table: 'staff_permissions', column: 'staff_id' },
      { table: 'staff_face_data', column: 'staff_id' },
      { table: 'staff_face_embeddings', column: 'staff_id' },
      { table: 'staff_attendance', column: 'staff_id' },
      { table: 'attendance_records', column: 'staff_id' },
      { table: 'attendance_schedules', column: 'staff_id' },
      { table: 'attendance_suspicious_alerts', column: 'staff_id' },
      { table: 'salary_expenses', column: 'staff_id' },
      { table: 'staff_salaries', column: 'staff_id' },
      { table: 'salary_payments', column: 'staff_id' },
      { table: 'user_roles', column: 'user_id' },
      { table: 'telegram_links', column: 'user_id' },
    ];
    for (const t of deleteTargets) {
      try {
        const { error } = await supabaseAdmin.from(t.table).delete().eq(t.column, staffId);
        if (error) console.warn(`Could not delete ${t.table}.${t.column}:`, error.message);
      } catch (_) { /* ignore - column/table may not exist */ }
    }

    // Delete auth user (cascades to profiles via trigger)
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(staffId);
    if (deleteError) {
      console.error('Delete auth user error:', deleteError);
      // Fallback: delete profile row directly
      const { error: profileDeleteError } = await supabaseAdmin
        .from('profiles')
        .delete()
        .eq('id', staffId);
      if (profileDeleteError) {
        console.error('Delete profile error:', profileDeleteError);
        return new Response(JSON.stringify({
          error: `Failed to delete staff: ${profileDeleteError.message}. Auth: ${deleteError.message}`,
        }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Error in delete-staff-account:', error);
    return new Response(JSON.stringify({ error: error.message || 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
};

serve(handler);

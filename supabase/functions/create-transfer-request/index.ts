import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.56.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestItemInput {
  medicine_id: string;
  requested_quantity: number;
}

interface CreateTransferRequestBody {
  requestingBranchId: string;
  sourceBranchId?: string | null;
  notes?: string | null;
  items: RequestItemInput[];
}

const branchTypeToLocationType = (branchType: string) => {
  if (branchType === 'pharmacy') return 'pharmacy';
  if (branchType === 'warehouse') return 'warehouse';
  return 'store';
};

serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      throw new Error('Missing environment configuration');
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = (await req.json()) as CreateTransferRequestBody;
    const requestingBranchId = body.requestingBranchId;
    const sourceBranchId = body.sourceBranchId || null;
    const notes = body.notes || null;
    const items = Array.isArray(body.items) ? body.items : [];

    if (!requestingBranchId) {
      return new Response(JSON.stringify({ error: 'Requesting branch is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (items.length === 0 || items.some((i) => !i.medicine_id || Number(i.requested_quantity) <= 0)) {
      return new Response(JSON.stringify({ error: 'Invalid request items' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('id, role, branch_id')
      .eq('id', user.id)
      .maybeSingle();

    if (profileError || !profile) {
      return new Response(JSON.stringify({ error: 'Profile not found' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (profile.role === 'staff' && profile.branch_id !== requestingBranchId) {
      return new Response(JSON.stringify({ error: 'Staff can only request for their assigned branch' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: requestingBranch, error: requestingBranchError } = await admin
      .from('pharmacy_branches')
      .select('id, name, branch_type, pharmacy_owner_id')
      .eq('id', requestingBranchId)
      .maybeSingle();

    if (requestingBranchError || !requestingBranch) {
      return new Response(JSON.stringify({ error: 'Requesting branch not found' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const ownerId = requestingBranch.pharmacy_owner_id;

    if (profile.role === 'owner' && ownerId !== user.id) {
      return new Response(JSON.stringify({ error: 'You can only create requests for your own branches' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (profile.role === 'staff' && profile.branch_id) {
      const { data: staffBranch } = await admin
        .from('pharmacy_branches')
        .select('pharmacy_owner_id')
        .eq('id', profile.branch_id)
        .maybeSingle();

      if (!staffBranch || staffBranch.pharmacy_owner_id !== ownerId) {
        return new Response(JSON.stringify({ error: 'Invalid tenant scope for transfer request' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const ensureLocationForBranch = async (branchId: string): Promise<string> => {
      const { data: existing } = await admin
        .from('locations')
        .select('id')
        .eq('branch_id', branchId)
        .maybeSingle();

      if (existing?.id) return existing.id;

      const { data: branch, error: branchError } = await admin
        .from('pharmacy_branches')
        .select('id, name, branch_type, pharmacy_owner_id')
        .eq('id', branchId)
        .maybeSingle();

      if (branchError || !branch) {
        throw new Error('Branch not found while resolving location');
      }

      const { data: created, error: createdError } = await admin
        .from('locations')
        .insert({
          pharmacy_owner_id: branch.pharmacy_owner_id,
          name: branch.name,
          type: branchTypeToLocationType(branch.branch_type),
          branch_id: branch.id,
        })
        .select('id')
        .maybeSingle();

      if (createdError || !created?.id) {
        throw new Error(createdError?.message || 'Failed to create location for branch');
      }

      return created.id;
    };

    const requestingLocationId = await ensureLocationForBranch(requestingBranchId);

    let sourceLocationId: string | null = null;
    if (sourceBranchId) {
      const { data: sourceBranch, error: sourceError } = await admin
        .from('pharmacy_branches')
        .select('id, pharmacy_owner_id')
        .eq('id', sourceBranchId)
        .maybeSingle();

      if (sourceError || !sourceBranch) {
        return new Response(JSON.stringify({ error: 'Source branch not found' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (sourceBranch.pharmacy_owner_id !== ownerId) {
        return new Response(JSON.stringify({ error: 'Source branch must belong to the same owner' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      sourceLocationId = await ensureLocationForBranch(sourceBranchId);
    }

    const { data: requestRow, error: requestError } = await admin
      .from('transfer_requests')
      .insert({
        requesting_location_id: requestingLocationId,
        source_location_id: sourceLocationId,
        notes,
        created_by: user.id,
      })
      .select('id')
      .maybeSingle();

    if (requestError || !requestRow?.id) {
      throw new Error(requestError?.message || 'Failed to create transfer request');
    }

    const { error: itemsError } = await admin.from('transfer_request_items').insert(
      items.map((item: any) => ({
        request_id: requestRow.id,
        medicine_id: item.medicine_id,
        requested_quantity: item.requested_quantity,
        target_medicine_id: item.target_medicine_id ?? item.medicine_id,
        target_batch_id: item.target_batch_id ?? null,
        create_new_batch: !!item.create_new_batch,
        new_batch_number: item.new_batch_number ?? null,
        new_batch_expiry: item.new_batch_expiry ?? null,
        new_batch_purchase_price:
          item.new_batch_purchase_price != null ? Number(item.new_batch_purchase_price) : null,
      }))
    );

    if (itemsError) {
      throw new Error(itemsError.message || 'Failed to create transfer request items');
    }

    return new Response(JSON.stringify({ success: true, requestId: requestRow.id }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message || 'Unexpected error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

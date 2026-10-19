// deploy: fulfill-rpc v2
import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.56.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized' }, 401);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: 'Unauthorized' }, 401);

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const body = await req.json();
    const { action, requestId } = body;
    if (!requestId || !['approve', 'reject', 'fulfill'].includes(action)) {
      return json({ error: 'Invalid action or requestId' }, 400);
    }

    const { data: trReq, error: trErr } = await admin
      .from('transfer_requests').select('*').eq('id', requestId).single();
    if (trErr || !trReq) return json({ error: 'Request not found' }, 404);

    const { data: profile } = await admin
      .from('profiles').select('id, role').eq('id', user.id).single();
    if (!profile || profile.role !== 'owner') {
      return json({ error: 'Only owners can manage transfer requests' }, 403);
    }

    // -------- APPROVE --------
    if (action === 'approve') {
      if (trReq.status !== 'pending') return json({ error: 'Can only approve pending requests' }, 400);

      const { error: updErr } = await admin
        .from('transfer_requests')
        .update({ status: 'approved', approved_by: user.id, updated_at: new Date().toISOString() })
        .eq('id', requestId);
      if (updErr) return json({ error: updErr.message }, 500);

      const { data: items, error: itemsErr } = await admin
        .from('transfer_request_items').select('*').eq('request_id', requestId);
      if (itemsErr) return json({ error: itemsErr.message }, 500);

      for (const item of items || []) {
        const { error: itErr } = await admin
          .from('transfer_request_items')
          .update({ approved_quantity: item.requested_quantity })
          .eq('id', item.id);
        if (itErr) return json({ error: itErr.message }, 500);
      }

      return json({ success: true, message: 'Request approved' });
    }

    // -------- REJECT --------
    if (action === 'reject') {
      if (trReq.status !== 'pending') return json({ error: 'Can only reject pending requests' }, 400);

      const { error: updErr } = await admin
        .from('transfer_requests')
        .update({ status: 'rejected', approved_by: user.id, updated_at: new Date().toISOString() })
        .eq('id', requestId);
      if (updErr) return json({ error: updErr.message }, 500);

      return json({ success: true, message: 'Request rejected' });
    }

    // -------- FULFILL (atomic via RPC) --------
    if (action === 'fulfill') {
      if (trReq.status !== 'approved') {
        return json({ error: 'Can only fulfill approved requests' }, 400);
      }

      const { error: rpcErr } = await admin.rpc('fulfill_transfer_request', {
        p_request_id: requestId,
        p_user_id: user.id,
      });
      if (rpcErr) {
        return json({ error: rpcErr.message || 'Transfer fulfillment failed' }, 500);
      }

      // -------- Financial impact: balanced expense entries per branch --------
      try {
        const locIds = [trReq.source_location_id, trReq.requesting_location_id].filter(Boolean);
        const { data: locs } = await admin
          .from('locations')
          .select('id, branch_id')
          .in('id', locIds);
        const locMap: Record<string, string> = {};
        (locs || []).forEach((l: any) => { if (l.branch_id) locMap[l.id] = l.branch_id; });
        const sourceBranchId = trReq.source_location_id ? locMap[trReq.source_location_id] : null;
        const destBranchId = trReq.requesting_location_id ? locMap[trReq.requesting_location_id] : null;

        if (sourceBranchId && destBranchId) {
          const { data: items } = await admin
            .from('transfer_request_items')
            .select('medicine_id, approved_quantity, requested_quantity, new_batch_purchase_price')
            .eq('request_id', requestId);

          const rows = (items || []).filter((i: any) => Number(i.approved_quantity ?? i.requested_quantity) > 0);
          if (rows.length > 0) {
            const medIds = [...new Set(rows.map((r: any) => r.medicine_id))];

            // Cost basis per spec: source branch_items.purchase_price fallback
            const { data: srcItems } = await admin
              .from('branch_items')
              .select('medicine_id, purchase_price')
              .eq('branch_id', sourceBranchId)
              .in('medicine_id', medIds);
            const priceMap: Record<string, number> = {};
            (srcItems || []).forEach((s: any) => { priceMap[s.medicine_id] = Number(s.purchase_price || 0); });

            const { data: meds } = await admin
              .from('medicines')
              .select('id, name')
              .in('id', medIds);
            const nameMap: Record<string, string> = {};
            (meds || []).forEach((m: any) => { nameMap[m.id] = m.name; });

            let totalCost = 0;
            const lineDescriptions: string[] = [];
            for (const r of rows) {
              const qty = Number(r.approved_quantity ?? r.requested_quantity);
              const pp = Number(r.new_batch_purchase_price ?? priceMap[r.medicine_id] ?? 0);
              totalCost += qty * pp;
              lineDescriptions.push(`${nameMap[r.medicine_id] || 'Item'} × ${qty}`);
            }

            if (totalCost > 0) {
              const refId = String(requestId).slice(0, 8);
              const summary = lineDescriptions.slice(0, 3).join(', ') +
                (lineDescriptions.length > 3 ? `, +${lineDescriptions.length - 3} more` : '');
              await admin.from('expenses').insert([
                {
                  description: `Stock Transfer Out (Req #${refId}): ${summary}`,
                  amount: -totalCost,
                  category: 'Stock Transfer',
                  created_by: user.id,
                  branch_id: sourceBranchId,
                },
                {
                  description: `Stock Transfer In (Req #${refId}): ${summary}`,
                  amount: totalCost,
                  category: 'Stock Transfer',
                  created_by: user.id,
                  branch_id: destBranchId,
                },
              ]);
            }
          }
        }
      } catch (expErr) {
        console.error('Transfer expense recording failed:', expErr);
        // Do not fail the whole fulfillment if expense logging fails
      }

      return json({ success: true, message: 'Transfer fulfilled — stock and expenses updated' });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (error: any) {
    return json({ error: error?.message || 'Unexpected error' }, 500);
  }
});

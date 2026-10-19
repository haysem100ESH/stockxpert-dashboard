import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3.23.8";

const BodySchema = z.object({
  itemId: z.string().uuid(),
  cascade: z.boolean().default(false),
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return json({ error: "Missing Supabase environment configuration" }, 500);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Unauthorized" }, 401);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return json({ error: "Unauthorized" }, 401);
    }

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return json({ error: parsed.error.flatten().fieldErrors }, 400);
    }

    const { itemId, cascade } = parsed.data;
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id, role, branch_id")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError || !profile) {
      return json({ error: "Profile not found" }, 403);
    }

    const { data: item, error: itemError } = await admin
      .from("branch_items")
      .select("id, branch_id, medicine_id")
      .eq("id", itemId)
      .maybeSingle();

    if (itemError || !item) {
      return json({ error: "Inventory item not found" }, 404);
    }

    const { data: branch, error: branchError } = await admin
      .from("pharmacy_branches")
      .select("id, pharmacy_owner_id")
      .eq("id", item.branch_id)
      .maybeSingle();

    if (branchError || !branch) {
      return json({ error: "Branch not found" }, 404);
    }

    const isOwner = profile.role === "owner" && branch.pharmacy_owner_id === user.id;
    const isAssignedStaff = profile.role === "staff" && profile.branch_id === item.branch_id;

    if (!isOwner && !isAssignedStaff) {
      return json({ error: "Permission denied" }, 403);
    }

    if (profile.role === "staff") {
      const { data: permission, error: permissionError } = await admin
        .from("staff_permissions")
        .select("permission_level")
        .eq("staff_id", user.id)
        .eq("page_name", "inventory")
        .maybeSingle();

      if (permissionError) {
        return json({ error: "Could not verify staff permissions" }, 403);
      }

      if (permission?.permission_level === "read" || permission?.permission_level === "no_access") {
        return json({ error: "Inventory edit permission is required" }, 403);
      }
    }

    const { data: linkedSaleItems, error: saleItemsError } = await admin
      .from("sale_items")
      .select("id, sale_id")
      .eq("branch_item_id", itemId);

    if (saleItemsError) {
      throw new Error(`Could not inspect sale history: ${saleItemsError.message}`);
    }

    const saleIds = [...new Set((linkedSaleItems || []).map((row: any) => row.sale_id).filter(Boolean))];
    if (saleIds.length > 0 && !cascade) {
      return json({
        success: false,
        requiresCascade: true,
        saleCount: linkedSaleItems?.length || 0,
        message: "This item has sales history. Confirm cascade deletion first.",
      });
    }

    const deleted = {
      saleItems: linkedSaleItems?.length || 0,
      emptySales: 0,
      batches: 0,
      transferRequestItems: 0,
      branchItems: 0,
    };

    if (cascade && saleIds.length > 0) {
      const { error: deleteSaleItemsError } = await admin
        .from("sale_items")
        .delete()
        .eq("branch_item_id", itemId);

      if (deleteSaleItemsError) {
        throw new Error(`Could not delete sale item history: ${deleteSaleItemsError.message}`);
      }

      for (const saleId of saleIds) {
        const { data: remainingItems, error: remainingError } = await admin
          .from("sale_items")
          .select("id")
          .eq("sale_id", saleId)
          .limit(1);

        if (remainingError) continue;

        if (!remainingItems || remainingItems.length === 0) {
          const { error: deleteSaleError } = await admin
            .from("sales")
            .delete()
            .eq("id", saleId);

          if (!deleteSaleError) deleted.emptySales += 1;
        }
      }
    }

    const { data: batches } = await admin
      .from("inventory_batches")
      .select("id")
      .eq("branch_item_id", itemId);

    deleted.batches = batches?.length || 0;

    const { error: batchDeleteError } = await admin
      .from("inventory_batches")
      .delete()
      .eq("branch_item_id", itemId);

    if (batchDeleteError) {
      throw new Error(`Could not delete inventory batches: ${batchDeleteError.message}`);
    }

    const bestEffortDeletes: Array<{ table: string; column: string }> = [
      { table: "transfer_request_items", column: "branch_item_id" },
      { table: "transfer_request_items", column: "target_branch_item_id" },
    ];

    for (const target of bestEffortDeletes) {
      try {
        const { count, error } = await admin
          .from(target.table)
          .delete({ count: "exact" })
          .eq(target.column, itemId);

        if (!error) deleted.transferRequestItems += count || 0;
      } catch (_) {
        // Table or column may not exist in older deployments.
      }
    }

    const { error: itemDeleteError } = await admin
      .from("branch_items")
      .delete()
      .eq("id", itemId);

    if (itemDeleteError) {
      throw new Error(`Could not delete inventory item: ${itemDeleteError.message}`);
    }

    deleted.branchItems = 1;
    return json({ success: true, deleted });
  } catch (error: any) {
    console.error("delete-branch-item-cascade error:", error);
    return json({ error: error?.message || "Internal server error" }, 500);
  }
});

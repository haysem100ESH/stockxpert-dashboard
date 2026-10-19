import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Gemini Tool Declarations ────────────────────────────────────────────────
const TOOL_DECLARATIONS = [
  {
    name: "get_branches",
    description: "Get all branches/stores for this business owner, including names, types (pharmacy/general), and whether they are the main branch.",
    parameters: { type: "OBJECT", properties: {} },
  },
  {
    name: "get_inventory",
    description: "Get inventory/medicine items. Supports filtering by stock status, category, name search, and branch.",
    parameters: {
      type: "OBJECT",
      properties: {
        filter: { type: "STRING", enum: ["all", "low_stock", "out_of_stock"], description: "Stock filter. 'low_stock' = quantity at or below minimum level. 'out_of_stock' = zero quantity." },
        category: { type: "STRING", description: "Filter by category name (partial match)" },
        search: { type: "STRING", description: "Search items by name (partial match)" },
        branch_id: { type: "STRING", description: "Filter by specific branch ID" },
        limit: { type: "INTEGER", description: "Max results (default 50, max 500)" },
      },
    },
  },
  {
    name: "get_expiring_items",
    description: "Get items/medicines that are expiring within a specified number of days, or already expired. Only relevant for branches with expiry tracking.",
    parameters: {
      type: "OBJECT",
      properties: {
        days_ahead: { type: "INTEGER", description: "Days to look ahead for expiry (default 30). Use 0 for already expired." },
        branch_id: { type: "STRING", description: "Filter by branch ID" },
        include_expired: { type: "BOOLEAN", description: "Also include already expired items (default false)" },
      },
    },
  },
  {
    name: "get_sales",
    description: "Get sales transactions and revenue summary for a time period.",
    parameters: {
      type: "OBJECT",
      properties: {
        period: { type: "STRING", enum: ["today", "week", "month", "custom"], description: "Time period" },
        days_back: { type: "INTEGER", description: "Days back when period is 'custom'" },
        branch_id: { type: "STRING", description: "Filter by branch ID" },
        include_items: { type: "BOOLEAN", description: "Include individual sale item details (default false)" },
      },
    },
  },
  {
    name: "get_top_sellers",
    description: "Get the top selling items by quantity sold in a given period.",
    parameters: {
      type: "OBJECT",
      properties: {
        days_back: { type: "INTEGER", description: "Period in days (default 30)" },
        limit: { type: "INTEGER", description: "Number of top items (default 10)" },
      },
    },
  },
  {
    name: "get_customers",
    description: "Get customer list with optional debt filter. Use filter 'with_debt' to see who owes money.",
    parameters: {
      type: "OBJECT",
      properties: {
        filter: { type: "STRING", enum: ["all", "with_debt"], description: "'with_debt' shows only customers who owe money." },
        search: { type: "STRING", description: "Search by customer name" },
        branch_id: { type: "STRING", description: "Filter by branch" },
        limit: { type: "INTEGER", description: "Max results (default 50)" },
      },
    },
  },
  {
    name: "get_customer_payments",
    description: "Get recent customer debt payments.",
    parameters: {
      type: "OBJECT",
      properties: {
        days_back: { type: "INTEGER", description: "Period in days (default 30)" },
        customer_id: { type: "STRING", description: "Filter by specific customer" },
        branch_id: { type: "STRING", description: "Filter by branch" },
      },
    },
  },
  {
    name: "get_suppliers",
    description: "Get supplier list. Use filter 'with_debt' to see suppliers we owe money to.",
    parameters: {
      type: "OBJECT",
      properties: {
        filter: { type: "STRING", enum: ["all", "with_debt"], description: "'with_debt' shows only suppliers with outstanding debt." },
        search: { type: "STRING", description: "Search by supplier name" },
        branch_id: { type: "STRING", description: "Filter by branch" },
      },
    },
  },
  {
    name: "get_supplier_purchases",
    description: "Get recent purchases from suppliers.",
    parameters: {
      type: "OBJECT",
      properties: {
        days_back: { type: "INTEGER", description: "Period in days (default 90)" },
        supplier_id: { type: "STRING", description: "Filter by specific supplier" },
        branch_id: { type: "STRING", description: "Filter by branch" },
        limit: { type: "INTEGER", description: "Max results (default 50)" },
      },
    },
  },
  {
    name: "get_supplier_payments",
    description: "Get recent payments made to suppliers.",
    parameters: {
      type: "OBJECT",
      properties: {
        days_back: { type: "INTEGER", description: "Period in days (default 90)" },
        supplier_id: { type: "STRING", description: "Filter by specific supplier" },
        branch_id: { type: "STRING", description: "Filter by branch" },
      },
    },
  },
  {
    name: "get_expenses",
    description: "Get expense records.",
    parameters: {
      type: "OBJECT",
      properties: {
        days_back: { type: "INTEGER", description: "Period in days (default 30)" },
        category: { type: "STRING", description: "Filter by expense category" },
        branch_id: { type: "STRING", description: "Filter by branch" },
      },
    },
  },
  {
    name: "get_stock_adjustments",
    description: "Get stock adjustment history (increases/decreases).",
    parameters: {
      type: "OBJECT",
      properties: {
        days_back: { type: "INTEGER", description: "Period in days (default 30)" },
        branch_id: { type: "STRING", description: "Filter by branch" },
      },
    },
  },
  {
    name: "get_transfers",
    description: "Get item/medicine transfer history between branches.",
    parameters: {
      type: "OBJECT",
      properties: {
        days_back: { type: "INTEGER", description: "Period in days (default 30)" },
      },
    },
  },
  {
    name: "get_locations",
    description: "Get storage locations (warehouses, pharmacies, stores).",
    parameters: {
      type: "OBJECT",
      properties: {
        branch_id: { type: "STRING", description: "Filter by branch" },
      },
    },
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resolveBranch(items: any[], bMap: Record<string, string>) {
  return items.map((item) => {
    const r: any = { ...item };
    if (item.branch_id && bMap[item.branch_id]) r.branch_name = bMap[item.branch_id];
    if (item.from_branch_id && bMap[item.from_branch_id]) r.from_branch_name = bMap[item.from_branch_id];
    if (item.to_branch_id && bMap[item.to_branch_id]) r.to_branch_name = bMap[item.to_branch_id];
    return r;
  });
}

async function buildNameMap(db: any, table: string, branchIds: string[]) {
  let q = db.from(table).select("id, name").limit(2000);
  if (branchIds?.length) q = q.in("branch_id", branchIds);
  const { data } = await q;
  const map: Record<string, string> = {};
  for (const row of data || []) map[row.id] = row.name;
  return map;
}

// ─── Tool Execution ──────────────────────────────────────────────────────────

interface ToolContext {
  branchIds: string[];
  branchMap: Record<string, string>;
  pharmacyOwnerId: string;
  branchType: string;
}

async function executeTool(db: any, name: string, args: any, ctx: ToolContext) {
  const { branchIds, branchMap, pharmacyOwnerId } = ctx;

  const applyBranch = (query: any, specific?: string) => {
    if (specific) return query.eq("branch_id", specific);
    if (branchIds?.length) return query.in("branch_id", branchIds);
    return query;
  };

  switch (name) {
    // ── Branches ──
    case "get_branches": {
      const { data } = await db
        .from("pharmacy_branches")
        .select("id, name, branch_type, is_main_branch, address, phone")
        .eq("pharmacy_owner_id", pharmacyOwnerId);
      return { branches: data || [], total: (data || []).length };
    }

    // ── Inventory ──
    case "get_inventory": {
      const limit = Math.min(args?.limit || 50, 500);
      let q = db
        .from("medicines")
        .select("id, name, generic_name, category, manufacturer, batch_number, purchase_price, selling_price, stock_quantity, minimum_stock_level, expiry_date, branch_id, units_per_pack, open_pack_units, unit_label, item_type, country_name");
      q = applyBranch(q, args?.branch_id);
      if (args?.filter === "out_of_stock") q = q.lte("stock_quantity", 0);
      if (args?.category) q = q.ilike("category", `%${args.category}%`);
      if (args?.search) q = q.ilike("name", `%${args.search}%`);
      q = q.order("stock_quantity", { ascending: true }).limit(args?.filter === "low_stock" ? 500 : limit);

      const { data } = await q;
      let items = data || [];
      if (args?.filter === "low_stock") {
        items = items.filter((i: any) => i.stock_quantity > 0 && i.stock_quantity <= i.minimum_stock_level).slice(0, limit);
      }
      return { items: resolveBranch(items, branchMap), total: items.length };
    }

    // ── Expiring Items ──
    case "get_expiring_items": {
      const days = args?.days_ahead ?? 30;
      const now = new Date();
      const today = now.toISOString().split("T")[0];
      const future = new Date(now.getTime() + days * 86400000).toISOString().split("T")[0];

      let q = db.from("medicines").select("id, name, stock_quantity, expiry_date, selling_price, branch_id, category");
      q = applyBranch(q, args?.branch_id);
      q = q.gt("stock_quantity", 0);
      if (args?.include_expired) {
        q = q.lte("expiry_date", future);
      } else {
        q = q.gte("expiry_date", today).lte("expiry_date", future);
      }
      q = q.order("expiry_date", { ascending: true }).limit(100);
      const { data } = await q;
      return { items: resolveBranch(data || [], branchMap), total: (data || []).length };
    }

    // ── Sales ──
    case "get_sales": {
      const now = new Date();
      const today = now.toISOString().split("T")[0];
      let start: string;
      switch (args?.period) {
        case "today":  start = `${today}T00:00:00`; break;
        case "week":   start = new Date(now.getTime() - 7 * 86400000).toISOString(); break;
        case "custom": start = new Date(now.getTime() - (args?.days_back || 30) * 86400000).toISOString(); break;
        default:       start = new Date(now.getTime() - 30 * 86400000).toISOString(); break;
      }

      let q = db
        .from("sales")
        .select("id, total_amount, payment_method, created_at, branch_id, customer_id, amount_paid, payment_status, discount_amount, extra_profit")
        .gte("created_at", start);
      if (args?.period === "today") q = q.lte("created_at", `${today}T23:59:59`);
      q = applyBranch(q, args?.branch_id);
      q = q.order("created_at", { ascending: false }).limit(500);

      const { data } = await q;
      const sales = data || [];
      const revenue = sales.reduce((s: number, x: any) => s + Number(x.total_amount || 0), 0);
      const discount = sales.reduce((s: number, x: any) => s + Number(x.discount_amount || 0), 0);
      const extra = sales.reduce((s: number, x: any) => s + Number(x.extra_profit || 0), 0);
      const credit = sales.filter((x: any) => x.payment_status === "credit" || x.payment_status === "partial");
      const methods: Record<string, number> = {};
      for (const s of sales) methods[s.payment_method || "unknown"] = (methods[s.payment_method || "unknown"] || 0) + 1;

      const result: any = {
        total_transactions: sales.length,
        total_revenue: revenue.toFixed(2),
        total_discount: discount.toFixed(2),
        total_extra_profit: extra.toFixed(2),
        credit_sales_count: credit.length,
        credit_sales_amount: credit.reduce((s: number, x: any) => s + Number(x.total_amount || 0), 0).toFixed(2),
        payment_methods: methods,
        period: args?.period || "month",
      };

      if (args?.include_items && sales.length > 0) {
        const ids = sales.slice(0, 100).map((s: any) => s.id);
        const { data: si } = await db.from("sale_items").select("medicine_id, quantity, unit_price, total_price, sale_type").in("sale_id", ids);
        const mMap = await buildNameMap(db, "medicines", branchIds);
        result.items = (si || []).map((x: any) => ({ ...x, item_name: mMap[x.medicine_id] || x.medicine_id }));
      }
      return result;
    }

    // ── Top Sellers ──
    case "get_top_sellers": {
      const days = args?.days_back || 30;
      const limit = args?.limit || 10;
      const since = new Date(Date.now() - days * 86400000).toISOString();
      let siQ = db.from("sale_items").select("medicine_id, quantity, total_price, branch_id").gte("created_at", since).limit(5000);
      siQ = applyBranch(siQ);
      const { data } = await siQ;

      // Restrict medicine name lookup to owner's branches
      const uniqueMedIds = [...new Set((data || []).map((si: any) => si.medicine_id).filter(Boolean))];
      const mMap: Record<string, string> = {};
      if (uniqueMedIds.length > 0) {
        for (let i = 0; i < uniqueMedIds.length; i += 200) {
          const batch = uniqueMedIds.slice(i, i + 200);
          let mq = db.from("medicines").select("id, name, branch_id").in("id", batch);
          if (branchIds?.length) mq = mq.in("branch_id", branchIds);
          const { data: meds } = await mq;
          for (const m of meds || []) mMap[m.id] = m.name;
        }
      }

      const stats: Record<string, { name: string; qty: number; revenue: number }> = {};
      for (const si of data || []) {
        if (!mMap[si.medicine_id]) continue; // skip items outside owner's branches
        const n = mMap[si.medicine_id];
        if (!stats[si.medicine_id]) stats[si.medicine_id] = { name: n, qty: 0, revenue: 0 };
        stats[si.medicine_id].qty += Number(si.quantity);
        stats[si.medicine_id].revenue += Number(si.total_price);
      }
      return { top_sellers: Object.values(stats).sort((a, b) => b.qty - a.qty).slice(0, limit), period_days: days };
    }

    // ── Customers ──
    case "get_customers": {
      const limit = Math.min(args?.limit || 50, 200);
      let q = db.from("customers").select("id, name, phone, credit_score, branch_id, notes");
      q = applyBranch(q, args?.branch_id);
      if (args?.search) q = q.ilike("name", `%${args.search}%`);
      q = q.limit(limit);
      const { data: customers } = await q;

      if (args?.filter === "with_debt") {
        let cq = db.from("customer_credits").select("customer_id, total_debt, branch_id").gt("total_debt", 0).order("total_debt", { ascending: false });
        cq = applyBranch(cq, args?.branch_id);
        const { data: credits } = await cq;
        const debtMap: Record<string, number> = {};
        for (const c of credits || []) debtMap[c.customer_id] = Number(c.total_debt);
        const withDebt = (customers || []).filter((c: any) => debtMap[c.id]).map((c: any) => ({ ...c, total_debt: debtMap[c.id], branch_name: branchMap[c.branch_id] }));
        return { customers: withDebt, total: withDebt.length, total_debt: Object.values(debtMap).reduce((s, d) => s + d, 0).toFixed(2) };
      }
      return { customers: resolveBranch(customers || [], branchMap), total: (customers || []).length };
    }

    // ── Customer Payments ──
    case "get_customer_payments": {
      const since = new Date(Date.now() - (args?.days_back || 30) * 86400000).toISOString();
      let q = db.from("customer_payments").select("id, customer_id, amount, payment_method, branch_id, created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(100);
      if (args?.customer_id) q = q.eq("customer_id", args.customer_id);
      q = applyBranch(q, args?.branch_id);
      const { data } = await q;
      const cMap = await buildNameMap(db, "customers", branchIds);
      const payments = (data || []).map((p: any) => ({ ...p, customer_name: cMap[p.customer_id] || "Unknown", branch_name: branchMap[p.branch_id] }));
      return { payments, total: payments.length, total_amount: payments.reduce((s: number, p: any) => s + Number(p.amount), 0).toFixed(2) };
    }

    // ── Suppliers ──
    case "get_suppliers": {
      let q = db.from("suppliers").select("id, name, contact_person, phone, email, address, branch_id");
      q = applyBranch(q, args?.branch_id);
      if (args?.search) q = q.ilike("name", `%${args.search}%`);
      q = q.limit(100);
      const { data: suppliers } = await q;

      if (args?.filter === "with_debt") {
        let dq = db.from("supplier_debts").select("supplier_id, total_debt, branch_id").gt("total_debt", 0);
        dq = applyBranch(dq, args?.branch_id);
        const { data: debts } = await dq;
        const debtMap: Record<string, number> = {};
        for (const d of debts || []) debtMap[d.supplier_id] = Number(d.total_debt);
        const withDebt = (suppliers || []).filter((s: any) => debtMap[s.id]).map((s: any) => ({ ...s, total_debt: debtMap[s.id], branch_name: branchMap[s.branch_id] }));
        return { suppliers: withDebt, total: withDebt.length, total_debt: Object.values(debtMap).reduce((s, d) => s + d, 0).toFixed(2) };
      }
      return { suppliers: resolveBranch(suppliers || [], branchMap), total: (suppliers || []).length };
    }

    // ── Supplier Purchases ──
    case "get_supplier_purchases": {
      const since = new Date(Date.now() - (args?.days_back || 90) * 86400000).toISOString();
      let q = db.from("supplier_purchases").select("id, supplier_id, item_name, quantity, unit_cost, total_cost, payment_type, branch_id, created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(Math.min(args?.limit || 50, 200));
      if (args?.supplier_id) q = q.eq("supplier_id", args.supplier_id);
      q = applyBranch(q, args?.branch_id);
      const { data } = await q;
      const sMap = await buildNameMap(db, "suppliers", branchIds);
      const purchases = (data || []).map((p: any) => ({ ...p, supplier_name: sMap[p.supplier_id] || p.supplier_id, branch_name: branchMap[p.branch_id] }));
      return { purchases, total: purchases.length, total_cost: purchases.reduce((s: number, p: any) => s + Number(p.total_cost), 0).toFixed(2) };
    }

    // ── Supplier Payments ──
    case "get_supplier_payments": {
      const since = new Date(Date.now() - (args?.days_back || 90) * 86400000).toISOString();
      let q = db.from("supplier_payments").select("id, supplier_id, amount, payment_method, branch_id, created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(100);
      if (args?.supplier_id) q = q.eq("supplier_id", args.supplier_id);
      q = applyBranch(q, args?.branch_id);
      const { data } = await q;
      const sMap = await buildNameMap(db, "suppliers", branchIds);
      const payments = (data || []).map((p: any) => ({ ...p, supplier_name: sMap[p.supplier_id] || "Unknown", branch_name: branchMap[p.branch_id] }));
      return { payments, total: payments.length, total_amount: payments.reduce((s: number, p: any) => s + Number(p.amount), 0).toFixed(2) };
    }

    // ── Expenses ──
    case "get_expenses": {
      const since = new Date(Date.now() - (args?.days_back || 30) * 86400000).toISOString();
      let q = db.from("expenses").select("id, description, amount, category, created_at, branch_id").gte("created_at", since).order("created_at", { ascending: false }).limit(100);
      if (args?.category) q = q.ilike("category", `%${args.category}%`);
      q = applyBranch(q, args?.branch_id);
      const { data } = await q;
      const expenses = resolveBranch(data || [], branchMap);
      return { expenses, total: expenses.length, total_amount: expenses.reduce((s: number, e: any) => s + Number(e.amount), 0).toFixed(2) };
    }

    // ── Stock Adjustments ──
    case "get_stock_adjustments": {
      const since = new Date(Date.now() - (args?.days_back || 30) * 86400000).toISOString();
      let q = db.from("inventory_stock_adjustments").select("id, medicine_id, adjustment_type, quantity, reason, branch_id, created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(50);
      q = applyBranch(q, args?.branch_id);
      const { data } = await q;
      const mMap = await buildNameMap(db, "medicines", branchIds);
      const adj = (data || []).map((a: any) => ({ ...a, item_name: mMap[a.medicine_id] || a.medicine_id, branch_name: branchMap[a.branch_id] }));
      return { adjustments: adj, total: adj.length };
    }

    // ── Transfers ──
    case "get_transfers": {
      const since = new Date(Date.now() - (args?.days_back || 30) * 86400000).toISOString();
      let q = db.from("medicine_transfers").select("id, medicine_id, from_branch_id, to_branch_id, quantity, created_at, notes").gte("created_at", since).order("created_at", { ascending: false }).limit(50);
      if (branchIds?.length) q = q.or(`from_branch_id.in.(${branchIds.join(",")}),to_branch_id.in.(${branchIds.join(",")})`);
      const { data } = await q;
      const mMap = await buildNameMap(db, "medicines", branchIds);
      const transfers = (data || []).map((t: any) => ({ ...t, item_name: mMap[t.medicine_id] || "Unknown", from_branch_name: branchMap[t.from_branch_id], to_branch_name: branchMap[t.to_branch_id] }));
      return { transfers, total: transfers.length };
    }

    // ── Locations ──
    case "get_locations": {
      let q = db.from("locations").select("id, name, type, address, branch_id").limit(50);
      q = applyBranch(q, args?.branch_id);
      const { data } = await q;
      return { locations: resolveBranch(data || [], branchMap), total: (data || []).length };
    }


    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ─── Main Handler ────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization header");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabaseAuth = createClient(supabaseUrl, supabaseServiceKey);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(token);
    if (authError || !user) throw new Error("Unauthorized");

    const { data: profile } = await supabaseAuth
      .from("profiles")
      .select("role, branch_id, full_name, gemini_api_key")
      .eq("id", user.id)
      .single();
    if (!profile) throw new Error("Profile not found");

    // Determine pharmacy owner to fetch their API key
    let ownerIdForKey = user.id;
    if (profile.role === "staff" && profile.branch_id) {
      const { data: ob } = await supabaseAuth.from("pharmacy_branches").select("pharmacy_owner_id").eq("id", profile.branch_id).single();
      if (ob) ownerIdForKey = ob.pharmacy_owner_id;
    }

    // Prioritize owner's profile API key, then fall back to env variable
    let geminiApiKey = profile.gemini_api_key;
    if (!geminiApiKey && ownerIdForKey !== user.id) {
      const { data: ownerProfile } = await supabaseAuth
        .from("profiles")
        .select("gemini_api_key")
        .eq("id", ownerIdForKey)
        .single();
      geminiApiKey = ownerProfile?.gemini_api_key;
    }
    if (!geminiApiKey) geminiApiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiApiKey) throw new Error("GEMINI_API_KEY is not configured. Please add your Gemini API key in settings.");

    const { messages, branchIds, branchType } = await req.json();
    const db = createClient(supabaseUrl, supabaseServiceKey);

    // Reuse owner ID already resolved for API key lookup
    const pharmacyOwnerId = ownerIdForKey;

    // Branch map (owner-filtered)
    const { data: branches } = await db
      .from("pharmacy_branches")
      .select("id, name, branch_type, is_main_branch")
      .eq("pharmacy_owner_id", pharmacyOwnerId);
    const branchMap: Record<string, string> = {};
    for (const b of branches || []) branchMap[b.id] = b.name;

    const ItemLabel = branchType === "pharmacy" ? "Medicine" : "Item";
    const branchList = (branches || [])
      .map((b: any) => `${b.name} (${b.branch_type}, ${b.is_main_branch ? "main" : "sub"}, ID: ${b.id})`)
      .join(", ");

    const systemPrompt = `You are StockXpert AI, a Smart Assistant for ${branchType === "pharmacy" ? "PharmaXpert (Pharmacy Management)" : "StockXpert (Inventory Management)"}.
User: ${profile.full_name} (Role: ${profile.role})
${profile.role === "staff" ? "Note: This user is staff. Do not reveal owner-only financial details like profit margins or purchase prices." : ""}

Available Branches (${(branches || []).length} total): ${branchList}
Currently querying branches: ${branchIds?.length ? branchIds.map((id: string) => branchMap[id] || id).join(", ") : "All branches"}

You have database query tools. USE THEM to answer data questions — never guess or make up numbers.

RULES:
- Call the appropriate tool(s) before answering data questions. You can call multiple tools in parallel.
- Use "${ItemLabel}" instead of generic terms ("medicine" for pharmacy, "item" for general).
- Always show branch names (not IDs).
- NEVER display raw UUIDs or internal IDs (id, branch_id, customer_id, supplier_id, medicine_id, sale_id, etc.) in your response. Use human-readable names only. If a name is unavailable, write "Unknown" — do not show the UUID.
- All data returned by tools is already scoped to this user's business. Do not invent or reference data from other businesses/pharmacies.
- Format with markdown, bullet points, and **bold** for key numbers.
- Add "💡 AI Insight" with actionable recommendations when relevant.
- Low stock = stock_quantity <= minimum_stock_level (NOT a hardcoded number).
- If a question can't be answered with available tools, say so clearly.
- Be concise and actionable.
- NEVER ask the user to clarify vague questions like "best suppliers" or "top suppliers". Instead, proactively call get_suppliers, get_supplier_purchases, and get_supplier_payments in parallel, then rank suppliers by a composite score: total purchase volume (40%), payment reliability (30%), number of transactions (20%), and lowest outstanding debt ratio (10%). Present a ranked list with scores and reasoning.
- For any ranking/comparison question, always fetch the data first and compute the answer yourself. Do NOT ask the user what criteria to use.`;

    // Convert messages to Gemini format
    const geminiContents: any[] = [];
    for (const msg of messages || []) {
      geminiContents.push({
        role: msg.role === "assistant" ? "model" : "user",
        parts: [{ text: msg.content }],
      });
    }

    const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash";

    // ── Step 1: Non-streaming call with tools ──
    const step1 = await fetch(`${GEMINI_BASE}:generateContent?key=${geminiApiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: geminiContents,
        tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
        toolConfig: { functionCallingConfig: { mode: "AUTO" } },
        generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
      }),
    });

    if (!step1.ok) {
      const err = await step1.text();
      console.error("Gemini step 1 error:", step1.status, err);
      const isRateLimit = step1.status === 429;
      return new Response(JSON.stringify({ error: isRateLimit ? "Rate limit exceeded. Please try again later." : `AI error: ${step1.status}` }), {
        status: isRateLimit ? 429 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const step1Result = await step1.json();
    const parts = step1Result.candidates?.[0]?.content?.parts || [];
    const fnCalls = parts.filter((p: any) => p.functionCall);

    // ── No tool calls → return text directly ──
    if (fnCalls.length === 0) {
      const text = parts.map((p: any) => p.text || "").join("");
      const sse = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`;
      return new Response(sse, {
        headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
      });
    }

    // ── Step 2: Execute tool calls in parallel ──
    const ctx: ToolContext = { branchIds, branchMap, pharmacyOwnerId, branchType };
    const toolResults = await Promise.all(
      fnCalls.map(async (fc: any) => {
        const { name, args } = fc.functionCall;
        console.log(`Tool: ${name}`, JSON.stringify(args));
        try {
          const result = await executeTool(db, name, args || {}, ctx);
          return { name, result };
        } catch (e) {
          console.error(`Tool ${name} error:`, e);
          return { name, result: { error: `Failed to execute ${name}` } };
        }
      })
    );

    // ── Step 3: Stream final response with tool results ──
    const fullContents = [
      ...geminiContents,
      { role: "model", parts: fnCalls.map((fc: any) => ({ functionCall: fc.functionCall })) },
      { role: "user", parts: toolResults.map((tr) => ({ functionResponse: { name: tr.name, response: { result: tr.result } } })) },
    ];

    const step3 = await fetch(`${GEMINI_BASE}:streamGenerateContent?alt=sse&key=${geminiApiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: fullContents,
        generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
      }),
    });

    if (!step3.ok) {
      const err = await step3.text();
      console.error("Gemini step 3 error:", step3.status, err);
      const isRateLimit = step3.status === 429;
      return new Response(JSON.stringify({ error: isRateLimit ? "Rate limit exceeded. Please try again later." : `AI error: ${step3.status}` }), {
        status: isRateLimit ? 429 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Transform Gemini SSE → OpenAI-compatible SSE
    const transform = new TransformStream({
      transform(chunk, controller) {
        const text = new TextDecoder().decode(chunk);
        for (const line of text.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6).trim();
          if (!json) continue;
          try {
            const parsed = JSON.parse(json);
            const content = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
            if (content) {
              controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`));
            }
          } catch { /* skip partial */ }
        }
      },
      flush(controller) {
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
      },
    });

    return new Response(step3.body!.pipeThrough(transform), {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("smart-assistant error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

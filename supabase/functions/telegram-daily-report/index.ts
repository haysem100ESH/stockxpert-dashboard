import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

async function sendTelegramMessage(chatId: string, text: string) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  });
  if (!response.ok) {
    const error = await response.text();
    console.error(`Failed to send message to ${chatId}:`, error);
    throw new Error(`Telegram API error: ${error}`);
  }
  return await response.json();
}

function formatNumber(num: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(num);
}

async function getDebtorsSummary(supabase: any, branchId: string): Promise<string> {
  // Use customer_credits table for fast debt lookup
  const { data: credits, error: credErr } = await supabase
    .from('customer_credits')
    .select('customer_id, total_debt')
    .eq('branch_id', branchId)
    .gt('total_debt', 0);

  if (credErr) {
    console.error('Error fetching customer_credits:', credErr);
    return '';
  }
  if (!credits || credits.length === 0) return '\n📌 No outstanding debts 🎉\n';

  const customerIds = credits.map((c: any) => c.customer_id);
  const { data: customers } = await supabase
    .from('customers')
    .select('id, name, phone')
    .in('id', customerIds);

  const customerMap: Record<string, { name: string; phone: string | null }> = {};
  for (const c of customers || []) {
    customerMap[c.id] = { name: c.name, phone: c.phone };
  }

  const debtors = credits
    .map((c: any) => ({
      name: customerMap[c.customer_id]?.name || 'Unknown',
      phone: customerMap[c.customer_id]?.phone || null,
      debt: Number(c.total_debt),
    }))
    .sort((a: any, b: any) => b.debt - a.debt);

  let section = '\n📌 *Outstanding Debtors:*\n\n';
  debtors.forEach((c: any, i: number) => {
    section += `${i + 1}. ${c.name}\n`;
    section += `   📞 ${c.phone || 'N/A'}\n`;
    section += `   💰 Total Debt: ${formatNumber(c.debt)} ETB\n\n`;
  });
  return section;
}

async function getInventoryAlerts(supabase: any, branchId: string): Promise<string> {
  const today = new Date().toISOString().split('T')[0];
  const thirtyDaysLater = new Date();
  thirtyDaysLater.setDate(thirtyDaysLater.getDate() + 30);
  const thirtyDaysStr = thirtyDaysLater.toISOString().split('T')[0];

  // Low stock (stock > 0 but <= minimum)
  const { data: lowStock } = await supabase
    .from('medicines')
    .select('name, stock_quantity, minimum_stock_level')
    .eq('branch_id', branchId)
    .gt('stock_quantity', 0)
    .not('minimum_stock_level', 'is', null)
    .order('stock_quantity', { ascending: true });

  const lowStockItems = (lowStock || []).filter((m: any) => m.stock_quantity <= (m.minimum_stock_level || 0));

  // Out of stock
  const { data: outOfStock } = await supabase
    .from('medicines')
    .select('name')
    .eq('branch_id', branchId)
    .eq('stock_quantity', 0);

  // Expired
  const { data: expired } = await supabase
    .from('medicines')
    .select('name, expiry_date')
    .eq('branch_id', branchId)
    .gt('stock_quantity', 0)
    .lt('expiry_date', today)
    .order('expiry_date', { ascending: true });

  // Expiring soon (within 30 days, not yet expired)
  const { data: expiringSoon } = await supabase
    .from('medicines')
    .select('name, expiry_date')
    .eq('branch_id', branchId)
    .gt('stock_quantity', 0)
    .gte('expiry_date', today)
    .lte('expiry_date', thirtyDaysStr)
    .order('expiry_date', { ascending: true });

  const hasAlerts = lowStockItems.length > 0 || (outOfStock?.length || 0) > 0 || (expired?.length || 0) > 0 || (expiringSoon?.length || 0) > 0;

  if (!hasAlerts) {
    return '\n📦 Inventory Status: All Good ✅\n';
  }

  let section = '\n📦 *Inventory Alerts:*\n';

  if (outOfStock && outOfStock.length > 0) {
    section += '\n❌ *Out of Stock:*\n';
    outOfStock.forEach((m: any) => { section += `- ${m.name}\n`; });
  }

  if (lowStockItems.length > 0) {
    section += '\n⚠ *Low Stock:*\n';
    lowStockItems.forEach((m: any) => { section += `- ${m.name} (${m.stock_quantity} left)\n`; });
  }

  if (expiringSoon && expiringSoon.length > 0) {
    section += '\n⏳ *Expiry Soon:*\n';
    expiringSoon.forEach((m: any) => { section += `- ${m.name} (Exp: ${m.expiry_date})\n`; });
  }

  if (expired && expired.length > 0) {
    section += '\n🛑 *Expired:*\n';
    expired.forEach((m: any) => { section += `- ${m.name} (Expired: ${m.expiry_date})\n`; });
  }

  return section;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (!TELEGRAM_BOT_TOKEN) {
      return new Response(
        JSON.stringify({ error: 'TELEGRAM_BOT_TOKEN environment variable is not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    
    const requestBody = await req.text();
    let ownerIds: string[] | null = null;
    if (requestBody) {
      try { ownerIds = JSON.parse(requestBody).ownerIds || null; } catch (_e) {}
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const todayStr = today.toISOString();
    const tomorrowStr = tomorrow.toISOString();

    let query = supabase
      .from('profiles')
      .select('id, full_name, telegram_chat_id, role')
      .not('telegram_chat_id', 'is', null)
      .eq('role', 'owner');
    
    if (ownerIds && ownerIds.length > 0) query = query.in('id', ownerIds);
    const { data: profiles, error: profilesError } = await query;

    if (profilesError) throw profilesError;
    if (!profiles || profiles.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'No profiles to send reports to', reports_delivered: 0 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const results = [];

    for (const profile of profiles) {
      try {
        const { data: branches } = await supabase
          .from('pharmacy_branches')
          .select('id, name, branch_type')
          .eq('pharmacy_owner_id', profile.id);

        if (!branches || branches.length === 0) continue;

        for (const branch of branches) {
          try {
            const isPharmacy = branch.branch_type === 'pharmacy';
            const botName = isPharmacy ? 'PharmaXpert Bot' : 'StockXpert Bot';
            const reportTitle = isPharmacy ? '📊 *Daily Pharmacy Report* 🧾' : '📊 *Daily Inventory Report* 🧾';

            const { data: sales } = await supabase
              .from('sales')
              .select('id, total_amount, created_at, sale_items(medicine_id, quantity, unit_price, total_price, sale_type, stripes_sold, medicines(id, name, unit_label, units_per_pack))')
              .eq('branch_id', branch.id)
              .gte('created_at', todayStr)
              .lt('created_at', tomorrowStr);

            const { data: expenses } = await supabase
              .from('expenses')
              .select('amount')
              .eq('branch_id', branch.id)
              .gte('created_at', todayStr)
              .lt('created_at', tomorrowStr);

            const totalIncome = sales?.reduce((sum: number, s: any) => sum + (s.total_amount || 0), 0) || 0;
            const totalExpense = expenses?.reduce((sum: number, e: any) => sum + (e.amount || 0), 0) || 0;

            // Build packaging map for medicines in these sales
            const medIds = Array.from(new Set(
              (sales || []).flatMap((s: any) => s.sale_items || [])
                .map((si: any) => si.medicine_id || si.medicines?.id).filter(Boolean)
            )) as string[];
            const pkgMap: Record<string, any> = {};
            if (medIds.length > 0) {
              const { data: pkgRows } = await supabase
                .from('medicine_packaging').select('*').in('medicine_id', medIds);
              (pkgRows || []).forEach((p: any) => { pkgMap[p.medicine_id] = p; });
            }

            const approxEq = (a: number, b: number) => Math.abs(a - b) < 0.01;
            const inferLevel = (si: any, pkg: any): 'unit' | 'strip' | 'pack' => {
              if (si?.sale_type === 'by_stripe') return 'unit';
              const price = Number(si?.unit_price || 0);
              if (pkg) {
                if (pkg.pack_enabled && pkg.pack_selling_price && approxEq(price, Number(pkg.pack_selling_price))) return 'pack';
                if (pkg.strip_enabled && pkg.strip_selling_price && approxEq(price, Number(pkg.strip_selling_price))) return 'strip';
                if (pkg.unit_selling_price && approxEq(price, Number(pkg.unit_selling_price))) return 'unit';
              }
              return 'pack';
            };
            const plural = (label: string, n: number) => {
              const s = (label || 'unit').trim() || 'unit';
              if (Math.abs(n - 1) < 1e-9) return s;
              return /(s|x|z|ch|sh)$/i.test(s) ? `${s}es` : `${s}s`;
            };

            type Bucket = { qty: number; baseUnits: number; total: number; levelLabel: string; baseLabel: string };
            const medicineSales: Record<string, { unit?: Bucket; strip?: Bucket; pack?: Bucket }> = {};
            let itemsSoldNumber = 0;

            for (const sale of sales || []) {
              for (const item of sale.sale_items || []) {
                const med = item.medicines as any;
                const medObj = Array.isArray(med) ? med[0] : med;
                const name = medObj?.name || 'Unknown';
                const medId = item.medicine_id || medObj?.id;
                const pkg = medId ? pkgMap[medId] : null;
                const level = inferLevel(item, pkg);
                let qty: number;
                if (item.sale_type === 'by_stripe') {
                  const raw = Number(item.stripes_sold || item.quantity || 0);
                  qty = raw >= 100 ? raw / 1000 : raw;
                } else {
                  qty = Number(item.quantity || 0);
                }
                const ups = Number(pkg?.units_per_strip || 0);
                const spp = Number(pkg?.strips_per_pack || 0);
                const unitsPerPack = (ups && spp) ? ups * spp : Number(medObj?.units_per_pack || 1);
                const baseUnits = level === 'unit' ? qty : level === 'strip' ? qty * (ups || 1) : qty * (unitsPerPack || 1);
                const unitName = pkg?.unit_name || medObj?.unit_label || 'tablet';
                const stripName = pkg?.strip_name || 'strip';
                const packName = pkg?.pack_name || 'pack';
                const levelLabel = level === 'unit' ? unitName : level === 'strip' ? stripName : packName;

                if (!medicineSales[name]) medicineSales[name] = {};
                const bucket = medicineSales[name][level] || { qty: 0, baseUnits: 0, total: 0, levelLabel, baseLabel: unitName };
                bucket.qty += qty;
                bucket.baseUnits += baseUnits;
                bucket.total += Number(item.total_price || 0);
                bucket.levelLabel = levelLabel;
                bucket.baseLabel = unitName;
                medicineSales[name][level] = bucket;
                itemsSoldNumber += baseUnits;
              }
            }

            // Top medicine = highest base-unit volume
            let topMedicine = 'N/A';
            let maxUnits = 0;
            for (const [name, lv] of Object.entries(medicineSales)) {
              const total = (lv.unit?.baseUnits || 0) + (lv.strip?.baseUnits || 0) + (lv.pack?.baseUnits || 0);
              if (total > maxUnits) { maxUnits = total; topMedicine = name; }
            }

            const salesSummary = Object.entries(medicineSales).map(([name, lv]) => {
              const parts: string[] = [];
              let lineTotal = 0;
              (['pack','strip','unit'] as const).forEach(level => {
                const b = lv[level]; if (!b || !b.qty) return;
                const qStr = b.qty % 1 === 0 ? `${b.qty}` : b.qty.toFixed(2);
                const detail = level !== 'unit' && b.baseUnits > 0 ? ` (${b.baseUnits} ${plural(b.baseLabel, b.baseUnits)})` : '';
                parts.push(`${qStr} ${plural(b.levelLabel, b.qty)}${detail}`);
                lineTotal += b.total;
              });
              return `• ${name} — ${parts.join(' + ')} — ${formatNumber(lineTotal)} ETB`;
            });

            const dateStr = today.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
            const topLabel = isPharmacy ? 'Top-Selling Medicine' : 'Top-Selling Item';

            let report = `${reportTitle}\n\n`;
            report += `🏪 *Branch:* ${branch.name}\n`;
            report += `📅 *Date:* ${dateStr}\n\n`;
            report += `💊 *Units Sold:* ${itemsSoldNumber}\n`;
            report += `💰 *Total Income:* ${formatNumber(totalIncome)} ETB\n`;
            report += `💸 *Total Expense:* ${formatNumber(totalExpense)} ETB\n`;
            report += `🔥 *${topLabel}:* ${topMedicine}\n\n`;
            
            if (salesSummary.length > 0) {
              report += `🧾 *Sales Summary:*\n${salesSummary.join('\n')}\n`;
            }

            // Add debtors summary
            report += await getDebtorsSummary(supabase, branch.id);

            // Add inventory alerts
            report += await getInventoryAlerts(supabase, branch.id);
            
            report += `\n✅ _Report generated automatically by ${botName}_ 🤖`;

            await sendTelegramMessage(profile.telegram_chat_id, report);
            
            results.push({
              profile: profile.full_name, branch: branch.name,
              chatId: profile.telegram_chat_id, status: 'sent',
              items_sold_number: itemsSoldNumber,
              total_income: parseFloat(totalIncome.toFixed(2)),
              total_expense: parseFloat(totalExpense.toFixed(2)),
            });
          } catch (error: any) {
            console.error(`Error processing daily report for branch ${branch.name}:`, error);
            results.push({ profile: profile.full_name, branch: branch.name, status: 'failed', error: error.message });
          }
        }
      } catch (error: any) {
        console.error(`Error processing report for ${profile.full_name}:`, error);
        results.push({ profile: profile.full_name, status: 'failed', error: error.message });
      }
    }

    const successCount = results.filter(r => r.status === 'sent').length;
    return new Response(
      JSON.stringify({ success: true, message: `Reports sent: ${successCount}`, reports_delivered: successCount, results }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('Error in telegram-daily-report:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

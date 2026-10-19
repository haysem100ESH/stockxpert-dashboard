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
    throw new Error(`Telegram API error: ${error}`);
  }
  return await response.json();
}

async function sendTelegramPhoto(chatId: string, photoUrl: string, caption: string) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, photo: photoUrl, caption, parse_mode: 'Markdown' }),
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Telegram API error: ${error}`);
  }
  return await response.json();
}

function formatNumber(num: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(num);
}

function generateChartUrl(labels: string[], incomeData: number[], expenseData: number[], title: string): string {
  const chartConfig = {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Income', data: incomeData, borderColor: 'rgb(75, 192, 192)', backgroundColor: 'rgba(75, 192, 192, 0.2)', tension: 0.1 },
        { label: 'Expense', data: expenseData, borderColor: 'rgb(255, 99, 132)', backgroundColor: 'rgba(255, 99, 132, 0.2)', tension: 0.1 }
      ]
    },
    options: { title: { display: true, text: title }, scales: { yAxes: [{ ticks: { beginAtZero: true } }] } }
  };
  return `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}&width=800&height=400`;
}

async function getDebtorsSummary(supabase: any, branchId: string): Promise<string> {
  const { data: credits } = await supabase
    .from('customer_credits')
    .select('customer_id, total_debt')
    .eq('branch_id', branchId)
    .gt('total_debt', 0);

  if (!credits || credits.length === 0) return '\n📌 No outstanding debts 🎉\n';

  const customerIds = credits.map((c: any) => c.customer_id);
  const { data: customers } = await supabase.from('customers').select('id, name, phone').in('id', customerIds);

  const customerMap: Record<string, { name: string; phone: string | null }> = {};
  for (const c of customers || []) { customerMap[c.id] = { name: c.name, phone: c.phone }; }

  const debtors = credits
    .map((c: any) => ({ name: customerMap[c.customer_id]?.name || 'Unknown', phone: customerMap[c.customer_id]?.phone || null, debt: Number(c.total_debt) }))
    .sort((a: any, b: any) => b.debt - a.debt);

  let section = '\n📌 *Outstanding Debtors:*\n\n';
  debtors.forEach((c: any, i: number) => {
    section += `${i + 1}. ${c.name}\n   📞 ${c.phone || 'N/A'}\n   💰 Total Debt: ${formatNumber(c.debt)} ETB\n\n`;
  });
  return section;
}

async function getInventoryAlerts(supabase: any, branchId: string): Promise<string> {
  const today = new Date().toISOString().split('T')[0];
  const thirtyDays = new Date(); thirtyDays.setDate(thirtyDays.getDate() + 30);
  const thirtyDaysStr = thirtyDays.toISOString().split('T')[0];

  const { data: lowStock } = await supabase.from('medicines').select('name, stock_quantity, minimum_stock_level')
    .eq('branch_id', branchId).gt('stock_quantity', 0).not('minimum_stock_level', 'is', null);
  const lowStockItems = (lowStock || []).filter((m: any) => m.stock_quantity <= (m.minimum_stock_level || 0));

  const { data: outOfStock } = await supabase.from('medicines').select('name').eq('branch_id', branchId).eq('stock_quantity', 0);
  const { data: expired } = await supabase.from('medicines').select('name, expiry_date').eq('branch_id', branchId).gt('stock_quantity', 0).lt('expiry_date', today);
  const { data: expiringSoon } = await supabase.from('medicines').select('name, expiry_date').eq('branch_id', branchId).gt('stock_quantity', 0).gte('expiry_date', today).lte('expiry_date', thirtyDaysStr);

  const hasAlerts = lowStockItems.length > 0 || (outOfStock?.length || 0) > 0 || (expired?.length || 0) > 0 || (expiringSoon?.length || 0) > 0;
  if (!hasAlerts) return '\n📦 Inventory Status: All Good ✅\n';

  let section = '\n📦 *Inventory Alerts:*\n';
  if (outOfStock?.length > 0) { section += '\n❌ *Out of Stock:*\n'; outOfStock.forEach((m: any) => { section += `- ${m.name}\n`; }); }
  if (lowStockItems.length > 0) { section += '\n⚠ *Low Stock:*\n'; lowStockItems.forEach((m: any) => { section += `- ${m.name} (${m.stock_quantity} left)\n`; }); }
  if (expiringSoon?.length > 0) { section += '\n⏳ *Expiry Soon:*\n'; expiringSoon.forEach((m: any) => { section += `- ${m.name} (Exp: ${m.expiry_date})\n`; }); }
  if (expired?.length > 0) { section += '\n🛑 *Expired:*\n'; expired.forEach((m: any) => { section += `- ${m.name} (Expired: ${m.expiry_date})\n`; }); }
  return section;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    if (!TELEGRAM_BOT_TOKEN) {
      return new Response(JSON.stringify({ error: 'TELEGRAM_BOT_TOKEN not configured' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    
    const today = new Date();
    const weekStart = new Date(today); weekStart.setDate(today.getDate() - 6); weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(today); weekEnd.setHours(23, 59, 59, 999);
    const weekStartStr = weekStart.toISOString();
    const weekEndStr = weekEnd.toISOString();

    const { data: profiles, error: profilesError } = await supabase
      .from('profiles').select('id, full_name, telegram_chat_id, role')
      .not('telegram_chat_id', 'is', null).eq('role', 'owner');

    if (profilesError) throw profilesError;
    if (!profiles || profiles.length === 0) {
      return new Response(JSON.stringify({ success: true, message: 'No profiles', reports_delivered: 0 }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const results = [];

    for (const profile of profiles) {
      try {
        const { data: branches } = await supabase.from('pharmacy_branches').select('id, name, branch_type').eq('pharmacy_owner_id', profile.id);
        if (!branches || branches.length === 0) continue;

        for (const branch of branches) {
          try {
            const isPharmacy = branch.branch_type === 'pharmacy';
            const botName = isPharmacy ? 'PharmaXpert Bot' : 'StockXpert Bot';
            const reportTitle = isPharmacy ? '📅 *Weekly Pharmacy Summary* 📈' : '📅 *Weekly Inventory Summary* 📈';
            const topLabel = isPharmacy ? 'Top 3 Medicines' : 'Top 3 Items';

            const { data: sales } = await supabase.from('sales')
              .select('id, total_amount, created_at, sale_items(medicine_id, quantity, unit_price, total_price, sale_type, stripes_sold, medicines(id, name, unit_label, units_per_pack))')
              .eq('branch_id', branch.id).gte('created_at', weekStartStr).lte('created_at', weekEndStr);

            const { data: expenses } = await supabase.from('expenses').select('amount, created_at')
              .eq('branch_id', branch.id).gte('created_at', weekStartStr).lte('created_at', weekEndStr);

            const totalIncome = sales?.reduce((s: number, sale: any) => s + (sale.total_amount || 0), 0) || 0;
            const totalExpense = expenses?.reduce((s: number, e: any) => s + (e.amount || 0), 0) || 0;

            const medIds = Array.from(new Set(
              (sales || []).flatMap((s: any) => s.sale_items || [])
                .map((si: any) => si.medicine_id || si.medicines?.id).filter(Boolean)
            )) as string[];
            const pkgMap: Record<string, any> = {};
            if (medIds.length > 0) {
              const { data: pkgRows } = await supabase.from('medicine_packaging').select('*').in('medicine_id', medIds);
              (pkgRows || []).forEach((p: any) => { pkgMap[p.medicine_id] = p; });
            }
            const approxEq = (a: number, b: number) => Math.abs(a - b) < 0.01;
            const inferLevel = (si: any, pkg: any): 'unit'|'strip'|'pack' => {
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
            const medicineSales: Record<string, { unit?: Bucket; strip?: Bucket; pack?: Bucket; total: number; baseUnits: number }> = {};
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
                } else qty = Number(item.quantity || 0);
                const ups = Number(pkg?.units_per_strip || 0);
                const spp = Number(pkg?.strips_per_pack || 0);
                const unitsPerPack = (ups && spp) ? ups * spp : Number(medObj?.units_per_pack || 1);
                const baseUnits = level === 'unit' ? qty : level === 'strip' ? qty * (ups || 1) : qty * (unitsPerPack || 1);
                const unitName = pkg?.unit_name || medObj?.unit_label || 'tablet';
                const stripName = pkg?.strip_name || 'strip';
                const packName = pkg?.pack_name || 'pack';
                const levelLabel = level === 'unit' ? unitName : level === 'strip' ? stripName : packName;
                if (!medicineSales[name]) medicineSales[name] = { total: 0, baseUnits: 0 };
                const cur = medicineSales[name][level] || { qty: 0, baseUnits: 0, total: 0, levelLabel, baseLabel: unitName };
                cur.qty += qty; cur.baseUnits += baseUnits; cur.total += Number(item.total_price || 0);
                cur.levelLabel = levelLabel; cur.baseLabel = unitName;
                medicineSales[name][level] = cur;
                medicineSales[name].total += Number(item.total_price || 0);
                medicineSales[name].baseUnits += baseUnits;
                itemsSoldNumber += baseUnits;
              }
            }

            const topMedicines = Object.entries(medicineSales)
              .sort(([, a]: any, [, b]: any) => b.baseUnits - a.baseUnits)
              .slice(0, 3);

            const formatLine = (lv: any) => {
              const parts: string[] = [];
              (['pack','strip','unit'] as const).forEach(l => {
                const b = lv[l]; if (!b || !b.qty) return;
                const qStr = b.qty % 1 === 0 ? `${b.qty}` : b.qty.toFixed(2);
                const detail = l !== 'unit' && b.baseUnits > 0 ? ` (${b.baseUnits} ${plural(b.baseLabel, b.baseUnits)})` : '';
                parts.push(`${qStr} ${plural(b.levelLabel, b.qty)}${detail}`);
              });
              return parts.join(' + ');
            };

            const dailyLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
            const dailyIncome = new Array(7).fill(0);
            const dailyExpense = new Array(7).fill(0);
            for (const sale of sales || []) { const d = (new Date(sale.created_at).getDay() + 6) % 7; dailyIncome[d] += sale.total_amount || 0; }
            for (const expense of expenses || []) { const d = (new Date(expense.created_at).getDay() + 6) % 7; dailyExpense[d] += expense.amount || 0; }

            const weekRangeStr = `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

            let report = `${reportTitle}\n\n🏪 *Branch:* ${branch.name}\n📆 *Week:* ${weekRangeStr}\n\n`;
            report += `💊 *Total Units Sold:* ${itemsSoldNumber}\n💰 *Total Income:* ${formatNumber(totalIncome)} ETB\n💸 *Total Expense:* ${formatNumber(totalExpense)} ETB\n`;

            if (topMedicines.length > 0) {
              report += `🔥 *${topLabel}:*\n`;
              topMedicines.forEach(([name, lv]: any, idx) => {
                report += `${idx + 1}️⃣ ${name} — ${formatLine(lv)} — ${formatNumber(lv.total)} ETB\n`;
              });
            }

            report += await getDebtorsSummary(supabase, branch.id);
            report += await getInventoryAlerts(supabase, branch.id);
            report += `\n✅ _Weekly summary generated automatically by ${botName}_ 🤖`;

            await sendTelegramMessage(profile.telegram_chat_id, report);

            const chartUrl = generateChartUrl(dailyLabels, dailyIncome, dailyExpense, '📊 Weekly Sales Performance');
            await sendTelegramPhoto(profile.telegram_chat_id, chartUrl, `📈 *Weekly Sales Trend — ${branch.name}*`);

            results.push({ profile: profile.full_name, branch: branch.name, status: 'sent', items_sold: itemsSoldNumber, total_income: parseFloat(totalIncome.toFixed(2)), total_expense: parseFloat(totalExpense.toFixed(2)) });
          } catch (error: any) {
            results.push({ profile: profile.full_name, branch: branch.name, status: 'failed', error: error.message });
          }
        }
      } catch (error: any) {
        results.push({ profile: profile.full_name, status: 'failed', error: error.message });
      }
    }

    const successCount = results.filter(r => r.status === 'sent').length;
    return new Response(JSON.stringify({ success: true, reports_delivered: successCount, results }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});

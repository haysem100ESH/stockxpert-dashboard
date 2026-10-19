import { useState } from 'react';
import { Info, Sparkles, TrendingUp, AlertTriangle, Package, Skull, CalendarDays, ShoppingCart, Turtle, Clock, Gauge } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';

interface Props {
  isPharmacy?: boolean;
}

export default function HealthScoreInfoDialog({ isPharmacy = false }: Props) {
  const [open, setOpen] = useState(false);
  const itemLabel = isPharmacy ? 'medicine' : 'item';
  const itemLabelPlural = isPharmacy ? 'medicines' : 'items';

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Info className="h-4 w-4" />
          <span className="hidden sm:inline">How it works</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[85vh] p-0">
        <DialogHeader className="p-6 pb-3 border-b">
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Sparkles className="h-5 w-5 text-primary" />
            Smart Inventory User Manual
          </DialogTitle>
          <DialogDescription>
            Understand how the Health Score, alerts, and predictions are calculated for every {itemLabel} in your inventory.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[65vh] px-6 py-4">
          <div className="space-y-6 pb-6">
            {/* Health Score Levels */}
            <section>
              <h3 className="font-semibold text-base mb-3 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" /> Health Score Levels
              </h3>
              <p className="text-sm text-muted-foreground mb-3">
                Each {itemLabel} receives a score from <b>0 to 100</b> reflecting how well it is performing. The dashboard's
                <b> overall Health Score</b> is the average of all individual {itemLabel} scores in your branch.
              </p>
              <div className="grid gap-2">
                <ScoreRow color="bg-green-500" label="🟢 Excellent" range="80 – 100" desc="Healthy stock, steady sales, no expiry or dead stock concerns." />
                <ScoreRow color="bg-blue-500" label="🔵 Good" range="60 – 79" desc="Performing well, minor attention may be needed." />
                <ScoreRow color="bg-amber-500" label="🟡 At Risk" range="40 – 59" desc="Action recommended — slow sales, overstock, near expiry, or low stock." />
                <ScoreRow color="bg-destructive" label="🔴 Critical" range="< 40" desc="Urgent attention required — dead stock, expired, or stock-out risk." />
              </div>
            </section>

            <Separator />

            {/* How the score is calculated */}
            <section>
              <h3 className="font-semibold text-base mb-3 flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" /> How the Health Score is Calculated
              </h3>
              <p className="text-sm text-muted-foreground mb-3">
                Every {itemLabel} starts at a baseline of <b>50 points</b>. Points are added or subtracted based on these factors:
              </p>
              <div className="space-y-2 text-sm">
                <ScoreFactor sign="+" range="up to +20" title="Sales velocity (WMA-ADC)" desc="Based on Weighted Moving Average — last week counts 3×, week 2 counts 2×, week 3 counts 1×. Higher recent daily sales = more points." />
                <ScoreFactor sign="+" range="up to +30" title="Stock vs Demand balance" desc="Compares effective stock against predicted demand. Best score when stock covers 0.8× to 2× of forecast demand." />
                <ScoreFactor sign="+" range="+15" title="New item with stock" desc={`${itemLabelPlural.charAt(0).toUpperCase() + itemLabelPlural.slice(1)} with stock but no sales history get a learning bonus for their first 30 days.`} />
                <ScoreFactor sign="−" range="−5 to −30" title="Expiry proximity (per batch)" desc="Penalties grow as the nearest expiring batch approaches: <90 days (−5), <60 days (−15), <30 days (−25), expired (−30)." />
                <ScoreFactor sign="−" range="−20" title="Dead stock" desc="No sales in the last 60 days while stock is on hand." />
              </div>
              <p className="text-xs text-muted-foreground mt-3 italic">
                Final score is clamped between 0 and 100.
              </p>
            </section>

            <Separator />

            {/* Predicted Demand & Reorder Logic */}
            <section>
              <h3 className="font-semibold text-base mb-3 flex items-center gap-2">
                <ShoppingCart className="h-4 w-4 text-primary" /> Predicted Demand & Reorder Logic
              </h3>

              <div className="space-y-5 text-sm">
                {/* WMA */}
                <div>
                  <p className="font-medium mb-1 flex items-center gap-2"><Gauge className="h-4 w-4 text-primary" /> ADC — Weighted Moving Average (WMA)</p>
                  <p className="text-muted-foreground mb-2">
                    Instead of a simple 30-day average, the system weights recent weeks more heavily:
                  </p>
                  <pre className="bg-muted/60 text-xs font-mono p-3 rounded-md overflow-x-auto">{`week1 (days 1–7)   × 3
week2 (days 8–14)  × 2
week3 (days 15–21) × 1

ADC = WMA ÷ 7`}</pre>
                  <p className="text-muted-foreground mt-2">
                    This means last week's sales count 3× more than sales from 3 weeks ago, so the system reacts faster to real demand changes.
                  </p>
                </div>

                {/* Slow mover */}
                <div>
                  <p className="font-medium mb-1 flex items-center gap-2"><Turtle className="h-4 w-4 text-amber-500" /> Slow Mover Fallback</p>
                  <p className="text-muted-foreground">
                    If an {itemLabel} has zero sales in the last 30 days but had sales in the last 60 days, the system falls back to a <b>60-day average ADC</b> instead of showing zero.
                    These {itemLabelPlural} are marked with a 🐢 badge so you know the prediction is based on sparser, older data.
                    Items with zero sales in 60 days are flagged as <Badge variant="outline">Dead Stock</Badge>.
                  </p>
                </div>

                {/* Trend */}
                <div>
                  <p className="font-medium mb-1 flex items-center gap-2"><TrendingUp className="h-4 w-4 text-primary" /> Trend Multiplier</p>
                  <p className="text-muted-foreground mb-2">
                    The system compares the last 14 days of sales against the prior 16 days to detect whether demand is growing or declining:
                  </p>
                  <pre className="bg-muted/60 text-xs font-mono p-3 rounded-md overflow-x-auto">{`recentRate = qty_14 ÷ 14
olderRate  = (qty_30 − qty_14) ÷ 16
trendMultiplier = recentRate ÷ olderRate   (clamped 0.7× – 1.5×)`}</pre>
                  <div className="space-y-1 mt-2">
                    <Bullet>📈 <b>Green chip:</b> demand growing more than +10% → forecast increases</Bullet>
                    <Bullet>📉 <b>Red chip:</b> demand declining more than −10% → forecast decreases</Bullet>
                    <Bullet>➡️ <b>Grey chip:</b> stable demand</Bullet>
                  </div>
                </div>

                {/* Seasonal */}
                <div>
                  <p className="font-medium mb-1">Seasonal Multiplier</p>
                  <p className="text-muted-foreground">
                    The system analyses up to 12 months of sales history and checks whether the current calendar month is historically a high or low demand period for each {itemLabel}.
                    The multiplier is clamped between <b>0.5×</b> and <b>2.0×</b> to prevent extreme swings.
                  </p>
                </div>

                {/* Forecast */}
                <div>
                  <p className="font-medium mb-1">Forecast Demand</p>
                  <pre className="bg-muted/60 text-xs font-mono p-3 rounded-md overflow-x-auto">{`forecastDays   = max(14, leadTimeDays × 2)
forecastDemand = ADC × forecastDays × seasonalMultiplier × trendMultiplier`}</pre>
                  <p className="text-muted-foreground mt-2">
                    {itemLabelPlural.charAt(0).toUpperCase() + itemLabelPlural.slice(1)} with longer lead times look further into the future automatically.
                  </p>
                </div>

                {/* Effective Stock */}
                <div>
                  <p className="font-medium mb-1 flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-500" /> Effective Stock (Expiry-Adjusted)</p>
                  <p className="text-muted-foreground mb-2">
                    The system does not count batches that will expire before new stock can arrive. Those units would be wasted during the lead time window anyway:
                  </p>
                  <pre className="bg-muted/60 text-xs font-mono p-3 rounded-md overflow-x-auto">{`effectiveStock = total stock − quantity in batches expiring within leadTimeDays`}</pre>
                  <p className="text-muted-foreground mt-2">
                    A ⚠️ icon appears on {itemLabelPlural} where stock was excluded due to near-expiry batches, with a tooltip showing exactly how many units were excluded.
                  </p>
                </div>

                {/* ROP */}
                <div>
                  <p className="font-medium mb-1">Reorder Point (ROP)</p>
                  <p className="text-muted-foreground mb-2">
                    Instead of waiting until stock runs out, the system flags {itemLabelPlural} for reorder proactively using a Reorder Point:
                  </p>
                  <pre className="bg-muted/60 text-xs font-mono p-3 rounded-md overflow-x-auto">{`safetyStock = forecastDemand × 0.20
ROP         = (ADC × leadTimeDays) + safetyStock`}</pre>
                  <p className="text-muted-foreground mt-2">
                    An {itemLabel} enters the <Badge variant="outline">Need Reorder</Badge> list the moment <b>effectiveStock ≤ ROP</b> — while you still have enough stock to last through the supplier delivery wait.
                  </p>
                </div>

                {/* Suggested reorder */}
                <div>
                  <p className="font-medium mb-1">Suggested Reorder Quantity</p>
                  <pre className="bg-muted/60 text-xs font-mono p-3 rounded-md overflow-x-auto">{`target           = max(forecastDemand + safetyStock, minStockLevel)
suggestedReorder = ceil(target − effectiveStock)   // minimum 1`}</pre>
                  <p className="text-muted-foreground mt-2">
                    The suggestion always brings you to whichever is higher: next forecast period's demand with buffer, or your configured minimum stock level.
                  </p>
                </div>

                {/* Lead time */}
                <div>
                  <p className="font-medium mb-1 flex items-center gap-2"><Clock className="h-4 w-4 text-primary" /> Lead Time (Per Item)</p>
                  <p className="text-muted-foreground">
                    Each {itemLabel} has a configurable <b>Lead Time</b> — how many days it typically takes your supplier to deliver after ordering.
                    Default is <b>3 days</b>. Set this accurately in the Edit {isPharmacy ? 'Medicine' : 'Item'} dialog under Stock Settings for the most precise reorder timing.
                  </p>
                </div>
              </div>
            </section>

            <Separator />

            {/* Alerts */}
            <section>
              <h3 className="font-semibold text-base mb-3 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-primary" /> Alert Categories
              </h3>
              <div className="space-y-3 text-sm">
                <AlertRow icon={<TrendingUp className="h-4 w-4 text-destructive" />} title="🔴 Need Reorder"
                  desc="Effective stock has dropped to or below the Reorder Point, or below minimum stock level." />
                <AlertRow icon={<AlertTriangle className="h-4 w-4 text-destructive" />} title="🔴 Stock-Out Risk"
                  desc="Less than 7 days of stock remaining at current ADC." />
                <AlertRow icon={<Skull className="h-4 w-4 text-amber-500" />} title="🟡 Dead Stock"
                  desc="No sales in the last 60 days while units are still on hand — consider promotions or branch transfers." />
                {isPharmacy && (
                  <AlertRow icon={<CalendarDays className="h-4 w-4 text-orange-500" />} title="🟠 Expiry Alert"
                    desc="One or more batches are expiring soon — shown per batch with parent item name in notifications." />
                )}
              </div>
            </section>

            <Separator />

            {/* New items */}
            <section>
              <h3 className="font-semibold text-base mb-3 flex items-center gap-2">
                <Package className="h-4 w-4 text-primary" /> How New {isPharmacy ? 'Medicines' : 'Items'} Are Treated
              </h3>
              <div className="space-y-2 text-sm">
                <Bullet>
                  A new {itemLabel} with stock but no sales starts at approximately <b>65 points</b> (50 baseline + 15 learning bonus) — placed in the <Badge variant="secondary">Good</Badge> tier.
                </Bullet>
                <Bullet>
                  ADC and trend stay at <b>0</b> until sales begin, so it won't appear in <b>Stock-Out Risk</b> or <b>Need Reorder</b> lists initially.
                </Bullet>
                <Bullet>
                  After <b>30 days of sales data</b>, WMA predictions become reliable and the score reflects real performance.
                </Bullet>
                <Bullet>
                  After <b>60 days with zero sales</b>, the {itemLabel} is flagged as <Badge variant="outline">Dead Stock</Badge> (−20 points).
                </Bullet>
                <Bullet>
                  {itemLabelPlural.charAt(0).toUpperCase() + itemLabelPlural.slice(1)} with frequent sales quickly climb toward <Badge className="bg-green-500 hover:bg-green-500">Excellent</Badge> as ADC, trend, and stock-balance bonuses accumulate.
                </Bullet>
              </div>
            </section>

            <Separator />

            {/* Tips */}
            <section>
              <h3 className="font-semibold text-base mb-3">Tips to Improve Your Health Score</h3>
              <div className="space-y-2 text-sm">
                <Bullet>Set <b>lead time</b> per {itemLabel} accurately — it directly controls when the system tells you to reorder.</Bullet>
                <Bullet>Set <b>minimum stock levels</b> on all {itemLabelPlural}, especially slow movers — they rely on it since their ADC may be 0.</Bullet>
                <Bullet>Reorder flagged {itemLabelPlural} promptly to avoid the stock-out penalty pulling your score down.</Bullet>
                <Bullet>Run promotions or transfer dead stock to other branches before the −20 penalty hits.</Bullet>
                <Bullet>Record every sale through the system — WMA and trend predictions improve significantly with consistent data.</Bullet>
                {isPharmacy && (
                  <Bullet>Monitor expiry alerts per batch — effective stock excludes near-expiry batches, so your real reorder need may be higher than raw stock suggests.</Bullet>
                )}
              </div>
            </section>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function ScoreRow({ color, label, range, desc }: { color: string; label: string; range: string; desc: string }) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-lg border bg-card">
      <div className={`h-3 w-3 rounded-full mt-1.5 ${color}`} />
      <div className="flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium">{label}</span>
          <Badge variant="outline" className="text-xs font-mono">{range}</Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-1">{desc}</p>
      </div>
    </div>
  );
}

function ScoreFactor({ sign, range, title, desc }: { sign: string; range: string; title: string; desc: string }) {
  const isPositive = sign === '+';
  return (
    <div className="flex gap-3 p-2.5 rounded-md bg-muted/40">
      <Badge
        variant="outline"
        className={`font-mono text-xs shrink-0 ${isPositive ? 'border-green-500/40 text-green-600 dark:text-green-400' : 'border-destructive/40 text-destructive'}`}
      >
        {range}
      </Badge>
      <div>
        <p className="font-medium text-sm">{title}</p>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="text-primary mt-1">•</span>
      <p className="flex-1">{children}</p>
    </div>
  );
}

function AlertRow({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="flex gap-3">
      <div className="mt-0.5">{icon}</div>
      <div>
        <p className="font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
    </div>
  );
}

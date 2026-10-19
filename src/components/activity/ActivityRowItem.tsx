import { useState } from 'react';
import { format } from 'date-fns';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ShoppingCart, Package, Tag, Users, ArrowRightLeft, Pencil, Trash2, Plus, Layers } from 'lucide-react';
import type { ActivityRow } from '@/hooks/useActivityFeed';
import { cn } from '@/lib/utils';

const TYPE_META: Record<string, { label: string; icon: any; color: string }> = {
  sell_item:               { label: 'Sale',                  icon: ShoppingCart,   color: 'text-emerald-600' },
  create_item:             { label: 'Item Created',          icon: Plus,           color: 'text-blue-600' },
  edit_item:               { label: 'Item Edited',           icon: Pencil,         color: 'text-amber-600' },
  delete_item:             { label: 'Item Deleted',          icon: Trash2,         color: 'text-destructive' },
  adjust_stock:            { label: 'Stock Adjusted',        icon: Layers,         color: 'text-orange-600' },
  create_batch:            { label: 'Batch Created',         icon: Layers,         color: 'text-blue-600' },
  edit_batch:              { label: 'Batch Edited',          icon: Layers,         color: 'text-amber-600' },
  delete_batch:            { label: 'Batch Deleted',         icon: Layers,         color: 'text-destructive' },
  create_medicine_code:    { label: 'Code Created',          icon: Tag,            color: 'text-blue-600' },
  edit_medicine_code:      { label: 'Code Edited',           icon: Tag,            color: 'text-amber-600' },
  delete_medicine_code:    { label: 'Code Deleted',          icon: Tag,            color: 'text-destructive' },
  assign_item_to_code:     { label: 'Item Assigned to Code', icon: Tag,            color: 'text-blue-600' },
  unassign_item_from_code: { label: 'Item Removed from Code',icon: Tag,            color: 'text-muted-foreground' },
  create_category:         { label: 'Category Created',      icon: Package,        color: 'text-blue-600' },
  edit_category:           { label: 'Category Edited',       icon: Package,        color: 'text-amber-600' },
  delete_category:         { label: 'Category Deleted',      icon: Package,        color: 'text-destructive' },
  request_stock_transfer:  { label: 'Transfer Requested',    icon: ArrowRightLeft, color: 'text-purple-600' },
  create_customer:         { label: 'Customer Added',        icon: Users,          color: 'text-blue-600' },
  edit_customer:           { label: 'Customer Edited',       icon: Users,          color: 'text-amber-600' },
  delete_customer:         { label: 'Customer Deleted',      icon: Users,          color: 'text-destructive' },
  record_payment:          { label: 'Payment Recorded',      icon: ShoppingCart,   color: 'text-emerald-600' },
  create_supplier:         { label: 'Supplier Added',        icon: Users,          color: 'text-blue-600' },
  edit_supplier:           { label: 'Supplier Edited',       icon: Users,          color: 'text-amber-600' },
};

function fmt(v: any): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export default function ActivityRowItem({ row }: { row: ActivityRow }) {
  const [open, setOpen] = useState(false);
  const meta = TYPE_META[row.activity_type] || { label: row.activity_type, icon: Package, color: 'text-muted-foreground' };
  const Icon = meta.icon;
  const m = row.metadata || {};
  const isSale = row.activity_type === 'sell_item';
  const saleTitle = isSale
    ? `Sale${m.customer_name ? ` — ${m.customer_name}` : ''}${m.total !== undefined ? ` · ${Number(m.total).toFixed(2)}` : ''}`
    : null;
  const baseName = saleTitle || m.item_name || m.name || m.code || m.label || meta.label;
  const batchSuffix = m.batch_number ? ` · Batch #${m.batch_number}` : '';
  const fieldSuffix = m.field ? ` — ${m.field}` : '';
  const title = `${baseName}${batchSuffix}${fieldSuffix}`;

  const renderDetails = () => {
    if (row.activity_type === 'sell_item') {
      const items = m.items as any[] | undefined;
      return (
        <div className="space-y-1 text-sm">
          {items && items.length > 0 ? (
            <div className="space-y-1">
              {items.map((it, i) => {
                const qty = Number(it.quantity) || 0;
                const lineTotal = it.line_total !== undefined
                  ? Number(it.line_total)
                  : Number(it.unit_price || 0) * qty;
                return (
                  <div key={i} className="flex justify-between gap-2 border-b border-border/40 py-1">
                    <span>{it.name} × {qty}</span>
                    <span className="tabular-nums">{lineTotal.toFixed(2)}</span>
                  </div>
                );
              })}
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 pt-1">
            {m.total !== undefined && <div><span className="text-muted-foreground">Total: </span><span className="font-medium">{Number(m.total).toFixed(2)}</span></div>}
            {m.payment_method && <div><span className="text-muted-foreground">Payment: </span>{m.payment_method}</div>}
            {m.customer_name && <div><span className="text-muted-foreground">Customer: </span>{m.customer_name}</div>}
            {m.discount !== undefined && Number(m.discount) > 0 && <div><span className="text-muted-foreground">Discount: </span>{m.discount}</div>}
          </div>
        </div>
      );
    }
    // Diff renderer for edits
    if (row.previous_value && row.new_value) {
      const keys = new Set([...Object.keys(row.previous_value), ...Object.keys(row.new_value)]);
      const changed = Array.from(keys).filter((k) => JSON.stringify(row.previous_value[k]) !== JSON.stringify(row.new_value[k]));
      if (changed.length === 0) return <div className="text-sm text-muted-foreground">No tracked field changes.</div>;
      return (
        <div className="space-y-1 text-sm">
          {changed.map((k) => (
            <div key={k} className="grid grid-cols-[110px,1fr] gap-2">
              <span className="text-muted-foreground capitalize">{k.replace(/_/g, ' ')}</span>
              <span><span className="line-through text-muted-foreground">{fmt(row.previous_value[k])}</span> <span className="mx-1">→</span> <span className="font-medium">{fmt(row.new_value[k])}</span></span>
            </div>
          ))}
        </div>
      );
    }
    if (row.new_value) {
      return (
        <div className="space-y-1 text-sm">
          {Object.entries(row.new_value).map(([k, v]) => (
            <div key={k} className="grid grid-cols-[110px,1fr] gap-2">
              <span className="text-muted-foreground capitalize">{k.replace(/_/g, ' ')}</span>
              <span>{fmt(v)}</span>
            </div>
          ))}
        </div>
      );
    }
    if (row.previous_value) {
      return (
        <div className="space-y-1 text-sm text-muted-foreground">
          {Object.entries(row.previous_value).map(([k, v]) => (
            <div key={k} className="grid grid-cols-[110px,1fr] gap-2">
              <span className="capitalize">{k.replace(/_/g, ' ')}</span>
              <span className="line-through">{fmt(v)}</span>
            </div>
          ))}
        </div>
      );
    }
    return <div className="text-sm text-muted-foreground">No additional details.</div>;
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border bg-card">
      <CollapsibleTrigger className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/40 transition-colors">
        <div className={cn('rounded-md bg-muted/50 p-2', meta.color)}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium truncate">{title}</span>
            <Badge variant="outline" className="text-[10px] py-0 px-1.5">{meta.label}</Badge>
          </div>
          <div className="text-xs text-muted-foreground">
            {(() => {
              // For sale rows, prefer the business sale_date stored in metadata
              // (the date the cashier picked); keep the actual recorded time.
              const saleDateStr = isSale ? (row.metadata as any)?.sale_date : null;
              if (saleDateStr) {
                const businessDay = format(new Date(`${saleDateStr}T00:00:00`), 'PP');
                const time = format(new Date(row.created_at), 'p');
                const isBackdated = saleDateStr !== format(new Date(row.created_at), 'yyyy-MM-dd');
                return (
                  <span>
                    {businessDay} · {time}
                    {isBackdated && <span className="ml-1 text-warning">(backdated)</span>}
                  </span>
                );
              }
              return format(new Date(row.created_at), 'PP p');
            })()}
          </div>
        </div>
        <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t bg-muted/20 px-3 py-3">
        {renderDetails()}
      </CollapsibleContent>
    </Collapsible>
  );
}

import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Download, Upload, FileSpreadsheet, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useBranchContext } from '@/hooks/useBranchContext';
import { createBatch } from '@/lib/batchInventory';
import { MEASURABLE_UNITS } from '@/lib/itemTypes';

// ---------------------------------------------------------------------------
// Real-world header aliases. Users upload sheets with messy / typo'd headers
// (CATAGORY, BACH NO, EX-DATE, "PERCHASING PRICE (strip)" ...). We normalize
// any column whose header — after lowercasing, stripping punctuation and
// collapsing whitespace — matches one of these aliases to our canonical key.
// ---------------------------------------------------------------------------
const HEADER_ALIASES: Record<string, string> = {
  // canonical
  name: 'name', 'name of items': 'name', 'item name': 'name', 'product name': 'name',
  generic_name: 'generic_name', 'generic name': 'generic_name', generic: 'generic_name',
  medicine_group: 'medicine_group', group: 'medicine_group', 'medicine group': 'medicine_group',
  strength: 'strength',
  category: 'category', catagory: 'category', cat: 'category',
  manufacturer: 'manufacturer', mfg: 'manufacturer', maker: 'manufacturer', brand: 'manufacturer',
  batch_number: 'batch_number', 'batch no': 'batch_number', 'bach no': 'batch_number', batch: 'batch_number', 'batch number': 'batch_number',
  item_type: 'item_type', 'item type': 'item_type', type: 'item_type',
  unit_label: 'unit_label', 'unit by label': 'unit_label', 'unit label': 'unit_label', unit: 'unit_label',
  // New LPI-based "Name of unit" column — renames the LPI (tablet / pcs / capsule / ml…)
  'name of unit': 'unit_label', 'unit name': 'unit_label', 'lpi name': 'unit_label', 'lpi unit': 'unit_label',
  packaging_mode: 'packaging_mode', 'packaging mode': 'packaging_mode', packaging: 'packaging_mode', pack: 'packaging_mode',
  strips_per_pack: 'strips_per_pack', 'strips per pack': 'strips_per_pack',
  units_per_strip: 'units_per_strip', 'units per strip': 'units_per_strip', 'tablets per strip': 'units_per_strip',
  // LPI per strip / LPI per pack
  'lpi per strip': 'units_per_strip', 'lpis per strip': 'units_per_strip',
  units_per_pack: 'units_per_pack', 'units per pack': 'units_per_pack', 'unit per pack': 'units_per_pack', 'units per item': 'units_per_pack',
  'lpi per pack': 'units_per_pack', 'lpis per pack': 'units_per_pack', 'lpi per item': 'units_per_pack',
  purchase_price: 'purchase_price', 'purchase price': 'purchase_price', 'perchasing price': 'purchase_price',
  'perchasing price strip': 'purchase_price', 'purchase price strip': 'purchase_price',
  'cost price': 'purchase_price', cost: 'purchase_price',
  selling_price: 'selling_price', 'selling price': 'selling_price', 'selling price strip': 'selling_price',
  price: 'selling_price', sale: 'selling_price', 'sale price': 'selling_price',
  // Pack-level price (legacy template): "MEDICINE PRICE" / "ITEM PRICE" / "PACK PRICE"
  pack_price: 'pack_price', 'pack price': 'pack_price', 'medicine price': 'pack_price', 'item price': 'pack_price',
  // LPI-level prices (NEW canonical) — price per indivisible unit (tablet / pcs / ml…)
  lpi_sell: 'lpi_sell', 'lpi sell': 'lpi_sell', 'lpi sell price': 'lpi_sell', 'lpi price': 'lpi_sell', 'sell per lpi': 'lpi_sell', 'sell lpi': 'lpi_sell',
  lpi_buy: 'lpi_buy', 'lpi buy': 'lpi_buy', 'lpi buy price': 'lpi_buy', 'lpi cost': 'lpi_buy', 'buy per lpi': 'lpi_buy', 'buy lpi': 'lpi_buy', 'lpi purchase': 'lpi_buy',
  lpi_stock: 'lpi_stock', 'lpi stock': 'lpi_stock', 'stock lpi': 'lpi_stock', 'lpi qty': 'lpi_stock', 'lpi quantity': 'lpi_stock',
  stock_quantity: 'stock_quantity', 'stock quantity': 'stock_quantity', quantity: 'stock_quantity',
  'quantity pk': 'stock_quantity', qty: 'stock_quantity', stock: 'stock_quantity',
  minimum_stock_level: 'minimum_stock_level', 'minimum stock level': 'minimum_stock_level',
  'min stock': 'minimum_stock_level', 'minimum stock': 'minimum_stock_level', 'reorder level': 'minimum_stock_level',
  'min stock lpi': 'minimum_stock_level', 'minimum stock lpi': 'minimum_stock_level', 'min lpi stock': 'minimum_stock_level', 'minimum lpi stock': 'minimum_stock_level', 'lpi min stock': 'minimum_stock_level', 'lpi minimum stock': 'minimum_stock_level',
  expiry_date: 'expiry_date', 'expiry date': 'expiry_date', 'ex date': 'expiry_date', 'exp date': 'expiry_date',
  expiry: 'expiry_date', expiration: 'expiry_date',
  // Multi-level packaging (PR1)
  container_type: 'container_type', 'container type': 'container_type',
  main_unit_name: 'main_unit_name', 'main unit name': 'main_unit_name',
  sub_unit_name: 'sub_unit_name', 'sub unit name': 'sub_unit_name',
  sub_units_per_unit: 'sub_units_per_unit', 'sub units per unit': 'sub_units_per_unit', 'sub units': 'sub_units_per_unit',
  main_unit_price: 'main_unit_price', 'main unit price': 'main_unit_price',
  unit_price: 'unit_price', 'unit price': 'unit_price', 'strip price': 'unit_price',
  sub_unit_price: 'sub_unit_price', 'sub unit price': 'sub_unit_price', 'tablet price': 'sub_unit_price',
};

function normalizeHeader(h: string): string {
  return String(h || '')
    .toLowerCase()
    .replace(/[()._\-\/\\*:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function canonicalHeader(h: string): string | null {
  const n = normalizeHeader(h);
  if (!n) return null;
  if (HEADER_ALIASES[n]) return HEADER_ALIASES[n];
  // Fallback: try removing trailing words like "strip", "pk"
  const stripped = n.replace(/\s+(strip|pk|pack)$/g, '').trim();
  return HEADER_ALIASES[stripped] || null;
}

// Parse a "PACKAGING MODE" cell like "3*10", "3x10", "3×10", "1*1", "30g", "100ml".
// Returns { stripsPerPack, unitsPerStrip } if it looks like a strip layout.
function parsePackagingMode(s: string): { stripsPerPack: number | null; unitsPerStrip: number | null; isStripLayout: boolean } {
  if (!s) return { stripsPerPack: null, unitsPerStrip: null, isStripLayout: false };
  const m = s.trim().match(/^(\d+)\s*[x*×]\s*(\d+)$/i);
  if (!m) return { stripsPerPack: null, unitsPerStrip: null, isStripLayout: false };
  const a = parseInt(m[1]);
  const b = parseInt(m[2]);
  // Treat 1*1 as "no real strip layout"
  if (a === 1 && b === 1) return { stripsPerPack: null, unitsPerStrip: null, isStripLayout: false };
  return { stripsPerPack: a, unitsPerStrip: b, isStripLayout: true };
}

// "1 PK", "3 tubes", "5 vials", "2pk" → 1, 3, 5, 2
function parseLeadingInt(s: string): number | null {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const v = parseFloat(m[1]);
  return isNaN(v) ? null : Math.round(v);
}

// Strength may be a percentage stored as a number (0.0116 → "1.16%"), a date
// (2/30/2027 — invalid date), or a normal string like "500mg".
function normalizeStrength(raw: any): string | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') {
    // Treat numbers <=1 as fraction → percentage
    if (raw > 0 && raw <= 1) return `${+(raw * 100).toFixed(2)}%`;
    return String(raw);
  }
  return String(raw).trim() || null;
}

// Robust date parser: handles ISO (2026-07-26), DMY (30/10/2027), MDY (10/30/2027),
// and Excel Date objects. Returns YYYY-MM-DD or null on invalid (incl. 2/30/...).
function parseExpiryDate(raw: any): { iso: string | null; valid: boolean; hadValue: boolean } {
  if (raw == null || raw === '') return { iso: null, valid: true, hadValue: false };
  if (raw instanceof Date) {
    if (isNaN(raw.getTime())) return { iso: null, valid: false, hadValue: true };
    return { iso: raw.toISOString().slice(0, 10), valid: true, hadValue: true };
  }
  const s = String(raw).trim();
  if (!s) return { iso: null, valid: true, hadValue: false };
  // ISO yyyy-mm-dd
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const [, y, mo, d] = m;
    return validateDate(+y, +mo, +d);
  }
  // d/m/y or m/d/y or d-m-y
  m = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (m) {
    let [, a, b, y] = m;
    let yr = +y;
    if (yr < 100) yr += 2000;
    const ai = +a, bi = +b;
    // Prefer DMY when first part > 12 (unambiguous), else try DMY first then MDY
    if (ai > 12) return validateDate(yr, bi, ai);
    if (bi > 12) return validateDate(yr, ai, bi);
    // Ambiguous: try DMY (matches the user's sheet locale: 30/10/2027)
    const dmy = validateDate(yr, bi, ai);
    if (dmy.valid) return dmy;
    return validateDate(yr, ai, bi);
  }
  // Last resort: native Date
  const d = new Date(s);
  if (!isNaN(d.getTime())) return { iso: d.toISOString().slice(0, 10), valid: true, hadValue: true };
  return { iso: null, valid: false, hadValue: true };
}

function validateDate(y: number, mo: number, d: number): { iso: string | null; valid: boolean; hadValue: boolean } {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return { iso: null, valid: false, hadValue: true };
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return { iso: null, valid: false, hadValue: true };
  }
  return { iso: dt.toISOString().slice(0, 10), valid: true, hadValue: true };
}

// Map freetext item type ("Tablet", "GEL", "INJECTION", "powder", "suspension")
// to our schema's full_pcs / measurable. Liquids/creams/gels = measurable.
function inferItemType(itemTypeText: string, unitLabel: string): 'full_pcs' | 'measurable' {
  const t = (itemTypeText + ' ' + unitLabel).toLowerCase();
  if (/(gel|cream|ointment|syrup|suspension|drop|spray|lotion|powder|liquid|tube|bottle|ml|gram|\bg\b|kg)/.test(t)) {
    // Tubes & bottles in this catalog still ship as discrete units → keep full_pcs
    if (/(tube|bottle|sachet|vial|ampoule|amp)/.test(t) && !/(ml|gram|\bg\b|kg)/.test(t)) {
      return 'full_pcs';
    }
    if (/(ml|gram|\bg\b|kg|liquid|powder)/.test(t)) return 'measurable';
  }
  return 'full_pcs';
}

function inferUnitLabel(itemType: 'full_pcs' | 'measurable', rawUnit: string, packagingText: string): string {
  const u = (rawUnit || '').toLowerCase().trim();
  if (itemType === 'measurable') {
    if (/ml/.test(packagingText)) return 'ml';
    if (/(g|gram)/.test(packagingText)) return 'g';
    if (MEASURABLE_UNITS.includes(u as any)) return u;
    return 'g';
  }
  // full_pcs
  if (!u) return 'piece';
  if (u === 'pk') return 'pack';
  if (u === 'tube') return 'tube';
  if (u === 'vial') return 'vial';
  if (u === 'bottle') return 'bottle';
  if (u === 'sachet') return 'sachet';
  if (u === 'strip') return 'strip';
  return u;
}

interface ImportCsvDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

interface ActiveIngredient {
  rowIndex: number;
  ingredient_name: string;
  strength: string | null;
}

interface ParsedRow {
  rowIndex: number;
  raw: Record<string, string>;
  errors: string[];
  isDuplicate: boolean;
  // normalized values
  name: string;
  generic_name: string | null;
  category: string;
  manufacturer: string | null;
  batch_number: string | null;
  item_type: 'full_pcs' | 'measurable';
  unit_label: string;
  packaging_mode: 'with_strip' | 'no_strip';
  strips_per_pack: number | null;
  units_per_strip: number | null;
  units_per_pack: number | null;
  purchase_price: number;
  selling_price: number;
  lpi_price_mode: boolean;
  stock_quantity: number;
  minimum_stock_level: number;
  expiry_date: string | null;
  // Pharmacy-only (optional)
  medicine_group: string | null;
  strength: string | null;
  // Multi-level packaging (optional)
  container_type: string | null;
  main_unit_name: string | null;
  sub_unit_name: string | null;
  sub_units_per_unit: number | null;
  unit_price: number | null;
  sub_unit_price: number | null;
  // Pharmacy hierarchical composition (rows with empty name attach here)
  active_ingredients: ActiveIngredient[];
  // Additional batches for the same item (multi-batch upload via continuation rows)
  extra_batches: Array<{
    rowIndex: number;
    batch_number: string | null;
    stock_quantity: number;
    purchase_price: number;
    selling_price: number;
    expiry_date: string | null;
    minimum_stock_level: number | null;
  }>;
}

// Final-template column order — pharmacy and general share the parser, but the
// downloaded template surfaces only the columns relevant to that branch type.
const PHARMACY_HEADERS = [
  'NAME OF ITEMS', 'GENERIC NAME', 'STRENGTH', 'CATEGORY',
  'BATCH NO', 'NAME OF UNIT',
  'STRIPS PER PACK', 'TABLETS PER STRIP',
  'LPI BUY', 'LPI SELL', 'LPI STOCK', 'MIN STOCK (LPI)', 'EXPIRY DATE',
];

const GENERAL_HEADERS = [
  'ITEM NAME', 'CATEGORY', 'NAME OF UNIT',
  'UNITS PER ITEM',
  'LPI BUY', 'LPI SELL', 'LPI STOCK', 'MIN STOCK (LPI)', 'EXPIRY DATE',
];

// Optional canonical columns (may be missing — alias-matched only when present)
const OPTIONAL_HEADERS = new Set(['medicine_group', 'strength']);

// NAME OF UNIT = friendly label of the LPI (Least Possible Item / smallest
// indivisible unit, e.g. tablet, capsule, pcs, ml). All LPI BUY / LPI SELL /
// LPI STOCK values are expressed in this unit. Packaging mode is auto-derived:
// filling both STRIPS PER PACK and TABLETS PER STRIP marks the item as stripped;
// otherwise it's a no-strip item (bottle / sachet / single pcs).
const SAMPLE_PHARMACY = [
  // NAME, GENERIC, STRENGTH, CATEGORY, BATCH, NAME OF UNIT, STRIPS/PACK, TABLETS/STRIP, LPI BUY, LPI SELL, LPI STOCK, MIN STOCK, EXPIRY
  ['Paracetamol 500mg', 'Paracetamol', '500mg',     'tablet', 'BN-PCM-01',   'tablet', '3', '10', '6',   '10',  '1500', '100', '2027-06-30'],
  ['Etricox 90mg',      'Etoricoxib',  '90mg',      'tablet', 'BN-ETR-09',   'tablet', '3', '10', '14',  '20',  '900',  '60',  '2026-12-31'],
  ['Amoxicillin Syrup', 'Amoxicillin', '250mg/5ml', 'syrup',  'BN-AMX-2026', 'ml',     '',  '',   '0.6', '0.93','1875', '200', '2026-08-15'],
];

const SAMPLE_GENERAL = [
  // ITEM NAME, CATEGORY, NAME OF UNIT, UNITS PER ITEM, LPI BUY, LPI SELL, LPI STOCK, MIN STOCK, EXPIRY
  ['Carton Milk 1L',  'grocery',  'bottle', '24', '75',  '100', '480', '50', ''],
  ['Cooking Oil 1L',  'grocery',  'bottle', '1',  '120', '150', '60',  '10', '2027-01-31'],
  ['Soap Bar Pack',   'cleaning', 'pcs',    '6',  '15',  '20',  '240', '30', ''],
];

function escapeCsv(v: string): string {
  if (v == null) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildTemplate(mode: 'pharmacy' | 'general'): string {
  const headers = mode === 'pharmacy' ? PHARMACY_HEADERS : GENERAL_HEADERS;
  const sample = mode === 'pharmacy' ? SAMPLE_PHARMACY : SAMPLE_GENERAL;
  const lines = [headers.join(',')];
  sample.forEach(row => lines.push(row.map(escapeCsv).join(',')));
  return lines.join('\n');
}

// Required columns by template mode (highlighted red + frozen in xlsx export)
const REQUIRED_PHARMACY = new Set([
  'NAME OF ITEMS', 'NAME OF UNIT', 'LPI BUY', 'LPI SELL', 'LPI STOCK', 'MIN STOCK (LPI)',
]);
const REQUIRED_GENERAL = new Set([
  'ITEM NAME', 'NAME OF UNIT', 'LPI BUY', 'LPI SELL', 'LPI STOCK', 'MIN STOCK (LPI)',
]);

// Batch-only / batch-continuation columns. On extra batch rows the user fills
// only these; all other columns may be left empty.
const BATCH_COLUMNS = new Set([
  'BATCH NO', 'LPI BUY', 'LPI SELL', 'LPI STOCK', 'MIN STOCK (LPI)', 'EXPIRY DATE',
]);

async function buildTemplateXlsx(mode: 'pharmacy' | 'general'): Promise<Blob> {
  const ExcelJS = (await import('exceljs')).default;
  const headers = mode === 'pharmacy' ? PHARMACY_HEADERS : GENERAL_HEADERS;
  const sample = mode === 'pharmacy' ? SAMPLE_PHARMACY : SAMPLE_GENERAL;
  const required = mode === 'pharmacy' ? REQUIRED_PHARMACY : REQUIRED_GENERAL;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Inventory', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  const NUMERIC_HEADERS = new Set([
    'STRIPS PER PACK', 'TABLETS PER STRIP', 'UNITS PER ITEM',
    'LPI BUY', 'LPI SELL', 'LPI STOCK', 'MIN STOCK (LPI)',
  ]);
  const TEXT_HEADERS = new Set([
    'NAME OF ITEMS', 'ITEM NAME', 'GENERIC NAME', 'STRENGTH', 'CATEGORY',
    'BATCH NO', 'NAME OF UNIT',
  ]);
  const DATE_HEADERS = new Set(['EXPIRY DATE']);

  ws.addRow(headers);
  sample.forEach(r => {
    const coerced = r.map((v, i) => {
      const h = headers[i];
      if (NUMERIC_HEADERS.has(h)) {
        if (v === '' || v == null) return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : v;
      }
      return v;
    });
    ws.addRow(coerced);
  });

  headers.forEach((h, i) => {
    const col = ws.getColumn(i + 1);
    if (NUMERIC_HEADERS.has(h)) col.numFmt = '0';
    else if (DATE_HEADERS.has(h)) col.numFmt = 'dd/mm/yyyy';
    else if (TEXT_HEADERS.has(h)) col.numFmt = '@';
  });

  const RED = 'FFDC2626';
  const ORANGE = 'FFF59E0B';
  const GRAY = 'FFE5E7EB';

  const headerRow = ws.getRow(1);
  headerRow.height = 28;
  headerRow.eachCell((cell, colNumber) => {
    const label = headers[colNumber - 1];
    const isRequired = required.has(label);
    const isBatch = BATCH_COLUMNS.has(label);
    const isBoth = isRequired && isBatch;

    let fill: any;
    if (isBoth) {
      // Diagonal split: red top-left → orange bottom-right
      fill = {
        type: 'gradient',
        gradient: 'angle',
        degree: 135,
        stops: [
          { position: 0, color: { argb: RED } },
          { position: 0.5, color: { argb: RED } },
          { position: 0.5001, color: { argb: ORANGE } },
          { position: 1, color: { argb: ORANGE } },
        ],
      };
    } else if (isRequired) {
      fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: RED } };
    } else if (isBatch) {
      fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ORANGE } };
    } else {
      fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRAY } };
    }

    cell.fill = fill;
    cell.font = {
      bold: true,
      color: { argb: (isRequired || isBatch) ? 'FFFFFFFF' : 'FF111827' },
      size: 12,
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF9CA3AF' } },
      left: { style: 'thin', color: { argb: 'FF9CA3AF' } },
      bottom: { style: 'medium', color: { argb: 'FF6B7280' } },
      right: { style: 'thin', color: { argb: 'FF9CA3AF' } },
    };
  });

  headers.forEach((h, i) => {
    let max = h.length;
    sample.forEach(r => { const v = String(r[i] ?? ''); if (v.length > max) max = v.length; });
    ws.getColumn(i + 1).width = Math.min(Math.max(max + 2, 12), 32);
  });

  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };

  // Legend sheet
  const legend = wb.addWorksheet('Legend');
  legend.columns = [
    { header: 'Color', key: 'color', width: 28 },
    { header: 'Meaning', key: 'meaning', width: 80 },
  ];
  legend.getRow(1).font = { bold: true, size: 12 };
  legend.getRow(1).alignment = { vertical: 'middle' };

  const legendRows = [
    { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: RED } }, fontColor: 'FFFFFFFF', label: 'Red', meaning: 'Required for every primary item row (the first row of each item).' },
    { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: ORANGE } }, fontColor: 'FFFFFFFF', label: 'Orange', meaning: 'Fill this on additional batch rows. Leave all other (non-orange) columns empty on those rows.' },
    {
      fill: {
        type: 'gradient', gradient: 'angle', degree: 135,
        stops: [
          { position: 0, color: { argb: RED } },
          { position: 0.5, color: { argb: RED } },
          { position: 0.5001, color: { argb: ORANGE } },
          { position: 1, color: { argb: ORANGE } },
        ],
      },
      fontColor: 'FFFFFFFF',
      label: 'Red / Orange (split)',
      meaning: 'Both required on the primary row AND the key field to fill on batch-continuation rows.',
    },
    { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: GRAY } }, fontColor: 'FF111827', label: 'Gray', meaning: 'Optional. Fill on the primary row only if relevant.' },
  ];

  legendRows.forEach((r) => {
    const row = legend.addRow({ color: r.label, meaning: r.meaning });
    row.height = 24;
    const cell = row.getCell(1);
    cell.fill = r.fill as any;
    cell.font = { bold: true, color: { argb: r.fontColor } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    row.getCell(2).alignment = { vertical: 'middle', wrapText: true };
  });

  legend.addRow([]);
  const tip = legend.addRow(['Tip', 'On a continuation batch row, leave NAME OF ITEMS empty and fill the orange columns (Batch No, LPI Buy, LPI Sell, LPI Stock, Min Stock, Expiry).']);
  tip.getCell(1).font = { bold: true };
  tip.getCell(2).alignment = { wrapText: true };
  tip.height = 36;

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

// Simple CSV parser supporting quoted fields with commas and "" escapes
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let i = 0;
  let inQuotes = false;
  // strip BOM
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ',') { cur.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field.length > 0 || cur.length > 0) { cur.push(field); rows.push(cur); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

export default function ImportCsvDialog({ open, onOpenChange, onImported }: ImportCsvDialogProps) {
  const { toast } = useToast();
  const { profile } = useAuth();
  const { selectedBranch, branchType } = useBranchContext();
  const isPharmacy = branchType === 'pharmacy';
  const fileRef = useRef<HTMLInputElement>(null);

  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string>('');
  const [step, setStep] = useState<'upload' | 'preview' | 'importing'>('upload');
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [duplicateAction, setDuplicateAction] = useState<'skip' | 'create_new'>('skip');
  const [submitting, setSubmitting] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0, success: 0, failed: 0, currentName: '' });

  useEffect(() => {
    if (!open) return;
    setStep('upload');
    setParsedRows([]);
    setParseErrors([]);
    setDuplicateAction('skip');
    if (fileRef.current) fileRef.current.value = '';
    fetchBranches();
  }, [open, profile, selectedBranch]);

  const fetchBranches = async () => {
    if (!profile) return;
    if (profile.role === 'staff' && profile.branch_id) {
      setSelectedBranchId(profile.branch_id);
      return;
    }
    if (profile.role === 'owner') {
      const { data } = await supabase
        .from('pharmacy_branches')
        .select('id, name')
        .eq('pharmacy_owner_id', profile.id)
        .order('is_main_branch', { ascending: false })
        .order('name');
      setBranches(data || []);
      if (selectedBranch) setSelectedBranchId(selectedBranch);
      else if (data && data.length > 0) setSelectedBranchId(data[0].id);
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      const mode = isPharmacy ? 'pharmacy' : 'general';
      const filename = `inventory-import-template-${mode}.xlsx`;
      const blob = await buildTemplateXlsx(mode);

      // iOS/Android Safari + in-app browsers don't reliably trigger download
      // from a detached <a>. Append to DOM, use rel=noopener, and as a last
      // resort fall back to opening the blob in a new tab so the user can save it.
      const nav: any = navigator;
      if (nav.msSaveOrOpenBlob) {
        nav.msSaveOrOpenBlob(blob, filename);
        return;
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.rel = 'noopener';
      a.target = '_blank';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();

      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 1500);
    } catch (e: any) {
      toast({ title: 'Failed to build template', description: e?.message || 'Unknown error', variant: 'destructive' });
    }
  };

  const validateAndNormalize = async (rows: any[][]): Promise<{ ok: ParsedRow[]; errs: string[] }> => {
    const errs: string[] = [];
    if (rows.length < 2) {
      return { ok: [], errs: ['File is empty or has no data rows.'] };
    }

    // Auto-detect the header row: skip leading rows that are blank, or that
    // contain a single title cell (e.g. "Drug List 2026"), and stop at the
    // first row whose cells map to ≥3 known canonical columns.
    let headerRowIdx = 0;
    let bestRecognized = 0;
    let bestHasName = false;
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      const cells = rows[i] || [];
      let recognized = 0;
      let hasName = false;
      cells.forEach((h: any) => {
        const k = canonicalHeader(String(h ?? ''));
        if (k) {
          recognized += 1;
          if (k === 'name') hasName = true;
        }
      });
      // Prefer rows that include the canonical "name" column. Only fall back to
      // a name-less row if no candidate row contains it.
      const better = hasName === bestHasName
        ? recognized > bestRecognized
        : hasName && !bestHasName;
      if (better) {
        bestRecognized = recognized;
        bestHasName = hasName;
        headerRowIdx = i;
      }
      if (hasName && recognized >= 3) break;
    }

    // Build header → canonical-key map by alias matching. Unknown columns are ignored.
    const rawHeaders = rows[headerRowIdx].map((h: any) => String(h ?? ''));
    const headerToKey: Record<number, string> = {};
    rawHeaders.forEach((h, i) => {
      const k = canonicalHeader(h);
      if (k) headerToKey[i] = k;
    });
    const keyIndex: Record<string, number> = {};
    Object.entries(headerToKey).forEach(([i, k]) => {
      if (keyIndex[k] === undefined) keyIndex[k] = +i;
    });

    // Required columns. LPI-based template (LPI BUY / LPI SELL / LPI STOCK) is
    // accepted as an alternative to the legacy (purchase_price / selling_price /
    // stock_quantity) columns.
    const hasLpiBuy   = keyIndex['lpi_buy']   !== undefined;
    const hasLpiSell  = keyIndex['lpi_sell']  !== undefined;
    const hasLpiStock = keyIndex['lpi_stock'] !== undefined;
    const required = ['name'];
    const missingReq = required.filter(k => keyIndex[k] === undefined);
    if (!hasLpiBuy   && keyIndex['purchase_price']  === undefined) missingReq.push('LPI BUY (or purchase price)');
    if (!hasLpiSell  && keyIndex['selling_price']   === undefined && keyIndex['pack_price'] === undefined) missingReq.push('LPI SELL (or selling/medicine/item price)');
    if (!hasLpiStock && keyIndex['stock_quantity']  === undefined) missingReq.push('LPI STOCK (or stock quantity)');
    if (keyIndex['minimum_stock_level'] === undefined) missingReq.push('MIN STOCK (LPI)');
    if (missingReq.length > 0) {
      const recognizedList = Object.values(headerToKey).join(', ') || '(none)';
      return { ok: [], errs: [`Missing required column(s): ${missingReq.join(', ')}. Header row detected at row ${headerRowIdx + 1}. Recognized headers: ${recognizedList}. Tip: make sure your header row is the first non-empty row and column names match (e.g. "NAME OF ITEMS", "NAME OF UNIT", "LPI BUY", "LPI SELL", "LPI STOCK", "MIN STOCK (LPI)").`] };
    }
    const get = (cells: any[], k: string): string => {
      const i = keyIndex[k];
      if (i === undefined) return '';
      const v = cells[i];
      if (v == null) return '';
      return String(v).trim();
    };
    const getRaw = (cells: any[], k: string): any => {
      const i = keyIndex[k];
      return i === undefined ? '' : cells[i];
    };

    // Duplicate detection is BRANCH-SCOPED: an item is only considered a
    // duplicate if it already exists in the SAME target branch. The same
    // medicine living in a different branch (or a different owner's account)
    // must not be flagged as a duplicate here.
    const existingKey = new Set<string>();
    if (selectedBranchId) {
      const { data: branchRows } = await supabase
        .from('branch_items')
        .select('medicine_id, medicines:medicine_id(name, manufacturer, strength, batch_number)')
        .eq('branch_id', selectedBranchId);
      (branchRows || []).forEach((r: any) => {
        const m = r.medicines || {};
        existingKey.add(`${(m.name || '').toLowerCase().trim()}|${(m.manufacturer || '').toLowerCase().trim()}|${(m.strength || '').toLowerCase().trim()}|${(m.batch_number || '').toLowerCase().trim()}`);
      });
    }

    const seenInFile = new Set<string>();
    const out: ParsedRow[] = [];
    let groupCarry: string | null = null; // GROUP cell only filled on first row of a group

    for (let r = headerRowIdx + 1; r < rows.length; r++) {
      const cells = rows[r] || [];
      if (!cells.some((c: any) => c != null && String(c).trim() !== '')) continue; // blank row
      const rowErrors: string[] = [];

      let name = get(cells, 'name');
      const generic_name_raw = get(cells, 'generic_name');
      const strengthRaw = getRaw(cells, 'strength');
      const groupCell = get(cells, 'medicine_group');
      if (groupCell) groupCarry = groupCell;

      // Detect standalone-medicine signals: any inventory/pricing/batch data
      // means this row is its own medicine, even if NAME OF ITEMS is empty.
      const hasStandaloneSignal = (
        get(cells, 'batch_number') !== '' ||
        get(cells, 'lpi_buy') !== '' ||
        get(cells, 'lpi_sell') !== '' ||
        get(cells, 'lpi_stock') !== '' ||
        get(cells, 'purchase_price') !== '' ||
        get(cells, 'selling_price') !== '' ||
        get(cells, 'pack_price') !== '' ||
        get(cells, 'stock_quantity') !== '' ||
        get(cells, 'minimum_stock_level') !== '' ||
        get(cells, 'expiry_date') !== ''
      );

      // Multi-batch upload: empty NAME + has batch/inventory data → attach as
      // an extra batch on the most recent parent row.
      if (!name && hasStandaloneSignal && out.length > 0) {
        const parent = out[out.length - 1];
        const stockRawC = get(cells, 'lpi_stock') || get(cells, 'stock_quantity');
        const buyRawC = get(cells, 'lpi_buy') || get(cells, 'purchase_price');
        const sellRawC = get(cells, 'lpi_sell') || get(cells, 'selling_price') || get(cells, 'pack_price');
        const minRawC = get(cells, 'minimum_stock_level');
        const expRawC = getRaw(cells, 'expiry_date');
        const expParsedC = parseExpiryDate(expRawC);
        const stockN = stockRawC ? parseFloat(stockRawC) : 0;
        const buyN = buyRawC ? parseFloat(buyRawC) : parent.purchase_price;
        const sellN = sellRawC ? parseFloat(sellRawC) : parent.selling_price;
        const minN = minRawC ? parseLeadingInt(minRawC) : null;
        parent.extra_batches.push({
          rowIndex: r + 1,
          batch_number: get(cells, 'batch_number') || null,
          stock_quantity: isNaN(stockN) || stockN < 0 ? 0 : stockN,
          purchase_price: isNaN(buyN) || buyN < 0 ? parent.purchase_price : buyN,
          selling_price: isNaN(sellN) || sellN < 0 ? parent.selling_price : sellN,
          expiry_date: expParsedC.iso,
          minimum_stock_level: minN,
        });
        continue;
      }

      // Pharmacy hierarchy: an empty-NAME row with ONLY generic/strength (no
      // inventory data) is an ingredient continuation of the medicine above.
      // If the row carries real inventory data, treat it as a standalone
      // medicine and fall back to GENERIC NAME as the item name.
      if (isPharmacy && !name) {
        if (generic_name_raw && !hasStandaloneSignal) {
          const parent = out[out.length - 1];
          if (parent) {
            parent.active_ingredients.push({
              rowIndex: r + 1,
              ingredient_name: generic_name_raw,
              strength: normalizeStrength(strengthRaw),
            });
            continue;
          }
          // No parent above → fall through and treat as standalone item.
        }
        if (generic_name_raw) {
          name = generic_name_raw;
        } else {
          // Nothing usable → skip silently.
          continue;
        }
      }

      if (!name) rowErrors.push('column "NAME OF ITEMS" is empty (required)');

      const itemTypeRaw = get(cells, 'item_type');
      const unitLabelRaw = get(cells, 'unit_label');
      const packagingRaw = get(cells, 'packaging_mode');

      // Detect strip-style packaging from explicit cells FIRST so item_type can
      // infer from unit label without forcing "tablet" → measurable later.
      const stripsCell = parseInt(get(cells, 'strips_per_pack'));
      const tabletsCell = parseInt(get(cells, 'units_per_strip'));
      const unitsPerPackCell = parseInt(get(cells, 'units_per_pack'));

      const item_type: 'full_pcs' | 'measurable' = (() => {
        const v = itemTypeRaw.toLowerCase();
        if (v === 'measurable' || v === 'full_pcs') return v as any;
        return inferItemType(itemTypeRaw, unitLabelRaw);
      })();
      const unit_label = inferUnitLabel(item_type, unitLabelRaw, packagingRaw);
      if (item_type === 'measurable' && !MEASURABLE_UNITS.includes(unit_label as any)) {
        rowErrors.push(`column "NAME OF UNIT" = "${unit_label}" is invalid for a measurable item — use one of: ${MEASURABLE_UNITS.join(', ')}`);
      }

      // Packaging is auto-derived from STRIPS PER PACK + TABLETS PER STRIP.
      // Backwards compatible: still accept a legacy PACKAGING MODE cell when present.
      let packaging_mode: 'with_strip' | 'no_strip' = 'no_strip';
      let strips_per_pack: number | null = null;
      let units_per_strip: number | null = null;
      let units_per_pack: number | null = null;

      if (!isNaN(stripsCell) && stripsCell > 0 && !isNaN(tabletsCell) && tabletsCell > 0) {
        packaging_mode = 'with_strip';
        strips_per_pack = stripsCell;
        units_per_strip = tabletsCell;
        units_per_pack = stripsCell * tabletsCell;
      } else if (packagingRaw) {
        const packagingNorm = packagingRaw.toLowerCase().trim();
        if (packagingNorm === 'with_strip' || packagingNorm === 'standard_strip') {
          packaging_mode = 'with_strip';
        } else {
          const parsed = parsePackagingMode(packagingRaw);
          if (parsed.isStripLayout) {
            packaging_mode = 'with_strip';
            strips_per_pack = parsed.stripsPerPack;
            units_per_strip = parsed.unitsPerStrip;
            units_per_pack = (parsed.stripsPerPack || 0) * (parsed.unitsPerStrip || 0);
          }
        }
      }
      if (units_per_pack == null && !isNaN(unitsPerPackCell) && unitsPerPackCell >= 1) {
        units_per_pack = unitsPerPackCell;
      }

      // ---- PRICES & STOCK -------------------------------------------------
      // Two accepted modes:
      //   (A) NEW  LPI-based: LPI BUY / LPI SELL / LPI STOCK are per-LPI values.
      //       Pack-level prices/stock are derived using units_per_pack.
      //   (B) LEGACY pack-level: PURCHASE PRICE / SELLING PRICE / STOCK QUANTITY.
      const lpiBuyRaw   = get(cells, 'lpi_buy');
      const lpiSellRaw  = get(cells, 'lpi_sell');
      const lpiStockRaw = get(cells, 'lpi_stock');
      const purchaseRaw = get(cells, 'purchase_price');
      const sellingRaw  = get(cells, 'selling_price');
      const packPriceRaw = get(cells, 'pack_price');
      const stockRaw    = get(cells, 'stock_quantity');

      const unitsPerPackForCalc = units_per_pack && units_per_pack > 0 ? units_per_pack : 1;

      let purchase_price: number;
      let selling_price: number;
      let usingPackLevelPrice = false; // tracks whether the SELL side is already pack-level
      // When true, purchase_price/selling_price are stored as per-LPI (smallest-unit)
      // values exactly as the user entered them — no pack multiplication.
      let lpi_price_mode = false;

      // BUY price
      if (lpiBuyRaw !== '') {
        const lpiBuy = parseFloat(lpiBuyRaw);
        if (isNaN(lpiBuy) || lpiBuy < 0) {
          rowErrors.push(`column "LPI BUY" = "${lpiBuyRaw}" is not a valid number ≥ 0`);
          purchase_price = 0;
        } else {
          // Save the per-LPI buy price exactly as entered.
          purchase_price = lpiBuy;
          lpi_price_mode = true;
        }
      } else {
        purchase_price = parseFloat(purchaseRaw);
        if (!purchaseRaw || isNaN(purchase_price) || purchase_price < 0) {
          rowErrors.push(`column "LPI BUY" (or PURCHASE PRICE) = "${purchaseRaw}" is missing or not a valid number ≥ 0`);
          purchase_price = 0;
        }
      }

      // SELL price
      if (lpiSellRaw !== '') {
        const lpiSell = parseFloat(lpiSellRaw);
        if (isNaN(lpiSell) || lpiSell < 0) {
          rowErrors.push(`column "LPI SELL" = "${lpiSellRaw}" is not a valid number ≥ 0`);
          selling_price = 0;
        } else {
          // Save the per-LPI sell price exactly as entered.
          selling_price = lpiSell;
          lpi_price_mode = true;
        }
      } else {
        const pickedPackPrice = packPriceRaw ? parseFloat(packPriceRaw) : NaN;
        usingPackLevelPrice = !isNaN(pickedPackPrice);
        selling_price = usingPackLevelPrice ? pickedPackPrice : parseFloat(sellingRaw);
        const sellingLabel = usingPackLevelPrice ? 'MEDICINE/ITEM PRICE' : 'SELLING PRICE';
        if ((!sellingRaw && !packPriceRaw) || isNaN(selling_price) || selling_price < 0) {
          rowErrors.push(`column "LPI SELL" (or ${sellingLabel}) = "${sellingRaw || packPriceRaw}" is missing or not a valid number ≥ 0`);
          selling_price = 0;
        }
      }

      // Legacy per-strip → per-pack conversion (only when neither LPI nor pack price was used)
      if (!lpi_price_mode && !usingPackLevelPrice && packaging_mode === 'with_strip' && strips_per_pack && strips_per_pack > 1) {
        if (!isNaN(purchase_price)) purchase_price = +(purchase_price * strips_per_pack).toFixed(2);
        if (!isNaN(selling_price)) selling_price = +(selling_price * strips_per_pack).toFixed(2);
      }

      // STOCK
      let stock_quantity: number;
      if (lpiStockRaw !== '') {
        const lpiStock = parseFloat(lpiStockRaw);
        if (isNaN(lpiStock) || lpiStock < 0) {
          rowErrors.push(`column "LPI STOCK" = "${lpiStockRaw}" is not a valid number ≥ 0`);
          stock_quantity = 0;
        } else {
          // Stock is stored as total smallest units (LPI). No pack conversion.
          stock_quantity = item_type === 'measurable' ? lpiStock : Math.round(lpiStock);
        }
      } else {
        stock_quantity = item_type === 'measurable' ? parseFloat(stockRaw) : parseInt(stockRaw);
        if (!stockRaw || isNaN(stock_quantity) || stock_quantity < 0) {
          rowErrors.push(`column "LPI STOCK" (or STOCK QUANTITY) = "${stockRaw}" is missing or not a valid number ≥ 0`);
          stock_quantity = 0;
        }
      }

      const minRaw = get(cells, 'minimum_stock_level');
      // accept "1 PK", "3 tubes" etc. Required field — must be a number ≥ 0.
      const minParsed = minRaw ? parseLeadingInt(minRaw) : null;
      const minimum_stock_level = minParsed ?? 0;
      if (!minRaw || minParsed == null || minParsed < 0) {
        rowErrors.push(`column "MIN STOCK (LPI)" = "${minRaw}" is missing or not a valid number ≥ 0`);
      }

      const expRaw = getRaw(cells, 'expiry_date');
      const expParsed = parseExpiryDate(expRaw);
      if (expParsed.hadValue && !expParsed.valid) {
        rowErrors.push(`column "EX-DATE" = "${String(expRaw)}" is not a valid date (use DD/MM/YYYY or YYYY-MM-DD; check that the day actually exists in that month)`);
      }
      const expiry_date = expParsed.iso;

      const generic_name = generic_name_raw || null;
      const manufacturer = get(cells, 'manufacturer') || null;
      const batch_number = get(cells, 'batch_number') || null;
      const category = get(cells, 'category') || (isPharmacy ? 'tablet' : 'other');
      const medicine_group = isPharmacy ? (groupCell || groupCarry || null) : null;
      const strength = isPharmacy ? normalizeStrength(getRaw(cells, 'strength')) : null;

      // Multi-level packaging (all optional)
      const container_type = get(cells, 'container_type') || null;
      const sub_unit_name = get(cells, 'sub_unit_name') || null;
      const subUnitsRaw = get(cells, 'sub_units_per_unit');
      let sub_units_per_unit = subUnitsRaw && parseInt(subUnitsRaw) > 0 ? parseInt(subUnitsRaw) : null;
      // Pharmacy template "TABLETS PER STRIP" feeds units_per_strip; mirror it
      // into sub_units_per_unit so the 3-tier (pack→strip→tablet) hierarchy
      // works at sale time without forcing the user to fill it twice.
      if (!sub_units_per_unit && isPharmacy && units_per_strip && units_per_strip > 1) {
        sub_units_per_unit = units_per_strip;
      }
      const unitPriceRaw = get(cells, 'unit_price');
      let unit_price: number | null = unitPriceRaw && !isNaN(parseFloat(unitPriceRaw)) ? parseFloat(unitPriceRaw) : null;
      const subUnitPriceRaw = get(cells, 'sub_unit_price');
      let sub_unit_price: number | null = subUnitPriceRaw && !isNaN(parseFloat(subUnitPriceRaw)) ? parseFloat(subUnitPriceRaw) : null;

      // Derive missing tier prices from the saved sell price.
      //   - In LPI price mode, `selling_price` IS the per-LPI (smallest unit) price,
      //     so unit/sub-unit prices equal it directly (no division).
      //   - In legacy/pack mode, `selling_price` is pack-level, so we divide.
      if (selling_price > 0) {
        if (lpi_price_mode) {
          if (isPharmacy && packaging_mode === 'with_strip' && units_per_strip && units_per_strip > 0) {
            // unit_price represents the STRIP price; sub_unit_price the TABLET price.
            if (sub_unit_price == null) sub_unit_price = selling_price;
            if (unit_price == null) unit_price = +(selling_price * units_per_strip).toFixed(4);
          } else {
            if (unit_price == null) unit_price = selling_price;
          }
        } else if (isPharmacy && packaging_mode === 'with_strip' && strips_per_pack && strips_per_pack > 0) {
          if (unit_price == null) unit_price = +(selling_price / strips_per_pack).toFixed(4);
          if (sub_unit_price == null && units_per_strip && units_per_strip > 0) {
            sub_unit_price = +(unit_price / units_per_strip).toFixed(4);
          }
        } else if (!isPharmacy && units_per_pack && units_per_pack > 0) {
          if (unit_price == null) unit_price = +(selling_price / units_per_pack).toFixed(4);
        }
      }

      const main_unit_name = container_type;

      const key = `${name.toLowerCase()}|${(manufacturer || '').toLowerCase()}|${(strength || '').toLowerCase()}|${(batch_number || '').toLowerCase()}`;
      if (seenInFile.has(key)) rowErrors.push(`duplicate of another row in this file (same NAME OF ITEMS "${name}", manufacturer "${manufacturer || '—'}", strength "${strength || '—'}", BATCH NO "${batch_number || '—'}"). If these are different items, set a different STRENGTH, BATCH NO, or MANUFACTURER to distinguish them.`);
      seenInFile.add(key);
      const isDuplicate = name ? existingKey.has(key) : false;

      const initialIngredients: ActiveIngredient[] = [];
      if (isPharmacy && generic_name_raw) {
        initialIngredients.push({
          rowIndex: r + 1,
          ingredient_name: generic_name_raw,
          strength: strength,
        });
      }

      out.push({
        rowIndex: r + 1,
        raw: Object.fromEntries(rawHeaders.map((h, i) => [String(h), cells[i] != null ? String(cells[i]) : ''])),
        errors: rowErrors,
        isDuplicate,
        name,
        generic_name,
        category,
        manufacturer,
        batch_number,
        item_type,
        unit_label,
        packaging_mode,
        strips_per_pack,
        units_per_strip,
        units_per_pack,
        purchase_price: isNaN(purchase_price) ? 0 : purchase_price,
        selling_price: isNaN(selling_price) ? 0 : selling_price,
        lpi_price_mode,
        stock_quantity: isNaN(stock_quantity) ? 0 : stock_quantity,
        minimum_stock_level: isNaN(minimum_stock_level) ? 0 : minimum_stock_level,
        expiry_date,
        medicine_group,
        strength,
        container_type,
        main_unit_name,
        sub_unit_name,
        sub_units_per_unit,
        unit_price,
        sub_unit_price,
        active_ingredients: initialIngredients,
        extra_batches: [],
      });
    }

    return { ok: out, errs };
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!selectedBranchId) {
      toast({ title: 'Select a branch', description: 'Please choose a branch before uploading.', variant: 'destructive' });
      e.target.value = '';
      return;
    }

    try {
      const isExcel = /\.(xlsx|xls)$/i.test(file.name);
      let rows: any[][];
      if (isExcel) {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array', cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, raw: true, defval: '' });
      } else {
        const text = await file.text();
        rows = parseCsv(text);
      }
      const { ok, errs } = await validateAndNormalize(rows);
      setParsedRows(ok);
      setParseErrors(errs);
      setStep('preview');
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Failed to read file', variant: 'destructive' });
    } finally {
      e.target.value = '';
    }
  };

  const rowsWithErrors = parsedRows.filter(r => r.errors.length > 0);
  const duplicates = parsedRows.filter(r => r.isDuplicate && r.errors.length === 0);
  const cleanRows = parsedRows.filter(r => r.errors.length === 0);
  const canImport = parseErrors.length === 0 && rowsWithErrors.length === 0 && cleanRows.length > 0;

  const handleImport = async () => {
    if (!canImport) return;
    if (!selectedBranchId) {
      toast({ title: 'Error', description: 'Select a branch first', variant: 'destructive' });
      return;
    }

    setSubmitting(true);
    setStep('importing');

    try {
      const { data: { user } } = await supabase.auth.getUser();
      const ownerId = profile?.role === 'owner' ? profile.id :
        (await supabase.from('pharmacy_branches').select('pharmacy_owner_id').eq('id', selectedBranchId).single()).data?.pharmacy_owner_id;

      // Resolve / create owner group for catalog linkage
      let groupId: string | null = null;
      if (ownerId) {
        const { data: og } = await supabase.from('owner_item_groups').select('group_id').eq('owner_id', ownerId).limit(1);
        if (og && og.length > 0) {
          groupId = og[0].group_id;
        } else {
          const { data: { user: gUser } } = await supabase.auth.getUser();
          const { data: newGroup, error: groupErr } = await supabase.from('grouped_items')
            .insert({
              group_name: 'Imported Items',
              business_type: isPharmacy ? 'pharmacy' : 'general',
              created_by: gUser?.id ?? null,
            })
            .select('id').single();
          if (groupErr) {
            console.warn('Could not create owner group (non-fatal):', groupErr.message);
          } else if (newGroup) {
            groupId = newGroup.id;
            await supabase.from('owner_item_groups').insert({ owner_id: ownerId, group_id: groupId });
          }
        }
      }

      const toImport = cleanRows.filter(r => !(r.isDuplicate && duplicateAction === 'skip'));

      let success = 0;
      let failed = 0;
      const failures: string[] = [];
      setImportProgress({ current: 0, total: toImport.length, success: 0, failed: 0, currentName: '' });

      for (let idx = 0; idx < toImport.length; idx++) {
        const row = toImport[idx];
        setImportProgress(p => ({ ...p, current: idx, currentName: row.name }));
        try {
          let medicineId: string | null = null;

          // Try reuse existing medicine if duplicate + create_new=false (skip path already filtered)
          if (row.isDuplicate && duplicateAction === 'skip') continue;

          // Always create a new medicine row (catalog entry) for clean imports.
          const medPayload: any = {
            name: row.name,
            generic_name: row.generic_name,
            category: row.category,
            manufacturer: row.manufacturer,
            batch_number: row.batch_number,
            item_type: row.item_type,
            unit_label: row.unit_label,
            units_per_pack: row.units_per_pack,
            minimum_stock_level: row.minimum_stock_level,
            purchase_price: row.purchase_price,
            selling_price: row.selling_price,
            stock_quantity: row.stock_quantity,
            branch_id: selectedBranchId,
            created_by: user?.id || null,
            expiry_date: row.expiry_date,
            packaging_mode: row.container_type || row.packaging_mode,
            main_unit_name: row.main_unit_name,
            sub_unit_name: row.sub_unit_name,
            sub_units_per_unit: row.sub_units_per_unit,
            unit_price: row.unit_price,
            sub_unit_price: row.sub_unit_price,
          };
          if (row.packaging_mode === 'with_strip') {
            medPayload.strips_per_pack = row.strips_per_pack;
            medPayload.units_per_strip = row.units_per_strip;
          }
          if (isPharmacy) {
            medPayload.medicine_group = row.medicine_group;
            medPayload.strength = row.strength;
          }

          const { data: newMed, error: medErr } = await supabase
            .from('medicines')
            .insert(medPayload)
            .select('id')
            .single();
          if (medErr) throw medErr;
          medicineId = newMed.id;

          // Link to owner's catalog group
          if (groupId && medicineId) {
            await supabase.from('grouped_item_members').insert({ group_id: groupId, medicine_id: medicineId });
          }

          // Persist multi-level packaging so Sales shows unit/strip/pack options
          // immediately (without requiring the user to open Edit + Save first).
          try {
            const stripEnabled = row.packaging_mode === 'with_strip'
              && !!row.units_per_strip && row.units_per_strip > 0;
            const packEnabled = stripEnabled
              && !!row.strips_per_pack && row.strips_per_pack > 1;
            const upp = (row.units_per_pack && row.units_per_pack > 0)
              ? row.units_per_pack
              : (stripEnabled && packEnabled
                  ? (row.strips_per_pack! * row.units_per_strip!)
                  : (stripEnabled ? row.units_per_strip! : 1));
            const unitSell = row.lpi_price_mode
              ? (row.selling_price || null)
              : (row.selling_price && upp > 0
                  ? +(row.selling_price / upp).toFixed(4)
                  : null);
            const stripSell = stripEnabled && unitSell != null && row.units_per_strip
              ? +(unitSell * row.units_per_strip).toFixed(2)
              : null;
            const packSell = packEnabled && stripSell != null && row.strips_per_pack
              ? +(stripSell * row.strips_per_pack).toFixed(2)
              : null;
            await (supabase as any).from('medicine_packaging').upsert({
              medicine_id: medicineId,
              unit_name: row.unit_label || 'unit',
              strip_enabled: stripEnabled,
              units_per_strip: stripEnabled ? row.units_per_strip : null,
              strip_name: stripEnabled ? 'strip' : null,
              pack_enabled: packEnabled,
              strips_per_pack: packEnabled ? row.strips_per_pack : null,
              pack_name: packEnabled ? 'pack' : null,
              unit_selling_price: unitSell,
              strip_selling_price: stripSell,
              pack_selling_price: packSell,
            }, { onConflict: 'medicine_id' });
          } catch (e) {
            console.warn('Failed to upsert medicine_packaging during import', e);
          }

          // Persist active ingredients (pharmacy hierarchical composition)
          if (isPharmacy && medicineId && row.active_ingredients.length > 0) {
            const ingredientRows = row.active_ingredients.map((ing, i) => ({
              medicine_id: medicineId,
              ingredient_name: ing.ingredient_name,
              strength: ing.strength,
              sort_order: i,
            }));
            await (supabase as any).from('medicine_active_ingredients').insert(ingredientRows);
          }

          // Create branch_item
          const { data: newBI, error: biErr } = await supabase.from('branch_items').insert({
            owner_id: ownerId,
            branch_id: selectedBranchId,
            medicine_id: medicineId,
            selling_price: row.selling_price,
            purchase_price: row.purchase_price,
            quantity: row.stock_quantity,
            expiry_date: row.expiry_date,
          }).select('id').single();
          if (biErr) throw biErr;

          // Create initial inventory batch (so FIFO works)
          if (row.stock_quantity > 0) {
            const { error: batchErr } = await createBatch({
              branchId: selectedBranchId,
              medicineId,
              branchItemId: newBI.id,
              batchNumber: row.batch_number,
              quantity: row.stock_quantity,
              purchasePrice: row.purchase_price,
              sellingPrice: row.selling_price,
              expiryDate: row.expiry_date,
              createdBy: user?.id || null,
            });
            if (batchErr) throw batchErr;
          }

          // Create additional batches from continuation rows
          for (const eb of row.extra_batches) {
            if (eb.stock_quantity <= 0) continue;
            const { error: ebErr } = await createBatch({
              branchId: selectedBranchId,
              medicineId,
              branchItemId: newBI.id,
              batchNumber: eb.batch_number,
              quantity: eb.stock_quantity,
              purchasePrice: eb.purchase_price,
              sellingPrice: eb.selling_price,
              expiryDate: eb.expiry_date,
              createdBy: user?.id || null,
            });
            if (ebErr) throw ebErr;
          }

          success++;
          setImportProgress(p => ({ ...p, success: p.success + 1 }));
        } catch (e: any) {
          failed++;
          failures.push(`Row ${row.rowIndex} (${row.name}): ${e.message || 'unknown error'}`);
          setImportProgress(p => ({ ...p, failed: p.failed + 1 }));
        }
      }

      setImportProgress(p => ({ ...p, current: toImport.length, currentName: '' }));
      const branchName = branches.find(b => b.id === selectedBranchId)?.name || 'selected branch';

      if (failed === 0) {
        toast({ title: '✅ Import complete', description: `${success} item(s) successfully added to ${branchName}.` });
      } else {
        toast({
          title: 'Import finished with errors',
          description: `${success} succeeded, ${failed} failed. ${failures.slice(0, 2).join(' • ')}`,
          variant: 'destructive',
        });
      }
      onImported();
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: 'Import failed', description: err.message || 'Unknown error', variant: 'destructive' });
      setStep('preview');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Import {isPharmacy ? 'Medicines' : 'Items'} from CSV / Excel
          </DialogTitle>
          <DialogDescription>
            Download the template, fill it with your items, then upload to bulk-create inventory.
          </DialogDescription>
        </DialogHeader>

        {step === 'upload' && (
          <div className="space-y-4">
            {profile?.role === 'owner' && branches.length > 0 && (
              <div className="space-y-2">
                <Label>Target Branch *</Label>
                <Select value={selectedBranchId} onValueChange={setSelectedBranchId}>
                  <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
                  <SelectContent>
                    {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-xs space-y-1">
                <p><strong>Accepted files:</strong> .csv, .xlsx, .xls.</p>
                <p><strong>Required:</strong> <code>NAME OF ITEMS</code>, <code>NAME OF UNIT</code>, <code>LPI BUY</code>, <code>LPI SELL</code>, <code>LPI STOCK</code>, <code>MIN STOCK (LPI)</code>.</p>
                <p><strong>LPI</strong> = <em>Least Possible Item</em> — the smallest indivisible unit (e.g. <code>tablet</code>, <code>capsule</code>, <code>pcs</code>, <code>ml</code>). <code>NAME OF UNIT</code> renames it.</p>
                <p><strong>Packaging is auto-derived:</strong> filling both <code>STRIPS PER PACK</code> and <code>TABLETS PER STRIP</code> = stripped layout; otherwise no-strip.</p>
                <p className="pt-1 border-t mt-1"><strong>📦 Multi-batch:</strong> List the same item across multiple rows for different batches. On continuation rows leave <code>NAME OF ITEMS</code> empty and fill only <code>BATCH NO</code>, <code>LPI BUY</code>, <code>LPI SELL</code>, <code>LPI STOCK</code>, <code>EXPIRY DATE</code>. Total stock = sum of all batches.</p>
                {isPharmacy && (
                  <p><strong>💊 Composition:</strong> Leave <code>NAME OF ITEMS</code> AND batch/stock columns empty and fill only GENERIC NAME + STRENGTH to add an <em>active ingredient</em> to the medicine above.</p>
                )}
              </AlertDescription>
            </Alert>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Button variant="outline" onClick={handleDownloadTemplate} className="h-auto py-4 flex-col gap-2">
                <Download className="h-5 w-5" />
                <span className="font-medium">Download Template</span>
                <span className="text-xs text-muted-foreground">Excel (.xlsx) — frozen header, required columns in red</span>
              </Button>

              <label className="cursor-pointer">
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                  className="hidden"
                  onChange={handleFile}
                />
                <Button
                  variant="default"
                  className="h-auto py-4 flex-col gap-2 w-full"
                  onClick={() => fileRef.current?.click()}
                  type="button"
                  disabled={!selectedBranchId}
                >
                  <Upload className="h-5 w-5" />
                  <span className="font-medium">Upload CSV / Excel</span>
                  <span className="text-xs opacity-80">{selectedBranchId ? 'Choose .csv, .xlsx or .xls…' : 'Select branch first'}</span>
                </Button>
              </label>
            </div>
          </div>
        )}

        {step === 'preview' && (
          <div className="space-y-4">
            {parseErrors.length > 0 && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <p className="font-semibold mb-1">File-level errors:</p>
                  <ul className="list-disc pl-4 text-xs">
                    {parseErrors.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border p-3 text-center">
                <div className="text-2xl font-bold">{parsedRows.length}</div>
                <div className="text-xs text-muted-foreground">Total rows</div>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <div className="text-2xl font-bold text-destructive">{rowsWithErrors.length}</div>
                <div className="text-xs text-muted-foreground">Invalid</div>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <div className="text-2xl font-bold text-warning">{duplicates.length}</div>
                <div className="text-xs text-muted-foreground">Duplicates</div>
              </div>
            </div>

            {rowsWithErrors.length > 0 && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <p className="font-semibold mb-1">
                    Found {rowsWithErrors.length} row(s) with problems. Fix these in your sheet, then re-upload — the entire file is rejected until all rows are valid:
                  </p>
                  <ul className="list-disc pl-4 text-xs max-h-60 overflow-y-auto space-y-1.5">
                    {rowsWithErrors.slice(0, 50).map(r => (
                      <li key={r.rowIndex}>
                        <strong>Row {r.rowIndex}</strong>{r.name ? ` — "${r.name}"` : ''}:
                        <ul className="list-[circle] pl-4 mt-0.5">
                          {r.errors.map((err, i) => <li key={i}>{err}</li>)}
                        </ul>
                      </li>
                    ))}
                    {rowsWithErrors.length > 50 && <li>…and {rowsWithErrors.length - 50} more row(s) with problems</li>}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {duplicates.length > 0 && rowsWithErrors.length === 0 && (
              <div className="space-y-2 rounded-lg border p-3 bg-warning/5">
                <p className="text-sm font-medium">⚠️ {duplicates.length} item(s) already exist in this branch (same name + manufacturer + strength + batch number):</p>
                <ul className="text-xs text-muted-foreground list-disc pl-4 max-h-24 overflow-y-auto">
                  {duplicates.slice(0, 8).map(d => <li key={d.rowIndex}>Row {d.rowIndex}: {d.name} {d.manufacturer ? `(${d.manufacturer})` : ''}</li>)}
                  {duplicates.length > 8 && <li>…and {duplicates.length - 8} more</li>}
                </ul>
                <div className="space-y-2 pt-1">
                  <Label className="text-xs">How to handle duplicates?</Label>
                  <Select value={duplicateAction} onValueChange={v => setDuplicateAction(v as any)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="skip">Skip duplicates (recommended)</SelectItem>
                      <SelectItem value="create_new">Create as new catalog entries anyway</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {canImport && rowsWithErrors.length === 0 && (
              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  Ready to import <strong>{cleanRows.length - (duplicateAction === 'skip' ? duplicates.length : 0)}</strong> item(s) into the selected branch.
                </AlertDescription>
              </Alert>
            )}

            {parsedRows.length > 0 && (
              <div className="border rounded-lg overflow-x-auto max-h-72">
                <table className="w-full text-xs">
                  <thead className="bg-muted sticky top-0 z-10">
                    <tr>
                      <th className="text-left p-2">Row</th>
                      <th className="text-left p-2">Item / Batch</th>
                      <th className="text-left p-2">Stock</th>
                      <th className="text-left p-2">Buy / Sell</th>
                      <th className="text-left p-2">Expiry</th>
                      <th className="text-left p-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedRows.slice(0, 50).map(r => {
                      const batchCount = 1 + r.extra_batches.length;
                      return (
                        <React.Fragment key={`g-${r.rowIndex}`}>
                          <tr key={`p-${r.rowIndex}`} className="border-t bg-muted/40">
                            <td className="p-2 font-medium">{r.rowIndex}</td>
                            <td className="p-2">
                              <div className="font-semibold">
                                {r.name || <span className="text-destructive">—</span>}
                                {batchCount > 1 && (
                                  <Badge variant="secondary" className="ml-2 text-[10px]">{batchCount} batches</Badge>
                                )}
                              </div>
                              <div className="text-[10px] text-muted-foreground mt-0.5">
                                {[r.category, r.manufacturer, r.item_type + (r.packaging_mode === 'with_strip' ? ' (strip)' : '')]
                                  .filter(Boolean).join(' • ')}
                                {r.minimum_stock_level > 0 && ` • min ${r.minimum_stock_level}`}
                              </div>
                              {isPharmacy && r.active_ingredients.length > 0 && (
                                <div className="text-[10px] text-muted-foreground mt-0.5">
                                  Contains: {r.active_ingredients.map(i => i.ingredient_name + (i.strength ? ` ${i.strength}` : '')).join(' + ')}
                                </div>
                              )}
                            </td>
                            <td className="p-2 font-medium">{r.stock_quantity} {r.unit_label}</td>
                            <td className="p-2">{r.purchase_price} / {r.selling_price}</td>
                            <td className="p-2">{r.expiry_date || '—'}</td>
                            <td className="p-2">
                              {r.errors.length > 0
                                ? <Badge variant="destructive" className="text-[10px]">Invalid</Badge>
                                : r.isDuplicate
                                  ? <Badge variant="outline" className="text-[10px] border-warning text-warning">Duplicate</Badge>
                                  : <Badge variant="outline" className="text-[10px] border-green-600 text-green-600">OK</Badge>}
                            </td>
                          </tr>
                          {/* Primary batch (from parent row) shown as nested when there are extras */}
                          {batchCount > 1 && (
                            <tr key={`b0-${r.rowIndex}`} className="border-t border-l-4 border-l-primary/60">
                              <td className="p-2 pl-6 text-muted-foreground">└─</td>
                              <td className="p-2 pl-2">
                                <span className="font-mono text-[11px]">{r.batch_number || <span className="italic text-muted-foreground">no batch #</span>}</span>
                              </td>
                              <td className="p-2">{r.stock_quantity} {r.unit_label}</td>
                              <td className="p-2">{r.purchase_price} / {r.selling_price}</td>
                              <td className="p-2">{r.expiry_date || '—'}</td>
                              <td className="p-2"><Badge variant="outline" className="text-[10px]">batch 1</Badge></td>
                            </tr>
                          )}
                          {r.extra_batches.map((eb, i) => (
                            <tr key={`b-${r.rowIndex}-${i}`} className="border-t border-l-4 border-l-primary/60">
                              <td className="p-2 pl-6 text-muted-foreground">└─ {eb.rowIndex}</td>
                              <td className="p-2 pl-2">
                                <span className="font-mono text-[11px]">{eb.batch_number || <span className="italic text-muted-foreground">no batch #</span>}</span>
                              </td>
                              <td className="p-2">{eb.stock_quantity} {r.unit_label}</td>
                              <td className="p-2">{eb.purchase_price} / {eb.selling_price}</td>
                              <td className="p-2">{eb.expiry_date || '—'}</td>
                              <td className="p-2"><Badge variant="outline" className="text-[10px]">batch {i + 2}</Badge></td>
                            </tr>
                          ))}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
                {parsedRows.length > 50 && (
                  <div className="p-2 text-center text-xs text-muted-foreground">…and {parsedRows.length - 50} more rows</div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setStep('upload')}>Upload Different File</Button>
              <Button onClick={handleImport} disabled={!canImport || submitting}>
                {submitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Import {cleanRows.length - (duplicateAction === 'skip' ? duplicates.length : 0)} item(s)
              </Button>
            </div>
          </div>
        )}

        {step === 'importing' && (
          <div className="flex flex-col items-center justify-center py-8 gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <div className="w-full space-y-2">
              <div className="flex justify-between text-sm">
                <span className="font-medium">
                  Importing {importProgress.current} of {importProgress.total}…
                </span>
                <span className="text-muted-foreground">
                  {importProgress.total > 0 ? Math.round((importProgress.current / importProgress.total) * 100) : 0}%
                </span>
              </div>
              <Progress value={importProgress.total > 0 ? (importProgress.current / importProgress.total) * 100 : 0} />
              {importProgress.currentName && (
                <p className="text-xs text-muted-foreground truncate">
                  Adding: <span className="font-medium text-foreground">{importProgress.currentName}</span>
                </p>
              )}
              <div className="flex gap-4 text-xs pt-1">
                <span className="text-green-600">✓ {importProgress.success} succeeded</span>
                {importProgress.failed > 0 && <span className="text-destructive">✗ {importProgress.failed} failed</span>}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Adding to: <strong>{branches.find(b => b.id === selectedBranchId)?.name || 'selected branch'}</strong>
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

import { useSyncExternalStore } from 'react';
import { offlineDb } from './db';
import { getOfflineState } from './store';

/**
 * Shared offline read cache for in-scope pages.
 * Wraps the existing database client's REST fetch: successful GET/HEAD table reads are
 * stored per [userId, scopeKey, queryKey]; when unreachable (or the network throws) the
 * cached copy is served. Writes, RPCs, auth and edge functions are never cached.
 */
export const READ_CACHE_SCHEMA = 1;
export const MAX_ENTRY_BYTES = 2 * 1024 * 1024;
export const MAX_USER_BYTES = 25 * 1024 * 1024;
export const DATED_RETENTION_MS = 30 * 86_400_000;

export interface ReadCacheEntry {
  userId: string; scopeKey: string; queryKey: string;
  path: string; select: string; filters: string[]; paged: boolean; accept: string;
  status: number; contentRange: string | null; data: string;
  savedAt: string; lastUsedAt: number; size: number; dated: boolean; schemaVersion: number;
}

let readUser: string | null = null;
let readScope = 'global';
export const setReadUser = (id: string | null) => { readUser = id; };
export const setReadScope = (scope: string | null | undefined) => { readScope = scope || 'global'; };
export const getReadContext = () => ({ userId: readUser, scopeKey: readScope });

const bypass = new WeakSet<AbortSignal>();
/** Reachability probes must always hit the network. */
export const bypassReadCache = (signal: AbortSignal) => { bypass.add(signal); };

// ---------- status for banners ----------
interface ReadStatus { byPath: Record<string, { oldest?: string; misses: number }>; offlineSince?: string; version: number }
let status: ReadStatus = { byPath: {}, version: 0 };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());
const currentPath = () => (typeof window !== 'undefined' ? window.location.pathname : '/');
function record(kind: 'hit' | 'miss', savedAt?: string) {
  const path = currentPath();
  const prev = status.byPath[path] ?? { misses: 0 };
  const next = kind === 'miss' ? { ...prev, misses: prev.misses + 1 }
    : { ...prev, oldest: !prev.oldest || (savedAt && savedAt < prev.oldest) ? savedAt : prev.oldest };
  status = { ...status, byPath: { ...status.byPath, [path]: next }, version: status.version + 1 };
  emit();
}
export function markOffline(at = new Date().toISOString()) { if (!status.offlineSince) { status = { ...status, offlineSince: at, version: status.version + 1 }; emit(); } }
export function resetReadStatus() { status = { byPath: {}, version: status.version + 1 }; emit(); }
export const getReadStatus = () => status;
export function useReadCacheStatus() {
  return useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l); }; }, getReadStatus, getReadStatus);
}

// ---------- secrets ----------
const SECRET_KEY = /(api_?key|token|secret|password|answer_hash|security_answer)/i;
export function stripSecrets<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripSecrets) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (!SECRET_KEY.test(k)) out[k] = stripSecrets(v);
    return out as T;
  }
  return value;
}

// ---------- request description ----------
const CONTROL = new Set(['select', 'order', 'limit', 'offset', 'columns', 'on_conflict']);
export interface ReadRequest { method: string; path: string; select: string; filters: string[]; order?: string; limit?: number; offset?: number; accept: string; prefer: string; queryKey: string; dated: boolean; tooOld: boolean }
const DATE_FILTER = /^(gte|gt|lte|lt)\.(\d{4}-\d{2}-\d{2})/;
export function describeRequest(url: string, method = 'GET', headers?: HeadersInit, now = new Date()): ReadRequest {
  const u = new URL(url);
  const h = new Headers(headers);
  const params = [...u.searchParams.entries()];
  const filters = params.filter(([k]) => !CONTROL.has(k)).map(([k, v]) => `${k}=${v}`).sort();
  const sorted = params.map(([k, v]) => `${k}=${v}`).sort().join('&');
  const accept = h.get('accept') ?? 'application/json';
  const prefer = h.get('prefer') ?? '';
  const cutoff = new Date(now.getTime() - DATED_RETENTION_MS).toISOString().slice(0, 10);
  let dated = false; let upper: string | undefined;
  for (const [, v] of params) {
    const m = DATE_FILTER.exec(v);
    if (m) { dated = true; if (m[1].startsWith('lt')) upper = !upper || m[2] > upper ? m[2] : upper; }
  }
  const limit = u.searchParams.get('limit'); const offset = u.searchParams.get('offset');
  return {
    method, path: u.pathname, select: u.searchParams.get('select') ?? '*', filters,
    order: u.searchParams.get('order') ?? undefined,
    limit: limit ? Number(limit) : undefined, offset: offset ? Number(offset) : undefined,
    accept, prefer, queryKey: `${method} ${u.pathname}?${sorted}|${accept}|${prefer}`,
    dated, tooOld: !!upper && upper < cutoff,
  };
}

// ---------- local filtering (search/filter/sort/pagination on cached lists) ----------
function splitTop(s: string): string[] {
  const out: string[] = []; let depth = 0; let quote = false; let cur = '';
  for (const ch of s) {
    if (ch === '"') quote = !quote;
    if (!quote && ch === '(') depth++;
    if (!quote && ch === ')') depth--;
    if (!quote && depth === 0 && ch === ',') { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
const unquote = (s: string) => s.replace(/^"(.*)"$/, '$1');
function cmp(a: unknown, b: string): number {
  const na = Number(a), nb = Number(b);
  if (a !== null && a !== '' && typeof a !== 'boolean' && !Number.isNaN(na) && b !== '' && !Number.isNaN(nb)) return na - nb;
  return String(a).localeCompare(b);
}
const likeRe = (p: string, i: boolean) => new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/[*%]/g, '.*')}$`, i ? 'is' : 's');
type Pred = (row: Record<string, unknown>) => boolean;
/** Returns null for anything we cannot evaluate exactly, so the caller falls back to "not cached". */
export function compileCondition(column: string, expr: string): Pred | null {
  if (column === 'or' || column === 'and') {
    const inner = expr.replace(/^\((.*)\)$/s, '$1');
    const parts = splitTop(inner).map(p => {
      const nested = /^(or|and)(\(.*\))$/s.exec(p);
      if (nested) return compileCondition(nested[1], nested[2]);
      const dot = p.indexOf('.');
      return dot < 0 ? null : compileCondition(p.slice(0, dot), p.slice(dot + 1));
    });
    if (parts.some(p => !p)) return null;
    const preds = parts as Pred[];
    return column === 'or' ? r => preds.some(p => p(r)) : r => preds.every(p => p(r));
  }
  if (column.includes('.') || column.includes('->')) return null;
  let negate = false;
  if (expr.startsWith('not.')) { negate = true; expr = expr.slice(4); }
  const dot = expr.indexOf('.');
  if (dot < 0) return null;
  const op = expr.slice(0, dot); const value = expr.slice(dot + 1);
  let pred: Pred | null = null;
  const cell = (r: Record<string, unknown>) => r[column];
  switch (op) {
    case 'eq': pred = r => cell(r) != null && String(cell(r)) === value; break;
    case 'neq': pred = r => cell(r) != null && String(cell(r)) !== value; break;
    case 'gt': pred = r => cell(r) != null && cmp(cell(r), value) > 0; break;
    case 'gte': pred = r => cell(r) != null && cmp(cell(r), value) >= 0; break;
    case 'lt': pred = r => cell(r) != null && cmp(cell(r), value) < 0; break;
    case 'lte': pred = r => cell(r) != null && cmp(cell(r), value) <= 0; break;
    case 'like': case 'ilike': { const re = likeRe(value, op === 'ilike'); pred = r => cell(r) != null && re.test(String(cell(r))); break; }
    case 'is': pred = value === 'null' ? r => cell(r) == null : value === 'true' ? r => cell(r) === true : value === 'false' ? r => cell(r) === false : null; break;
    case 'in': { const set = new Set(splitTop(value.replace(/^\((.*)\)$/s, '$1')).map(unquote)); pred = r => cell(r) != null && set.has(String(cell(r))); break; }
    default: return null;
  }
  if (!pred) return null;
  const p = pred;
  return negate ? r => !p(r) : p;
}
export function applyOrder(rows: Record<string, unknown>[], order?: string): Record<string, unknown>[] | null {
  if (!order) return rows;
  const keys = order.split(',').map(part => { const [col, ...mods] = part.split('.'); return { col, desc: mods.includes('desc'), nullsFirst: mods.includes('nullsfirst') }; });
  if (keys.some(k => k.col.includes('(') || k.col.includes('->'))) return null;
  return [...rows].sort((a, b) => {
    for (const k of keys) {
      const av = a[k.col], bv = b[k.col];
      if (av == null && bv == null) continue;
      if (av == null) return k.nullsFirst ? -1 : 1;
      if (bv == null) return k.nullsFirst ? 1 : -1;
      const c = cmp(av, String(bv));
      if (c) return k.desc ? -c : c;
    }
    return 0;
  });
}
const OBJECT = 'application/vnd.pgrst.object+json';
export function deriveFromEntry(entry: ReadCacheEntry, req: ReadRequest): { status: number; body: string | null; contentRange: string | null } | null {
  if (entry.paged || entry.accept.includes(OBJECT) || entry.path !== req.path || entry.select !== req.select) return null;
  if (!entry.filters.every(f => req.filters.includes(f))) return null;
  let rows: Record<string, unknown>[];
  try { const parsed = JSON.parse(entry.data); if (!Array.isArray(parsed)) return null; rows = parsed; } catch { return null; }
  for (const f of req.filters.filter(f => !entry.filters.includes(f))) {
    const eq = f.indexOf('=');
    const pred = compileCondition(f.slice(0, eq), f.slice(eq + 1));
    if (!pred) return null;
    rows = rows.filter(pred);
  }
  const ordered = applyOrder(rows, req.order);
  if (!ordered) return null;
  const total = ordered.length;
  const start = req.offset ?? 0;
  const page = req.limit !== undefined ? ordered.slice(start, start + req.limit) : ordered.slice(start);
  const range = page.length ? `${start}-${start + page.length - 1}` : '*';
  const contentRange = `${range}/${req.prefer.includes('count=') ? total : '*'}`;
  if (req.accept.includes(OBJECT)) {
    if (page.length !== 1) return { status: 406, body: JSON.stringify({ code: 'PGRST116', details: `The result contains ${page.length} rows`, hint: null, message: 'JSON object requested, multiple (or no) rows returned' }), contentRange };
    return { status: 200, body: req.method === 'HEAD' ? null : JSON.stringify(page[0]), contentRange };
  }
  return { status: 200, body: req.method === 'HEAD' ? null : JSON.stringify(page), contentRange };
}

// ---------- storage ----------
const key = (u: string, s: string, q: string) => [u, s, q] as [string, string, string];
export async function saveReadEntry(userId: string, scopeKey: string, req: ReadRequest, status: number, text: string, contentRange: string | null, now = new Date()) {
  if (req.tooOld || status < 200 || status >= 300) return false;
  let data = text;
  if (text) { try { data = JSON.stringify(stripSecrets(JSON.parse(text))); } catch { return false; } }
  if (data.length > MAX_ENTRY_BYTES) return false;
  const entry: ReadCacheEntry = {
    userId, scopeKey, queryKey: req.queryKey, path: req.path, select: req.select, filters: req.filters,
    paged: req.limit !== undefined || req.offset !== undefined, accept: req.accept, status, contentRange, data,
    savedAt: now.toISOString(), lastUsedAt: now.getTime(), size: data.length, dated: req.dated, schemaVersion: READ_CACHE_SCHEMA,
  };
  await offlineDb.readCache.put(entry);
  scheduleLimits(userId);
  return true;
}
/** Exact entry first, then a local derivation from a complete cached list of the same table. */
export async function readCachedResponse(userId: string, scopeKey: string, req: ReadRequest) {
  const exact = await offlineDb.readCache.get(key(userId, scopeKey, req.queryKey));
  if (exact && exact.userId === userId && exact.schemaVersion === READ_CACHE_SCHEMA) {
    void offlineDb.readCache.update(key(userId, scopeKey, req.queryKey), { lastUsedAt: Date.now() }).catch(() => undefined);
    return { status: exact.status, body: req.method === 'HEAD' || !exact.data ? null : exact.data, contentRange: exact.contentRange, savedAt: exact.savedAt };
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return null;
  const candidates = (await offlineDb.readCache.where('[userId+path]').equals([userId, req.path]).toArray())
    .filter(e => e.scopeKey === scopeKey && e.schemaVersion === READ_CACHE_SCHEMA)
    .sort((a, b) => b.filters.length - a.filters.length);
  for (const c of candidates) {
    const derived = deriveFromEntry(c, req);
    if (derived) return { ...derived, savedAt: c.savedAt };
  }
  return null;
}
export async function enforceReadCacheLimits(userId: string, maxBytes = MAX_USER_BYTES, now = Date.now()) {
  const rows = await offlineDb.readCache.where('userId').equals(userId).toArray();
  const expired = rows.filter(r => r.dated && now - Date.parse(r.savedAt) > DATED_RETENTION_MS);
  const live = rows.filter(r => !expired.includes(r)).sort((a, b) => a.lastUsedAt - b.lastUsedAt);
  let total = live.reduce((s, r) => s + r.size, 0);
  const evict = [...expired];
  while (total > maxBytes && live.length) { const r = live.shift()!; evict.push(r); total -= r.size; }
  if (evict.length) await offlineDb.readCache.bulkDelete(evict.map(r => key(r.userId, r.scopeKey, r.queryKey)));
  return { evicted: evict.length, total };
}
const timers = new Map<string, ReturnType<typeof setTimeout>>();
function scheduleLimits(userId: string) {
  if (timers.has(userId)) return;
  timers.set(userId, setTimeout(() => { timers.delete(userId); void enforceReadCacheLimits(userId).catch(() => undefined); }, 3000));
}
export async function cachedScopes(userId: string): Promise<Set<string>> {
  const keys = await offlineDb.readCache.where('userId').equals(userId).primaryKeys();
  return new Set((keys as unknown as string[][]).map(k => k[1]));
}
export async function clearUserReadCache(userId: string) {
  await offlineDb.readCache.where('userId').equals(userId).delete();
}

// ---------- fetch wrapper ----------
const toResponse = (r: { status: number; body: string | null; contentRange: string | null }) => {
  const headers: Record<string, string> = { 'content-type': 'application/json; charset=utf-8', 'x-offline-cache': '1' };
  if (r.contentRange) headers['content-range'] = r.contentRange;
  return new Response(r.status === 204 ? null : r.body, { status: r.status, headers });
};
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export function createReadCacheFetch(base: FetchLike): FetchLike {
  return async (input, init) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const { userId, scopeKey } = getReadContext();
    if ((method !== 'GET' && method !== 'HEAD') || !url.includes('/rest/v1/') || url.includes('/rest/v1/rpc/')
      || (init?.signal && bypass.has(init.signal)) || !userId) return base(input, init);
    let req: ReadRequest;
    try { req = describeRequest(url, method, init?.headers); } catch { return base(input, init); }
    const serve = async () => {
      const cached = await readCachedResponse(userId, scopeKey, req).catch(() => null);
      if (cached) record('hit', cached.savedAt); else record('miss');
      return cached ? toResponse(cached) : null;
    };
    if (!getOfflineState().reachable) {
      const hit = await serve();
      if (hit) return hit;
      throw new TypeError('Failed to fetch (offline and not saved on this PC)');
    }
    let res: Response;
    try { res = await base(input, init); }
    catch (err) { const hit = await serve(); if (hit) return hit; throw err; }
    if (res.ok) {
      const copy = res.clone();
      void (async () => {
        const text = method === 'HEAD' ? '' : await copy.text();
        // Never attribute a response to a different user who signed in meanwhile.
        if (getReadContext().userId !== userId) return;
        await saveReadEntry(userId, scopeKey, req, res.status, text, res.headers.get('content-range'));
      })().catch(() => undefined);
    }
    return res;
  };
}
/** Install on the existing client without changing its configuration or auth. */
export function installReadCache(client: { rest?: { fetch?: FetchLike } }) {
  const rest = client.rest as { fetch?: FetchLike; __offlineReadCache?: boolean } | undefined;
  if (!rest?.fetch || rest.__offlineReadCache) return;
  rest.fetch = createReadCacheFetch(rest.fetch.bind(rest));
  rest.__offlineReadCache = true;
}

/** Which routes work offline, and which controls count as writes. Pure for tests. */
export const CACHED_ROUTES = ['/', '/inventory', '/medicine-codes', '/customers', '/suppliers', '/account'] as const;
export const OWN_OFFLINE_ROUTES = ['/sales', '/activity', '/owner/activity'] as const;
export type OfflineRouteMode = 'cached' | 'own' | 'online-only';
export function offlineRouteMode(pathname: string): OfflineRouteMode {
  const path = pathname.replace(/\/+$/, '') || '/';
  if ((OWN_OFFLINE_ROUTES as readonly string[]).includes(path)) return 'own';
  if ((CACHED_ROUTES as readonly string[]).includes(path)) return 'cached';
  return 'online-only';
}
export const NEEDS_INTERNET_PAGE = 'Needs internet — this page is not available offline.';
export const NEEDS_INTERNET = 'Needs internet';
export const NOT_CACHED = 'Not available offline — open it once while online on this PC.';

export interface ControlInfo { text: string; role?: string | null; type?: string | null; icons?: string }
const WRITE_WORDS = /\b(add|new|create|edit|save|update|delete|remove|record|import|upload|submit|pay|payment|adjust|transfer|archive|restore|confirm|apply|send|deactivate|activate|approve|reject|void|assign|mark|write[- ]?off|dispose|link|unlink|generate|reset|change|set up|connect|disconnect|merge|split|open pack|receive)\b/i;
const WRITE_ICONS = /lucide-(plus|trash|pencil|pen|edit|save|upload|send|square-pen|file-up|user-plus|package-plus)\b/;
const SAFE_WORDS = /^(close|cancel|back|search|filter|view|details|export|print|refresh|next|previous|prev|show|hide|more|less|clear filter)/i;
/** Conservative: a control is a write when its label/icon/role says so; navigation stays usable. */
export function isWriteControl(c: ControlInfo): boolean {
  const text = c.text.trim();
  if (c.role === 'switch') return true;
  if (c.type === 'submit') return true;
  if (SAFE_WORDS.test(text)) return false;
  return WRITE_WORDS.test(text) || WRITE_ICONS.test(c.icons ?? '');
}

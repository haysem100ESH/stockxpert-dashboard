export function pwaRefused(production: boolean, framed: boolean, hostname: string, search: string) {
  return !production || framed || hostname.startsWith('id-preview--') || hostname.startsWith('preview--')
    || ['lovableproject.com', 'lovableproject-dev.com', 'beta.lovable.dev'].some(domain => hostname === domain || hostname.endsWith(`.${domain}`))
    || new URLSearchParams(search).get('sw') === 'off';
}
export async function registerAppShell() {
  if (!('serviceWorker' in navigator)) return;
  const refused = pwaRefused(import.meta.env.PROD, window.self !== window.top, location.hostname, location.search);
  if (refused) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.filter(registration => [registration.active, registration.waiting, registration.installing]
      .some(worker => worker && new URL(worker.scriptURL).pathname === '/sw.js')).map(registration => registration.unregister()));
    return;
  }
  const { registerSW } = await import('virtual:pwa-register');
  registerSW({ immediate: true });
}
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from 'vite-plugin-pwa';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
    VitePWA({
      strategies: 'generateSW', filename: 'sw.js', registerType: 'autoUpdate', injectRegister: null,
      devOptions: { enabled: false },
      manifest: {
        name: 'PharmaXpert', short_name: 'PharmaXpert', start_url: '/sales', scope: '/', id: '/',
        display: 'standalone', theme_color: '#16a34a', background_color: '#f8fafc',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        globIgnores: ['**/*face-api*', '**/*onnx*', '**/models/**', '**/*.wasm'],
        maximumFileSizeToCacheInBytes: 16 * 1024 * 1024,
        // Excluding all URLs from the default precache navigation handler lets
        // the explicit NetworkFirst handler below own HTML navigations.
        navigateFallback: '/index.html', navigateFallbackDenylist: [/./],
        runtimeCaching: [{
          urlPattern: ({ request, url }) => request.mode === 'navigate' && url.origin === self.location.origin && !url.pathname.startsWith('/~oauth'),
          handler: 'NetworkFirst', options: { cacheName: 'pos-navigation', networkTimeoutSeconds: 5,
            precacheFallback: { fallbackURL: '/index.html' }, expiration: { maxEntries: 20 } },
        }, {
          urlPattern: ({ url }) => url.origin === self.location.origin && /\/assets\/[^/]+-[\w-]+\.(js|css|svg|png|ico|woff2)$/.test(url.pathname),
          handler: 'CacheFirst', options: { cacheName: 'pos-assets', expiration: { maxEntries: 150 } },
        }],
      },
    }),
    mode === 'development' &&
    componentTagger(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl';
import { VitePWA } from 'vite-plugin-pwa';

const WEEK = 7 * 24 * 60 * 60;

// JOMIFY_HTTP=1 serves plain HTTP for the phone loop: `adb reverse tcp:3000 tcp:3000` makes
// http://127.0.0.1:3000 on the phone a secure context, which self-signed LAN HTTPS never is
// (no service worker, no Widevine behind a certificate error).
const useSsl = !globalThis.process?.env?.JOMIFY_HTTP;

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    useSsl ? basicSsl() : null,
    VitePWA({
      // 'prompt', never 'autoUpdate': an automatic reload would cut playback mid-song
      registerType: 'prompt',
      injectRegister: null,
      manifest: {
        name: 'Jomify Music Player',
        short_name: 'Jomify',
        description: 'Spotify done right.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#000000',
        background_color: '#000000',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          // Spotify and our own sync API are live data; never serve them from a cache
          { urlPattern: /^https:\/\/(api|accounts)\.spotify\.com\//, handler: 'NetworkOnly' },
          { urlPattern: /^https:\/\/sdk\.scdn\.co\//, handler: 'NetworkOnly' },
          { urlPattern: /\/api\//, handler: 'NetworkOnly' },
          {
            urlPattern: /^https:\/\/(i|mosaic|image-cdn-[a-z]+)\.scdn\.co\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'spotify-artwork',
              expiration: { maxEntries: 200, maxAgeSeconds: WEEK },
              cacheableResponse: { statuses: [0, 200] }
            }
          }
        ]
      },
      devOptions: { enabled: false }
    })
  ].filter(Boolean),
  server: {
    host: true,
    port: 3000,
  },
  preview: {
    host: true,
    port: 3000,
  }
})

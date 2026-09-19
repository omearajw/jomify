import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl';
import { VitePWA } from 'vite-plugin-pwa';


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
      // The worker is our own file (src/sw.js) so it can handle push; the plugin injects the
      // precache manifest into it
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}']
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

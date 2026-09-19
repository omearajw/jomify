// Jomify's service worker: the precache and runtime caching that vite-plugin-pwa generated
// before, plus push notifications. Built with injectManifest so the push handlers can live here.
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { NetworkOnly, CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';

const WEEK = 7 * 24 * 60 * 60;

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//] }));

// Spotify and our own API are live data; never serve them from a cache
registerRoute(/^https:\/\/(api|accounts)\.spotify\.com\//, new NetworkOnly());
registerRoute(/^https:\/\/sdk\.scdn\.co\//, new NetworkOnly());
registerRoute(/\/api\//, new NetworkOnly());
registerRoute(
  /^https:\/\/(i|mosaic|image-cdn-[a-z]+)\.scdn\.co\//,
  new CacheFirst({
    cacheName: 'spotify-artwork',
    plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: WEEK }), new CacheableResponsePlugin({ statuses: [0, 200] })]
  })
);

// --- Push -----------------------------------------------------------------------------------

self.addEventListener('push', (event) => {
  let data;
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'Jomify', body: event.data?.text() || '' }; }
  const title = data.title || 'Jomify';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.tag || 'jomify',
    renotify: Boolean(data.tag),
    data: { url: data.url || '/' }
  }));
});

// Tap: bring an open Jomify to the front and tell it where to go, or open one
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = clients.find((c) => 'focus' in c);
    if (existing) {
      await existing.focus();
      existing.postMessage({ type: 'open', url });
      return;
    }
    await self.clients.openWindow(url);
  })());
});

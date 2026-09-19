import { useUserStore } from '../store/userStore';
import { redirectToAuthCodeFlow, exchangeCode } from '../services/spotify/auth';
import { apiBaseUrl } from '../services/sync/client';

// Web Push for Sevens. The browser subscribes through the service worker; the server also needs
// its own way to ask Spotify who dropped last while the app is closed, which is a second Spotify
// authorization done in the browser (state=PUSH_STATE) whose refresh token goes to the server
// and is never used by the browser. Two chains, so neither can sign the other out.

export const PUSH_STATE = 'jomify-push';
const PENDING_KEY = 'jomify_push_pending';

export function isPushSupported() {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
}

const isIos = () => typeof navigator !== 'undefined' && /iP(hone|ad|od)/.test(navigator.userAgent);
const isStandalone = () => typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true);

// Why the switch can't be turned on here, in the user's terms; null when it can
export function describePushBlocker() {
  if (typeof window === 'undefined') return null;
  if (!isPushSupported()) {
    if (isIos() && !isStandalone()) return 'On iPhone, add Jomify to your Home Screen first (Share, then Add to Home Screen); notifications only work from the installed app.';
    return "This browser doesn't support push notifications.";
  }
  if (Notification.permission === 'denied') return 'Notifications are blocked for Jomify in your browser settings.';
  if (['127.0.0.1', 'localhost'].includes(location.hostname)) return 'Notifications need the installed app or the live site, not the local dev server.';
  return null;
}

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function api(path, token, body) {
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Push request failed (${response.status})`);
  return data;
}

export async function getPushSubscription() {
  if (!isPushSupported()) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

// Step 1, inside the tap: permission, subscribe, stash the subscription, go to Spotify
export async function beginEnableNotifications(token) {
  const blocker = describePushBlocker();
  if (blocker) throw new Error(blocker);
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications were not allowed.');

  const { publicKey } = await api('/api/push/config', token);
  const registration = await navigator.serviceWorker.ready;
  const subscription = (await registration.pushManager.getSubscription())
    || (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }));

  localStorage.setItem(PENDING_KEY, JSON.stringify(subscription.toJSON()));
  await redirectToAuthCodeFlow({ state: PUSH_STATE });
}

// Step 2, back from Spotify with ?code&state=jomify-push: hand the server its grant + subscription
export async function completeEnableNotifications(code, token) {
  const pending = localStorage.getItem(PENDING_KEY);
  let subscription = pending ? JSON.parse(pending) : null;
  if (!subscription) {
    const live = await getPushSubscription();
    subscription = live?.toJSON() || null;
  }
  if (!subscription) throw new Error('This device has no push subscription; try turning notifications on again.');

  const tokens = await exchangeCode(code);
  if (!tokens.refresh_token) throw new Error('Spotify did not return a refresh token for the notification sign-in.');
  await api('/api/push/subscribe', token, { subscription, refreshToken: tokens.refresh_token });

  localStorage.removeItem(PENDING_KEY);
  useUserStore.getState().setSevensNotifications(true);
}

export async function disableNotifications(token) {
  const subscription = await getPushSubscription();
  const endpoint = subscription?.endpoint || null;
  if (subscription) await subscription.unsubscribe().catch(() => {});
  await api('/api/push/unsubscribe', token, { endpoint });
  useUserStore.getState().setSevensNotifications(false);
}

// On start-up: the switch should reflect reality, not what it last said
export async function syncPushStatus() {
  const { sevensNotifications, setSevensNotifications } = useUserStore.getState();
  if (!sevensNotifications) return;
  if (!isPushSupported() || Notification.permission !== 'granted') { setSevensNotifications(false); return; }
  const subscription = await getPushSubscription().catch(() => null);
  if (!subscription) setSevensNotifications(false);
}

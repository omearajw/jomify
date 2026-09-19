import { applyCors } from '../_lib/cors.js';
import { vapidPublicKey, PushConfigError } from '../_lib/push.js';

// The VAPID public key is not secret; the browser needs it to subscribe
export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
  try {
    res.status(200).json({ publicKey: vapidPublicKey() });
  } catch (err) {
    if (err instanceof PushConfigError) { res.status(503).json({ error: err.message }); return; }
    res.status(500).json({ error: 'Push is not available' });
  }
}

// Origins allowed to call the sync API.
//
// This app runs from an unusual number of origins, and every one of them is legitimate:
//   - the deployed site and its Vercel preview builds
//   - http://127.0.0.1:3000, which is where the ELECTRON build serves from (main.cjs runs an
//     Express static server so the Spotify redirect URI has a fixed origin)
//   - https://localhost:3000 and https://127.0.0.1:3000, the dev server, which is HTTPS because
//     vite.config.js loads basicSsl()
//   - a private LAN address, for testing on a phone
//
// A CORS failure is invisible apart from a console message, which is exactly why the app shows a
// sync status line rather than failing silently.

const EXACT_ORIGINS = new Set([
  'https://jomify.vercel.app',
  'http://127.0.0.1:3000',
  'https://127.0.0.1:3000',
  'http://localhost:3000',
  'https://localhost:3000'
]);

const PREVIEW_DEPLOY = /^https:\/\/jomify-[a-z0-9-]+\.vercel\.app$/;

const PRIVATE_LAN = /^https?:\/\/(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/;

export function isAllowedOrigin(origin) {
  if (!origin) return false;
  return EXACT_ORIGINS.has(origin) || PREVIEW_DEPLOY.test(origin) || PRIVATE_LAN.test(origin);
}

export function applyCors(req, res) {
  const origin = req.headers.origin;

  if (isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  // Vary matters even when the origin is rejected, or a CDN could cache one origin's response
  // and serve it to another.
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');

  // Preflight is mandatory here because the client sends an Authorization header
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }

  return false;
}

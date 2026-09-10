# Jomify

A custom Spotify client. React 19, Vite, Tailwind 4 and the Spotify Web Playback SDK, talking to
the Spotify Web API directly from the browser with a PKCE login — no client secret anywhere.

Deployed at https://jomify.vercel.app. Also builds as an Electron desktop app and installs as a PWA.

## What it adds over Spotify

- **Folders** for playlists and albums, with drag-and-drop, and a pinned "sandbox" on the home page.
- **Cross-device sync** of folders, pins and settings, keyed by your Spotify account. A device
  with no folders can never wipe one that has them: the server only merges, deletion is an
  explicit tombstone, and tombstones are minted in exactly one place. See `src/sync/`.
- **Sevens** — collaborative playlists where two people trade batches of seven tracks. A settings
  page tracks who each Seven is with and whether it's still running; the workspace dims tracks
  you've already sent that person on any other Seven with them.
- Zen Mode, synced lyrics (lrclib), a queue panel, per-playlist sort settings, and an
  "Unadded Songs" reconciliation for liked tracks that aren't in any playlist yet.

## Running it

```
npm install
npm run dev          # https://localhost:3000 (self-signed cert — click through it)
```

Create `.env.local` with:

```
VITE_SPOTIFY_CLIENT_ID=...
VITE_REDIRECT_URI=https://127.0.0.1:3000/
```

The redirect URI must match one registered on your Spotify app exactly, including the trailing
slash. Spotify requires HTTPS or an explicit loopback literal; `localhost` is rejected. For testing
on a phone over the LAN use `https://<your-machine-ip>:3000/` and register that too.

Sync needs an Upstash Redis attached to the Vercel project (`KV_REST_API_URL` /
`KV_REST_API_TOKEN`, or the `UPSTASH_REDIS_REST_*` names). Local dev syncs against the deployed
API, so `npm run dev` shares data with production.

## Scripts

| Command | What |
|---|---|
| `npm run dev` | Vite dev server on port 3000, LAN-accessible |
| `npm run build` | Production build to `dist/` |
| `npm run lint` | ESLint |
| `npm run test:merge` | The sync merge and transform case table (no test runner needed) |
| `npm run build-app` | Build, then package the Electron desktop app |

## Layout

```
api/                 Vercel serverless function for sync (+ Redis, CORS, auth helpers)
src/services/spotify Auth (PKCE), API wrapper with rate-limit interceptor, playback SDK
src/store            Zustand stores; userStore is persisted and migrated
src/sync             Merge, engine, transforms, metadata, backup/restore
src/views            One folder per screen
src/layouts          Sidebar, player bar, queue panel, main layout
scripts/             merge-cases.mjs — run before shipping any change to the merge
```

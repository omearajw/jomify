// How songs sound, from ReccoBeats: a free service (no key) with the measurements Spotify stopped
// giving apps like this one in November 2024. By Spotify track id, up to 40 a request:
//   energy, valence (happy to sad), danceability, acousticness, instrumentalness, speechiness,
//   liveness (0 to 1), tempo (BPM), loudness (dB), key (0-11) and mode (1 major, 0 minor).
// A song's sound does not change, so answers are kept on this device for a month, and songs it
// does not know are remembered for a week so they are not asked about on every visit.

import { log } from './debugLog.js';

const URL_BASE = 'https://api.reccobeats.com/v1/audio-features';
const BATCH = 40;
const CACHE_KEY = 'jomify_sound_features';
const FOUND_MS = 30 * 24 * 60 * 60 * 1000;
const MISSING_MS = 7 * 24 * 60 * 60 * 1000;
const FIELDS = ['energy', 'valence', 'danceability', 'acousticness', 'instrumentalness', 'speechiness', 'liveness', 'tempo', 'loudness', 'key', 'mode'];

const memory = loadCache(); // spotify id -> features, or null for "not known"
const inflight = new Map(); // spotify id -> promise of the batch it is in

function loadCache() {
  const map = new Map();
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    const now = Date.now();
    for (const [id, entry] of Object.entries(raw)) {
      if (!entry) continue;
      if (now - (entry.t || 0) < (entry.f ? FOUND_MS : MISSING_MS)) map.set(id, entry.f || null);
    }
  } catch { /* fresh start */ }
  return map;
}

let saveTimer = null;
function saveSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      const out = {};
      const t = Date.now();
      for (const [id, f] of memory) out[id] = { f, t };
      localStorage.setItem(CACHE_KEY, JSON.stringify(out));
    } catch { /* storage full or blocked: the in-memory copy still works */ }
  }, 500);
}

const idOf = (href) => String(href || '').split('/').pop();

export function pickFeatures(raw) {
  if (!raw || !Number.isFinite(Number(raw.tempo))) return null;
  const out = {};
  for (const k of FIELDS) out[k] = Number(raw[k]);
  return out;
}

async function fetchBatch(ids) {
  const res = await fetch(`${URL_BASE}?ids=${ids.map(encodeURIComponent).join(',')}`);
  if (!res.ok) throw new Error(`ReccoBeats answered ${res.status}`);
  const body = await res.json();
  const found = new Map();
  for (const f of body?.content || []) found.set(idOf(f.href), pickFeatures(f));
  for (const id of ids) memory.set(id, found.get(id) || null);
  saveSoon();
}

// Makes sure every id has an answer (or a remembered "not known"). Failures leave ids unknown, so
// the next call asks again; they are logged, never thrown.
export async function ensureSoundFeatures(trackIds) {
  const wanted = [...new Set((trackIds || []).filter((id) => typeof id === 'string' && /^[A-Za-z0-9]{22}$/.test(id)))];
  const waits = [];
  const missing = [];
  for (const id of wanted) {
    if (memory.has(id)) continue;
    if (inflight.has(id)) waits.push(inflight.get(id));
    else missing.push(id);
  }
  for (let i = 0; i < missing.length; i += BATCH) {
    const ids = missing.slice(i, i + BATCH);
    const work = fetchBatch(ids)
      .catch((err) => log('sound', 'song measurements unavailable', err?.message || String(err)))
      .finally(() => ids.forEach((id) => inflight.delete(id)));
    ids.forEach((id) => inflight.set(id, work));
    waits.push(work);
  }
  await Promise.all(waits);
  return memory;
}

export const soundFeatures = memory;

export async function soundFeaturesFor(trackId) {
  if (!trackId) return null;
  await ensureSoundFeatures([trackId]);
  return memory.get(trackId) || null;
}

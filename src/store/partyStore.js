import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const newDeviceId = () => `d${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;

// The host's side of a party. The code survives a reload so the phone rejoins as host; the
// live state (queue, now playing) is whatever the last heartbeat brought back.
export const usePartyStore = create(persist((set) => ({
  code: null,
  deviceId: newDeviceId(),
  party: null,
  queue: [],
  upNext: null,
  history: [],
  guestCount: 0,
  conductor: false,
  hostAway: false,
  lastHeartbeatAt: 0,
  error: null,
  setCode: (code) => set({ code }),
  applyState: (s) => set({
    party: s.party ?? null, queue: s.queue || [], upNext: s.upNext ?? null, history: s.history || [],
    guestCount: s.guestCount || 0, conductor: Boolean(s.conductor), hostAway: Boolean(s.hostAway), lastHeartbeatAt: Date.now(), error: null
  }),
  setError: (error) => set({ error }),
  clear: () => set({ code: null, party: null, queue: [], upNext: null, history: [], guestCount: 0, conductor: false, hostAway: false, error: null })
}), { name: 'jomify-party', partialize: (s) => ({ code: s.code, deviceId: s.deviceId }) }));

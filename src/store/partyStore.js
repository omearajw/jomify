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
  skipping: false,
  // This device's part: 'conductor' runs the party, 'remote' only controls it, 'auto' lets the
  // devices sort it out (the one playing the music wins)
  role: 'auto',
  conductorInfo: null,
  conductorQuiet: false,
  dormant: false, // a party left open from earlier, not rejoined on opening
  rejoinChecked: false, // the launch check has decided whether to rejoin
  blocked: [],
  speakerOk: null,
  error: null,
  setCode: (code) => set({ code }),
  setRole: (role) => set({ role }),
  // Only the heartbeat says who conducts; other replies leave that alone
  applyState: (s) => set((current) => ({
    party: s.party ?? null, queue: s.queue || [], upNext: s.upNext ?? null, history: s.history || [],
    guestCount: s.guestCount || 0, conductor: s.conductor === undefined ? current.conductor : Boolean(s.conductor),
    conductorInfo: s.conductorInfo ?? current.conductorInfo, speakerOk: s.speakerOk === undefined ? current.speakerOk : s.speakerOk,
    // Measured against the server's clock, so a phone with the wrong time doesn't call it quiet
    conductorQuiet: Boolean(s.conductorInfo?.at && s.serverTime && s.serverTime - s.conductorInfo.at > 30000),
    blocked: s.blocked ?? current.blocked,
    hostAway: Boolean(s.hostAway), lastHeartbeatAt: Date.now(), error: null
  })),
  setError: (error) => set({ error }),
  clear: () => set({ dormant: false, code: null, party: null, queue: [], upNext: null, history: [], guestCount: 0, conductor: false, hostAway: false, error: null })
}), { name: 'jomify-party', partialize: (s) => ({ code: s.code, deviceId: s.deviceId, role: s.role }) }));

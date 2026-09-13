import { create } from 'zustand';

const DEVICE_FIELDS = ['id', 'name', 'type', 'supportsVolume', 'volumePercent', 'isActive', 'isLocal'];
const sameDevice = (a, b) => (a === b) || (Boolean(a) && Boolean(b) && DEVICE_FIELDS.every(k => a[k] === b[k]));
const sameDeviceList = (a, b) => a.length === b.length && a.every((d, i) => sameDevice(d, b[i]));

export const usePlayerStore = create((set) => ({
  player: null,          // the Web Playback SDK instance, once created
  deviceId: null,        // this browser's own Connect device id
  playbackState: null,   // SDK-shaped; remote state is adapted into the same shape
  positionAt: 0,         // Date.now() when playbackState.position was captured
  isShuffled: false,
  repeatMode: 0,         // 0 off, 1 context, 2 track

  // 'idle' | 'loading' | 'ready' | 'failed'. Failed (blocked script, unsupported browser,
  // non-Premium) degrades to remote control of other devices instead of a dead player bar.
  sdkStatus: 'idle',
  sdkError: null,

  // Whichever device Spotify says is currently playing: { id, name, type, supportsVolume, volumePercent }
  activeDevice: null,
  devices: [],
  isLocalActive: false,  // the active device is this browser, so SDK events drive the state
  remoteVolume: null,    // last known volume of a remote active device, 0-100

  setPlayer: (playerInstance) => set({ player: playerInstance }),
  setDeviceId: (id) => set({ deviceId: id }),

  // True between an optimistic shuffle flip and Spotify's acknowledgement. While it's set, state
  // events must not overwrite isShuffled -- a stale event landing mid-flight made the button
  // visibly bounce.
  shufflePending: false,

  setPlaybackState: (state) => set((current) => ({
    playbackState: state,
    positionAt: Date.now(),
    // The SDK payload property is 'shuffle', not 'shuffle_state'
    isShuffled: current.shufflePending ? current.isShuffled : Boolean(state?.shuffle),
    repeatMode: typeof state?.repeat_mode === 'number' ? state.repeat_mode : current.repeatMode
  })),

  setShuffle: (value) => set({ isShuffled: Boolean(value) }),
  setShufflePending: (pending) => set({ shufflePending: Boolean(pending) }),
  setRepeatMode: (mode) => set({ repeatMode: mode }),
  setSdkStatus: (sdkStatus, sdkError = null) => set({ sdkStatus, sdkError }),
  // The remote poller calls these every few seconds with freshly built objects. Returning the
  // current state when nothing actually changed keeps selector subscribers from re-rendering.
  setActiveDevice: (device) => set((current) => (sameDevice(current.activeDevice, device) ? current : { activeDevice: device })),
  setDevices: (devices) => set((current) => {
    const next = Array.isArray(devices) ? devices : [];
    return sameDeviceList(current.devices, next) ? current : { devices: next };
  }),
  setIsLocalActive: (value) => set((current) => (current.isLocalActive === Boolean(value) ? current : { isLocalActive: Boolean(value) })),
  setRemoteVolume: (volume) => set((current) => (current.remoteVolume === volume ? current : { remoteVolume: volume })),

  // Kept for callers that still use the old name; prefer setShuffle + setShufflePending so a
  // failure can restore the real previous value instead of blindly flipping again.
  toggleOptimisticShuffle: () => set((state) => ({ isShuffled: !state.isShuffled })),
}));

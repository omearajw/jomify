import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { RefreshCw, Laptop, Smartphone, Speaker, Tv, Cast, MonitorSpeaker, Globe } from 'lucide-react';
import { useUserStore } from '../store/userStore';
import { usePlayerStore } from '../store/playerStore';
import { refreshDevices, transferTo, PLAYER_NAME, hasPendingPlay, playPendingOn, clearPendingPlay } from '../services/spotify/playbackController';
import { deviceTypeLabel, localDeviceLabel, describePlatform } from '../services/spotify/playbackAdapter';
import { useIsMobile } from '../hooks/useMediaQuery';
import { useSlice } from '../store/selectors';

const ICONS = {
  Computer: Laptop,
  Smartphone,
  Tablet: Smartphone,
  Speaker,
  TV: Tv,
  CastVideo: Cast,
  CastAudio: Cast,
  AVR: Speaker,
  STB: Tv,
  AudioDongle: Speaker,
  GameConsole: Tv,
  Automobile: Speaker
};

const REFRESH_MS = 5000;
const LOCAL_LABEL = localDeviceLabel(describePlatform());

export default function DevicePicker() {
  const isOpen = useUserStore((s) => s.isDevicePickerOpen);
  if (!isOpen) return null;
  return <DevicePickerBody />;
}

function DevicePickerBody() {
  const setDevicePickerOpen = useUserStore((s) => s.setDevicePickerOpen);
  const { devices, activeDevice, sdkStatus, deviceId } = useSlice(usePlayerStore, ['devices', 'activeDevice', 'sdkStatus', 'deviceId']);
  const isMobile = useIsMobile();
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(null);

  const close = () => { clearPendingPlay(); setDevicePickerOpen(false); };

  useEffect(() => {
    let cancelled = false;
    const load = () => refreshDevices().finally(() => { if (!cancelled) setLoading(false); });
    load();
    const id = setInterval(load, REFRESH_MS);
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    return () => { cancelled = true; clearInterval(id); document.removeEventListener('keydown', onKey); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The SDK device only shows in Spotify's list once it has connected; until then list it
  // ourselves so this device is always a choice when the player is up
  const list = [...devices];
  if (sdkStatus === 'ready' && deviceId && !list.some(d => d.id === deviceId)) {
    list.unshift({ id: deviceId, name: LOCAL_LABEL, type: 'Computer', isActive: activeDevice?.id === deviceId, isLocal: true, supportsVolume: true });
  }

  const pick = async (device) => {
    setSwitching(device.id);
    if (hasPendingPlay()) await playPendingOn(device.id);
    else if (!device.isActive) await transferTo(device.id);
    setSwitching(null);
    setDevicePickerOpen(false);
  };

  const detail = (device, active) => {
    if (switching === device.id) return 'Switching…';
    const kind = device.isLocal ? PLAYER_NAME : deviceTypeLabel(device.type);
    return active ? `${kind} · playing here` : kind;
  };

  const panel = (
    <div
      role="dialog" style={{ fontFamily: 'var(--font-room)' }}
      aria-modal="true"
      aria-labelledby="device-picker-title"
      className={isMobile
        ? 'ui-plane w-full max-h-[80dvh] rounded-t-[10px] flex flex-col p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]'
        : 'ui-plane w-full max-w-md flex flex-col max-h-[80vh] p-8'}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h2 id="device-picker-title" className="room-mono text-[var(--room-dim)]">Play on</h2>
          <p className="mt-2 text-[13px] text-[var(--room-dim)]">
            {hasPendingPlay() ? 'Choose where to play it' : activeDevice ? `Currently playing on ${activeDevice.name}` : 'Nothing is playing right now'}
          </p>
        </div>
        <button type="button" onClick={close} className="ui-word">Close</button>
      </div>

      <div className="overflow-y-auto">
        {list.map((device) => {
          const Icon = device.isLocal ? Globe : (ICONS[device.type] || MonitorSpeaker);
          const active = device.isActive || device.id === activeDevice?.id;
          return (
            <button
              key={device.id}
              type="button"
              onClick={() => pick(device)}
              disabled={switching !== null}
              className="ui-row" aria-current={active ? "true" : undefined}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="flex-1 min-w-0">
                <span className="block truncate text-[13px] font-medium">{device.name}</span>
                <span className="room-mono block text-[var(--room-faint)]">{detail(device, active)}</span>
              </span>
              {active && <span className="room-mono shrink-0 text-[var(--room-paper)]">Playing</span>}
            </button>
          );
        })}

        {list.length === 0 && (
          <div className="px-4 py-10 text-center text-[var(--room-dim)] space-y-3">
            <MonitorSpeaker className="w-10 h-10 mx-auto opacity-50" />
            <p className="text-sm">{loading ? 'Looking for devices…' : 'No devices found. Open Spotify on your phone, computer or speaker, then refresh.'}</p>
            <button type="button" onClick={() => { setLoading(true); refreshDevices().finally(() => setLoading(false)); }} className="inline-flex items-center gap-2 rounded-full border border-[var(--room-hair)] px-4 py-2 text-sm font-semibold text-[var(--room-paper)] hover:bg-white/[0.05]">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>
        )}
        {sdkStatus === 'failed' && (
          <p className="px-4 pt-3 pb-1 text-xs text-[var(--room-faint)]">This browser can't play audio itself here, so Jomify controls your other devices instead.</p>
        )}
      </div>
    </div>
  );

  return createPortal(
    <div
      className={`fixed inset-0 z-[10000] flex bg-black/70 ${isMobile ? 'items-end' : 'items-center justify-center px-4 py-6'}`}
      onClick={close}
    >
      {panel}
    </div>,
    document.body
  );
}

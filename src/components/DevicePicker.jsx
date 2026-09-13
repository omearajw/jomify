import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Check, RefreshCw, Laptop, Smartphone, Speaker, Tv, Cast, MonitorSpeaker, Globe } from 'lucide-react';
import { useUserStore } from '../store/userStore';
import { usePlayerStore } from '../store/playerStore';
import { refreshDevices, transferTo } from '../services/spotify/playbackController';
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

  const close = () => setDevicePickerOpen(false);

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
  // ourselves so "This browser" is always a choice when the player is up
  const list = [...devices];
  if (sdkStatus === 'ready' && deviceId && !list.some(d => d.id === deviceId)) {
    list.unshift({ id: deviceId, name: 'This browser', type: 'Computer', isActive: activeDevice?.id === deviceId, isLocal: true, supportsVolume: true });
  }

  const pick = async (device) => {
    if (device.isActive) { close(); return; }
    setSwitching(device.id);
    await transferTo(device.id);
    setSwitching(null);
    close();
  };

  const panel = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="device-picker-title"
      className={isMobile
        ? 'w-full max-h-[80dvh] rounded-t-3xl bg-neutral-950 border-t border-white/10 shadow-2xl flex flex-col pb-[env(safe-area-inset-bottom)]'
        : 'w-full max-w-md rounded-3xl bg-neutral-950 border border-white/10 shadow-2xl flex flex-col max-h-[80vh]'}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between px-6 py-5 border-b border-white/10">
        <div>
          <h2 id="device-picker-title" className="text-xl font-bold text-white">Play on</h2>
          <p className="text-sm text-neutral-400 mt-1">
            {activeDevice ? `Currently playing on ${activeDevice.name}` : 'Nothing is playing right now'}
          </p>
        </div>
        <button type="button" onClick={close} aria-label="Close" className="text-neutral-400 hover:text-white transition-colors p-2">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="overflow-y-auto p-3">
        {list.map((device) => {
          const Icon = device.isLocal ? Globe : (ICONS[device.type] || MonitorSpeaker);
          const active = device.isActive || device.id === activeDevice?.id;
          return (
            <button
              key={device.id}
              type="button"
              onClick={() => pick(device)}
              disabled={switching !== null}
              className={`w-full flex items-center gap-4 rounded-2xl px-4 py-3.5 text-left transition-colors ${active ? 'bg-[var(--brand-mid)]/10 text-white' : 'text-neutral-200 hover:bg-white/5 active:bg-white/10'} disabled:opacity-60`}
            >
              <Icon className={`w-6 h-6 shrink-0 ${active ? 'text-[var(--brand-mid)]' : 'text-neutral-400'}`} />
              <span className="flex-1 min-w-0">
                <span className="block font-semibold truncate">{device.name}</span>
                <span className="block text-xs text-neutral-500">{switching === device.id ? 'Switching…' : active ? 'Playing here' : device.type}</span>
              </span>
              {active && <Check className="w-5 h-5 text-[var(--brand-mid)] shrink-0" />}
            </button>
          );
        })}

        {list.length === 0 && (
          <div className="px-4 py-10 text-center text-neutral-400 space-y-3">
            <MonitorSpeaker className="w-10 h-10 mx-auto opacity-50" />
            <p className="text-sm">{loading ? 'Looking for devices…' : 'No devices found. Open Spotify on your phone, computer or speaker, then refresh.'}</p>
            <button type="button" onClick={() => { setLoading(true); refreshDevices().finally(() => setLoading(false)); }} className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/5">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>
        )}
        {sdkStatus === 'failed' && (
          <p className="px-4 pt-3 pb-1 text-xs text-neutral-500">This browser can't play audio itself here, so Jomify controls your other devices instead.</p>
        )}
      </div>
    </div>
  );

  return createPortal(
    <div
      className={`fixed inset-0 z-[10000] flex bg-black/70 backdrop-blur-sm ${isMobile ? 'items-end' : 'items-center justify-center px-4 py-6'}`}
      onClick={close}
    >
      {panel}
    </div>,
    document.body
  );
}

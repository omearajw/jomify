import { useEffect, useRef, useState } from 'react';
import { Play, Pause, SkipForward, Volume2, Search, Plus, X, Pin, Link2, Check, PauseCircle, PlayCircle, Users, Loader2, PartyPopper, Smartphone, QrCode, ChevronUp, Ban, Monitor } from 'lucide-react';
import { useUserStore } from '../../store/userStore';
import { usePlayerStore } from '../../store/playerStore';
import { usePartyStore } from '../../store/partyStore';
import { useSlice, usePlaybackSummary } from '../../store/selectors';
import { hostApi, partyLink, partyScreenLink } from '../../party/client';
import { startConductor, stopConductor, heartbeat, skipWithParty, setHostPaused, isConducting } from '../../party/conductor';
import { togglePlay, setVolume, playOn, setShuffle } from '../../services/spotify/playbackController';
import { searchSpotify, playContext } from '../../services/spotify/api';
import { artUrl } from '../../utils/images';
import { toast } from '../../store/toastStore';
import { RolePicker, SpeakerPicker, SpeakerBanner, PartyCheck } from './PartyTools';
import { qrSvg, requestedBy } from '../../party/view';

// The host's phone at a party: the few controls that matter, made huge, and the queue the room
// is building. Playback can be on this phone or anywhere else Spotify is; it all goes through
// the same controls.

const slim = (t) => ({ uri: t.uri, id: t.id, name: t.name, artists: (t.artists || []).map((a) => a.name).join(', '), image: artUrl(t.album?.images, 96) || null, durationMs: t.duration_ms || 0 });

function Setup({ playlists, profile, onStart, busy }) {
  const [backingId, setBackingId] = useState(playlists[0]?.id || null);
  const backing = playlists.find((p) => p.id === backingId);
  return (
    <div className="flex flex-col gap-6 animate-fade-in max-w-2xl">
      <div>
        <h1 className="text-4xl md:text-5xl font-extrabold tracking-tighter text-white flex items-center gap-3"><PartyPopper className="w-9 h-9 text-[var(--brand-mid)]" /> Party mode</h1>
        <p className="text-neutral-300 mt-2">Huge controls for you, and a link for the room: anyone can request songs from their phone, no Spotify account needed. Requests take turns, so nobody can hog the night, and the music never stops.</p>
      </div>
      <div>
        <h2 className="text-xs font-bold uppercase tracking-widest text-neutral-400 mb-3">Playlist to fall back on when nothing is requested</h2>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 max-h-[40dvh] overflow-y-auto pr-1">
          {playlists.map((p) => (
            <button key={p.id} type="button" onClick={() => setBackingId(p.id)} aria-pressed={p.id === backingId} className={`rounded-2xl p-2 text-left border transition-colors ${p.id === backingId ? 'border-[var(--brand-mid)] bg-white/10' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}>
              <div className="aspect-square rounded-xl overflow-hidden bg-neutral-800 mb-2">{p.images?.[0]?.url && <img src={artUrl(p.images, 200)} alt="" className="w-full h-full object-cover" />}</div>
              <p className="text-sm font-semibold text-white truncate">{p.name}</p>
            </button>
          ))}
        </div>
      </div>
      <button type="button" disabled={!backing || busy} onClick={() => onStart(backing)} className="rounded-full bg-brand-gradient py-4 px-8 text-lg font-bold text-white shadow-brand-glow disabled:opacity-50 flex items-center justify-center gap-2">
        {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <PartyPopper className="w-5 h-5" />} Start the party{profile?.display_name ? ` as ${profile.display_name}` : ''}
      </button>
    </div>
  );
}

export default function PartyMode() {
  const { token, profile, playlists } = useSlice(useUserStore, ['token', 'profile', 'playlists']);
  const savedVolume = useUserStore((s) => s.savedVolume);
  const { code, party, queue, upNext, history, guestCount, conductor, hostAway, error, skipping, applyState, setCode, clear } = useSlice(usePartyStore, ['code', 'party', 'queue', 'upNext', 'history', 'guestCount', 'conductor', 'hostAway', 'error', 'skipping', 'applyState', 'setCode', 'clear']);
  const { currentPlayingTrack: track, isCurrentTrackPaused: paused } = usePlaybackSummary();
  const { isLocalActive, remoteVolume, activeDevice } = useSlice(usePlayerStore, ['isLocalActive', 'remoteVolume', 'activeDevice']);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [copied, setCopied] = useState(false);
  const [endArmed, setEndArmed] = useState(false);
  const [showPlaylists, setShowPlaylists] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [blockArmed, setBlockArmed] = useState(null); // a guest id, waiting for the second tap
  const blocked = usePartyStore((s) => s.blocked);
  const searchTimer = useRef(null);

  const own = playlists.filter((p) => p.owner?.id === profile?.id || p.collaborative);
  const choices = own.length ? own : playlists;

  // The conductor runs whether or not this page is open; opening it just makes sure
  useEffect(() => {
    if (code && token && !isConducting()) startConductor();
    else if (code && token) heartbeat();
  }, [code, token]);

  useEffect(() => {
    clearTimeout(searchTimer.current);
    const q = query.trim();
    if (!token || q.length < 2) return undefined;
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await searchSpotify(token, q);
        setResults((res?.tracks?.items || []).slice(0, 8).map(slim));
      } catch { setResults([]); }
    }, 350);
    return () => clearTimeout(searchTimer.current);
  }, [query, token]);
  const shownResults = query.trim().length < 2 ? null : results;

  const start = async (backing) => {
    setBusy(true);
    try {
      const u = useUserStore.getState();
      const { party: created } = await hostApi.create({ hostName: profile?.display_name || 'The host', backing: { uri: `spotify:playlist:${backing.id}`, name: backing.name, image: artUrl(backing.images, 200) || null }, token: u.token, tokenExpiresAt: u.tokenExpiresAt });
      setCode(created.code);
      startConductor();
      // Off we go: the backing playlist, shuffled, wherever Spotify plays
      await playOn(async (deviceId) => { await playContext(token, deviceId, `spotify:playlist:${backing.id}`, 0); await setShuffle(true, deviceId).catch(() => {}); });
    } catch (err) {
      toast(err?.message || "Couldn't start the party", { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const op = async (body, okText) => {
    try {
      const res = await hostApi.op(code, body);
      if (res?.queue) applyState({ ...res, conductor });
      if (okText) toast(okText, { tone: 'success' });
      return res;
    } catch (err) {
      toast(err?.message || 'That did not work', { tone: 'error' });
      return null;
    }
  };

  const end = async () => {
    if (!endArmed) { setEndArmed(true); setTimeout(() => setEndArmed(false), 4000); return; }
    await op({ op: 'end' });
    stopConductor();
    clear();
    toast('Party over. Thanks for hosting.', { tone: 'info' });
  };

  const copyLink = async () => {
    const link = partyLink(code);
    try {
      if (navigator.share) { await navigator.share({ title: 'Join my Jomify party', text: `Request songs at my party: ${link}`, url: link }); return; }
      await navigator.clipboard.writeText(link);
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    } catch { /* cancelled share */ }
  };

  const changeBacking = async (p) => {
    const backing = { uri: `spotify:playlist:${p.id}`, name: p.name, image: artUrl(p.images, 200) || null };
    setShowPlaylists(false);
    await op({ op: 'settings', backing });
    await playOn(async (deviceId) => { await playContext(token, deviceId, backing.uri, 0); await setShuffle(true, deviceId).catch(() => {}); });
  };

  const volume = isLocalActive ? savedVolume : (remoteVolume ?? activeDevice?.volumePercent ?? 50);

  if (!code) return <Setup playlists={choices} profile={profile} onStart={start} busy={busy} />;

  const fromGuest = requestedBy(track, { history, upNext });

  return (
    <div className="flex flex-col gap-5 animate-fade-in max-w-3xl pb-8">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold uppercase tracking-widest text-neutral-400 flex items-center gap-2"><PartyPopper className="w-4 h-4 text-[var(--brand-mid)]" /> Party on · <Users className="w-3.5 h-3.5" /> {guestCount}</p>
          <p className="font-mono text-4xl md:text-5xl font-extrabold tracking-[0.3em] text-white">{code}</p>
          <p className="text-sm text-neutral-400 truncate">{partyLink(code).replace(/^https?:\/\//, '')}</p>
        </div>
        <button type="button" onClick={copyLink} className="rounded-full border border-white/15 bg-white/10 px-4 py-3 text-sm font-bold text-white flex items-center gap-2 hover:bg-white/15">{copied ? <Check className="w-4 h-4" /> : <Link2 className="w-4 h-4" />} {copied ? 'Copied' : 'Share link'}</button>
        <a href={partyScreenLink(code)} target="_blank" rel="noreferrer" title="Open this on a TV or a spare screen: QR, now playing and what's next" className="rounded-full border border-white/15 bg-white/10 px-4 py-3 text-sm font-bold text-white flex items-center gap-2 hover:bg-white/15"><Monitor className="w-4 h-4" /> Wall screen</a>
        <button type="button" onClick={() => setShowQr((v) => !v)} aria-pressed={showQr} className="rounded-full border border-white/15 bg-white/10 px-4 py-3 text-sm font-bold text-white flex items-center gap-2 hover:bg-white/15"><QrCode className="w-4 h-4" /> QR</button>
        <button type="button" onClick={end} className={`rounded-full px-4 py-3 text-sm font-bold flex items-center gap-2 ${endArmed ? 'bg-red-500 text-white' : 'border border-white/15 text-neutral-300 hover:bg-white/10'}`}>{endArmed ? 'Tap again to end' : 'End party'}</button>
      </header>

      {showQr && (
        <button type="button" onClick={() => setShowQr(false)} aria-label="Hide the QR code" className="self-center rounded-3xl bg-white p-4 shadow-2xl">
          <div className="w-56 h-56 md:w-72 md:h-72 [&>svg]:w-full [&>svg]:h-full" dangerouslySetInnerHTML={{ __html: qrSvg(partyLink(code)) }} />
          <p className="text-center text-black font-mono font-extrabold tracking-[0.3em] mt-2">{code}</p>
        </button>
      )}
      <SpeakerBanner party={party} />
      {error && <p className="rounded-2xl bg-amber-500/15 border border-amber-400/30 px-4 py-3 text-sm text-amber-200">{error}</p>}
      {!conductor && <p className="rounded-2xl bg-white/10 px-4 py-3 text-sm text-neutral-200 flex items-center gap-2"><Smartphone className="w-4 h-4" /> Another of your devices is running the party; this one is along for the ride.</p>}
      {hostAway && conductor && <p className="rounded-2xl bg-amber-500/15 border border-amber-400/30 px-4 py-3 text-sm text-amber-200">Guests can't search until the next heartbeat lands.</p>}

      {/* Now playing + the big three */}
      <section className="rounded-3xl bg-white/5 border border-white/10 p-5 flex flex-col gap-5">
        <div className="flex items-center gap-4">
          {track?.album?.images?.[0]?.url ? <img src={artUrl(track.album.images, 160)} alt="" className="w-24 h-24 md:w-32 md:h-32 rounded-2xl object-cover shadow-2xl" /> : <div className="w-24 h-24 md:w-32 md:h-32 rounded-2xl bg-white/10" />}
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-widest text-neutral-400">{paused ? 'Paused' : 'Now playing'}{activeDevice?.name ? ` · ${activeDevice.name}` : ''}</p>
            <p className="text-2xl font-extrabold text-white truncate">{track?.name || 'Nothing yet'}</p>
            <p className="text-neutral-300 truncate">{(track?.artists || []).map((a) => a.name).join(', ')}</p>
            {fromGuest && <p className="text-sm text-[var(--brand-mid)] font-semibold mt-1">Requested by {fromGuest}</p>}
            {upNext && (!track || upNext.uri !== track.uri) && <p className="text-xs text-neutral-500 mt-1 truncate">Up next: {upNext.name} · {upNext.guestName}</p>}
          </div>
        </div>
        <div className="flex items-center justify-center gap-6">
          <button type="button" onClick={() => { setHostPaused(!paused); togglePlay(); }} aria-label={paused ? 'Play' : 'Pause'} className="w-24 h-24 rounded-full bg-brand-gradient text-white flex items-center justify-center shadow-brand-glow active:scale-95 transition-transform">
            {paused ? <Play className="w-12 h-12 fill-current ml-1" /> : <Pause className="w-12 h-12 fill-current" />}
          </button>
          <button type="button" onClick={() => { setHostPaused(false); skipWithParty(); }} aria-label="Skip" aria-busy={skipping || undefined} disabled={skipping} className={`w-20 h-20 rounded-full border border-white/15 text-white flex items-center justify-center active:scale-95 transition-all ${skipping ? 'bg-white/20 scale-95' : 'bg-white/10'}`}>
            {skipping ? <Loader2 className="w-9 h-9 animate-spin" /> : <SkipForward className="w-10 h-10 fill-current" />}
          </button>
        </div>
        <label className="flex items-center gap-4">
          <Volume2 className="w-7 h-7 text-neutral-300 shrink-0" />
          <input type="range" min="0" max="100" value={volume} onChange={(e) => setVolume(Number(e.target.value))} aria-label="Volume" className="w-full h-3 accent-[var(--brand-mid)]" />
          <span className="w-10 text-right tabular-nums text-neutral-300 font-semibold">{volume}</span>
        </label>
      </section>

      {/* Add a song */}
      <section className="flex flex-col gap-3">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-neutral-500" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Add a song" aria-label="Add a song" className="w-full rounded-2xl bg-white/10 border border-white/15 pl-12 pr-10 py-4 text-lg text-white placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-[var(--brand-mid)]" />
          {query && <button type="button" onClick={() => { setQuery(''); setResults(null); }} aria-label="Clear" className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-neutral-400"><X className="w-5 h-5" /></button>}
        </div>
        {shownResults && shownResults.length === 0 && <p className="text-sm text-neutral-400">Nothing found.</p>}
        {shownResults && shownResults.length > 0 && (
          <ul className="flex flex-col gap-2">
            {shownResults.map((t) => (
              <li key={t.uri} className="flex items-center gap-3 rounded-2xl bg-white/5 border border-white/10 p-3">
                {t.image ? <img src={t.image} alt="" className="w-12 h-12 rounded-lg object-cover" /> : <div className="w-12 h-12 rounded-lg bg-white/10" />}
                <span className="min-w-0 flex-1"><span className="block font-semibold text-white truncate">{t.name}</span><span className="block text-sm text-neutral-400 truncate">{t.artists}</span></span>
                <button type="button" onClick={async () => { if (await op({ op: 'add', track: t }, `Added ${t.name}`)) { setQuery(''); setResults(null); } }} className="rounded-full bg-white/10 px-3 py-2 text-sm font-bold text-white flex items-center gap-1"><Plus className="w-4 h-4" /> Add</button>
                <button type="button" onClick={async () => { if (await op({ op: 'add', track: t, playNext: true }, `${t.name} is next`)) { setQuery(''); setResults(null); } }} className="rounded-full bg-brand-gradient px-3 py-2 text-sm font-bold text-white">Next</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Settings row */}
      <section className="flex flex-wrap items-center gap-2">
        <SpeakerPicker party={party} op={op} />
        <button type="button" onClick={() => setShowPlaylists((v) => !v)} className="rounded-full border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white truncate max-w-full">Playlist: {party?.backing?.name || 'none'}</button>
        <button type="button" onClick={() => op({ op: 'settings', paused: !party?.paused })} aria-pressed={Boolean(party?.paused)} className={`rounded-full px-4 py-2.5 text-sm font-semibold flex items-center gap-2 ${party?.paused ? 'bg-amber-500/20 text-amber-200 border border-amber-400/30' : 'border border-white/15 bg-white/5 text-white'}`}>
          {party?.paused ? <PlayCircle className="w-4 h-4" /> : <PauseCircle className="w-4 h-4" />} {party?.paused ? 'Requests paused' : 'Pause requests'}
        </button>
      </section>
      {showPlaylists && (
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-3 max-h-[36dvh] overflow-y-auto pr-1">
          {choices.map((p) => (
            <button key={p.id} type="button" onClick={() => changeBacking(p)} className={`rounded-2xl p-2 text-left border ${party?.backing?.uri === `spotify:playlist:${p.id}` ? 'border-[var(--brand-mid)] bg-white/10' : 'border-white/10 bg-white/5'}`}>
              <div className="aspect-square rounded-xl overflow-hidden bg-neutral-800 mb-2">{p.images?.[0]?.url && <img src={artUrl(p.images, 160)} alt="" className="w-full h-full object-cover" />}</div>
              <p className="text-xs font-semibold text-white truncate">{p.name}</p>
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <RolePicker />
        <PartyCheck code={code} />
      </div>
      {blocked?.length > 0 && (
        <p className="text-xs text-neutral-400 flex flex-wrap items-center gap-2">
          Blocked:
          {blocked.map((g) => (
            <button key={g.id} type="button" onClick={() => op({ op: 'unblock', guestId: g.id }, `${g.name} can request again`)} className="rounded-full bg-white/10 px-2 py-0.5 text-neutral-200 hover:bg-white/15">{g.name} · Unblock</button>
          ))}
        </p>
      )}

      {/* The queue */}
      <section>
        <h2 className="text-xs font-bold uppercase tracking-widest text-neutral-400 mb-2">Requests{queue.length ? ` · ${queue.length}` : ''}</h2>
        {queue.length === 0 ? (
          <p className="text-sm text-neutral-500">Nothing waiting. {party?.backing?.name || 'The playlist'} carries on until someone asks for a song.</p>
        ) : (
          <ol className="flex flex-col gap-1.5">
            {queue.map((i, n) => (
              <li key={i.id} className="flex items-center gap-3 rounded-2xl bg-white/5 border border-white/10 px-3 py-2">
                <span className="w-6 text-right text-neutral-500 tabular-nums font-semibold">{n + 1}</span>
                {i.image ? <img src={i.image} alt="" className="w-10 h-10 rounded-lg object-cover" /> : <div className="w-10 h-10 rounded-lg bg-white/10" />}
                <span className="min-w-0 flex-1"><span className="block font-semibold text-white truncate">{i.name}</span><span className="block text-xs text-neutral-400 truncate">{i.artists} · {i.guestName}</span></span>
                {i.votes > 0 && <span className="text-xs font-bold text-[var(--brand-mid)] flex items-center gap-0.5 tabular-nums"><ChevronUp className="w-4 h-4" />{i.votes}</span>}
                <button type="button" onClick={() => op({ op: 'pin', id: i.id, pinned: !i.pinnedAt })} aria-label={i.pinnedAt ? 'Unpin' : 'Play next'} aria-pressed={Boolean(i.pinnedAt)} className={`p-2 rounded-full ${i.pinnedAt ? 'text-[var(--brand-mid)]' : 'text-neutral-400 hover:text-white'}`}><Pin className="w-5 h-5" /></button>
                {i.guestId !== 'host' && (
                  <button
                    type="button"
                    onClick={() => {
                      if (blockArmed !== i.guestId) { setBlockArmed(i.guestId); setTimeout(() => setBlockArmed((v) => (v === i.guestId ? null : v)), 4000); return; }
                      setBlockArmed(null);
                      op({ op: 'block', guestId: i.guestId }, `Blocked ${i.guestName}; their songs are gone`);
                    }}
                    aria-label={blockArmed === i.guestId ? `Tap again to block ${i.guestName}` : `Block ${i.guestName}`}
                    className={`rounded-full ${blockArmed === i.guestId ? 'bg-red-500 text-white px-2 py-1 text-xs font-bold' : 'p-2 text-neutral-500 hover:text-red-300'}`}
                  >
                    {blockArmed === i.guestId ? `Block ${i.guestName}?` : <Ban className="w-4 h-4" />}
                  </button>
                )}
                <button type="button" onClick={() => op({ op: 'remove', id: i.id })} aria-label={`Remove ${i.name}`} className="p-2 rounded-full text-neutral-400 hover:text-white"><X className="w-5 h-5" /></button>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

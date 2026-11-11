import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity, ArrowLeft, AudioLines, Check, ChevronDown, ChevronRight, CircleHelp, Copy,
  Disc3, Headphones, Link2, ListMusic, LoaderCircle, LockKeyhole, LogIn, Menu, Mic2,
  Minus, Music2, Pause, Play, Plus, Radio, Search, Settings2, Share2, SkipForward,
  SlidersHorizontal, Sparkles, Speaker, Upload, Volume2, X, Zap
} from 'lucide-react';
import { io } from 'socket.io-client';
import { compensatePlaybackPosition, DEFAULT_SETTINGS, FREQUENCIES, useAudioProcessing } from './audio.js';

const API = 'https://sonora-8hkp.onrender.com/api';
const tabs = [
  { id: 'eq', label: 'Equalizer', icon: SlidersHorizontal },
  { id: 'bass', label: 'Bass boost', icon: Activity },
  { id: 'filters', label: 'Frequency cut', icon: AudioLines },
  { id: 'sub', label: 'Subwoofer', icon: Speaker },
  { id: 'latency', label: 'Latency', icon: Radio },
  { id: 'device', label: 'Device', icon: Headphones }
];
const presets = {
  Flat: Array(16).fill(0),
  'Bass Boost': [7, 7, 6, 5, 4, 3, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  Treble: [-1, -1, -1, -1, 0, 0, 0, 0, 1, 2, 4, 5, 5, 4, 3, 2],
  Vocal: [-3, -3, -2, -1, 0, 2, 3, 4, 3, 2, 1, 0, 0, -1, -2, -2],
  Rock: [5, 4, 3, 1, -1, -2, 0, 2, 4, 5, 4, 3, 3, 3, 3, 3],
  Electronic: [5, 4, 3, 1, -1, 1, 0, 2, 1, 2, 0, 2, 3, 3, 3, 2]
};

function readIdentity() {
  let userId = localStorage.getItem('sonora-user-id');
  if (!userId) {
    userId = globalThis.crypto?.randomUUID?.()
      || `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem('sonora-user-id', userId);
  }
  return userId;
}

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data;
}

function Brand({ compact = false }) {
  return <div className={`brand ${compact ? 'brand-compact' : ''}`}><span className="brand-mark"><AudioLines size={18} strokeWidth={2.2} /></span><span>sonora<span className="brand-dot">.</span></span></div>;
}

function Visualizer({ size = 'large', active = true }) {
  return <div className={`visualizer visualizer-${size} ${active ? 'is-active' : ''}`} aria-hidden="true">
    {Array.from({ length: size === 'large' ? 34 : 18 }, (_, i) =>
      <i key={i} style={{ '--i': i, '--h': `${16 + ((i * 19 + 31) % 70)}%` }} />)}
  </div>;
}

function App() {
  const userId = useMemo(readIdentity, []);
  const [page, setPage] = useState('home');
  const [room, setRoom] = useState(null);
  const [role, setRole] = useState('member');
  const [ownerToken, setOwnerToken] = useState('');
  const [name, setName] = useState(localStorage.getItem('sonora-name') || '');
  const [modal, setModal] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [socketStatus, setSocketStatus] = useState('disconnected');
  const socketRef = useRef(null);

  const enterRoom = (nextRoom, nextRole, token = '') => {
    setRoom(nextRoom);
    setRole(nextRole);
    setOwnerToken(token);
    if (token) localStorage.setItem(`sonora-host-${nextRoom.code}`, token);
    setPage('room');
    setModal('');
    setError('');
    localStorage.setItem('sonora-name', name.trim());
    window.history.pushState({ code: nextRoom.code }, '', `#room-${nextRoom.code}`);
  };

  useEffect(() => {
    const code = window.location.hash.match(/^#room-([A-Z0-9]{6})$/i)?.[1];
    if (!code) return;
    const token = localStorage.getItem(`sonora-host-${code.toUpperCase()}`) || '';
    request(`${API}/rooms/${code}`)
      .then(({ room: current }) => {
        const isHost = current.hostUserId === userId && Boolean(token);
        setRoom(current);
        setRole(isHost ? 'host' : 'member');
        setOwnerToken(token);
        setPage('room');
      })
      .catch(() => {
        window.history.replaceState(null, '', window.location.pathname);
      });
  }, [userId]);

  useEffect(() => {
    if (!notice) return undefined;
    const timeout = setTimeout(() => setNotice(''), 2800);
    return () => clearTimeout(timeout);
  }, [notice]);

  const createRoom = async () => {
    setBusy(true); setError('');
    try {
      const result = await request(`${API}/rooms`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, name: name.trim() })
      });
      enterRoom(result.room, 'host', result.ownerToken);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const joinRoom = async (code) => {
    setBusy(true); setError('');
    try {
      const result = await request(`${API}/rooms/${code.trim().toUpperCase()}/join`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, name: name.trim() })
      });
      enterRoom(result.room, result.room.hostUserId === userId ? 'host' : 'member',
        localStorage.getItem(`sonora-host-${result.room.code}`) || '');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const leaveRoom = () => {
    socketRef.current?.emit('room:leave');
    socketRef.current?.disconnect();
    socketRef.current = null;
    window.history.replaceState(null, '', window.location.pathname);
    setRoom(null); setPage('home'); setError('');
  };

  return <>
    <AnimatePresence mode="wait">
      {page === 'home'
        ? <Home key="home" onOpen={setModal} onCreate={() => setModal('create')} />
        : <RoomView key={room?.code || 'room'} room={room} setRoom={setRoom} role={role}
          ownerToken={ownerToken} userId={userId} name={name} onLeave={leaveRoom}
          socketRef={socketRef} socketStatus={socketStatus} setSocketStatus={setSocketStatus}
          setNotice={setNotice} />}
    </AnimatePresence>
    <AnimatePresence>
      {modal && <RoomModal key={modal} type={modal} onClose={() => { setModal(''); setError(''); }}
        name={name} setName={setName} error={error} setError={setError} busy={busy}
        onCreate={createRoom} onJoin={joinRoom} />}
      {notice && <motion.div className="toast" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}><Check size={16} />{notice}</motion.div>}
    </AnimatePresence>
  </>;
}

function Home({ onOpen, onCreate }) {
  return <motion.main className="landing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
    <div className="landing-glow landing-glow-a" /><div className="landing-glow landing-glow-b" />
    <header className="topbar"><Brand /><nav className="nav-links"><a href="#how">How it works</a><a href="#sound">Your sound, your way</a></nav>
      <button className="button button-outline button-small" onClick={() => onOpen('join')}><LogIn size={15} /> Join a room</button></header>
    <section className="hero">
      <div className="hero-copy">
        <div className="eyebrow"><span className="live-dot" /> LISTEN TOGETHER, WHEREVER</div>
        <h1>Same song.<br /><span>Different rooms.</span></h1>
        <p className="hero-lede">A little closer, even when you’re far apart. Start a room, invite your people, and press play together.</p>
        <div className="hero-actions"><button className="button button-primary" onClick={onCreate}><Plus size={17} /> Create a room <ChevronRight size={17} /></button><button className="button button-quiet" onClick={() => onOpen('join')}>I have a room code <ArrowLeft size={15} className="rotate-180" /></button></div>
        <div className="hero-social"><div className="avatar-stack"><span>M</span><span>J</span><span>A</span><span><Plus size={11} /></span></div><span>For the songs you wish you could share</span></div>
      </div>
      <div className="hero-art">
        <div className="orbit orbit-one" /><div className="orbit orbit-two" />
        <div className="disc-card"><div className="disc-glow" /><div className="record"><div className="record-groove" /><div className="record-center"><AudioLines size={24} /></div></div><div className="disc-caption"><span className="caption-kicker">NOW PLAYING TOGETHER</span><strong>Good things take time</strong><span>by The Quiet Hours</span></div><div className="play-indicator"><span /><span /><span /><span /><span /></div></div>
        <div className="float-pill pill-top"><span className="pill-icon"><Radio size={14} /></span><span><b>IN SYNC</b><small>Across every device</small></span><Check size={15} className="pill-check" /></div>
        <div className="float-pill pill-bottom"><span className="avatar-mini">S</span><span><b>Sam just joined</b><small>Listening from Brooklyn</small></span><span className="online-dot" /></div>
        <Visualizer size="large" />
      </div>
    </section>
    <section id="how" className="how-section">
      <div className="section-heading"><span className="eyebrow">THE GOOD PART IS THE TOGETHER PART</span><h2>One room. All your people.</h2><p>No complicated setup. Just a room code and a song worth sharing.</p></div>
      <div className="steps-grid">
        {[{ n: '01', icon: Radio, title: 'Make a room', text: 'You’re the host. Pick what to play and set the vibe.' }, { n: '02', icon: Share2, title: 'Send the invite', text: 'Your people join in seconds with a simple room code.' }, { n: '03', icon: Headphones, title: 'Hear it your way', text: 'One shared moment, with personal audio for everyone.' }].map(({ n, icon: Icon, title, text }) =>
          <div className="step-card" key={n}><div className="step-top"><span>{n}</span><Icon size={18} /></div><h3>{title}</h3><p>{text}</p></div>)}
      </div>
    </section>
    <section id="sound" className="sound-band"><div><span className="eyebrow">YOUR DEVICE, YOUR SOUND</span><h2>Make it feel like yours.</h2><p>Fine-tune your equalizer, give the bass a little love, or compensate for headphone delay. Your settings never touch anyone else’s.</p></div><div className="sound-eq">{Array.from({ length: 28 }, (_, i) => <i key={i} style={{ '--i': i, '--h': `${22 + Math.abs(Math.sin(i * 1.7)) * 67}%` }} />)}<span>LOW <b>YOUR EQ</b> HIGH</span></div></section>
    <footer className="landing-footer"><Brand compact /><span>Made for listening, better together.</span><span className="footer-note">Your sound stays yours.</span></footer>
  </motion.main>;
}

function RoomModal({ type, onClose, name, setName, error, setError, busy, onCreate, onJoin }) {
  const [code, setCode] = useState('');
  const isCreate = type === 'create';
  const submit = (event) => {
    event.preventDefault();
    if (!name.trim()) { setError('Add a name so your friends know it’s you.'); return; }
    if (isCreate) onCreate(); else onJoin(code);
  };
  return <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <motion.form className="modal-card" onSubmit={submit} initial={{ opacity: 0, y: 14, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }}>
      <button type="button" className="icon-button modal-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
      <span className="modal-emblem">{isCreate ? <Radio size={21} /> : <Link2 size={21} />}</span>
      <span className="eyebrow">{isCreate ? 'YOU SET THE MOOD' : 'YOUR PEOPLE ARE WAITING'}</span>
      <h2>{isCreate ? 'Start a listening room' : 'Join the room'}</h2>
      <p>{isCreate ? 'You’ll be the host. Everyone else can settle in and listen.' : 'Enter the six-character code your host shared with you.'}</p>
      <label className="field-label" htmlFor="display-name">YOUR NAME</label>
      <input id="display-name" className="text-input" value={name} onChange={(e) => { setName(e.target.value); setError(''); }} placeholder="What should we call you?" maxLength={32} autoFocus />
      {!isCreate && <><label className="field-label field-spaced" htmlFor="room-code">ROOM CODE</label><input id="room-code" className="text-input room-code-input" value={code} onChange={(e) => { setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)); setError(''); }} placeholder="E.G. A7K2QD" maxLength={6} autoComplete="off" /></>}
      {error && <div className="form-error"><CircleHelp size={15} />{error}</div>}
      <button className="button button-primary modal-submit" disabled={busy || (!isCreate && code.length !== 6)}>{busy ? <><LoaderCircle size={16} className="spin" /> Connecting…</> : <>{isCreate ? <><Plus size={17} /> Create my room</> : <><LogIn size={17} /> Join listening room</>}</>}</button>
      <span className="modal-footnote"><LockKeyhole size={12} /> Your audio settings stay on your device</span>
    </motion.form>
  </motion.div>;
}

function RoomView({ room, setRoom, role, ownerToken, userId, name, onLeave, socketRef, socketStatus, setSocketStatus, setNotice }) {
  const [roomError, setRoomError] = useState('');
  const [activeTab, setActiveTab] = useState('eq');
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [panel, setPanel] = useState('music');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchMessage, setSearchMessage] = useState('');
  const [copied, setCopied] = useState(false);
  const [playError, setPlayError] = useState('');
  const [playerReady, setPlayerReady] = useState(false);
  const [clockOffset, setClockOffset] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [seekPreview, setSeekPreview] = useState(null);
  const [positionTick, setPositionTick] = useState(0);
  const socketRefLocal = useRef(null);
  const audioRef = useRef(null);
  const audioBufferingRef = useRef(false);
  const ytRef = useRef(null);
  const uploadRef = useRef(null);
  const playbackRef = useRef(null);
  const latencyAlignmentRef = useRef('');
  const command = useCallback((type, extra = {}) => {
    if (role !== 'host' || !socketRefLocal.current?.connected) return;
    socketRefLocal.current.emit('playback:command', {
      code: room.code, ownerToken, type, position: getMediaPosition(room, ytRef.current, audioRef.current, clockOffset), ...extra
    }, (result) => {
      if (result?.error) setRoomError(result.error);
    });
  }, [role, room, ownerToken, clockOffset]);
  const currentSong = room?.queue?.[room.currentIndex] || null;
  const isHost = role === 'host';
  const audio = useAudioProcessing(audioRef, settings, currentSong?.type === 'audio');
  playbackRef.current = { currentSong, playerReady, latency: settings.latency };

  useEffect(() => {
    let alive = true;
    request(`${API}/preferences/${userId}`)
      .then(({ settings: saved }) => { if (alive && saved) setSettings({ ...DEFAULT_SETTINGS, ...saved }); })
      .catch((err) => setRoomError(`Audio settings could not be loaded: ${err.message}`))
      .finally(() => { if (alive) setSettingsLoaded(true); });
    return () => { alive = false; };
  }, [userId]);

  useEffect(() => {
    if (!settingsLoaded) return undefined;
    const timeout = setTimeout(() => {
      request(`${API}/preferences/${userId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings })
      }).catch((err) => setRoomError(`Audio settings could not be saved: ${err.message}`));
    }, 350);
    return () => clearTimeout(timeout);
  }, [settings, settingsLoaded, userId]);

  useEffect(() => {
    if (!currentSong || room.playback.status !== 'playing') return undefined;
    const timer = setInterval(() => setPositionTick(Date.now()), 500);
    return () => clearInterval(timer);
  }, [currentSong?.videoId, currentSong?.url, room.playback.status]);

  useEffect(() => {
    setSeekPreview(null);
  }, [currentSong?.videoId, currentSong?.url]);

  useEffect(() => {
    const socket = io('https://sonora-8hkp.onrender.com', {
    autoConnect: true,
    reconnection: true
    });
    socketRef.current = socket;
    socketRefLocal.current = socket;
    const measureClockOffset = () => {
      if (!socket.connected) return;
      const sentAt = Date.now();
      socket.emit('sync:ping', (result) => {
        if (typeof result?.serverNow !== 'number') return;
        const receivedAt = Date.now();
        setClockOffset(result.serverNow - (sentAt + receivedAt) / 2);
      });
    };
    socket.on('connect', () => {
      setSocketStatus('connecting');
      measureClockOffset();
      socket.emit('room:join', { code: room.code, userId, ownerToken }, (result) => {
        if (result?.error) { setRoomError(result.error); setSocketStatus('disconnected'); return; }
        setRoom(result.room);
        setSocketStatus('connected');
      });
    });
    socket.on('room:state', (state) => setRoom(state));
    socket.on('playback:seek', ({ position }) => {
      const current = playbackRef.current;
      const target = compensatePlaybackPosition(Number(position), current.latency);
      if (current.currentSong?.type === 'youtube' && ytRef.current && current.playerReady) {
        ytRef.current.seekTo(target, true);
      } else if (current.currentSong?.type === 'audio' && audioRef.current) {
        audioRef.current.currentTime = target;
      }
    });
    socket.on('disconnect', () => setSocketStatus('disconnected'));
    socket.on('connect_error', () => setSocketStatus('disconnected'));
    const clockTimer = setInterval(measureClockOffset, 5000);
    return () => {
      clearInterval(clockTimer);
      socket.emit('room:leave');
      socket.disconnect();
      socketRef.current = null;
      socketRefLocal.current = null;
    };
  }, [room.code, userId, ownerToken, setRoom, setSocketStatus, socketRef]);

  useEffect(() => {
    const audioElement = audioRef.current;
    if (!audioElement || currentSong?.type !== 'audio') {
      if (audioElement && !currentSong) audioElement.pause();
      return;
    }
    const url = `${currentSong.url}`;
    if (!audioElement.src.endsWith(url)) {
      setAudioDuration(0);
      audioElement.src = url;
      audioElement.load();
    }
    if (room.playback.status === 'playing') {
      const target = expectedPosition(room.playback, settings.latency, clockOffset);
      if (Number.isFinite(target) && Math.abs(audioElement.currentTime - target) > 1.5) {
        audioElement.currentTime = Math.max(0, target);
      }
      audio.resume();
      audioElement.play().then(() => setPlayError('')).catch(() => setPlayError('Tap play once to allow audio on this device.'));
    } else if (room.playback.status === 'paused') {
      audioElement.pause();
      const target = compensatePlaybackPosition(room.playback.position, settings.latency);
      if (Math.abs(audioElement.currentTime - target) > 0.8) {
        audioElement.currentTime = target;
      }
    }
  }, [currentSong?.url, currentSong?.type, room.playback.status, room.playback.updatedAt, room.playback.position, settings.latency, clockOffset, audio]);

  useEffect(() => {
    if (!settingsLoaded || !currentSong) return;
    const trackId = currentSong.type === 'youtube' ? currentSong.videoId : currentSong.url;
    const alignmentKey = `${trackId}:${room.playback.updatedAt}:${room.playback.status}:${settings.latency}`;
    if (latencyAlignmentRef.current === alignmentKey) return;
    latencyAlignmentRef.current = alignmentKey;

    const target = room.playback.status === 'playing'
      ? expectedPosition(room.playback, settings.latency, clockOffset)
      : compensatePlaybackPosition(room.playback.position, settings.latency);

    if (currentSong.type === 'audio') {
      const element = audioRef.current;
      if (!element || !Number.isFinite(target)) return;
      try {
        element.currentTime = target;
      } catch {
        element.addEventListener('loadedmetadata', () => {
          element.currentTime = target;
        }, { once: true });
      }
      return;
    }

    const player = ytRef.current;
    if (currentSong.type === 'youtube' && playerReady && player && Number.isFinite(target)) {
      if (room.playback.status !== 'playing' || player.getPlayerState?.() === 1) {
        player.seekTo(target, true);
      }
    }
  }, [
    settingsLoaded, currentSong?.type, currentSong?.videoId, currentSong?.url,
    room.playback.updatedAt, room.playback.status, room.playback.position,
    settings.latency, playerReady, clockOffset
  ]);

  useEffect(() => {
    if (currentSong?.type !== 'audio' || room.playback.status !== 'playing') return undefined;
    const timer = setInterval(() => {
      const element = audioRef.current;
      if (!element || element.paused || audioBufferingRef.current || !Number.isFinite(element.currentTime)) return;
      const target = expectedPosition(room.playback, settings.latency, clockOffset);
      const drift = target - element.currentTime;
      if (Math.abs(drift) > 2) element.currentTime = Math.max(0, target);
      else element.playbackRate = 1 + Math.max(-0.015, Math.min(0.015, drift * 0.02));
    }, 3000);
    return () => clearInterval(timer);
  }, [currentSong?.type, room.playback, settings.latency, clockOffset]);

  useEffect(() => {
    if (currentSong?.type !== 'youtube' || !ytRef.current || !playerReady) return;
    const player = ytRef.current;
    if (room.playback.status === 'playing') {
      const target = expectedPosition(room.playback, settings.latency, clockOffset);
      const state = player.getPlayerState?.();
      if (state === 3) return;
      if (state !== 1) {
        player.playVideo();
        return;
      }
      const now = player.getCurrentTime?.();
      if (Number.isFinite(target) && Number.isFinite(now) && Math.abs(target - now) > 3) player.seekTo(Math.max(0, target), true);
    } else if (room.playback.status === 'paused') {
      player.pauseVideo();
      const now = player.getCurrentTime?.();
      const target = compensatePlaybackPosition(room.playback.position, settings.latency);
      if (Number.isFinite(now) && Math.abs(target - now) > 1.2) {
        player.seekTo(target, true);
      }
    }
  }, [currentSong?.videoId, playerReady, room.playback.status, room.playback.updatedAt, room.playback.position, settings.latency, clockOffset]);

  useEffect(() => {
    if (currentSong?.type !== 'youtube' || !playerReady) return;
    const timer = setInterval(() => {
      const player = ytRef.current;
      if (!player) return;
      if (room.playback.status !== 'playing') {
        player.pauseVideo?.();
        return;
      }
      if (player.getPlayerState?.() !== 1) return;
      const target = expectedPosition(room.playback, settings.latency, clockOffset);
      const current = player.getCurrentTime?.();
      if (Number.isFinite(target) && Number.isFinite(current) && Math.abs(target - current) > 3) {
        player.seekTo(Math.max(0, target), true);
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [currentSong?.videoId, playerReady, room.playback, settings.latency, clockOffset]);

  useEffect(() => {
    if (currentSong?.type === 'youtube' && playerReady) {
      ytRef.current?.setVolume?.(Math.max(0, Math.min(100, Number(settings.volume) || 0)));
    }
  }, [currentSong?.videoId, playerReady, settings.volume]);

  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    navigator.mediaDevices.enumerateDevices().then((devices) => {
      setSettings((current) => ({ ...current, availableDevices: devices.filter((device) => device.kind === 'audiooutput').map((device) => ({ id: device.deviceId, label: device.label || 'Audio output' })) }));
    }).catch(() => {});
  }, []);

  const hostPlayPause = () => {
    if (!currentSong) return;
    setPlayError('');
    if (room.playback.status === 'playing') command('pause');
    else {
      if (currentSong.type === 'youtube') ytRef.current?.playVideo?.();
      else { audio.resume(); audioRef.current?.play().catch(() => setPlayError('Tap play once to allow audio on this device.')); }
      command('play');
    }
  };

  const enableLocalPlayback = () => {
    setPlayError('');
    if (currentSong?.type === 'youtube') {
      ytRef.current?.playVideo?.();
      return;
    }
    if (currentSong?.type === 'audio') {
      audio.resume();
      audioRef.current?.play().then(() => setPlayError('')).catch(() => setPlayError('Your browser blocked audio. Press Play again to enable it.'));
    }
  };

  const syncYouTube = useCallback((player) => { ytRef.current = player; setPlayerReady(Boolean(player)); }, []);
  const handleAutoplayBlocked = useCallback(() => {
    setPlayError('Your browser blocked autoplay. Press to start synced playback.');
  }, []);

  const seek = (position) => {
    if (!isHost) return;
    setSeekPreview(null);
    if (currentSong?.type === 'youtube' && ytRef.current) ytRef.current.seekTo(position, true);
    if (currentSong?.type === 'audio' && audioRef.current) audioRef.current.currentTime = position;
    command('seek', { position: Math.max(0, position) });
  };

  const currentPosition = () => {
    void positionTick;
    if (currentSong?.type === 'youtube') return ytRef.current?.getCurrentTime?.() || getPosition(room, clockOffset);
    if (currentSong?.type === 'audio') return audioRef.current?.currentTime || getPosition(room, clockOffset);
    return 0;
  };

  const addVideo = (song, queueOnly = false) => {
    setRoomError('');
    if (queueOnly) command('queue', { song });
    else command('select', { song });
  };

  const searchVideos = async (event) => {
    event?.preventDefault();
    if (!search.trim()) return;
    setSearching(true); setSearchMessage('');
    try {
      const result = await request(`${API}/youtube/search?q=${encodeURIComponent(search.trim())}`);
      setSearchResults(result.results);
      if (!result.results.length) setSearchMessage('No videos found. Try another search.');
    } catch (err) {
      setSearchResults([]);
      setSearchMessage(err.message);
    } finally { setSearching(false); }
  };

  const addVideoUrl = async () => {
    const videoId = extractVideoId(search.trim());
    if (!videoId) { setSearchMessage('That doesn’t look like a YouTube video link or video ID.'); return; }
    setSearching(true); setSearchMessage('');
    try {
      const video = await request(`${API}/youtube/video/${videoId}`);
      addVideo({ ...video, duration: '—' });
      setSearch(''); setSearchResults([]);
    } catch (err) {
      setSearchMessage(err.message);
    } finally { setSearching(false); }
  };

  const uploadAudio = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setSearching(true); setRoomError('');
    try {
      const data = new FormData();
      data.append('audio', file);
      const result = await request(`${API}/rooms/${room.code}/upload`, {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` }, body: data
      });
      setRoom(result.room);
      setNotice('Shared audio added to the room');
    } catch (err) { setRoomError(err.message); }
    finally { setSearching(false); event.target.value = ''; }
  };

  const updateSettings = (changes) => setSettings((current) => ({ ...current, ...changes }));
  const setEQ = (index, value) => {
    const eq = [...settings.eq]; eq[index] = Number(value);
    updateSettings({ eq, presetName: 'Custom' });
  };
  const applyPreset = (presetName) => updateSettings({ eq: [...presets[presetName]], presetName });
  const copyInvite = async () => {
    const invite = `${window.location.origin}/#room-${room.code}`;
    try {
      await navigator.clipboard.writeText(`Join my Sonora room: ${invite}  ·  Code: ${room.code}`);
      setCopied(true); setNotice('Invite copied to clipboard');
      setTimeout(() => setCopied(false), 1800);
    } catch { setNotice(`Room code: ${room.code}`); }
  };

  const onUploadClick = () => uploadRef.current?.click();
  const song = currentSong;
  const activeCount = room.members?.filter((member) => member.online).length || 0;

  return <motion.main className="room-app" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
    <header className="room-topbar"><div className="room-brand-wrap"><button className="icon-button back-button" onClick={onLeave} aria-label="Back"><ArrowLeft size={18} /></button><Brand compact /><span className="topbar-divider" /><span className="room-label">LISTENING ROOM</span></div>
      <div className="room-top-actions"><span className={`connection-badge ${socketStatus}`}><i />{socketStatus === 'connected' ? 'Connected' : socketStatus === 'connecting' ? 'Connecting' : 'Reconnecting'}</span><button className="button button-outline button-small invite-top" onClick={copyInvite}><Share2 size={14} /> Invite people</button><button className="icon-button mobile-menu" onClick={() => setSettingsOpen((v) => !v)} aria-label="Open audio settings"><Settings2 size={18} /></button></div>
    </header>
    <div className="room-layout">
      <aside className="room-sidebar">
        <span className="sidebar-label">YOUR ROOM</span>
        <button className={`sidebar-link ${panel === 'music' ? 'active' : ''}`} onClick={() => setPanel('music')}><Disc3 size={17} /> Listening room</button>
        <button className={`sidebar-link ${panel === 'queue' ? 'active' : ''}`} onClick={() => setPanel('queue')}><ListMusic size={17} /> Up next <span className="sidebar-count">{Math.max(0, room.queue.length - room.currentIndex - 1)}</span></button>
        <div className="sidebar-divider" />
        <div className="sidebar-section-head"><span className="sidebar-label">IN THIS ROOM</span><span className="member-count">{activeCount}</span></div>
        <div className="member-list">{room.members?.map((member, index) =>
          <div className="member-item" key={member.userId}><span className={`member-avatar avatar-color-${index % 5}`}>{member.name.slice(0, 1).toUpperCase()}<i className={member.online ? 'online' : ''} /></span><span className="member-name">{member.name}{member.userId === room.hostUserId && <small>HOST</small>}</span><span className={`member-presence ${member.online ? 'online' : ''}`} title={member.online ? 'Connected' : 'Away'} /></div>)}</div>
        <div className="sidebar-bottom"><button className="audio-profile" onClick={() => setSettingsOpen((value) => !value)}><span className="profile-icon"><Headphones size={16} /></span><span><b>Your audio</b><small>Personal settings</small></span><ChevronRight size={15} /></button></div>
      </aside>
      <section className="room-main">
        <div className="room-scroll">
          <div className="room-welcome"><div><div className="eyebrow"><span className="live-dot" /> ROOM {room.code}</div><h1>{isHost ? 'You set the mood.' : `You’re listening with ${room.hostName}.`}</h1><p>{isHost ? 'Pick a song. Your people will hear it too.' : 'Settle in. The host is in control of the music.'}</p></div>
            <button className="room-code-card" onClick={copyInvite}><span>ROOM CODE</span><strong>{room.code}</strong><small>{copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy invite</>}</small></button></div>
          {roomError && <div className="inline-error"><CircleHelp size={15} />{roomError}<button onClick={() => setRoomError('')} aria-label="Dismiss"><X size={14} /></button></div>}
          {panel === 'music' && <>
            <div className="now-card">
              <div className="now-card-head"><span className="eyebrow">{song ? room.playback.status === 'playing' ? 'PLAYING NOW' : 'READY WHEN YOU ARE' : 'YOUR ROOM IS READY'}</span><span className="sync-label"><span className="sync-bars"><i /><i /><i /></span>{activeCount} listening</span></div>
              {song ? <div className="now-content">
                <div className="now-art">{song.type === 'youtube' && song.thumbnail ? <img src={song.thumbnail} alt="" /> : <div className="art-placeholder"><Music2 size={28} /><Visualizer size="small" active={room.playback.status === 'playing'} /></div>}</div>
                <div className="now-details"><span className="song-source">{song.type === 'youtube' ? 'YOUTUBE' : 'SHARED AUDIO'}</span><h2>{song.title}</h2><p>{song.channel || 'Unknown artist'}{song.duration ? ` · ${song.duration}` : ''}</p>
                  {room.playback.status === 'playing' && <div className="waveform-line"><Visualizer size="small" /></div>}
                </div>
                <div className="now-controls">{isHost ? <><button className="play-button" onClick={hostPlayPause} aria-label={room.playback.status === 'playing' ? 'Pause' : 'Play'}>{room.playback.status === 'playing' ? <Pause size={21} fill="currentColor" /> : <Play size={21} fill="currentColor" />}</button><button className="icon-button skip-button" onClick={() => command('next')} aria-label="Next track"><SkipForward size={18} /></button></> : <span className="host-control-label"><LockKeyhole size={13} /> Host controlled</span>}</div>
              </div> : <div className="empty-now"><div className="empty-disc"><Music2 size={22} /></div><div><h2>A good song goes a long way.</h2><p>{isHost ? 'Search for something you all love, or drop in a video link.' : 'Your host will pick the first track soon.'}</p></div></div>}
              {song?.type === 'youtube' && <YouTubeEmbed videoId={song.videoId} playerRef={ytRef} onReady={syncYouTube} onBlocked={handleAutoplayBlocked} />}
              {song?.type === 'audio' && <audio ref={audioRef} className="audio-source" data-audio-processing={audio.isReady ? 'ready' : 'pending'} preload="auto" onWaiting={() => { audioBufferingRef.current = true; }} onStalled={() => { audioBufferingRef.current = true; }} onPlaying={() => { audioBufferingRef.current = false; }} onCanPlay={() => { audioBufferingRef.current = false; }} onLoadedMetadata={(event) => { if (Number.isFinite(event.currentTarget.duration)) setAudioDuration(event.currentTarget.duration); }} onEnded={() => { if (isHost) command('next'); }} />}
              {song && <div className="timeline"><span>{formatTime(currentPosition())}</span><input type="range" min="0" max={song.durationSeconds || (song.type === 'audio' ? audioDuration || 3600 : 3600)} value={seekPreview ?? Math.min(currentPosition(), song.durationSeconds || (song.type === 'audio' ? audioDuration || 3600 : 3600))} onChange={(e) => { if (isHost) setSeekPreview(Number(e.target.value)); }} onPointerUp={(e) => { if (isHost) seek(Number(e.currentTarget.value)); }} onKeyUp={(e) => { if (isHost) seek(Number(e.currentTarget.value)); }} disabled={!isHost} aria-label="Playback position" /><span>{song.duration || (song.type === 'audio' && audioDuration ? formatTime(audioDuration) : '--:--')}</span></div>}
              {playError && <button className="play-enable" onClick={enableLocalPlayback}><Play size={14} /> {playError}</button>}
              {song?.type === 'youtube' && <div className="youtube-note"><CircleHelp size={13} /> YouTube playback stays in its official player. Your EQ and filters apply only to shared audio uploads.</div>}
            </div>
            {isHost && <div className="music-tools">
              <div className="tool-heading"><div><span className="eyebrow">FIND THE RIGHT TRACK</span><h2>Bring the music in.</h2></div><button className="text-link" onClick={onUploadClick}><Upload size={15} /> Upload audio</button></div>
              <form className="search-bar" onSubmit={searchVideos}><Search size={17} /><input value={search} onChange={(e) => { setSearch(e.target.value); setSearchMessage(''); }} placeholder="Search YouTube or paste a video link…" /><button type="button" className="paste-button" onClick={addVideoUrl}><Link2 size={14} /><span>Add link</span></button><button className="search-submit" disabled={searching || !search.trim()} aria-label="Search"><Search size={16} /></button></form>
              <input ref={uploadRef} className="visually-hidden" type="file" accept="audio/*" onChange={uploadAudio} />
              <div className="upload-hint"><Upload size={13} /> Shared audio uploads are processed through Web Audio on every listener’s device. MP3, WAV, OGG, M4A · up to 40 MB.</div>
              {searching && <div className="search-loading"><LoaderCircle size={15} className="spin" /> Looking for your song…</div>}
              {searchMessage && <div className="search-message">{searchMessage}</div>}
              {searchResults.length > 0 && <div className="search-results">{searchResults.map((result) => <div className="search-result" key={result.videoId}><img src={result.thumbnail} alt="" /><div className="result-info"><b>{result.title}</b><span>{result.channel} · {result.duration}</span></div><button className="result-play" title="Play now" onClick={() => { addVideo(result); setSearchResults([]); setSearch(''); }}><Play size={15} fill="currentColor" /></button><button className="icon-button result-queue" title="Add to queue" onClick={() => addVideo(result, true)}><Plus size={17} /></button></div>)}</div>}
            </div>}
            {!isHost && <div className="listener-note"><LockKeyhole size={15} /><span><b>Listening along with {room.hostName}</b><small>The host manages the shared playlist and playback. Your audio settings are all yours.</small></span></div>}
          </>}
          {panel === 'queue' && <QueuePanel room={room} currentSong={song} isHost={isHost} onNext={() => command('next')} />}
          <div className="room-bottom-note"><span><Zap size={13} /> Sync checks every 2 seconds</span><span>Audio processing is per device</span></div>
        </div>
      </section>
      <aside className={`settings-sidebar ${settingsOpen ? 'settings-open' : ''}`}>
        <div className="settings-title"><div><span className="eyebrow">JUST FOR YOU</span><h2>Your sound</h2></div><button className="icon-button settings-close" onClick={() => setSettingsOpen(false)} aria-label="Close settings"><X size={17} /></button></div>
        <div className="settings-tabs">{tabs.map(({ id, label, icon: Icon }) => <button key={id} className={`settings-tab ${activeTab === id ? 'selected' : ''}`} onClick={() => setActiveTab(id)}><Icon size={15} /><span>{label}</span>{activeTab === id && <ChevronRight size={13} />}</button>)}</div>
        <div className="settings-body">
          <SettingsPanel tab={activeTab} settings={settings} update={updateSettings} setEQ={setEQ} applyPreset={applyPreset} audioRef={audioRef} audio={audio} youtubeActive={currentSong?.type === 'youtube'} audioActive={currentSong?.type === 'audio'} />
        </div>
        <div className="settings-footer"><span><span className="online-dot" /> Saved to your device profile</span><button onClick={() => setNotice('Settings save automatically')}><Check size={13} /> Auto-saved</button></div>
      </aside>
    </div>
  </motion.main>;
}

function YouTubeEmbed({ videoId, playerRef, onReady, onBlocked }) {
  const elementRef = useRef(null);
  const [playerError, setPlayerError] = useState('');
  useEffect(() => {
    let cancelled = false;
    setPlayerError('');
    loadYouTube().then((YT) => {
      if (cancelled || !elementRef.current) return;
      const player = new YT.Player(elementRef.current, {
        width: '100%', height: '100%', videoId,
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1, origin: window.location.origin },
        events: {
          onReady: (event) => { playerRef.current = event.target; onReady(event.target); },
          onAutoplayBlocked: () => onBlocked(),
          onError: (event) => {
            const message = event.data === 101 || event.data === 150
              ? 'This video’s owner doesn’t allow it to play inside Sonora.'
              : event.data === 153
                ? 'YouTube could not verify this embed. Try a current mobile browser or another video.'
                : event.data === 100
                  ? 'This video is unavailable, private, or has been removed.'
                  : 'YouTube couldn’t play this video here.';
            setPlayerError(message);
            onReady(null);
          }
        }
      });
      playerRef.current = player;
    }).catch(() => {
      const message = 'The YouTube player could not load. Check your internet connection and try again.';
      setPlayerError(message);
      onReady(null);
    });
    return () => {
      cancelled = true;
      if (playerRef.current?.destroy) playerRef.current.destroy();
      playerRef.current = null;
      onReady(null);
    };
  }, [videoId, playerRef, onReady, onBlocked]);
  return <div className="youtube-frame"><div ref={elementRef} />{playerError && <div className="youtube-frame-error"><CircleHelp size={17} /><span>{playerError}</span><a href={`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`} target="_blank" rel="noreferrer">Watch on YouTube <ChevronRight size={14} /></a></div>}</div>;
}

let youtubePromise;
function loadYouTube() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!youtubePromise) youtubePromise = new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { previous?.(); resolve(window.YT); };
    if (!document.querySelector('script[data-youtube-api]')) {
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.dataset.youtubeApi = 'true';
      script.onerror = () => reject(new Error('Could not load the YouTube player.'));
      document.head.appendChild(script);
    }
    setTimeout(() => reject(new Error('The YouTube player took too long to load.')), 12000);
  });
  return youtubePromise;
}

function SettingsPanel({ tab, settings, update, setEQ, applyPreset, audioRef, audio, youtubeActive, audioActive }) {
  const [tonePlaying, setTonePlaying] = useState(false);
  const [presetInput, setPresetInput] = useState('');
  const [deviceList, setDeviceList] = useState([]);

  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return undefined;
    let live = true;
    navigator.mediaDevices.enumerateDevices().then((devices) => {
      if (live) setDeviceList(devices.filter((item) => item.kind === 'audiooutput'));
    }).catch(() => {});
    return () => { live = false; };
  }, []);

  const slider = (title, key, min, max, unit = '', step = 1) =>
    <SliderControl key={key} title={title} value={settings[key]} min={min} max={max} unit={unit} step={step} onChange={(value) => update({ [key]: value })} />;
  const reset = () => update({ ...DEFAULT_SETTINGS, eq: Array(16).fill(0), customPresets: settings.customPresets || {} });

  if (tab === 'eq') return <div className="settings-panel">
    <PanelHeading kicker="SHAPE YOUR SOUND" title="Equalizer" description="16 bands, tuned to your ears." />
    <div className="preset-row"><span>PRESET</span><select value={presets[settings.presetName] ? settings.presetName : 'Custom'} onChange={(e) => { if (presets[e.target.value]) applyPreset(e.target.value); }}><option>Custom</option>{Object.keys(presets).map((name) => <option key={name}>{name}</option>)}</select></div>
    <div className="eq-graph"><div className="eq-zero" />{FREQUENCIES.map((frequency, index) => <div className="eq-column" key={frequency}><div className="eq-track"><span className="eq-fill" style={{ height: `${Math.abs(settings.eq[index]) / 12 * 48}%`, bottom: settings.eq[index] < 0 ? '50%' : 'auto', top: settings.eq[index] >= 0 ? '50%' : 'auto' }} /><input type="range" min="-12" max="12" value={settings.eq[index]} onChange={(e) => setEQ(index, e.target.value)} aria-label={`${formatFrequency(frequency)} dB`} /></div><span className="eq-label">{formatFrequency(frequency)}</span></div>)}</div>
    <div className="eq-legend"><span>−12 dB</span><span>{settings.presetName === 'Custom' ? 'CUSTOM CURVE' : `${settings.presetName.toUpperCase()} PRESET`}</span><span>+12 dB</span></div>
    <div className="preset-save"><input value={presetInput} onChange={(e) => setPresetInput(e.target.value)} placeholder="Name this preset" maxLength={24} /><button disabled={!presetInput.trim()} onClick={() => { update({ customPresets: { ...settings.customPresets, [presetInput.trim()]: [...settings.eq] } }); setPresetInput(''); }}>Save</button></div>
    {Object.keys(settings.customPresets || {}).length > 0 && <div className="custom-presets">{Object.keys(settings.customPresets).map((preset) => <button key={preset} onClick={() => update({ eq: [...settings.customPresets[preset]], presetName: preset })}>{preset}</button>)}</div>}
    <button className="reset-button" onClick={reset}><Minus size={13} /> Reset all audio settings</button>
    <AudioCapability youtubeActive={youtubeActive} audioActive={audioActive} audioReady={audio.isReady} audioSupported={audio.isSupported} />
  </div>;
  if (tab === 'bass') return <div className="settings-panel"><PanelHeading kicker="A LITTLE MORE LOW END" title="Bass boost" description="A warm lift, without the muddy bits." />
    <ToggleRow title="Bass enhancement" description="Apply a gentle low-shelf boost." value={settings.bassEnabled} onChange={(value) => update({ bassEnabled: value })} />
    <div className={`control-stack ${!settings.bassEnabled ? 'is-dim' : ''}`}>{slider('Intensity', 'bassIntensity', 0, 100, '%')}{slider('Bass gain', 'bassGain', 0, 12, ' dB')}</div>
    <div className="info-card"><Sparkles size={16} /><span>A dynamics compressor helps keep stronger bass from clipping the output.</span></div><AudioCapability youtubeActive={youtubeActive} audioActive={audioActive} audioReady={audio.isReady} audioSupported={audio.isSupported} /></div>;
  if (tab === 'filters') return <div className="settings-panel"><PanelHeading kicker="CLEAR OUT THE EXTREMES" title="Frequency cut" description="Shape the range that makes it through." />
    {slider('High-pass · remove below', 'highPass', 20, 1000, ' Hz', 1)}
    {slider('Low-pass · remove above', 'lowPass', 1000, 20000, ' Hz', 50)}
    <div className="control-select"><span>FILTER SLOPE</span><select value={settings.filterSlope} onChange={(e) => update({ filterSlope: Number(e.target.value) })}><option value="12">12 dB / octave</option><option value="24">24 dB / octave</option></select></div>
    <FrequencyViz low={settings.highPass} high={settings.lowPass} /><AudioCapability youtubeActive={youtubeActive} audioActive={audioActive} audioReady={audio.isReady} audioSupported={audio.isSupported} /></div>;
  if (tab === 'sub') return <div className="settings-panel"><PanelHeading kicker="FOR THE LOW-END LOVERS" title="Subwoofer" description="Add a crossover-shaped bass layer to your output." />
    <ToggleRow title="Subwoofer mode" description="Mix in a filtered low-frequency layer." value={settings.subEnabled} onChange={(value) => update({ subEnabled: value })} />
    <div className="info-card"><Speaker size={16} /><span>This creates a bass layer in your normal stereo output. Browsers cannot route it to a separate physical subwoofer channel.</span></div>
    <div className={`control-stack ${!settings.subEnabled ? 'is-dim' : ''}`}>
      {slider('Crossover frequency', 'crossover', 20, 250, ' Hz')}
      {slider('Subwoofer level', 'subVolume', 0, 100, '%')}
      {slider('Subwoofer gain', 'subGain', 0, 12, ' dB')}
      <div className="control-select"><span>CROSSOVER SLOPE</span><select value={settings.subSlope} onChange={(e) => update({ subSlope: Number(e.target.value) })}><option value="12">12 dB / octave</option><option value="24">24 dB / octave</option></select></div>
      <button className="test-tone" onClick={() => playTestTone(setTonePlaying)}><Activity size={15} />{tonePlaying ? 'Playing test tone…' : 'Play subwoofer test tone'}</button>
    </div><FrequencyViz low={20} high={settings.crossover} subEnabled={settings.subEnabled} /><AudioCapability youtubeActive={youtubeActive} audioActive={audioActive} audioReady={audio.isReady} audioSupported={audio.isSupported} /></div>;
  if (tab === 'latency') return <div className="settings-panel"><PanelHeading kicker="TIME IT TO YOUR EARS" title="Latency" description="Compensate for device output delay." />
    <div className="latency-current"><div><span>YOUR ADJUSTMENT</span><strong>{settings.latency > 0 ? '+' : ''}{settings.latency}<small>ms</small></strong></div><span className="latency-device"><Headphones size={15} /> This device only</span></div>
    <input className="wide-range" type="range" min="-500" max="1000" step="5" value={settings.latency} onChange={(e) => update({ latency: Number(e.target.value) })} aria-label="Audio latency compensation" />
    <div className="range-captions"><span>−500 ms · delay</span><span>0 ms</span><span>+1000 ms · advance</span></div>
    <div className="manual-latency"><label htmlFor="latency-number">Fine adjustment</label><div><input id="latency-number" type="number" min="-500" max="1000" step="1" value={settings.latency} onChange={(e) => update({ latency: Math.max(-500, Math.min(1000, Number(e.target.value))) })} /><span>milliseconds</span></div></div>
    <div className="latency-actions"><button className="test-tone" onClick={() => playTestTone(setTonePlaying)}><Activity size={15} />{tonePlaying ? 'Playing calibration tone…' : 'Play calibration tone'}</button><button className="reset-inline" onClick={() => update({ latency: 0 })}>Reset</button></div>
    <div className="info-card"><CircleHelp size={16} /><span>Changes immediately shift this device’s playback position: positive values advance the track to compensate for delayed headphones; negative values move it back. YouTube seeking is approximate; browser controls cannot measure Bluetooth delay automatically. Adjust while listening, then save your preferred value.</span></div><AudioCapability youtubeActive={youtubeActive} audioActive={audioActive} audioReady={audio.isReady} audioSupported={audio.isSupported} /></div>;
  return <div className="settings-panel"><PanelHeading kicker="THE LISTENING SETUP" title="Device" description="Set your local level and output." />
    {slider('Local volume', 'volume', 0, 100, '%')}
    <div className="control-select device-select"><span>AUDIO OUTPUT</span><select value={settings.outputDevice || 'default'} disabled={youtubeActive} onChange={async (e) => {
      const sinkId = e.target.value;
      try {
        await audio.setOutputDevice(sinkId);
        update({ outputDevice: sinkId });
      } catch (error) { window.alert(error.message); }
    }}><option value="default">System default</option>{deviceList.map((device, index) => <option key={device.deviceId || index} value={device.deviceId}>{device.label || `Audio output ${index + 1}`}</option>)}</select></div>
    <div className="info-card"><Headphones size={16} /><span>{youtubeActive ? 'YouTube output is controlled by its player and your phone’s system audio settings. Device selection is available for shared audio uploads.' : 'Output-device selection requires browser permission and support. Your local volume and saved audio settings never affect other listeners.'}</span></div>
    <AudioCapability youtubeActive={youtubeActive} audioActive={audioActive} audioReady={audio.isReady} audioSupported={audio.isSupported} />
    <div className="device-saved"><span className="online-dot" /><span>Profile follows this browser</span></div></div>;
}

function PanelHeading({ kicker, title, description }) {
  return <div className="panel-heading"><span className="eyebrow">{kicker}</span><h3>{title}</h3><p>{description}</p></div>;
}

function SliderControl({ title, value, min, max, unit, step = 1, onChange }) {
  const safeValue = Number.isFinite(Number(value)) ? Number(value) : min;
  return <div className="slider-control"><div className="slider-heading"><label>{title}</label><span>{safeValue}{unit}</span></div><input type="range" min={min} max={max} step={step} value={safeValue} onChange={(e) => onChange(Number(e.target.value))} aria-label={title} /></div>;
}

function ToggleRow({ title, description, value, onChange }) {
  return <div className="toggle-row"><span><b>{title}</b><small>{description}</small></span><button role="switch" aria-checked={value} className={`switch ${value ? 'on' : ''}`} onClick={() => onChange(!value)}><i /></button></div>;
}

function FrequencyViz({ low, high, subEnabled = false }) {
  const lowPercent = Math.min(48, Math.max(0, (low / 20000) * 100));
  const highPercent = Math.min(100, Math.max(10, (high / 20000) * 100));
  return <div className="frequency-viz"><div className="frequency-viz-bars">{Array.from({ length: 32 }, (_, i) => {
    const position = i / 31 * 100;
    const passed = position >= lowPercent && position <= highPercent;
    return <i key={i} className={`${passed ? 'passed' : ''} ${subEnabled && position < 24 ? 'sub-range' : ''}`} style={{ '--height': `${20 + Math.abs(Math.sin(i * 1.1)) * 72}%` }} />;
  })}</div><div className="frequency-axis"><span>20 Hz</span><span>{Math.round(low)} Hz</span><span>{Math.round(high)} Hz</span><span>20 kHz</span></div><div className="frequency-legend"><i /> {subEnabled ? 'SUBWOOFER BAND' : 'PASS BAND'}</div></div>;
}

function AudioCapability({ youtubeActive = false, audioActive = false, audioReady = false, audioSupported = true }) {
  const title = youtubeActive
    ? 'EQ, bass and filters do not affect YouTube'
    : audioActive && !audioSupported
      ? 'This browser does not support Web Audio'
      : audioActive && !audioReady
        ? 'Setting up your audio processing…'
        : 'Works with shared audio uploads';
  const message = youtubeActive
    ? 'YouTube blocks custom EQ and subwoofer processing. Have the host upload a shared audio track to use these effects. Your local volume and room sync still work.'
    : audioActive && !audioSupported
      ? 'Use a current Safari, Chrome or Firefox browser to process shared audio.'
      : audioActive && !audioReady
        ? 'Your audio processing graph is being prepared for this track.'
        : 'Ask the host to upload a shared audio track to use these per-device equalizer, filter, bass and subwoofer effects.';
  return <div className={`audio-capability ${youtubeActive || (audioActive && !audioSupported) ? 'audio-capability-warning' : ''}`}><span className="capability-icon"><CircleHelp size={14} /></span><span><b>{title}</b><small>{message}</small></span></div>;
}

function QueuePanel({ room, currentSong, isHost, onNext }) {
  const upcoming = room.queue.slice(room.currentIndex + 1);
  return <div className="queue-panel"><div className="queue-heading"><span className="eyebrow">THE ROOM PLAYLIST</span><h2>Up next.</h2><p>{upcoming.length ? `${upcoming.length} ${upcoming.length === 1 ? 'track' : 'tracks'} queued` : 'The next song is yours to pick.'}</p></div>
    {currentSong && <div className="queue-current"><span className="eyebrow">NOW PLAYING</span><div><span className="queue-index playing">♪</span><span><b>{currentSong.title}</b><small>{currentSong.channel}</small></span><span className="queue-playing">PLAYING</span></div></div>}
    {upcoming.length ? <div className="queue-list">{upcoming.map((song, index) => <div className="queue-item" key={`${song.title}-${index}`}><span className="queue-index">{String(index + 1).padStart(2, '0')}</span><span className="queue-song"><b>{song.title}</b><small>{song.channel || song.type}</small></span><span className="queue-song-type">{song.type === 'youtube' ? 'YT' : 'AUDIO'}</span></div>)}</div> : <div className="queue-empty"><ListMusic size={23} /><span>Nothing in the queue yet.</span></div>}
    {!isHost && <div className="listener-note"><LockKeyhole size={15} /><span><b>The host curates the playlist</b><small>Ask them to add a song you’d like to hear.</small></span></div>}
    {isHost && upcoming.length > 0 && <button className="text-link queue-skip" onClick={onNext}><SkipForward size={15} /> Skip to next</button>}
  </div>;
}

function getPosition(room, clockOffset = 0) {
  if (!room?.playback) return 0;
  if (room.playback.status !== 'playing') return Math.max(0, room.playback.position);
  return Math.max(0, room.playback.position + (Date.now() + clockOffset - room.playback.updatedAt) / 1000);
}

function getMediaPosition(room, youtubePlayer, audioElement, clockOffset = 0) {
  const mediaPosition = youtubePlayer?.getCurrentTime?.();
  if (Number.isFinite(mediaPosition)) return Math.max(0, mediaPosition);
  if (audioElement && Number.isFinite(audioElement.currentTime)) return Math.max(0, audioElement.currentTime);
  return getPosition(room, clockOffset);
}

function expectedPosition(playback, latency, clockOffset = 0) {
  const elapsed = playback.status === 'playing'
    ? (Date.now() + clockOffset - playback.updatedAt) / 1000
    : 0;
  return compensatePlaybackPosition(playback.position + elapsed, latency);
}

function extractVideoId(value) {
  if (/^[\w-]{11}$/.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.hostname === 'youtu.be' || url.hostname.endsWith('.youtu.be')) return url.pathname.split('/').filter(Boolean)[0]?.match(/^[\w-]{11}$/)?.[0] || null;
    if (url.hostname.includes('youtube.com')) {
      const fromQuery = url.searchParams.get('v');
      if (fromQuery && /^[\w-]{11}$/.test(fromQuery)) return fromQuery;
      const match = url.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]{11})/);
      return match?.[1] || null;
    }
  } catch { return null; }
  return null;
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '0:00';
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

function formatFrequency(value) {
  if (value >= 1000) return `${value / 1000}k`;
  return `${value}`;
}

function playTestTone(setPlaying) {
  if (!window.AudioContext) { window.alert('Web Audio is not available in this browser.'); return; }
  const context = new window.AudioContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.value = 80;
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.04);
  gain.gain.setTargetAtTime(0.0001, context.currentTime + 0.7, 0.08);
  oscillator.connect(gain); gain.connect(context.destination);
  oscillator.start(); setPlaying(true);
  oscillator.stop(context.currentTime + 1.2);
  oscillator.onended = () => { setPlaying(false); context.close(); };
}

export default App;

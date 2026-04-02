import React, { useEffect, useEffectEvent, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { SyncController } from './SyncController';
import {
  AlertTriangle,
  Crown,
  RefreshCw,
  Sparkles,
  Upload,
  Users,
  WifiOff,
} from 'lucide-react';

interface SyncState {
  playing: boolean;
  position: number;
  updatedAt: number;
}

interface SyncResponse {
  success?: boolean;
  isLeader?: boolean;
  error?: string;
  state?: SyncState;
  participants?: string[];
}

const V_URL = import.meta.env.VITE_SOCKET_URL;
const SOCKET_URL = V_URL
  ? V_URL
  : import.meta.env.PROD
    ? window.location.origin
    : `http://${window.location.hostname}:4000`;

const syncController = new SyncController();

const THEME_OPTIONS = [
  {
    id: 'ivory',
    label: 'Ivory',
    swatch: 'linear-gradient(135deg, #f6f2e8 0%, #ffffff 52%, #d9d1c3 100%)',
  },
  {
    id: 'midnight',
    label: 'Midnight',
    swatch: 'linear-gradient(135deg, #000000 0%, #101010 55%, #2c2c2c 100%)',
  },
  {
    id: 'ocean',
    label: 'Ocean',
    swatch: 'linear-gradient(135deg, #051c33 0%, #0f6aa8 48%, #79d5ff 100%)',
  },
  {
    id: 'romance',
    label: 'Romance',
    swatch: 'linear-gradient(135deg, #2a1021 0%, #9f265f 45%, #ffc4db 100%)',
  },
  {
    id: 'forest',
    label: 'Forest',
    swatch: 'linear-gradient(135deg, #08150e 0%, #1f5d3e 45%, #b9edb1 100%)',
  },
] as const;

type ThemeName = typeof THEME_OPTIONS[number]['id'];

const isThemeName = (value: string | null): value is ThemeName => {
  return THEME_OPTIONS.some((option) => option.id === value);
};

const getInitialTheme = (): ThemeName => {
  if (typeof window === 'undefined') return 'ivory';

  const storedTheme = window.localStorage.getItem('letswatch-theme');
  if (isThemeName(storedTheme)) {
    return storedTheme;
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'midnight' : 'ivory';
};

function App() {
  const [roomId, setRoomId] = useState('');
  const [isJoined, setIsJoined] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isLeader, setIsLeader] = useState(false);
  const [participantsCount, setParticipantsCount] = useState(0);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [drift, setDrift] = useState(0);
  const [theme, setTheme] = useState<ThemeName>(getInitialTheme);

  const videoRef = useRef<HTMLVideoElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const ignoreEvents = useRef({ play: false, pause: false, seek: false });
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('letswatch-theme', theme);
  }, [theme]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
    }

    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    setVideoSrc(url);
  };

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
    };
  }, []);

  const applyState = (state: SyncState) => {
    if (!videoRef.current) return;

    const targetTime = syncController.getTargetTime(state);

    if (Math.abs(videoRef.current.currentTime - targetTime) > 0.5) {
      ignoreEvents.current.seek = true;
      videoRef.current.currentTime = targetTime;
    }

    if (state.playing && videoRef.current.paused) {
      ignoreEvents.current.play = true;
      videoRef.current.play().catch((error) => console.error('Playback stopped', error));
    } else if (!state.playing && !videoRef.current.paused) {
      ignoreEvents.current.pause = true;
      videoRef.current.pause();
    }
  };

  const handleManualSync = () => {
    const socket = socketRef.current;
    if (!socket || !videoRef.current) return;

    socket.emit('force_sync_request', roomId, (response: SyncResponse) => {
      if (response?.state) {
        applyState(response.state);
      }
    });
  };

  const syncFromRoomResponse = (response: SyncResponse) => {
    if (!response.success || response.isLeader === undefined) return false;

    setIsLeader(response.isLeader);
    setParticipantsCount(response.participants?.length ?? 0);

    if (response.state) {
      applyState(response.state);
    }

    return true;
  };

  const handleReconnect = useEffectEvent(() => {
    const socket = socketRef.current;
    if (!socket || !roomId || !isJoined) return;

    socket.emit('join_room', roomId, (response: SyncResponse) => {
      syncFromRoomResponse(response);
    });
  });

  const handleStateUpdated = useEffectEvent((state: SyncState) => {
    applyState(state);
  });

  const handleLeaderChanged = useEffectEvent((newLeaderId: string) => {
    setIsLeader(socketRef.current?.id === newLeaderId);
  });

  const handleParticipantsUpdated = useEffectEvent((participantList: string[]) => {
    setParticipantsCount(participantList.length);
  });

  useEffect(() => {
    const socket = io(SOCKET_URL);
    socketRef.current = socket;

    const onConnect = () => {
      setIsConnected(true);
      handleReconnect();
    };

    const onDisconnect = () => {
      setIsConnected(false);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('state_updated', handleStateUpdated);
    socket.on('leader_changed', handleLeaderChanged);
    socket.on('participants_updated', handleParticipantsUpdated);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('state_updated', handleStateUpdated);
      socket.off('leader_changed', handleLeaderChanged);
      socket.off('participants_updated', handleParticipantsUpdated);
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  const handleJoin = () => {
    const socket = socketRef.current;
    if (!roomId || !socket) return;

    socket.emit('join_room', roomId, (response: SyncResponse) => {
      if (syncFromRoomResponse(response)) {
        setIsJoined(true);
      } else {
        alert(response.error || 'Failed to join room');
      }
    });
  };

  const handlePlay = () => {
    const socket = socketRef.current;
    if (ignoreEvents.current.play) {
      ignoreEvents.current.play = false;
      return;
    }

    if (socket && isJoined && isLeader && videoRef.current) {
      socket.emit('sync_state', roomId, {
        position: videoRef.current.currentTime,
        playing: true,
      });
    }
  };

  const handlePause = () => {
    const socket = socketRef.current;
    if (ignoreEvents.current.pause) {
      ignoreEvents.current.pause = false;
      return;
    }

    if (socket && isJoined && isLeader && videoRef.current) {
      socket.emit('sync_state', roomId, {
        position: videoRef.current.currentTime,
        playing: false,
      });
    }
  };

  const handleSeeked = () => {
    const socket = socketRef.current;
    if (ignoreEvents.current.seek) {
      ignoreEvents.current.seek = false;
      return;
    }

    if (socket && isJoined && isLeader && videoRef.current) {
      socket.emit('sync_state', roomId, {
        position: videoRef.current.currentTime,
        playing: !videoRef.current.paused,
      });
    }
  };

  useEffect(() => {
    if (!isJoined) return;

    const interval = setInterval(() => {
      const socket = socketRef.current;
      if (!socket) return;

      socket.emit('force_sync_request', roomId, (response: SyncResponse) => {
        if (!videoRef.current || !response?.state || !response.state.playing) return;

        const currentDrift = syncController.calculateDrift(videoRef.current.currentTime, response.state);
        setDrift(currentDrift);

        if (currentDrift > 2) {
          applyState(response.state);
        }
      });
    }, 3000);

    return () => clearInterval(interval);
  }, [isJoined, roomId]);

  const getDriftColor = () => {
    if (drift < 0.5) return 'text-emerald-400';
    if (drift < 2.0) return 'text-amber-300';
    return 'text-rose-400';
  };

  return (
    <div className="app-shell">
      <div className="ambient-orb ambient-orb-one" aria-hidden="true" />
      <div className="ambient-orb ambient-orb-two" aria-hidden="true" />
      <div className="ambient-grid" aria-hidden="true" />

      <header className="mx-auto mb-8 w-full max-w-[1400px] px-6 pt-8 sm:px-8 lg:px-10">
        <div className="chrome-panel flex flex-col gap-6 rounded-[32px] px-6 py-6 sm:px-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="brand-mark">
              <img src="/app-icon.svg" alt="Lets Watch Icon" className="h-12 w-12 object-contain" />
            </div>
            <div className="space-y-2">
              <div className="eyebrow">
                <Sparkles size={14} />
                <span>Local-first sync lounge</span>
              </div>
              <div>
                <h1 className="hero-title">Lets Watch</h1>
                <p className="hero-copy">
                  Private watch parties with cinematic themes, low-friction room control, and playback that stays in step.
                </p>
              </div>
            </div>
          </div>

          <div className="theme-rail">
            <p className="theme-rail-label">Choose the room mood</p>
            <div className="flex flex-wrap gap-2">
              {THEME_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={theme === option.id}
                  className={`theme-pill ${theme === option.id ? 'theme-pill-active' : ''}`}
                  onClick={() => setTheme(option.id)}
                >
                  <span className="theme-swatch" style={{ backgroundImage: option.swatch }} aria-hidden="true" />
                  <span>{option.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col px-6 pb-12 sm:px-8 lg:px-10">
        {!isJoined ? (
          <section className="grid flex-1 items-start gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="chrome-panel panel-feature rounded-[32px] p-8 sm:p-10">
              <div className="space-y-5">
                <div className="eyebrow">
                  <Sparkles size={14} />
                  <span>Sleeker shared sessions</span>
                </div>
                <h2 className="text-4xl font-semibold tracking-tight text-[var(--text-main)] sm:text-5xl">
                  Pick a theme, share a room, and keep everyone in sync.
                </h2>
                <p className="max-w-2xl text-base leading-7 text-[var(--text-muted)] sm:text-lg">
                  Lets Watch keeps the media on each viewer&apos;s machine while the room state flows through a lightweight
                  Socket.IO control plane. Fast to self-host, easy to join, and much nicer to look at now.
                </p>
              </div>

              <div className="mt-8 grid gap-4 sm:grid-cols-3">
                <div className="info-tile">
                  <span className="info-tile-title">Local files</span>
                  <span className="info-tile-copy">No uploads, no transcoding, no quality loss.</span>
                </div>
                <div className="info-tile">
                  <span className="info-tile-title">Live rooms</span>
                  <span className="info-tile-copy">Leader-based sync for play, pause, and seek.</span>
                </div>
                <div className="info-tile">
                  <span className="info-tile-title">Theme-ready</span>
                  <span className="info-tile-copy">Midnight, Ocean, Romance, Forest, and more.</span>
                </div>
              </div>
            </div>

            <div className="chrome-panel panel-form rounded-[32px] p-8 sm:p-10">
              <div className="space-y-2">
                <p className="eyebrow">
                  <Users size={14} />
                  <span>Join a session</span>
                </p>
                <h2 className="text-3xl font-semibold tracking-tight text-[var(--text-main)]">Enter your room code</h2>
                <p className="text-sm leading-6 text-[var(--text-muted)]">
                  Start a new room automatically or reconnect to an existing one with the same code.
                </p>
              </div>

              <div className="mt-8 space-y-4">
                <label className="block text-xs font-semibold uppercase tracking-[0.28em] text-[var(--text-muted)]">
                  Room code
                </label>
                <input
                  type="text"
                  placeholder="movie-night"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value)}
                  className="input-shell"
                />
                <button type="button" onClick={handleJoin} className="primary-button w-full" disabled={!roomId}>
                  Enter Room
                </button>
              </div>
            </div>
          </section>
        ) : (
          <section className="flex flex-1 flex-col gap-8">
            {!videoSrc ? (
              <div className="chrome-panel panel-upload flex min-h-[62vh] flex-col items-center justify-center rounded-[36px] border border-dashed border-[var(--border-color)] px-8 py-12 text-center">
                <div className="upload-icon-shell">
                  <Upload size={28} />
                </div>
                <h2 className="mt-6 text-3xl font-semibold tracking-tight text-[var(--text-main)]">Choose your local video</h2>
                <p className="mt-4 max-w-xl text-base leading-7 text-[var(--text-muted)]">
                  Everyone plays their own copy for full quality. Load an `.mp4`, `.mkv`, or `.webm` file and the room will
                  handle the playback timing.
                </p>

                <div className="relative mt-10 overflow-hidden">
                  <button type="button" className="primary-button px-8 py-4 text-base">
                    Browse Files
                  </button>
                  <input
                    type="file"
                    accept="video/mp4,video/webm,video/x-matroska"
                    onChange={handleFileChange}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  />
                </div>
              </div>
            ) : (
              <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_360px]">
                <div className="chrome-panel overflow-hidden rounded-[36px] p-3">
                  <div className="video-frame">
                    <video
                      ref={videoRef}
                      src={videoSrc}
                      controls
                      className="w-full aspect-video rounded-[28px] outline-none"
                      onPlay={handlePlay}
                      onPause={handlePause}
                      onSeeked={handleSeeked}
                    />
                  </div>

                  <div className="mt-4 flex flex-col gap-4 rounded-[26px] bg-[var(--panel-strong)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                    <button type="button" onClick={handleManualSync} className="secondary-button">
                      <RefreshCw size={18} />
                      <span>Force Sync</span>
                    </button>

                    <div className="metric-pill">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.26em] text-[var(--text-muted)]">
                        Drift
                      </span>
                      {drift > 0.5 && <AlertTriangle size={18} className={getDriftColor()} />}
                      <span className={`font-mono text-lg font-bold ${getDriftColor()}`}>{drift.toFixed(2)}s</span>
                    </div>
                  </div>
                </div>

                <aside className="flex flex-col gap-6">
                  {!isConnected && (
                    <div className="status-card status-card-offline">
                      <WifiOff size={24} />
                      <div>
                        <h3 className="text-base font-semibold">Disconnected</h3>
                        <p className="text-sm text-current/80">Reconnecting to the room server.</p>
                      </div>
                    </div>
                  )}

                  <div className="chrome-panel rounded-[32px] p-7">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="eyebrow">
                          <Users size={14} />
                          <span>Session info</span>
                        </p>
                        <h3 className="mt-3 text-2xl font-semibold tracking-tight text-[var(--text-main)]">Room details</h3>
                      </div>

                      <div className="metric-pill px-3 py-2">
                        <Users size={16} />
                        <span className="font-semibold text-[var(--text-main)]">{participantsCount}</span>
                      </div>
                    </div>

                    <div className="mt-7 space-y-5">
                      <div>
                        <label className="block text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--text-muted)]">
                          Room code
                        </label>
                        <div className="mt-2 rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-quiet)] px-4 py-4 text-center font-mono text-lg font-semibold tracking-[0.08em] text-[var(--text-main)]">
                          {roomId}
                        </div>
                      </div>

                      <div
                        className={`role-banner ${
                          isLeader ? 'role-banner-leader' : 'role-banner-viewer'
                        }`}
                      >
                        {isLeader ? <Crown size={18} /> : <Users size={18} />}
                        <span>{isLeader ? 'You are leading playback' : 'You are following the leader'}</span>
                      </div>
                    </div>

                    <div className="mt-8 space-y-4 text-sm text-[var(--text-muted)]">
                      <div className="feature-row">
                        <span className="feature-dot" />
                        <span>Low-latency room sync across connected viewers</span>
                      </div>
                      <div className="feature-row">
                        <span className="feature-dot" />
                        <span>Video stays local for full-resolution playback</span>
                      </div>
                      <div className="feature-row">
                        <span className="feature-dot" />
                        <span>Theme-aware layout with ambient gradients and glass panels</span>
                      </div>
                    </div>
                  </div>
                </aside>
              </div>
            )}
          </section>
        )}
      </main>

      <footer className="mx-auto mb-6 w-full max-w-[1400px] px-6 text-center text-sm text-[var(--text-muted)] sm:px-8 lg:px-10">
        <div className="chrome-panel flex flex-col items-center justify-between gap-2 rounded-[26px] px-5 py-4 sm:flex-row">
          <p className="text-xs uppercase tracking-[0.26em] text-[var(--text-soft)]">&copy; 2026 nickcardoso</p>
          <a
            href="https://github.com/nicx17/letswatch"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-[var(--text-main)] transition-colors hover:text-[var(--accent)]"
          >
            github.com/nicx17/letswatch
          </a>
        </div>
      </footer>
    </div>
  );
}

export default App;

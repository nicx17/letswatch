import { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, Upload, WifiOff } from 'lucide-react';
import { SyncController } from './SyncController';
import { JoinScreen } from './components/JoinScreen';
import { NoticeStack, type Notice } from './components/NoticeStack';
import { WatchLayout } from './components/WatchLayout';
import { useVideoMedia } from './hooks/useVideoMedia';
import { useRoomSocket } from './hooks/useRoomSocket';
import type { SyncState } from './types';

type JoinMode = 'pin' | 'link' | null;
const ACTIVE_SHARE_LINK_STORAGE_KEY = 'letswatch-active-share-link';
const TOP_CHAT_EMOJIS = [
  '😂', '😭', '😍', '🔥', '👏', '😮', '🥹', '❤️', '🤣', '😊',
  '👀', '😏', '😜', '😈', '💋', '👄', '👅', '💦', '🥵', '😫',
  '😵‍💫', '🔞', '🍑', '🍆', '🍌', '👙', '💄', '💅🏼', '🎬', '🍿',
];

const clientLoggingEnabled =
  import.meta.env.DEV || globalThis.window?.localStorage.getItem('letswatch-debug') === '1';

const clientLog = (
  level: 'info' | 'warn' | 'error',
  event: string,
  meta?: Record<string, unknown>,
) => {
  if (!clientLoggingEnabled && level === 'info') return;

  const payload = {
    ts: new Date().toISOString(),
    ns: 'client',
    level,
    event,
    ...(meta ? { meta } : {}),
  };

  if (level === 'error') {
    console.error(payload);
    return;
  }

  if (level === 'warn') {
    console.warn(payload);
    return;
  }

  console.info(payload);
};

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return 'Unknown error';
  }
};

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
  const browserWindow = globalThis.window;
  if (!browserWindow) return 'ivory';

  const storedTheme = browserWindow.localStorage.getItem('letswatch-theme');
  if (isThemeName(storedTheme)) {
    return storedTheme;
  }

  return browserWindow.matchMedia('(prefers-color-scheme: dark)').matches ? 'midnight' : 'ivory';
};

const getInitialDisplayName = () => {
  const browserWindow = globalThis.window;
  if (!browserWindow) return '';
  return browserWindow.localStorage.getItem('letswatch-display-name') ?? '';
};

const getInitialSharedRoomId = () => {
  const browserWindow = globalThis.window;
  if (!browserWindow) return '';
  return new URLSearchParams(browserWindow.location.search).get('room')?.trim().toUpperCase() ?? '';
};

const getPersistedShareLink = () => {
  const browserWindow = globalThis.window;
  if (!browserWindow) return null;

  const rawValue = browserWindow.sessionStorage.getItem(ACTIVE_SHARE_LINK_STORAGE_KEY);
  if (!rawValue) return null;

  try {
    const parsed = JSON.parse(rawValue) as { roomId?: string; shareToken?: string };
    if (typeof parsed.roomId === 'string' && typeof parsed.shareToken === 'string') {
      return {
        roomId: parsed.roomId.trim().toUpperCase(),
        shareToken: parsed.shareToken.trim(),
      };
    }
  } catch {
    browserWindow.sessionStorage.removeItem(ACTIVE_SHARE_LINK_STORAGE_KEY);
  }

  return null;
};

const getInitialSharedRoomToken = () => {
  const browserWindow = globalThis.window;
  if (!browserWindow) return '';

  const params = new URLSearchParams(browserWindow.location.search);
  // Invite links carry the token in the fragment so it never reaches servers or
  // proxy logs. The query parameter is still read for links copied before that.
  const fragmentParams = new URLSearchParams(browserWindow.location.hash.slice(1));
  const tokenFromUrl = fragmentParams.get('token')?.trim() || params.get('token')?.trim();
  if (tokenFromUrl) {
    return tokenFromUrl;
  }

  const roomId = params.get('room')?.trim().toUpperCase();
  const persistedLink = getPersistedShareLink();
  if (roomId && persistedLink?.roomId === roomId) {
    return persistedLink.shareToken;
  }

  return '';
};

const getScrollBehavior = (): ScrollBehavior => {
  const browserWindow = globalThis.window;
  if (!browserWindow) return 'auto';

  return browserWindow.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
};

const scrollToElement = (
  element: HTMLElement | null,
  block: ScrollLogicalPosition = 'start',
) => {
  if (!element) return;
  element.scrollIntoView({ behavior: getScrollBehavior(), block });
};

const showSubtitleTrack = (
  videoElement: HTMLVideoElement | null,
  hasSubtitle: boolean,
  activeLabel: string | null,
) => {
  if (!videoElement || !hasSubtitle) return;

  const subtitleTracks = Array.from(videoElement.textTracks);
  subtitleTracks.forEach((track) => {
    track.mode = 'disabled';
  });

  const uploadedTrack = subtitleTracks.find(
    (track) => track.label === (activeLabel ?? 'Uploaded subtitles'),
  );

  if (uploadedTrack) {
    uploadedTrack.mode = 'showing';
  }
};

const EMPTY_SUBTITLE_TRACK_SRC = 'data:text/vtt;charset=utf-8,WEBVTT%0A%0A';

/**
 * Sanitize a blob URL through the URL constructor to break CodeQL taint
 * propagation (js/xss-through-dom). The URL constructor parses and validates
 * the input, and .href returns a freshly constructed string that CodeQL
 * recognises as untainted. Only blob: protocol URLs are accepted.
 */
const sanitizeBlobUrl = (value: string): string | null => {
  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'blob:') {
      return parsed.href;
    }
  } catch {
    // Malformed URL — reject
  }
  return null;
};

const getTrustedVideoSrc = (value: string | null): string | undefined => {
  if (typeof value !== 'string') return undefined;
  return sanitizeBlobUrl(value) ?? undefined;
};

const getTrustedSubtitleSrc = (value: string | null): string => {
  if (typeof value !== 'string') return EMPTY_SUBTITLE_TRACK_SRC;
  return sanitizeBlobUrl(value) ?? EMPTY_SUBTITLE_TRACK_SRC;
};

const NOTICE_TIMEOUT_MS = 6000;
const MAX_VISIBLE_NOTICES = 3;

function App() {
  // ── UI-only state ─────────────────────────────────────────────────────────
  const [roomId, setRoomId] = useState(getInitialSharedRoomId);
  const [roomPin, setRoomPin] = useState('');
  const [theme, setTheme] = useState<ThemeName>(getInitialTheme);
  const [isTheaterMode, setIsTheaterMode] = useState(false);
  const [displayName, setDisplayName] = useState(getInitialDisplayName);
  const [joinMode, setJoinMode] = useState<JoinMode>(null);
  const [sharedRoomId, setSharedRoomId] = useState(getInitialSharedRoomId);
  const [shareToken, setShareToken] = useState(getInitialSharedRoomToken);
  const [roomLinkCopied, setRoomLinkCopied] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const copyResetTimeoutRef = useRef<number | null>(null);
  const joinScreenRef = useRef<HTMLDivElement>(null);
  const watchSectionRef = useRef<HTMLElement>(null);
  const noticeIdRef = useRef(0);
  // Last known room playback state. The socket hook writes it and useVideoMedia
  // reads it when a file finishes loading, so both share this one ref.
  const latestRoomStateRef = useRef<SyncState | null>(null);

  const dismissNotice = useCallback((id: number) => {
    setNotices((current) => current.filter((notice) => notice.id !== id));
  }, []);

  const notify = useCallback((message: string) => {
    noticeIdRef.current += 1;
    const id = noticeIdRef.current;
    setNotices((current) => [...current.slice(-(MAX_VISIBLE_NOTICES - 1)), { id, message }]);
    globalThis.setTimeout(() => dismissNotice(id), NOTICE_TIMEOUT_MS);
  }, [dismissNotice]);

  // ── Persist theme / displayName ───────────────────────────────────────────
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    globalThis.window?.localStorage.setItem('letswatch-theme', theme);
  }, [theme]);

  useEffect(() => {
    globalThis.window?.localStorage.setItem('letswatch-display-name', displayName);
  }, [displayName]);

  const {
    videoSrc,
    videoLabel,
    subtitleSrc,
    subtitleLabel,
    audioTracks,
    applyState,
    clearVideoFile,
    handleFileChange,
    handleSubtitleChange,
    clearSubtitleTrack,
    handleAudioTrackSwitch,
    handleVideoLoadedMetadata,
  } = useVideoMedia(videoRef, latestRoomStateRef, clientLog);

  const {
    isJoined,
    isConnected,
    participantsCount,
    currentParticipantId,
    memberProfiles,
    chatMessages,
    unreadMessages,
    isChatCollapsed,
    chatDraft,
    setChatDraft,
    isEmojiStripCollapsed,
    drift,
    setDrift,
    chatInputRef,
    chatImageInputRef,
    handleManualSync,
    handleCreateRoom,
    handleJoin,
    handlePlay,
    handlePause,
    handleSeeked,
    handleSaveDisplayName,
    handleSendChatMessage,
    handleEmojiSelect,
    handleEmojiStripToggle,
    handleChatImageChange,
    handleChatKeyDown,
    handleChatToggle,
  } = useRoomSocket({
    roomId, setRoomId,
    roomPin, setRoomPin,
    displayName,
    joinMode, setJoinMode,
    sharedRoomId, setSharedRoomId,
    shareToken, setShareToken,
    videoRef,
    latestRoomStateRef,
    syncController,
    applyState,
    clientLog,
    notify,
  });

  // ── Derived ───────────────────────────────────────────────────────────────
  const showJoinScreen = !isJoined;
  const shouldShowUploadState = !videoSrc;
  const trustedVideoSrc = getTrustedVideoSrc(videoSrc);
  const trustedSubtitleSrc = getTrustedSubtitleSrc(subtitleSrc);

  const isWatching = isJoined && Boolean(videoSrc);

  // Decorative blur and animated backgrounds compete with video decoding for the
  // GPU, so the stylesheet switches them off while a video is loaded.
  useEffect(() => {
    if (isWatching) {
      document.documentElement.dataset.watching = 'true';
    } else {
      delete document.documentElement.dataset.watching;
    }
  }, [isWatching]);

  const handleClearVideo = () => {
    clearVideoFile();
    setDrift(0);
  };

  // ── Scroll chat to bottom on new messages ─────────────────────────────────
  useEffect(() => {
    if (!chatScrollRef.current) return;

    if (typeof chatScrollRef.current.scrollTo === 'function') {
      chatScrollRef.current.scrollTo({
        top: chatScrollRef.current.scrollHeight,
        behavior: getScrollBehavior(),
      });
      return;
    }

    chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
  }, [chatMessages, isChatCollapsed]);

  useEffect(() => {
    if (showJoinScreen) {
      return;
    }

    const id = globalThis.setTimeout(() => {
      scrollToElement(watchSectionRef.current, 'start');
    }, 120);

    return () => globalThis.clearTimeout(id);
  }, [showJoinScreen]);

  // ── Sync subtitle track display after src changes ─────────────────────────
  useEffect(() => {
    if (!subtitleSrc) return;
    const id = globalThis.setTimeout(() => {
      showSubtitleTrack(videoRef.current, true, subtitleLabel);
    }, 0);
    return () => globalThis.clearTimeout(id);
  }, [subtitleSrc, subtitleLabel]);

  // ── URL-copy cleanup ──────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (copyResetTimeoutRef.current) {
        globalThis.clearTimeout(copyResetTimeoutRef.current);
      }
    };
  }, []);

  // ── Copy room link ────────────────────────────────────────────────────────
  const handleCopyRoomLink = async () => {
    const browserWindow = globalThis.window;
    if (!browserWindow || !roomId || !shareToken) return;

    const shareUrl = new URL(browserWindow.location.href);
    shareUrl.searchParams.set('room', roomId);
    shareUrl.searchParams.delete('token');
    shareUrl.hash = new URLSearchParams({ token: shareToken }).toString();

    try {
      await browserWindow.navigator.clipboard.writeText(shareUrl.toString());
      setRoomLinkCopied(true);
      if (copyResetTimeoutRef.current) {
        globalThis.clearTimeout(copyResetTimeoutRef.current);
      }
      copyResetTimeoutRef.current = globalThis.setTimeout(() => setRoomLinkCopied(false), 2200);
      clientLog('info', 'room.link_copied', { roomId });
    } catch (error) {
      clientLog('warn', 'room.link_copy_failed', { roomId, message: getErrorMessage(error) });
      notify('Unable to copy the room link');
    }
  };

  // ── Theater mode ──────────────────────────────────────────────────────────
  const handleTheaterToggle = () => {
    setIsTheaterMode((current) => !current);
  };

  const getDriftColor = () => {
    if (drift < 0.5) return 'text-emerald-400';
    if (drift < 2) return 'text-amber-300';
    return 'text-rose-400';
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className={`app-shell ${isTheaterMode ? 'app-shell-theater' : ''}`}>
      <div className="ambient-orb ambient-orb-one" aria-hidden="true" />
      <div className="ambient-orb ambient-orb-two" aria-hidden="true" />
      <div className="ambient-grid" aria-hidden="true" />

      <NoticeStack notices={notices} onDismiss={dismissNotice} />

      {isJoined && !isConnected ? (
        <div className="connection-banner status-card status-card-offline" role="status">
          <WifiOff size={20} />
          <div>
            <p className="text-sm font-semibold">Disconnected</p>
            <p className="text-sm text-current/80">Reconnecting to the room server…</p>
          </div>
        </div>
      ) : null}

      {/* While in a room the header shrinks to brand + themes so the player gets the space. */}
      <header className={`page-chrome mx-auto w-full max-w-[1600px] px-4 pt-5 sm:px-6 sm:pt-6 lg:px-10 lg:pt-8 ${showJoinScreen ? 'mb-8' : 'mb-4'} ${isTheaterMode ? 'page-chrome-hidden' : ''}`}>
        <div className={`chrome-panel flex flex-col rounded-[32px] lg:flex-row lg:items-center lg:justify-between ${showJoinScreen ? 'gap-6 px-6 py-6 sm:px-8' : 'gap-4 px-5 py-4 sm:px-6'}`}>
          <div className="flex items-center gap-4">
            <div className="brand-mark">
              <img src="/app-icon.svg" alt="Lets Watch Icon" className={showJoinScreen ? 'h-12 w-12 object-contain' : 'h-9 w-9 object-contain'} />
            </div>
            <div className="space-y-2">
              {showJoinScreen ? (
                <div className="eyebrow">
                  <Sparkles size={14} />
                  <span>Local-first sync lounge</span>
                </div>
              ) : null}
              <div>
                <h1 className="hero-title">Lets Watch</h1>
                {showJoinScreen ? (
                  <p className="hero-copy">
                    Private watch parties with cinematic themes, low-friction room control, and playback that stays in step.
                  </p>
                ) : null}
              </div>
            </div>
          </div>

          <div className="theme-rail">
            {showJoinScreen ? (
              <>
                <p className="theme-rail-label">Choose the room mood</p>
                <div className="hero-actions">
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => scrollToElement(joinScreenRef.current)}
                  >
                    Start Your Room
                  </button>
                </div>
              </>
            ) : null}
            <div className="flex flex-wrap gap-2" role="group" aria-label="Theme">
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

      <main className={`main-shell mx-auto flex w-full max-w-[1600px] flex-1 flex-col px-4 pb-8 sm:px-6 sm:pb-10 lg:px-10 ${isTheaterMode ? 'main-shell-theater' : ''}`}>
        {showJoinScreen ? (
          <div ref={joinScreenRef}>
            <JoinScreen
              displayName={displayName}
              setDisplayName={setDisplayName}
              roomId={roomId}
              setRoomId={setRoomId}
              roomPin={roomPin}
              setRoomPin={setRoomPin}
              handleCreateRoom={handleCreateRoom}
              handleJoin={handleJoin}
            />
          </div>
        ) : (
          <section
            ref={watchSectionRef}
            className={`watch-section flex flex-1 flex-col gap-8 ${isTheaterMode ? 'watch-section-theater' : ''}`}
          >
            {shouldShowUploadState ? (
              <div className="chrome-panel panel-upload flex min-h-[62vh] flex-col items-center justify-center rounded-[36px] border border-dashed border-[var(--border-color)] px-8 py-12 text-center">
                <div className="upload-icon-shell">
                  <Upload size={28} />
                </div>
                <h2 className="mt-6 text-3xl font-semibold tracking-tight text-[var(--text-main)]">Choose your local video</h2>
                <p className="mt-4 max-w-xl text-base leading-7 text-[var(--text-muted)]">
                  Everyone plays their own copy for full quality. Load almost any video file (e.g. `.mp4`, `.mkv`, `.webm`, `.mov`) and the room will
                  handle the playback timing.
                </p>

                <div className="relative mt-10 overflow-hidden">
                  <button type="button" className="primary-button px-8 py-4 text-base">
                    Browse Files
                  </button>
                  <input
                    id="upload-video-primary"
                    name="videoFilePrimary"
                    type="file"
                    accept="video/*,.mkv,.mp4,.webm,.mov,.m4v,.avi"
                    onChange={handleFileChange}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                    aria-label="Choose video file"
                  />
                </div>
              </div>
            ) : (
              <WatchLayout
                videoRef={videoRef}
                trustedVideoSrc={trustedVideoSrc}
                trustedSubtitleSrc={trustedSubtitleSrc}
                subtitleSrc={subtitleSrc}
                subtitleLabel={subtitleLabel}
                videoLabel={videoLabel}
                audioTracks={audioTracks}
                isTheaterMode={isTheaterMode}
                handleFileChange={handleFileChange}
                handleVideoLoadedMetadata={handleVideoLoadedMetadata}
                handlePlay={handlePlay}
                handlePause={handlePause}
                handleSeeked={handleSeeked}
                handleManualSync={handleManualSync}
                handleTheaterToggle={handleTheaterToggle}
                handleAudioTrackSwitch={handleAudioTrackSwitch}
                clearVideoFile={handleClearVideo}
                handleSubtitleChange={handleSubtitleChange}
                clearSubtitleTrack={clearSubtitleTrack}
                drift={drift}
                getDriftColor={getDriftColor}
                chatScrollRef={chatScrollRef}
                chatInputRef={chatInputRef}
                chatImageInputRef={chatImageInputRef}
                chatMessages={chatMessages}
                chatDraft={chatDraft}
                setChatDraft={setChatDraft}
                isChatCollapsed={isChatCollapsed}
                isEmojiStripCollapsed={isEmojiStripCollapsed}
                unreadMessages={unreadMessages}
                currentParticipantId={currentParticipantId}
                participantsCount={participantsCount}
                handleChatToggle={handleChatToggle}
                handleChatKeyDown={handleChatKeyDown}
                handleSendChatMessage={handleSendChatMessage}
                handleEmojiSelect={handleEmojiSelect}
                handleEmojiStripToggle={handleEmojiStripToggle}
                handleChatImageChange={handleChatImageChange}
                topChatEmojis={TOP_CHAT_EMOJIS}
                roomId={roomId}
                roomPin={roomPin}
                roomLinkCopied={roomLinkCopied}
                displayName={displayName}
                setDisplayName={setDisplayName}
                memberProfiles={memberProfiles}
                handleCopyRoomLink={handleCopyRoomLink}
                handleSaveDisplayName={handleSaveDisplayName}
              />
            )}
          </section>
        )}
      </main>

      <footer className={`page-chrome mx-auto mt-auto w-full max-w-[1600px] px-4 pb-4 text-center text-sm text-[var(--text-muted)] sm:px-6 sm:pb-6 lg:px-10 ${isTheaterMode ? 'page-chrome-hidden' : ''}`}>
        <div className="chrome-panel flex flex-col items-center justify-between gap-2 rounded-[26px] px-5 py-4 sm:flex-row">
          <p className="text-xs uppercase tracking-[0.26em] text-[var(--text-soft)]">&copy; 2026 nickcardoso</p>
          <a
            href="https://github.com/nicx17/letswatch"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-[var(--text-main)] hover:text-[var(--accent)]"
          >
            github.com/nicx17/letswatch
          </a>
        </div>
      </footer>
    </div>
  );
}

export default App;

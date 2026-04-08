import React, { useEffect, useEffectEvent, useRef, useState } from 'react';
import twemoji from 'twemoji';
import { io, Socket } from 'socket.io-client';
import { SyncController } from './SyncController';
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileText,
  ImagePlus,
  Maximize2,
  MessageSquare,
  Minimize2,
  SendHorizontal,
  RefreshCw,
  SmilePlus,
  Sparkles,
  Upload,
  UserRound,
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
  error?: string;
  state?: SyncState;
  participants?: string[];
  roomId?: string;
  pin?: string;
  shareToken?: string;
  selfParticipantId?: string;
  memberProfiles?: MemberProfile[];
  message?: ChatMessage;
}

interface MemberProfile {
  participantId: string;
  displayName: string;
}

interface ChatMessage {
  id: string;
  participantId: string;
  displayName: string;
  type: 'text' | 'image';
  text?: string;
  imageDataUrl?: string;
  sentAt: number;
}

type JoinMode = 'pin' | 'link' | null;
const TOP_CHAT_EMOJIS = [
  '😂', '😭', '😍', '🔥', '👏', '😮', '🥹', '❤️', '🤣', '😊',
  '👀', '😏', '😜', '😈', '💋', '👄', '👅', '💦', '🥵', '😫',
  '😵‍💫', '🔞', '🍑', '🍆', '🍌', '👙', '💄', '💅🏼', '🎬', '🍿',
];

const V_URL = import.meta.env.VITE_SOCKET_URL;
const getDefaultSocketUrl = () => {
  const browserWindow = globalThis.window;
  if (!browserWindow) {
    return 'http://localhost:4000';
  }

  if (import.meta.env.PROD) {
    return browserWindow.location.origin;
  }

  return `http://${browserWindow.location.hostname}:4000`;
};

const SOCKET_URL = V_URL || getDefaultSocketUrl();

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

const convertSrtToVtt = (subtitleContent: string) => {
  const normalized = subtitleContent.replaceAll(/\r+/g, '');
  const withCueTimings = normalized.replaceAll(
    /(\d{2}:\d{2}:\d{2}),(\d{3})/g,
    '$1.$2',
  );

  return `WEBVTT\n\n${withCueTimings.trim()}\n`;
};

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

const getInitialSharedRoomToken = () => {
  const browserWindow = globalThis.window;
  if (!browserWindow) return '';
  return new URLSearchParams(browserWindow.location.search).get('token')?.trim() ?? '';
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
const isTrustedBlobUrl = (value: string | null): value is string =>
  typeof value === 'string' && value.startsWith('blob:');
const getTrustedVideoSrc = (value: string | null): string | undefined => (isTrustedBlobUrl(value) ? value : undefined);
const getTrustedSubtitleSrc = (value: string | null): string => (
  isTrustedBlobUrl(value) ? value : EMPTY_SUBTITLE_TRACK_SRC
);

const MAX_CHAT_IMAGE_DIMENSION = 1600;
const MAX_CHAT_IMAGE_FILE_SIZE = 4 * 1024 * 1024;
const MAX_CHAT_IMAGE_DATA_URL_LENGTH = 1_700_000;
const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }

      reject(new Error('Unable to read image data'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read image data'));
    reader.readAsDataURL(file);
  });

const loadImageElement = (dataUrl: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Unable to load image'));
    image.src = dataUrl;
  });

const canvasToDataUrl = (
  canvas: HTMLCanvasElement,
  mimeType: 'image/webp' | 'image/jpeg',
  quality: number,
) =>
  new Promise<string>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Unable to compress image'));
          return;
        }

        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === 'string') {
            resolve(reader.result);
            return;
          }

          reject(new Error('Unable to encode image'));
        };
        reader.onerror = () => reject(reader.error ?? new Error('Unable to encode image'));
        reader.readAsDataURL(blob);
      },
      mimeType,
      quality,
    );
  });

const prepareChatImageDataUrl = async (file: File) => {
  const sourceDataUrl = await readFileAsDataUrl(file);
  const image = await loadImageElement(sourceDataUrl);
  const scale = Math.min(1, MAX_CHAT_IMAGE_DIMENSION / Math.max(image.width, image.height));

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Unable to process image');
  }

  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const preferredType = file.type === 'image/png' || file.type === 'image/gif' ? 'image/webp' : 'image/jpeg';
  let quality = preferredType === 'image/webp' ? 0.82 : 0.84;
  let compressedDataUrl = await canvasToDataUrl(canvas, preferredType, quality);

  while (compressedDataUrl.length > MAX_CHAT_IMAGE_DATA_URL_LENGTH && quality > 0.45) {
    quality -= 0.1;
    compressedDataUrl = await canvasToDataUrl(canvas, preferredType, quality);
  }

  if (compressedDataUrl.length > MAX_CHAT_IMAGE_DATA_URL_LENGTH) {
    throw new Error('That image is still too large after compression. Try a smaller image.');
  }

  return compressedDataUrl;
};

const EmojiText = ({ text }: { text: string }) => {
  const textRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!textRef.current) return;
    textRef.current.textContent = text;
    twemoji.parse(textRef.current, {
      folder: 'svg',
      ext: '.svg',
      className: 'emoji-inline',
    });
  }, [text]);

  return <span ref={textRef} />;
};

function App() { // NOSONAR
  const [roomId, setRoomId] = useState(getInitialSharedRoomId);
  const [roomPin, setRoomPin] = useState('');
  const [isJoined, setIsJoined] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [participantsCount, setParticipantsCount] = useState(0);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [videoLabel, setVideoLabel] = useState<string | null>(null);
  const [subtitleSrc, setSubtitleSrc] = useState<string | null>(null);
  const [subtitleLabel, setSubtitleLabel] = useState<string | null>(null);
  const [drift, setDrift] = useState(0);
  const [theme, setTheme] = useState<ThemeName>(getInitialTheme);
  const [isTheaterMode, setIsTheaterMode] = useState(false);
  const [displayName, setDisplayName] = useState(getInitialDisplayName);
  const [memberProfiles, setMemberProfiles] = useState<MemberProfile[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatDraft, setChatDraft] = useState('');
  const [isEmojiStripCollapsed, setIsEmojiStripCollapsed] = useState(true);
  const [isChatCollapsed, setIsChatCollapsed] = useState(false);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [currentParticipantId, setCurrentParticipantId] = useState('');
  const [joinMode, setJoinMode] = useState<JoinMode>(null);
  const [sharedRoomId, setSharedRoomId] = useState(getInitialSharedRoomId);
  const [shareToken, setShareToken] = useState(getInitialSharedRoomToken);
  const [roomLinkCopied, setRoomLinkCopied] = useState(false);
  const [viewportSize, setViewportSize] = useState(() => ({
    width: globalThis.window?.innerWidth ?? 1440,
    height: globalThis.window?.innerHeight ?? 900,
  }));

  const videoRef = useRef<HTMLVideoElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const chatImageInputRef = useRef<HTMLInputElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const copyResetTimeoutRef = useRef<number | null>(null);
  const ignoreEvents = useRef({ play: false, pause: false, seek: false });
  const objectUrlRef = useRef<string | null>(null);
  const subtitleUrlRef = useRef<string | null>(null);
  const latestRoomStateRef = useRef<SyncState | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    globalThis.window?.localStorage.setItem('letswatch-theme', theme);
  }, [theme]);

  useEffect(() => {
    globalThis.window?.localStorage.setItem('letswatch-display-name', displayName);
  }, [displayName]);

  useEffect(() => {
    const browserWindow = globalThis.window;
    if (!browserWindow) return;

    const updateViewportSize = () => {
      setViewportSize({
        width: browserWindow.innerWidth,
        height: browserWindow.innerHeight,
      });
    };

    updateViewportSize();
    browserWindow.addEventListener('resize', updateViewportSize);

    return () => browserWindow.removeEventListener('resize', updateViewportSize);
  }, []);

  const applyVideoFile = (file: File) => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
    }

    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    setVideoSrc(url);
    setVideoLabel(file.name);
  };

  const clearVideoFile = () => {
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.removeAttribute('src');
      videoRef.current.load();
    }

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }

    clearSubtitleTrack();
    setVideoSrc(null);
    setVideoLabel(null);
    setDrift(0);

  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    applyVideoFile(file);
    e.target.value = '';
  };

  const clearSubtitleTrack = () => {
    if (videoRef.current) {
      Array.from(videoRef.current.textTracks).forEach((track) => {
        track.mode = 'disabled';
      });
    }

    if (subtitleUrlRef.current) {
      URL.revokeObjectURL(subtitleUrlRef.current);
      subtitleUrlRef.current = null;
    }

    setSubtitleSrc(null);
    setSubtitleLabel(null);
  };

  const handleSubtitleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    clearSubtitleTrack();

    const fileExtension = file.name.split('.').pop()?.toLowerCase();
    let nextSubtitleUrl: string;

    if (fileExtension === 'srt') {
      const srtText = await file.text();
      const vttBlob = new Blob([convertSrtToVtt(srtText)], { type: 'text/vtt' });
      nextSubtitleUrl = URL.createObjectURL(vttBlob);
    } else {
      nextSubtitleUrl = URL.createObjectURL(file);
    }

    subtitleUrlRef.current = nextSubtitleUrl;
    setSubtitleSrc(nextSubtitleUrl);
    setSubtitleLabel(file.name);
    e.target.value = '';
  };

  useEffect(() => {
    return () => {
      if (copyResetTimeoutRef.current) {
        globalThis.clearTimeout(copyResetTimeoutRef.current);
      }

      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }

      if (subtitleUrlRef.current) {
        URL.revokeObjectURL(subtitleUrlRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!subtitleSrc) return;

    const timeoutId = globalThis.setTimeout(() => {
      showSubtitleTrack(videoRef.current, true, subtitleLabel);
    }, 0);

    return () => globalThis.clearTimeout(timeoutId);
  }, [subtitleSrc, subtitleLabel]);

  useEffect(() => {
    if (!chatScrollRef.current) return;
    chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
  }, [chatMessages, isChatCollapsed]);

  const applyState = (state: SyncState) => {
    if (!videoRef.current) return;

    const targetTime = syncController.getTargetTime(state);

    if (Math.abs(videoRef.current.currentTime - targetTime) > 0.5) {
      ignoreEvents.current.seek = true;
      videoRef.current.currentTime = targetTime;
    }

    if (state.playing && videoRef.current.paused) {
      ignoreEvents.current.play = true;
      videoRef.current.play().catch((error) => {
        clientLog('error', 'playback.play_failed', {
          roomId,
          message: getErrorMessage(error),
        });
      });
    } else if (!state.playing && !videoRef.current.paused) {
      ignoreEvents.current.pause = true;
      videoRef.current.pause();
    }
  };

  const normalizeIncomingState = (state: SyncState): SyncState => ({
    position: state.position,
    playing: state.playing,
    // Treat the received snapshot as authoritative "now" on the local client.
    updatedAt: Date.now(),
  });

  const canApplyVideoState = () => {
    const videoElement = videoRef.current;
    return Boolean(videoElement && videoElement.readyState >= 1);
  };

  const cacheRoomState = (state: SyncState) => {
    const normalizedState = normalizeIncomingState(state);
    latestRoomStateRef.current = normalizedState;
    return normalizedState;
  };

  const applyAuthoritativeState = (state: SyncState) => {
    const normalizedState = cacheRoomState(state);
    if (canApplyVideoState()) {
      applyState(normalizedState);
    }

    return normalizedState;
  };

  const clearShareUrl = () => {
    const browserWindow = globalThis.window;
    if (!browserWindow) return;

    const url = new URL(browserWindow.location.href);
    url.searchParams.delete('room');
    url.searchParams.delete('token');
    browserWindow.history.replaceState({}, '', url.toString());
  };

  const resetJoinedRoomState = (clearSharedLink: boolean) => {
    latestRoomStateRef.current = null;
    setIsJoined(false);
    setJoinMode(null);
    setParticipantsCount(0);
    setMemberProfiles([]);
    setCurrentParticipantId('');
    setChatMessages([]);
    setUnreadMessages(0);
    setDrift(0);

    if (clearSharedLink) {
      setSharedRoomId('');
      setShareToken('');
      clearShareUrl();
    }
  };

  const handleReconnectFailure = (response: SyncResponse, clearSharedLink: boolean) => {
    resetJoinedRoomState(clearSharedLink);
    clientLog('warn', 'room.reconnect.failed', {
      roomId,
      joinMode: joinMode ?? 'unknown',
      error: response.error,
    });
    alert(response.error || 'Unable to reconnect to the room');
  };

  const handleVideoLoadedMetadata = () => {
    showSubtitleTrack(videoRef.current, Boolean(subtitleSrc), subtitleLabel);

    if (latestRoomStateRef.current) {
      applyState(latestRoomStateRef.current);
    }
  };

  const handleManualSync = () => {
    const socket = socketRef.current;
    if (!socket || !videoRef.current) return;

    socket.emit('force_sync_request', roomId, (response: SyncResponse) => {
      if (response?.success && response.state) {
        applyAuthoritativeState(response.state);
      }
    });
  };

  const syncFromRoomResponse = (response: SyncResponse) => {
    if (!response.success) return false;
    setParticipantsCount(response.participants?.length ?? 0);
    setMemberProfiles(response.memberProfiles ?? []);
    setCurrentParticipantId(response.selfParticipantId ?? '');
    if (response.shareToken) {
      setShareToken(response.shareToken);
    }

    if (response.state) {
      applyAuthoritativeState(response.state);
    }

    return true;
  };

  const updateShareUrl = (nextRoomId: string, nextShareToken: string) => {
    const browserWindow = globalThis.window;
    if (!browserWindow) return;

    const url = new URL(browserWindow.location.href);
    url.searchParams.set('room', nextRoomId);
    url.searchParams.set('token', nextShareToken);
    browserWindow.history.replaceState({}, '', url.toString());
  };

  const joinRoomFromLink = useEffectEvent((targetRoomId: string) => {
    const socket = socketRef.current;
    if (!socket || !targetRoomId || !shareToken) return;

    const normalizedRoomId = targetRoomId.trim().toUpperCase();
    clientLog('info', 'room.link_join.requested', { roomId: normalizedRoomId });
    socket.emit('join_room_link', { roomId: normalizedRoomId, shareToken, displayName }, (response: SyncResponse) => {
      if (syncFromRoomResponse(response)) {
        setChatMessages([]);
        setRoomId((response.roomId ?? normalizedRoomId).toUpperCase());
        setRoomPin('');
        setJoinMode('link');
        setIsJoined(true);
        setSharedRoomId((response.roomId ?? normalizedRoomId).toUpperCase());
        if (response.shareToken) {
          updateShareUrl((response.roomId ?? normalizedRoomId).toUpperCase(), response.shareToken);
        }
        clientLog('info', 'room.link_join.succeeded', {
          roomId: response.roomId ?? normalizedRoomId,
          selfParticipantId: response.selfParticipantId,
        });
        return;
      }

      setSharedRoomId('');
      setShareToken('');
      clearShareUrl();
      clientLog('warn', 'room.link_join.failed', { roomId: normalizedRoomId, error: response.error });
      alert(response.error || 'Failed to join shared room');
    });
  });

  const handleReconnect = useEffectEvent(() => {
    const socket = socketRef.current;
    if (!socket || !roomId || !isJoined) return;

    if (joinMode === 'link') {
      if (!shareToken) return;
      socket.emit('join_room_link', { roomId, shareToken, displayName }, (response: SyncResponse) => {
        if (!syncFromRoomResponse(response)) {
          handleReconnectFailure(response, true);
        }
      });
      return;
    }

    if (!roomPin) return;
    socket.emit('join_room', { roomId, pin: roomPin, displayName }, (response: SyncResponse) => {
      if (!syncFromRoomResponse(response)) {
        handleReconnectFailure(response, false);
      }
    });
  });

  const handleStateUpdated = useEffectEvent((state: SyncState) => {
    applyAuthoritativeState(state);
  });

  const handleParticipantsUpdated = useEffectEvent((participantList: string[]) => {
    setParticipantsCount(participantList.length);
  });

  const handleMemberProfilesUpdated = useEffectEvent((profiles: MemberProfile[]) => {
    setMemberProfiles(profiles);
    setParticipantsCount(profiles.length);
  });

  const handleChatMessage = useEffectEvent((message: ChatMessage) => {
    setChatMessages((current) => [...current, message].slice(-120));

    if (isChatCollapsed && message.participantId !== currentParticipantId) {
      setUnreadMessages((current) => current + 1);
    }
  });

  const handleDriftCorrection = useEffectEvent((state: SyncState) => {
    applyState(state);
  });

  useEffect(() => {
    const socket = io(SOCKET_URL);
    socketRef.current = socket;

    const onConnect = () => {
      setIsConnected(true);
      clientLog('info', 'socket.connected', { transport: socket.io.engine.transport.name });
      handleReconnect();
    };

    const onDisconnect = () => {
      setIsConnected(false);
      setCurrentParticipantId('');
      clientLog('warn', 'socket.disconnected');
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('state_updated', handleStateUpdated);
    socket.on('participants_updated', handleParticipantsUpdated);
    socket.on('member_profiles_updated', handleMemberProfilesUpdated);
    socket.on('chat_message', handleChatMessage);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('state_updated', handleStateUpdated);
      socket.off('participants_updated', handleParticipantsUpdated);
      socket.off('member_profiles_updated', handleMemberProfilesUpdated);
      socket.off('chat_message', handleChatMessage);
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!isConnected || isJoined || !sharedRoomId || !shareToken) return;
    joinRoomFromLink(sharedRoomId);
  }, [isConnected, isJoined, shareToken, sharedRoomId]);

  const handleCreateRoom = () => {
    const socket = socketRef.current;
    const normalizedRoomId = roomId.trim().toUpperCase();
    const normalizedPin = roomPin.replaceAll(/\D/g, '').slice(0, 6);
    if (!socket || !normalizedRoomId || !normalizedPin) return;

    setRoomId(normalizedRoomId);
    setRoomPin(normalizedPin);
    clientLog('info', 'room.create.requested', { roomId: normalizedRoomId, displayName: displayName || undefined });
    socket.emit('create_room', { roomId: normalizedRoomId, pin: normalizedPin, displayName }, (response: SyncResponse) => {
      if (syncFromRoomResponse(response)) {
        setChatMessages([]);
        setRoomId((response.roomId ?? normalizedRoomId).toUpperCase());
        setRoomPin(response.pin ?? normalizedPin);
        setJoinMode('pin');
        setSharedRoomId((response.roomId ?? normalizedRoomId).toUpperCase());
        setIsJoined(true);
        if (response.shareToken) {
          updateShareUrl((response.roomId ?? normalizedRoomId).toUpperCase(), response.shareToken);
        }
        clientLog('info', 'room.create.succeeded', {
          roomId: response.roomId ?? normalizedRoomId,
          selfParticipantId: response.selfParticipantId,
        });
      } else {
        clientLog('warn', 'room.create.failed', { error: response.error });
        alert(response.error || 'Failed to create room');
      }
    });
  };

  const handleJoin = () => {
    const socket = socketRef.current;
    const normalizedRoomId = roomId.trim().toUpperCase();
    const normalizedPin = roomPin.replaceAll(/\D/g, '').slice(0, 6);
    if (!normalizedRoomId || !normalizedPin || !socket) return;

    setRoomId(normalizedRoomId);
    setRoomPin(normalizedPin);
    clientLog('info', 'room.join.requested', { roomId: normalizedRoomId });
    socket.emit('join_room', { roomId: normalizedRoomId, pin: normalizedPin, displayName }, (response: SyncResponse) => {
      if (syncFromRoomResponse(response)) {
        setChatMessages([]);
        setRoomId((response.roomId ?? normalizedRoomId).toUpperCase());
        setJoinMode('pin');
        setSharedRoomId((response.roomId ?? normalizedRoomId).toUpperCase());
        setIsJoined(true);
        if (response.shareToken) {
          updateShareUrl((response.roomId ?? normalizedRoomId).toUpperCase(), response.shareToken);
        }
        clientLog('info', 'room.join.succeeded', {
          roomId: response.roomId ?? normalizedRoomId,
          selfParticipantId: response.selfParticipantId,
        });
      } else {
        clientLog('warn', 'room.join.failed', { roomId: normalizedRoomId, error: response.error });
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

    if (socket && isJoined && videoRef.current) {
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

    if (socket && isJoined && videoRef.current) {
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

    if (socket && isJoined && videoRef.current) {
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
        if (!videoRef.current || !response?.success || !response.state) return;

        const normalizedState: SyncState = {
          position: response.state.position,
          playing: response.state.playing,
          updatedAt: Date.now(),
        };
        latestRoomStateRef.current = normalizedState;
        const currentDrift = syncController.calculateDrift(videoRef.current.currentTime, normalizedState);
        setDrift(currentDrift);

        if (syncController.shouldForceSync(currentDrift)) {
          handleDriftCorrection(normalizedState);
        }
      });
    }, 3000);

    return () => clearInterval(interval);
  }, [isJoined, roomId]);

  const handleSaveDisplayName = () => {
    const socket = socketRef.current;
    if (!socket || !isJoined) return;

    socket.emit('set_display_name', roomId, displayName, (response: SyncResponse) => {
      if (!response.success) {
        clientLog('warn', 'profile.save_failed', { roomId, error: response.error });
        alert(response.error || 'Unable to save name');
        return;
      }

      if (response.memberProfiles) {
        setMemberProfiles(response.memberProfiles);
      }
      clientLog('info', 'profile.saved', { roomId });
    });
  };

  const handleSendChatMessage = () => {
    const socket = socketRef.current;
    const trimmedDraft = chatDraft.trim();
    if (!socket || !isJoined || !trimmedDraft) return;

    socket.emit('send_chat_message', roomId, { type: 'text', text: trimmedDraft }, (response: SyncResponse) => {
      if (!response.success) {
        clientLog('warn', 'chat.text_failed', { roomId, error: response.error });
        alert(response.error || 'Unable to send message');
        return;
      }

      setChatDraft('');
      clientLog('info', 'chat.text_sent', { roomId, length: trimmedDraft.length });
    });
  };

  const handleEmojiSelect = (emoji: string) => {
    const draftInput = chatInputRef.current;
    if (!draftInput) {
      setChatDraft((current) => `${current}${emoji}`);
      return;
    }

    const selectionStart = draftInput.selectionStart ?? chatDraft.length;
    const selectionEnd = draftInput.selectionEnd ?? chatDraft.length;

    setChatDraft((current) => {
      const safeStart = Math.min(selectionStart, current.length);
      const safeEnd = Math.min(selectionEnd, current.length);
      return `${current.slice(0, safeStart)}${emoji}${current.slice(safeEnd)}`;
    });

    globalThis.requestAnimationFrame(() => {
      const nextCaretPosition = selectionStart + emoji.length;
      draftInput.focus();
      draftInput.setSelectionRange(nextCaretPosition, nextCaretPosition);
    });
  };

  const handleEmojiStripToggle = () => {
    setIsEmojiStripCollapsed((current) => !current);
  };

  const handleCopyRoomLink = async () => {
    const browserWindow = globalThis.window;
    if (!browserWindow || !roomId || !shareToken) return;

    const shareUrl = new URL(browserWindow.location.href);
    shareUrl.searchParams.set('room', roomId);
    shareUrl.searchParams.set('token', shareToken);

    try {
      await browserWindow.navigator.clipboard.writeText(shareUrl.toString());
      setRoomLinkCopied(true);
      if (copyResetTimeoutRef.current) {
        globalThis.clearTimeout(copyResetTimeoutRef.current);
      }
      copyResetTimeoutRef.current = globalThis.setTimeout(() => {
        setRoomLinkCopied(false);
      }, 2200);
      clientLog('info', 'room.link_copied', { roomId });
    } catch (error) {
      clientLog('warn', 'room.link_copy_failed', {
        roomId,
        message: getErrorMessage(error),
      });
      alert('Unable to copy the room link');
    }
  };

  const handleChatImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !isJoined || !socketRef.current) return;

    if (!file.type.startsWith('image/')) {
      clientLog('warn', 'chat.image_rejected', { reason: 'invalid_type', fileType: file.type });
      alert('Choose a PNG, JPG, GIF, or WebP image');
      e.target.value = '';
      return;
    }

    if (file.size > MAX_CHAT_IMAGE_FILE_SIZE) {
      clientLog('warn', 'chat.image_rejected', { reason: 'file_too_large', fileSize: file.size });
      alert('Keep chat images under 4 MB before upload');
      e.target.value = '';
      return;
    }

    void prepareChatImageDataUrl(file)
      .then((imageDataUrl) => {
        clientLog('info', 'chat.image_prepared', {
          roomId,
          originalSize: file.size,
          payloadSize: imageDataUrl.length,
          mimeType: file.type,
        });
        socketRef.current?.emit(
          'send_chat_message',
          roomId,
          { type: 'image', imageDataUrl },
          (response: SyncResponse) => {
            if (!response.success) {
              clientLog('warn', 'chat.image_failed', { roomId, error: response.error });
              alert(response.error || 'Unable to send image');
              return;
            }

            clientLog('info', 'chat.image_sent', { roomId, payloadSize: imageDataUrl.length });
          },
        );
      })
      .catch((error: unknown) => {
        clientLog('error', 'chat.image_prepare_failed', {
          roomId,
          message: getErrorMessage(error),
        });
        alert(error instanceof Error ? error.message : 'Unable to send image');
      });

    e.target.value = '';
  };

  const handleChatKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendChatMessage();
    }
  };

  const handleChatToggle = () => {
    setIsChatCollapsed((current) => {
      const nextValue = !current;
      if (!nextValue) {
        setUnreadMessages(0);
      }
      return nextValue;
    });
  };

  const handleTheaterToggle = () => {
    setIsTheaterMode((current) => {
      const nextValue = !current;
      if (nextValue) {
        setIsChatCollapsed(true);
      }
      return nextValue;
    });
  };

  const otherMembers = memberProfiles.filter((member) => member.participantId !== currentParticipantId);
  const currentMemberName =
    memberProfiles.find((member) => member.participantId === currentParticipantId)?.displayName || displayName || 'You';
  const showJoinScreen = isJoined === false;
  const shouldShowUploadState = !videoSrc;
  const isChatExpanded = isChatCollapsed === false;
  const isEmojiStripOpen = isEmojiStripCollapsed === false;
  const trustedVideoSrc = getTrustedVideoSrc(videoSrc);
  const trustedSubtitleSrc = getTrustedSubtitleSrc(subtitleSrc);

  const getDriftColor = () => {
    if (drift < 0.5) return 'text-emerald-400';
    if (drift < 2) return 'text-amber-300';
    return 'text-rose-400';
  };

  return (
    <div
      className={`app-shell ${isTheaterMode ? 'app-shell-theater' : ''}`}
      style={
        {
          '--viewport-width': `${viewportSize.width}px`,
          '--viewport-height': `${viewportSize.height}px`,
        } as React.CSSProperties
      }
    >
      <div className="ambient-orb ambient-orb-one" aria-hidden="true" />
      <div className="ambient-orb ambient-orb-two" aria-hidden="true" />
      <div className="ambient-grid" aria-hidden="true" />

      <header className={`page-chrome mx-auto mb-10 w-full max-w-[1480px] px-6 pt-8 sm:px-8 lg:px-12 ${isTheaterMode ? 'page-chrome-hidden' : ''}`}>
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

      <main className={`main-shell mx-auto flex w-full max-w-[1480px] flex-1 flex-col px-6 pb-10 sm:px-8 lg:px-12 ${isTheaterMode ? 'main-shell-theater' : ''}`}>
        {showJoinScreen ? (
          <section className="grid flex-1 content-start gap-8 lg:grid-cols-[1.15fr_0.85fr] xl:gap-10">
            <div className="chrome-panel panel-feature rounded-[32px] p-8 sm:p-10 lg:p-12">
              <div className="space-y-6">
                <div className="eyebrow">
                  <Sparkles size={14} />
                  <span>Watch together</span>
                </div>
                <h2 className="section-title max-w-4xl text-[var(--text-main)]">
                  Watch together, beautifully.
                </h2>
                <p className="max-w-3xl text-[1.05rem] leading-8 text-[var(--text-muted)] sm:text-[1.12rem]">
                  Bring your own video, invite someone into the same room, and enjoy a setup that feels calm, polished,
                  and easy to use from the first click.
                </p>
              </div>

              <div className="mt-10 grid gap-5 sm:grid-cols-3">
                <div className="info-tile">
                  <span className="info-tile-title">Bring your file</span>
                  <span className="info-tile-copy">Open the video you already have and keep the full quality.</span>
                </div>
                <div className="info-tile">
                  <span className="info-tile-title">Shared control</span>
                  <span className="info-tile-copy">Anyone in the room can play, pause, and scrub the timeline.</span>
                </div>
                <div className="info-tile">
                  <span className="info-tile-title">Room atmosphere</span>
                  <span className="info-tile-copy">Switch between Midnight, Ocean, Romance, Forest, and Ivory.</span>
                </div>
              </div>
            </div>

            <div className="chrome-panel panel-form rounded-[32px] p-8 sm:p-10 lg:p-12">
              <div className="space-y-3">
                <p className="eyebrow">
                  <Users size={14} />
                  <span>Join a session</span>
                </p>
                <h2 className="section-title text-[var(--text-main)]">Enter your room code</h2>
                <p className="text-base leading-7 text-[var(--text-muted)]">
                  Pick your own room code and 6-digit PIN, or join with credentials someone shared with you.
                </p>
              </div>

              <form
                className="mt-10 space-y-5"
                onSubmit={(e) => {
                  e.preventDefault();
                  handleJoin();
                }}
              >
                <label htmlFor="join-display-name" className="block text-xs font-semibold uppercase tracking-[0.28em] text-[var(--text-muted)]">
                  Your name
                </label>
                <input
                  id="join-display-name"
                  name="displayName"
                  type="text"
                  autoComplete="name"
                  placeholder="Movie buddy"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="input-shell"
                  maxLength={24}
                />
                <label htmlFor="join-room-code" className="block text-xs font-semibold uppercase tracking-[0.28em] text-[var(--text-muted)]">
                  Room code
                </label>
                <input
                  id="join-room-code"
                  name="roomCode"
                  type="text"
                  autoComplete="username"
                  autoCapitalize="characters"
                  spellCheck={false}
                  placeholder="ABCD2345"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                  className="input-shell"
                />
                <label htmlFor="join-room-pin" className="block text-xs font-semibold uppercase tracking-[0.28em] text-[var(--text-muted)]">
                  Room PIN
                </label>
                <input
                  id="join-room-pin"
                  name="roomPin"
                  type="password"
                  autoComplete="current-password"
                  placeholder="123456"
                  value={roomPin}
                  onChange={(e) => setRoomPin(e.target.value.replaceAll(/\D/g, '').slice(0, 6))}
                  className="input-shell"
                  inputMode="numeric"
                  maxLength={6}
                />
                <button type="button" onClick={handleCreateRoom} className="primary-button w-full" disabled={!roomId || !roomPin}>
                  Create Room
                </button>
                <button type="submit" className="secondary-button w-full" disabled={!roomId || !roomPin}>
                  Enter Room
                </button>
              </form>
            </div>
          </section>
        ) : (
          <section className={`watch-section flex flex-1 flex-col gap-8 ${isTheaterMode ? 'watch-section-theater' : ''}`}>
            {shouldShowUploadState ? (
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
                    id="upload-video-primary"
                    name="videoFilePrimary"
                    type="file"
                    accept="video/mp4,video/webm,video/x-matroska"
                    onChange={handleFileChange}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                    aria-label="Choose video file"
                  />
                </div>
              </div>
            ) : (
              <div className={`watch-layout ${isTheaterMode ? 'watch-layout-theater' : ''}`}>
                <div className={`player-stage ${isTheaterMode ? 'player-stage-theater' : ''}`}>
                  <div className={`chrome-panel player-panel overflow-hidden rounded-[36px] p-3 ${isTheaterMode ? 'player-panel-theater' : ''}`}>
                    <div className="video-frame">
                      <video
                        ref={videoRef}
                        src={trustedVideoSrc}
                        controls
                        className={`w-full aspect-video rounded-[28px] outline-none ${isTheaterMode ? 'theater-video' : ''}`}
                        onLoadedMetadata={handleVideoLoadedMetadata}
                        onPlay={handlePlay}
                        onPause={handlePause}
                        onSeeked={handleSeeked}
                      >
                        <track
                          key={subtitleSrc ?? 'empty-caption-track'}
                          src={trustedSubtitleSrc}
                          kind="captions"
                          srcLang="en"
                          label={subtitleLabel ?? 'Uploaded subtitles'}
                          default={Boolean(subtitleSrc)}
                        />
                      </video>
                    </div>

                    <div className="player-toolbar mt-4 rounded-[26px] bg-[var(--panel-strong)] px-4 py-4 sm:px-5">
                      <div className="flex flex-wrap items-center gap-3">
                        <label className="secondary-button cursor-pointer">
                          <Upload size={18} />
                          <span>Change Video</span>
                          <input
                            id="upload-video-toolbar"
                            name="videoFileToolbar"
                            type="file"
                            accept="video/mp4,video/webm,video/x-matroska"
                            onChange={handleFileChange}
                            className="hidden"
                          />
                        </label>

                        <button type="button" onClick={clearVideoFile} className="secondary-button">
                          <span>Remove Video</span>
                        </button>

                        <button type="button" onClick={handleManualSync} className="secondary-button">
                          <RefreshCw size={18} />
                          <span>Force Sync</span>
                        </button>

                        <button
                          type="button"
                          onClick={handleTheaterToggle}
                          className="secondary-button"
                          aria-pressed={isTheaterMode}
                        >
                          {isTheaterMode ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                          <span>{isTheaterMode ? 'Exit Theater' : 'Theater Mode'}</span>
                        </button>
                      </div>

                      <div className="metric-pill">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.26em] text-[var(--text-muted)]">
                          Drift
                        </span>
                        {drift > 0.5 && <AlertTriangle size={18} className={getDriftColor()} />}
                        <span className={`font-mono text-lg font-bold ${getDriftColor()}`}>{drift.toFixed(2)}s</span>
                      </div>
                    </div>
                  </div>

                  <div
                    className={`chat-shell ${isChatCollapsed ? 'chat-shell-collapsed' : ''} ${isTheaterMode ? 'chat-shell-theater' : ''}`}
                  >
                    <button
                      type="button"
                      className="chat-toggle"
                      onClick={handleChatToggle}
                      aria-expanded={isChatExpanded}
                    >
                      <div className="chat-toggle-main">
                        <MessageSquare size={18} />
                        {isChatExpanded ? <span>Room chat</span> : null}
                      </div>
                      <div className="chat-toggle-side">
                        {unreadMessages > 0 ? <span className="chat-badge">{unreadMessages}</span> : null}
                        {isChatCollapsed ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
                      </div>
                    </button>

                    {isChatExpanded ? (
                      <div className="chrome-panel chat-panel rounded-[32px] p-5">
                        <div className="chat-panel-head">
                          <div>
                            <p className="eyebrow">
                              <MessageSquare size={14} />
                              <span>Live chat</span>
                            </p>
                          </div>
                          <div className="metric-pill px-3 py-2">
                            <UserRound size={16} />
                            <span className="font-semibold text-[var(--text-main)]">{participantsCount}</span>
                          </div>
                        </div>

                        <div ref={chatScrollRef} className="chat-log">
                          {chatMessages.length > 0 ? (
                            chatMessages.map((message) => {
                              const isOwnMessage = message.participantId === currentParticipantId;

                              return (
                                <article
                                  key={message.id}
                                  className={`chat-message ${isOwnMessage ? 'chat-message-own' : ''}`}
                                >
                                  <div className="chat-message-meta">
                                    <span className="chat-message-name">
                                      {isOwnMessage ? 'You' : message.displayName}
                                    </span>
                                    <time className="chat-message-time">
                                      {new Date(message.sentAt).toLocaleTimeString([], {
                                        hour: 'numeric',
                                        minute: '2-digit',
                                      })}
                                    </time>
                                  </div>
                                  <div className="chat-message-bubble">
                                    {message.type === 'image' && message.imageDataUrl ? (
                                      <img
                                        src={message.imageDataUrl}
                                        alt={`Shared by ${message.displayName}`}
                                        className="chat-image"
                                      />
                                    ) : (
                                      <p><EmojiText text={message.text ?? ''} /></p>
                                    )}
                                  </div>
                                </article>
                              );
                            })
                          ) : (
                            <div className="chat-empty-state">
                              <MessageSquare size={18} />
                              <p>No messages yet.</p>
                            </div>
                          )}
                        </div>

                        <div className="chat-compose">
                          {isEmojiStripOpen ? (
                            <div className="emoji-strip" aria-label="Quick emoji reactions">
                              {TOP_CHAT_EMOJIS.map((emoji) => (
                                <button
                                  key={emoji}
                                  type="button"
                                  className="emoji-chip"
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => handleEmojiSelect(emoji)}
                                  aria-label={`Add ${emoji}`}
                                >
                                  <EmojiText text={emoji} />
                                </button>
                              ))}
                            </div>
                          ) : null}

                          <label htmlFor="chat-message-input" className="sr-only">
                            Chat message
                          </label>
                          <textarea
                            ref={chatInputRef}
                            id="chat-message-input"
                            name="chatMessage"
                            autoComplete="off"
                            value={chatDraft}
                            onChange={(e) => setChatDraft(e.target.value)}
                            onKeyDown={handleChatKeyDown}
                            placeholder="Type a message or drop an emoji 😄"
                            className="chat-input"
                            rows={3}
                            maxLength={500}
                          />
                          <div className="chat-compose-row">
                            <span className="chat-compose-hint">Enter sends, Shift+Enter adds a new line</span>
                            <div className="chat-compose-actions">
                              <button
                                type="button"
                                onClick={handleEmojiStripToggle}
                                className="chat-icon-button"
                                aria-label={isEmojiStripCollapsed ? 'Show emoji reactions' : 'Hide emoji reactions'}
                                title={isEmojiStripCollapsed ? 'Show emoji reactions' : 'Hide emoji reactions'}
                                aria-pressed={isEmojiStripOpen}
                              >
                                <SmilePlus size={16} />
                              </button>
                              <button
                                type="button"
                                onClick={() => chatImageInputRef.current?.click()}
                                className="chat-icon-button"
                                aria-label="Send image"
                                title="Send image"
                              >
                                <ImagePlus size={16} />
                              </button>
                              <input
                                ref={chatImageInputRef}
                                id="chat-image-input"
                                name="chatImage"
                                type="file"
                                accept="image/png,image/jpeg,image/gif,image/webp"
                                onChange={handleChatImageChange}
                                className="hidden"
                                aria-label="Upload chat image"
                              />
                              <button
                                type="button"
                                onClick={handleSendChatMessage}
                                className="primary-button"
                                disabled={!chatDraft.trim()}
                              >
                                <SendHorizontal size={16} />
                                <span>Send</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>

                <aside className={`sidebar-column flex flex-col gap-6 ${isTheaterMode ? 'sidebar-column-theater' : ''}`}>
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
                        <p className="block text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--text-muted)]">
                          Room code
                        </p>
                        <div className="mt-2 rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-quiet)] px-4 py-4 text-center font-mono text-lg font-semibold tracking-[0.08em] text-[var(--text-main)]">
                          {roomId}
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-3">
                          <button type="button" onClick={handleCopyRoomLink} className="secondary-button">
                            {roomLinkCopied ? <Check size={16} /> : <Copy size={16} />}
                            <span>{roomLinkCopied ? 'Copied Link' : 'Copy Room Link'}</span>
                          </button>
                          <span className="text-xs text-[var(--text-muted)]">
                            Anyone opening the link joins this room right away.
                          </span>
                        </div>
                      </div>

                      <div>
                        <p className="block text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--text-muted)]">
                          Room PIN
                        </p>
                        <div className="mt-2 rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-quiet)] px-4 py-4 text-center font-mono text-lg font-semibold tracking-[0.12em] text-[var(--text-main)]">
                          {roomPin}
                        </div>
                      </div>

                      <div>
                        <p className="block text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--text-muted)]">
                          Current video
                        </p>
                        <div className="mt-2 rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-quiet)] px-4 py-4 text-center text-sm font-medium text-[var(--text-main)]">
                          {videoLabel ?? 'No local file loaded'}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-3">
                          <label className="secondary-button cursor-pointer">
                            <Upload size={16} />
                            <span>{videoLabel ? 'Switch Video' : 'Add Video'}</span>
                            <input
                              id="upload-video-sidebar"
                              name="videoFileSidebar"
                              type="file"
                              accept="video/mp4,video/webm,video/x-matroska"
                              onChange={handleFileChange}
                              className="hidden"
                            />
                          </label>
                          {videoSrc ? (
                            <button type="button" onClick={clearVideoFile} className="secondary-button">
                              Remove
                            </button>
                          ) : null}
                        </div>
                      </div>

                      <div>
                        <label htmlFor="sidebar-display-name" className="block text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--text-muted)]">
                          Your name
                        </label>
                        <div className="mt-2 flex flex-col gap-3 sm:flex-row">
                          <input
                            id="sidebar-display-name"
                            name="displayNameSidebar"
                            type="text"
                            autoComplete="name"
                            value={displayName}
                            onChange={(e) => setDisplayName(e.target.value)}
                            placeholder="Choose a chat name"
                            className="input-shell flex-1 py-3 text-base"
                            maxLength={24}
                          />
                          <button type="button" onClick={handleSaveDisplayName} className="secondary-button">
                            Save
                          </button>
                        </div>
                      </div>

                      <div className="role-banner role-banner-shared">
                        <Users size={18} />
                        <span>Everyone in this room can control playback</span>
                      </div>

                      <div className="subtitle-card">
                        <div className="flex items-start gap-3">
                          <div className="subtitle-icon">
                            <FileText size={16} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--text-muted)]">
                              Subtitles
                            </p>
                            <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
                              Any viewer can add local `.vtt` or `.srt` subtitles for their own playback.
                            </p>
                            <p className="mt-3 truncate text-sm font-medium text-[var(--text-main)]">
                              {subtitleLabel ?? 'No subtitle file loaded'}
                            </p>
                          </div>
                        </div>

                        <div className="mt-4 flex flex-wrap gap-3">
                          <label className="secondary-button cursor-pointer">
                            <Upload size={16} />
                            <span>{subtitleLabel ? 'Replace Subs' : 'Add Subtitles'}</span>
                            <input
                              id="upload-subtitles"
                              name="subtitleFile"
                              type="file"
                              accept=".vtt,.srt,text/vtt,application/x-subrip"
                              onChange={handleSubtitleChange}
                              className="hidden"
                            />
                          </label>
                          {subtitleSrc ? (
                            <button type="button" onClick={clearSubtitleTrack} className="secondary-button">
                              Remove
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    <div className="mt-8 space-y-4 text-sm text-[var(--text-muted)]">
                      <div className="member-strip">
                        <div className="member-strip-header">
                          <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--text-muted)]">
                            In the room
                          </span>
                          <span className="text-sm font-medium text-[var(--text-main)]">{currentMemberName}</span>
                        </div>
                        <div className="member-chip-row">
                          {otherMembers.length > 0 ? (
                            otherMembers.map((member) => (
                              <span key={member.participantId} className="member-chip">
                                {member.displayName}
                              </span>
                            ))
                          ) : (
                            <span className="text-sm text-[var(--text-muted)]">Waiting for someone else to join.</span>
                          )}
                        </div>
                      </div>

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

      <footer className={`page-chrome mx-auto mt-auto w-full max-w-[1480px] px-6 pb-6 text-center text-sm text-[var(--text-muted)] sm:px-8 lg:px-12 ${isTheaterMode ? 'page-chrome-hidden' : ''}`}>
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

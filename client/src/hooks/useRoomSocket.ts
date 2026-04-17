import { useEffect, useRef, useState, useEffectEvent } from 'react';
import { io, Socket } from 'socket.io-client';
import { SyncController } from '../SyncController';

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

const ACTIVE_SHARE_LINK_STORAGE_KEY = 'letswatch-active-share-link';
const MAX_CHAT_IMAGE_FILE_SIZE = 2 * 1024 * 1024;
const MAX_CHAT_IMAGE_UPLOAD_BYTES = 850 * 1024;
const MAX_CHAT_IMAGE_DIMENSION = 1280;

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

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || getDefaultSocketUrl();

const getApproximateDataUrlSizeBytes = (dataUrl: string) => {
  const base64Payload = dataUrl.split(',')[1] ?? '';
  return Math.ceil((base64Payload.length * 3) / 4);
};

const persistShareLinkSession = (roomId: string, shareToken: string) => {
  globalThis.window?.sessionStorage.setItem(
    ACTIVE_SHARE_LINK_STORAGE_KEY,
    JSON.stringify({ roomId, shareToken }),
  );
};

const clearShareLinkSession = () => {
  globalThis.window?.sessionStorage.removeItem(ACTIVE_SHARE_LINK_STORAGE_KEY);
};

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }

      reject(new Error('Unable to read image'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read image'));
    reader.readAsDataURL(file);
  });

const loadImageElement = (dataUrl: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Unable to decode image'));
    image.src = dataUrl;
  });

const compressChatImage = async (file: File) => {
  if (file.type === 'image/gif') {
    const originalDataUrl = await readFileAsDataUrl(file);
    if (getApproximateDataUrlSizeBytes(originalDataUrl) > MAX_CHAT_IMAGE_UPLOAD_BYTES) {
      throw new Error('GIFs must stay under 850KB. Try a smaller GIF or a static image.');
    }
    return originalDataUrl;
  }

  const sourceDataUrl = await readFileAsDataUrl(file);
  const sourceImage = await loadImageElement(sourceDataUrl);
  const longestEdge = Math.max(sourceImage.naturalWidth, sourceImage.naturalHeight, 1);
  let scale = Math.min(1, MAX_CHAT_IMAGE_DIMENSION / longestEdge);
  let bestResult = sourceDataUrl;

  while (scale >= 0.4) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sourceImage.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceImage.naturalHeight * scale));

    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Unable to prepare image');
    }

    context.drawImage(sourceImage, 0, 0, canvas.width, canvas.height);

    for (const quality of [0.84, 0.74, 0.64, 0.54]) {
      const candidate = canvas.toDataURL('image/webp', quality);
      bestResult = candidate;

      if (getApproximateDataUrlSizeBytes(candidate) <= MAX_CHAT_IMAGE_UPLOAD_BYTES) {
        return candidate;
      }
    }

    scale *= 0.82;
  }

  if (getApproximateDataUrlSizeBytes(bestResult) > MAX_CHAT_IMAGE_UPLOAD_BYTES) {
    throw new Error('Image is still too large after compression. Try a smaller image.');
  }

  return bestResult;
};

interface UseRoomSocketOptions {
  roomId: string;
  setRoomId: React.Dispatch<React.SetStateAction<string>>;
  roomPin: string;
  setRoomPin: React.Dispatch<React.SetStateAction<string>>;
  displayName: string;
  joinMode: 'pin' | 'link' | null;
  setJoinMode: React.Dispatch<React.SetStateAction<'pin' | 'link' | null>>;
  sharedRoomId: string;
  setSharedRoomId: React.Dispatch<React.SetStateAction<string>>;
  shareToken: string;
  setShareToken: React.Dispatch<React.SetStateAction<string>>;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  syncController: SyncController;
  applyState: (state: SyncState) => void;
  clientLog: (level: 'info' | 'warn' | 'error', event: string, meta?: Record<string, unknown>) => void;
}

export function useRoomSocket(options: UseRoomSocketOptions) {
  const {
    roomId, setRoomId,
    roomPin, setRoomPin,
    displayName,
    joinMode, setJoinMode,
    sharedRoomId, setSharedRoomId,
    shareToken, setShareToken,
    videoRef,
    syncController,
    applyState,
    clientLog,
  } = options;

  const [isJoined, setIsJoined] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [participantsCount, setParticipantsCount] = useState(0);
  const [currentParticipantId, setCurrentParticipantId] = useState('');
  const [memberProfiles, setMemberProfiles] = useState<MemberProfile[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [isChatCollapsed, setIsChatCollapsed] = useState(false);
  const [chatDraft, setChatDraft] = useState('');
  const [isEmojiStripCollapsed, setIsEmojiStripCollapsed] = useState(true);
  const [drift, setDrift] = useState(0);

  const socketRef = useRef<Socket | null>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const chatImageInputRef = useRef<HTMLInputElement>(null);
  const latestRoomStateRef = useRef<SyncState | null>(null);
  const ignoreEvents = useRef({ play: false, pause: false, seek: false });

  const clearShareUrl = () => {
    const browserWindow = globalThis.window;
    if (!browserWindow) return;
    const url = new URL(browserWindow.location.href);
    url.searchParams.delete('room');
    url.searchParams.delete('token');
    browserWindow.history.replaceState({}, '', url.toString());
  };

  const updateShareUrl = (nextRoomId: string, nextShareToken?: string) => {
    const browserWindow = globalThis.window;
    if (!browserWindow) return;
    const url = new URL(browserWindow.location.href);
    url.searchParams.set('room', nextRoomId);
    if (nextShareToken) {
      url.searchParams.set('token', nextShareToken);
    } else {
      url.searchParams.delete('token');
    }
    browserWindow.history.replaceState({}, '', url.toString());
  };

  const applyAuthoritativeState = (state: SyncState) => {
    latestRoomStateRef.current = state;
    ignoreEvents.current = { play: true, pause: true, seek: true };
    applyState(state);
    setTimeout(() => {
      ignoreEvents.current = { play: false, pause: false, seek: false };
    }, 500);
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

  const resetJoinedRoomState = (clearSharedLink: boolean) => {
    setChatMessages([]);
    setIsJoined(false);
    setJoinMode(null);
    if (clearSharedLink && joinMode === 'link') {
      setSharedRoomId('');
      setShareToken('');
      clearShareLinkSession();
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

  const handleManualSync = () => {
    const socket = socketRef.current;
    if (!socket || !videoRef.current) return;
    socket.emit('force_sync_request', roomId, (response: SyncResponse) => {
      if (response?.success && response.state) {
        applyAuthoritativeState(response.state);
      }
    });
  };

  const joinRoomFromLink = useEffectEvent((targetRoomId: string) => {
    const socket = socketRef.current;
    if (!socket || !targetRoomId || !shareToken) return;

    const normalizedRoomId = targetRoomId.trim().toUpperCase();
    clientLog('info', 'room.link_join.requested', { roomId: normalizedRoomId });
    socket.emit('join_room_link', { roomId: normalizedRoomId, shareToken, displayName }, (response: SyncResponse) => {
      if (syncFromRoomResponse(response)) {
        const resolvedRoomId = (response.roomId ?? normalizedRoomId).toUpperCase();
        setChatMessages([]);
        setRoomId(resolvedRoomId);
        setRoomPin('');
        setJoinMode('link');
        setIsJoined(true);
        setSharedRoomId(resolvedRoomId);
        if (response.shareToken) {
          persistShareLinkSession(resolvedRoomId, response.shareToken);
        }
        updateShareUrl(resolvedRoomId);
        clientLog('info', 'room.link_join.succeeded', {
          roomId: resolvedRoomId,
          selfParticipantId: response.selfParticipantId,
        });
        return;
      }

      setSharedRoomId('');
      setShareToken('');
      clearShareLinkSession();
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
    // clientLog is a stable module-level function; omitting it is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isConnected || isJoined || !sharedRoomId || !shareToken) return;
    joinRoomFromLink(sharedRoomId);
  }, [isConnected, isJoined, shareToken, sharedRoomId]);

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
    // syncController and videoRef are stable references; omitting is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isJoined, roomId]);

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
        const resolvedRoomId = (response.roomId ?? normalizedRoomId).toUpperCase();
        setChatMessages([]);
        setRoomId(resolvedRoomId);
        setRoomPin(response.pin ?? normalizedPin);
        setJoinMode('pin');
        setSharedRoomId(resolvedRoomId);
        setIsJoined(true);
        clearShareLinkSession();
        updateShareUrl(resolvedRoomId);
        clientLog('info', 'room.create.succeeded', { roomId: resolvedRoomId, selfParticipantId: response.selfParticipantId });
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
        const resolvedRoomId = (response.roomId ?? normalizedRoomId).toUpperCase();
        setChatMessages([]);
        setRoomId(resolvedRoomId);
        setJoinMode('pin');
        setSharedRoomId(resolvedRoomId);
        setIsJoined(true);
        clearShareLinkSession();
        updateShareUrl(resolvedRoomId);
        clientLog('info', 'room.join.succeeded', { roomId: resolvedRoomId, selfParticipantId: response.selfParticipantId });
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
      socket.emit('sync_state', roomId, { position: videoRef.current.currentTime, playing: true });
    }
  };

  const handlePause = () => {
    const socket = socketRef.current;
    if (ignoreEvents.current.pause) {
      ignoreEvents.current.pause = false;
      return;
    }
    if (socket && isJoined && videoRef.current) {
      socket.emit('sync_state', roomId, { position: videoRef.current.currentTime, playing: false });
    }
  };

  const handleSeeked = () => {
    const socket = socketRef.current;
    if (ignoreEvents.current.seek) {
      ignoreEvents.current.seek = false;
      return;
    }
    if (socket && isJoined && videoRef.current) {
      socket.emit('sync_state', roomId, { position: videoRef.current.currentTime, playing: !videoRef.current.paused });
    }
  };

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

    const currentDraft = chatDraft;
    const selectionStart = draftInput.selectionStart ?? currentDraft.length;
    const selectionEnd = draftInput.selectionEnd ?? currentDraft.length;

    const safeStart = Math.min(selectionStart, currentDraft.length);
    const safeEnd = Math.min(selectionEnd, currentDraft.length);
    
    setChatDraft(`${currentDraft.slice(0, safeStart)}${emoji}${currentDraft.slice(safeEnd)}`);

    setTimeout(() => {
      draftInput.focus();
      const nextPosition = safeStart + emoji.length;
      draftInput.setSelectionRange(nextPosition, nextPosition);
    }, 0);
  };

  const handleEmojiStripToggle = () => {
    setIsEmojiStripCollapsed((v) => !v);
  };

  const handleChatImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const socket = socketRef.current;
    if (!file || !socket || !isJoined) return;

    if (file.size > MAX_CHAT_IMAGE_FILE_SIZE) {
      alert('Image is too large. Must be under 2MB.');
      e.target.value = '';
      return;
    }

    compressChatImage(file)
      .then((dataUrl) => {
      socket.emit('send_chat_message', roomId, { type: 'image', imageDataUrl: dataUrl }, (response: SyncResponse) => {
        if (!response.success) {
          clientLog('warn', 'chat.image_failed', { roomId, error: response.error });
          alert(response.error || 'Unable to send image');
          return;
        }
        clientLog('info', 'chat.image_sent', {
          roomId,
          approxBytes: getApproximateDataUrlSizeBytes(dataUrl),
        });
      });
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Unable to prepare image';
        clientLog('warn', 'chat.image_prepare_failed', { roomId, error: message });
        alert(message);
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
    setIsChatCollapsed((v) => {
      if (v) setUnreadMessages(0);
      return !v;
    });
  };

  return {
    isJoined,
    isConnected,
    participantsCount,
    currentParticipantId,
    memberProfiles,
    chatMessages,
    unreadMessages,
    setUnreadMessages,
    isChatCollapsed,
    setIsChatCollapsed,
    chatDraft, setChatDraft,
    isEmojiStripCollapsed, setIsEmojiStripCollapsed,
    drift,
    setDrift,
    socketRef,
    chatInputRef,
    chatImageInputRef,
    latestRoomStateRef,
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
  };
}

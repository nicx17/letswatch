import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { z } from 'zod';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const LOG_NAMESPACE = 'server';

type LogLevel = 'info' | 'warn' | 'error';

const writeLog = (level: LogLevel, event: string, meta?: Record<string, unknown>) => {
  const entry = {
    ts: new Date().toISOString(),
    ns: LOG_NAMESPACE,
    level,
    event,
    ...(meta ? { meta } : {}),
  };

  const output = JSON.stringify(entry);
  if (level === 'error') {
    console.error(output);
    return;
  }

  if (level === 'warn') {
    console.warn(output);
    return;
  }

  console.log(output);
};

// Compress static assets and JSON responses before they leave the server.
app.use(compression());

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://static.cloudflareinsights.com"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      connectSrc: ["'self'", "ws:", "wss:", "https://cloudflareinsights.com"],
      mediaSrc: ["'self'", "blob:"],
      requireTrustedTypesFor: ["'script'"],
      upgradeInsecureRequests: null,
    },
  }
}));

const isProduction = process.env.NODE_ENV === 'production';

const getProductionOrigin = () => {
  if (!isProduction) return null;

  const appUrl = process.env.APP_URL?.trim();
  if (!appUrl) {
    throw new Error('APP_URL must be set when NODE_ENV=production');
  }

  return new URL(appUrl).origin;
};

const productionOrigin = getProductionOrigin();
const corsOrigin = productionOrigin ? [productionOrigin] : '*';
const productionHost = productionOrigin ? new URL(productionOrigin).host : null;

app.use(cors({
  origin: corsOrigin,
  methods: ['GET', 'POST']
}));

const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: corsOrigin,
    methods: ['GET', 'POST'],
  },
  // Chat image messages travel over Socket.IO as data URLs, so allow a little
  // extra room above the default buffer while still keeping payloads bounded.
  maxHttpBufferSize: 2_000_000,
  allowRequest: (req, callback) => {
    if (!productionOrigin) {
      callback(null, true);
      return;
    }

    const requestOrigin = req.headers.origin;
    if (requestOrigin) {
      callback(null, requestOrigin === productionOrigin);
      return;
    }

    // Same-origin polling requests may omit the Origin header. Fall back to the
    // forwarded/public host so production deployments still connect cleanly.
    const forwardedHostHeader = req.headers['x-forwarded-host'];
    const requestHost = Array.isArray(forwardedHostHeader)
      ? forwardedHostHeader[0]
      : forwardedHostHeader || req.headers.host;

    callback(null, requestHost === productionHost);
  },
});

interface SyncSession {
  id: string;          
  pinHash: string;
  pinSalt: string;
  shareTokenHash: string;
  fileHash?: string;    
  state: SyncState;
  participants: string[];
  memberProfiles: RoomMember[];
}

interface SyncState {
  position: number;
  playing: boolean;
  updatedAt: number;
}

interface RoomMember {
  participantId: string;
  socketId: string;
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

interface RoomOperationSuccess extends Record<string, unknown> {
  success: true;
}

interface RoomOperationFailure {
  success: false;
  error: string;
}

type RoomOperationResult<T extends Record<string, unknown>> = (T & RoomOperationSuccess) | RoomOperationFailure;

export const rooms = new Map<string, SyncSession>();

// Keep a lightweight per-socket budget to avoid noisy clients spamming room events.
const rateLimits = new Map<string, { count: number, resetAt: number }>();
const consumeRateLimit = (key: string, limit: number, windowMs: number) => {
  const now = Date.now();
  let record = rateLimits.get(key);
  if (!record || record.resetAt < now) {
    record = { count: 0, resetAt: now + windowMs };
    rateLimits.set(key, record);
  }
  record.count++;
  return record.count > limit;
};
export const isRateLimited = (socketId: string) => consumeRateLimit(socketId, 15, 2000);
const isImageRateLimited = (socketId: string) => consumeRateLimit(`${socketId}:image`, 3, 30000);

export const SeekSchema = z.object({
  position: z.number().nonnegative(),
  playing: z.boolean(),
});

const JoinRoomSchema = z.object({
  roomId: z.string().trim().min(1).max(36),
  pin: z.string().trim().regex(/^\d{6}$/),
  displayName: z.string().trim().max(24).optional(),
});

const LinkJoinRoomSchema = z.object({
  roomId: z.string().trim().min(1).max(36),
  shareToken: z.string().trim().min(12).max(128),
  displayName: z.string().trim().max(24).optional(),
});

const CreateRoomSchema = z.object({
  roomId: z.string().trim().min(1).max(36),
  pin: z.string().trim().regex(/^\d{6}$/),
  displayName: z.string().trim().max(24).optional(),
});

const DisplayNameSchema = z.string().trim().min(1).max(24);
const TextChatPayloadSchema = z.object({
  type: z.literal('text'),
  text: z.string().trim().min(1).max(500),
});

const ImageChatPayloadSchema = z.object({
  type: z.literal('image'),
  imageDataUrl: z
    .string()
    .trim()
    .regex(/^data:image\/(?:png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/=]+$/)
    .max(1_800_000),
});

const ChatPayloadSchema = z.union([TextChatPayloadSchema, ImageChatPayloadSchema]);

const normalizeRoomId = (roomId: string) => roomId.trim().toUpperCase();
const normalizePin = (pin: string) => pin.trim();

const isRoomParticipant = (room: SyncSession, socketId: string) => {
  return room.participants.includes(socketId);
};

const buildParticipantProfiles = (room: SyncSession) =>
  room.memberProfiles.map(({ participantId, displayName }) => ({
    participantId,
    displayName,
  }));

const buildDisplayName = (requestedName: string | undefined, socketId: string) => {
  const parsedName = DisplayNameSchema.safeParse(requestedName);
  if (parsedName.success) {
    return parsedName.data;
  }

  return `Viewer ${socketId.slice(0, 4)}`;
};

const createPinHash = (pin: string, salt: string) =>
  createHash('sha256').update(`${salt}:${pin}`).digest('hex');

const hashShareToken = (shareToken: string) =>
  createHash('sha256').update(`share:${shareToken}`).digest('hex');

const verifyPin = (room: SyncSession, pin: string) => {
  const expectedHash = Buffer.from(room.pinHash, 'hex');
  const providedHash = Buffer.from(createPinHash(pin, room.pinSalt), 'hex');
  return expectedHash.length === providedHash.length && timingSafeEqual(expectedHash, providedHash);
};

const verifyShareToken = (room: SyncSession, shareToken: string) => {
  const expectedHash = Buffer.from(room.shareTokenHash, 'hex');
  const providedHash = Buffer.from(hashShareToken(shareToken), 'hex');
  return expectedHash.length === providedHash.length && timingSafeEqual(expectedHash, providedHash);
};

const createParticipantId = () => randomBytes(6).toString('base64url');
const createShareToken = () => randomBytes(18).toString('base64url');

const emitRoomPeople = (roomId: string, room: SyncSession) => {
  io.to(roomId).emit('participants_updated', room.memberProfiles.map((member) => member.participantId));
  io.to(roomId).emit('member_profiles_updated', buildParticipantProfiles(room));
};

const getRoomMember = (room: SyncSession, socketId: string) =>
  room.memberProfiles.find((member) => member.socketId === socketId);

const attachSocketToRoom = (
  room: SyncSession,
  socketId: string,
  displayName: string | undefined,
) => {
  const resolvedDisplayName = buildDisplayName(displayName, socketId);
  if (room.participants.length >= 20 && !isRoomParticipant(room, socketId)) {
    return { success: false as const, error: 'Room is full' };
  }

  if (!isRoomParticipant(room, socketId)) {
    room.participants.push(socketId);
  }

  const existingMember = getRoomMember(room, socketId);
  if (existingMember) {
    existingMember.displayName = resolvedDisplayName;
  } else {
    room.memberProfiles.push({
      participantId: createParticipantId(),
      socketId,
      displayName: resolvedDisplayName,
    });
  }

  return {
    success: true as const,
    room,
    currentMember: getRoomMember(room, socketId),
  };
};

export const resetRuntimeState = () => {
  rooms.clear();
  rateLimits.clear();
};

export const createRoomForSocket = (
  socketId: string,
  payload?: { roomId: string; pin: string; displayName?: string },
): RoomOperationResult<{
  roomId: string;
  pin: string;
  shareToken: string;
  state: SyncState;
  participants: string[];
  memberProfiles: Array<{ participantId: string; displayName: string }>;
  selfParticipantId: string;
}> => {
  const parsedPayload = CreateRoomSchema.safeParse(payload ?? {});
  if (!parsedPayload.success) {
    return { success: false, error: 'Invalid room code, PIN, or display name' };
  }

  const roomId = normalizeRoomId(parsedPayload.data.roomId);
  if (rooms.has(roomId)) {
    return { success: false, error: 'Room code is already in use' };
  }

  const pin = normalizePin(parsedPayload.data.pin);
  const shareToken = createShareToken();
  const pinSalt = randomBytes(16).toString('hex');
  const participantId = createParticipantId();
  const room: SyncSession = {
    id: roomId,
    pinHash: createPinHash(pin, pinSalt),
    pinSalt,
    shareTokenHash: hashShareToken(shareToken),
    state: {
      position: 0,
      playing: false,
      updatedAt: Date.now(),
    },
    participants: [socketId],
    memberProfiles: [{
      participantId,
      socketId,
      displayName: buildDisplayName(parsedPayload.data.displayName, socketId),
    }],
  };

  rooms.set(roomId, room);

  return {
    success: true,
    roomId,
    pin,
    shareToken,
    state: room.state,
    participants: [participantId],
    memberProfiles: buildParticipantProfiles(room),
    selfParticipantId: participantId,
  };
};

export const joinRoomForSocket = (
  socketId: string,
  payload: { roomId: string; pin: string; displayName?: string },
): RoomOperationResult<{
  roomId: string;
  shareToken: string;
  state: SyncState;
  participants: string[];
  memberProfiles: Array<{ participantId: string; displayName: string }>;
  selfParticipantId?: string;
}> => {
  const parsedPayload = JoinRoomSchema.safeParse(payload);
  if (!parsedPayload.success) {
    return { success: false, error: 'Invalid room credentials' };
  }

  const roomId = normalizeRoomId(parsedPayload.data.roomId);
  const pin = normalizePin(parsedPayload.data.pin);
  const { displayName } = parsedPayload.data;
  const room = rooms.get(roomId);
  if (!room || !verifyPin(room, pin)) {
    return { success: false, error: 'Room not found or PIN is incorrect' };
  }

  const attachResult = attachSocketToRoom(room, socketId, displayName);
  if (!attachResult.success) {
    return { success: false, error: attachResult.error };
  }

  const shareToken = createShareToken();
  room.shareTokenHash = hashShareToken(shareToken);

  return {
    success: true,
    roomId,
    shareToken,
    state: room.state,
    participants: room.memberProfiles.map((member) => member.participantId),
    memberProfiles: buildParticipantProfiles(room),
    ...(attachResult.currentMember ? { selfParticipantId: attachResult.currentMember.participantId } : {}),
  };
};

export const joinRoomByLinkForSocket = (
  socketId: string,
  payload: { roomId: string; shareToken: string; displayName?: string },
): RoomOperationResult<{
  roomId: string;
  shareToken: string;
  state: SyncState;
  participants: string[];
  memberProfiles: Array<{ participantId: string; displayName: string }>;
  selfParticipantId?: string;
}> => {
  const parsedPayload = LinkJoinRoomSchema.safeParse(payload);
  if (!parsedPayload.success) {
    return { success: false, error: 'Invalid room link' };
  }

  const roomId = normalizeRoomId(parsedPayload.data.roomId);
  const shareToken = parsedPayload.data.shareToken.trim();
  const room = rooms.get(roomId);
  if (!room) {
    return { success: false, error: 'Room not found' };
  }
  if (!verifyShareToken(room, shareToken)) {
    return { success: false, error: 'Share link is invalid or expired' };
  }

  const attachResult = attachSocketToRoom(room, socketId, parsedPayload.data.displayName);
  if (!attachResult.success) {
    return { success: false, error: attachResult.error };
  }

  return {
    success: true,
    roomId,
    shareToken,
    state: room.state,
    participants: room.memberProfiles.map((member) => member.participantId),
    memberProfiles: buildParticipantProfiles(room),
    ...(attachResult.currentMember ? { selfParticipantId: attachResult.currentMember.participantId } : {}),
  };
};

export const applySyncStateForSocket = (
  socketId: string,
  roomId: string,
  update: { position: number; playing: boolean },
) => {
  if (isRateLimited(socketId)) {
    return { success: false as const, error: 'Rate limited' };
  }

  const room = rooms.get(roomId);
  if (!room) {
    return { success: false as const, error: 'Room not found' };
  }
  if (!isRoomParticipant(room, socketId)) {
    return { success: false as const, error: 'Not a room participant' };
  }

  const result = SeekSchema.safeParse(update);
  if (!result.success) {
    return { success: false as const, error: 'Invalid sync payload' };
  }

  room.state.position = update.position;
  room.state.playing = update.playing;
  room.state.updatedAt = Date.now();

  return { success: true as const, state: room.state };
};

export const requestSyncStateForSocket = (socketId: string, roomId: string) => {
  if (isRateLimited(socketId)) {
    return { success: false as const, error: 'Rate limited' };
  }
  const room = rooms.get(roomId);
  if (!room || !isRoomParticipant(room, socketId)) {
    return { success: false as const, error: 'Room not found' };
  }

  return { success: true as const, state: room.state };
};

export const setDisplayNameForSocket = (
  socketId: string,
  roomId: string,
  nextDisplayName: string,
): RoomOperationResult<{
  memberProfiles: Array<{ participantId: string; displayName: string }>;
}> => {
  if (isRateLimited(socketId)) {
    return { success: false, error: 'Rate limited' };
  }

  const room = rooms.get(roomId);
  if (!room || !isRoomParticipant(room, socketId)) {
    return { success: false, error: 'Room not found' };
  }

  const parsedName = DisplayNameSchema.safeParse(nextDisplayName);
  if (!parsedName.success) {
    return { success: false, error: 'Enter a name between 1 and 24 characters' };
  }

  const member = getRoomMember(room, socketId);
  if (!member) {
    return { success: false, error: 'Member not found' };
  }

  member.displayName = parsedName.data;
  return { success: true, memberProfiles: buildParticipantProfiles(room) };
};

export const sendChatMessageForSocket = (
  socketId: string,
  roomId: string,
  payload: unknown,
): RoomOperationResult<{
  message: ChatMessage;
}> => {
  if (isRateLimited(socketId)) {
    return { success: false, error: 'Rate limited' };
  }

  const room = rooms.get(roomId);
  if (!room || !isRoomParticipant(room, socketId)) {
    return { success: false, error: 'Room not found' };
  }

  const parsedMessage = ChatPayloadSchema.safeParse(payload);
  if (!parsedMessage.success) {
    return { success: false, error: 'Chat payload is invalid or too large' };
  }

  const member = getRoomMember(room, socketId);
  if (!member) {
    return { success: false, error: 'Member not found' };
  }

  if (parsedMessage.data.type === 'image' && isImageRateLimited(socketId)) {
    return { success: false, error: 'You are sending images too quickly' };
  }

  const message: ChatMessage = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    participantId: member.participantId,
    displayName: member.displayName,
    ...parsedMessage.data,
    sentAt: Date.now(),
  };

  return { success: true, message };
};

export const disconnectSocket = (socketId: string) => {
  rateLimits.delete(socketId);
  const updatedRoomIds: string[] = [];
  const deletedRoomIds: string[] = [];

  rooms.forEach((room, roomId) => {
    const hadMember = room.participants.includes(socketId);
    if (!hadMember) return;

    room.participants = room.participants.filter((id) => id !== socketId);
    room.memberProfiles = room.memberProfiles.filter((member) => member.socketId !== socketId);
    if (room.participants.length === 0) {
      rooms.delete(roomId);
      deletedRoomIds.push(roomId);
      return;
    }

    updatedRoomIds.push(roomId);
  });

  return { updatedRoomIds, deletedRoomIds };
};

io.on('connection', (socket) => {
  writeLog('info', 'socket.connected', { socketId: socket.id });

  socket.on('create_room', (payload: { roomId: string; pin: string; displayName?: string } | undefined, cb) => {
    const response = createRoomForSocket(socket.id, payload);
    if (!response.success) {
      writeLog('warn', 'room.create.rejected', {
        socketId: socket.id,
        reason: response.error,
      });
      return cb(response);
    }
    writeLog('info', 'room.created', {
      roomId: response.roomId,
      socketId: socket.id,
      participantId: response.selfParticipantId,
    });
    socket.join(response.roomId);
    cb(response);
    const room = rooms.get(response.roomId);
    if (room) {
      emitRoomPeople(response.roomId, room);
    }
  });

  socket.on('join_room', (payload: { roomId: string; pin: string; displayName?: string }, cb) => {
    const response = joinRoomForSocket(socket.id, payload);
    if (!response.success) {
      const room = rooms.get(payload.roomId);
      writeLog('warn', 'room.join.denied', {
        socketId: socket.id,
        roomId: payload.roomId,
        reason: room ? 'bad_pin_or_invalid' : 'missing_room',
      });
      return cb(response);
    }

    const room = rooms.get(response.roomId);
    socket.join(response.roomId);

    if (!room) {
      writeLog('warn', 'room.join.denied', {
        socketId: socket.id,
        roomId: payload.roomId,
        reason: 'missing_room_post_join',
      });
      return cb({ success: false, error: 'Room not found' });
    }
    const currentMember = getRoomMember(room, socket.id);
    writeLog('info', 'room.joined', {
      roomId: response.roomId,
      socketId: socket.id,
      participantId: currentMember?.participantId,
      participants: room.memberProfiles.length,
    });
    cb(response);
    emitRoomPeople(response.roomId, room);
  });

  socket.on('join_room_link', (payload: { roomId: string; shareToken: string; displayName?: string }, cb) => {
    const response = joinRoomByLinkForSocket(socket.id, payload);
    if (!response.success) {
      writeLog('warn', 'room.link_join.denied', {
        socketId: socket.id,
        roomId: payload?.roomId,
        reason: response.error,
      });
      return cb(response);
    }

    const room = rooms.get(response.roomId);
    socket.join(response.roomId);

    if (!room) {
      writeLog('warn', 'room.link_join.denied', {
        socketId: socket.id,
        roomId: payload?.roomId,
        reason: 'missing_room_post_join',
      });
      return cb({ success: false, error: 'Room not found' });
    }

    const currentMember = getRoomMember(room, socket.id);
    writeLog('info', 'room.link_joined', {
      roomId: response.roomId,
      socketId: socket.id,
      participantId: currentMember?.participantId,
      participants: room.memberProfiles.length,
    });
    cb(response);
    emitRoomPeople(response.roomId, room);
  });

  socket.on('sync_state', (roomId: string, update: { position: number; playing: boolean }) => {
    const result = applySyncStateForSocket(socket.id, roomId, update);
    if (!result.success) {
      writeLog('warn', 'sync.rejected', { socketId: socket.id, roomId, reason: result.error });
      return;
    }

    socket.to(roomId).emit('state_updated', result.state);
  });

  socket.on('force_sync_request', (roomId: string, cb) => {
    const result = requestSyncStateForSocket(socket.id, roomId);
    if (!result.success) {
      writeLog('warn', 'sync_request.rejected', {
        socketId: socket.id,
        roomId,
        reason: result.error,
      });
      return;
    }
    cb({ state: result.state });
  });

  socket.on('set_display_name', (roomId: string, nextDisplayName: string, cb) => {
    const result = setDisplayNameForSocket(socket.id, roomId, nextDisplayName);
    if (!result.success) {
      writeLog('warn', 'profile.update.rejected', {
        socketId: socket.id,
        roomId,
        reason: result.error,
      });
      cb?.(result);
      return;
    }

    const room = rooms.get(roomId);
    const member = room ? getRoomMember(room, socket.id) : undefined;
    if (room) {
      emitRoomPeople(roomId, room);
    }
    writeLog('info', 'profile.updated', {
      roomId,
      socketId: socket.id,
      participantId: member?.participantId,
    });
    cb?.(result);
  });

  socket.on('send_chat_message', (roomId: string, payload: unknown, cb) => {
    const result = sendChatMessageForSocket(socket.id, roomId, payload);
    if (!result.success) {
      writeLog('warn', 'chat.rejected', {
        socketId: socket.id,
        roomId,
        reason: result.error,
      });
      cb?.(result);
      return;
    }

    io.to(roomId).emit('chat_message', result.message);
    writeLog('info', 'chat.sent', {
      roomId,
      participantId: result.message.participantId,
      type: result.message.type,
      textLength: result.message.type === 'text' ? result.message.text?.length : undefined,
      imageSize: result.message.type === 'image' ? result.message.imageDataUrl?.length : undefined,
    });
    cb?.(result);
  });

  socket.on('disconnect', () => {
    const { updatedRoomIds, deletedRoomIds } = disconnectSocket(socket.id);
    deletedRoomIds.forEach((roomId) => {
      writeLog('info', 'room.deleted', { roomId, reason: 'empty_room' });
    });
    updatedRoomIds.forEach((roomId) => {
      const room = rooms.get(roomId);
      if (room) {
        emitRoomPeople(roomId, room);
      }
    });
    writeLog('info', 'socket.disconnected', { socketId: socket.id });
  });
});

// Serve frontend in production
if (process.env.NODE_ENV === 'production') {
  // `tsx` executes from `server/src`, so resolve the built frontend from the repo root.
  const clientBuildPath = path.resolve(__dirname, '../../client/dist');
  
  // Vite fingerprints asset filenames, so they can be cached aggressively.
  app.use('/assets', express.static(path.resolve(clientBuildPath, 'assets'), {
    maxAge: '1y',
    immutable: true,
  }));
  
  // HTML and unversioned public assets keep a shorter cache window.
  app.use(express.static(clientBuildPath, { maxAge: '1h' }));

  app.get(/.*/, (req, res) => {
    // Always serve a fresh shell so clients receive the latest asset manifest.
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.sendFile(path.resolve(clientBuildPath, 'index.html'));
  });
}

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;
if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, '0.0.0.0', () => {
    writeLog('info', 'server.started', {
      port: PORT,
      nodeEnv: process.env.NODE_ENV ?? 'development',
      origin: productionOrigin ?? 'development-open',
    });
  });
}

export { app, server, io };

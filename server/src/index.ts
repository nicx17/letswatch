import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import { createServer, IncomingMessage, type IncomingHttpHeaders } from 'node:http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const LOG_NAMESPACE = 'server';
const isProduction = process.env.NODE_ENV === 'production';
const trustProxy = process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true';
const productionOrigin = (() => {
  if (!isProduction) return null;

  const appUrl = process.env.APP_URL?.trim();
  if (!appUrl) {
    throw new Error('APP_URL must be set when NODE_ENV=production');
  }

  return new URL(appUrl).origin;
})();
const productionHost = productionOrigin ? new URL(productionOrigin).host : null;
const productionSocketOrigin = productionOrigin
  ? productionOrigin.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')
  : null;
const cspConnectSrc = [
  "'self'",
  ...(productionSocketOrigin ? [productionSocketOrigin] : []),
  'https://cloudflareinsights.com',
  'https://static.cloudflareinsights.com',
];
const cspImageSrc = [
  "'self'",
  'data:',
  'blob:',
  'https://twemoji.maxcdn.com',
];

if (trustProxy) {
  app.set('trust proxy', true);
}

type LogLevel = 'info' | 'warn' | 'error';

const SENSITIVE_LOG_KEYS = new Set([
  'socketid',
  'participantid',
  'selfparticipantid',
  'roomid',
  'roomcode',
  'pin',
  'pinsalt',
  'token',
  'sharetoken',
  'sharetokenhash',
  'pinhash',
  'displayname',
  'origin',
  'host',
]);

const isSensitiveLogKey = (key: string) => {
  const normalized = key.toLowerCase();
  if (SENSITIVE_LOG_KEYS.has(normalized)) {
    return true;
  }

  return /(token|pin|socket|participant|display.?name|origin|host|roomid|roomcode|hash)/i.test(key);
};

const obfuscateLogString = (value: string) => {
  const digest = createHash('sha256').update(value).digest('hex').slice(0, 10);
  return `redacted:${digest}`;
};

const sanitizeLogValue = (value: unknown, key?: string): unknown => {
  if (typeof value === 'string') {
    if (key && isSensitiveLogKey(key)) {
      return obfuscateLogString(value);
    }

    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean' || value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeLogValue(entry, key));
  }

  if (typeof value === 'object') {
    const sanitizedEntries = Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
      entryKey,
      sanitizeLogValue(entryValue, entryKey),
    ]);
    return Object.fromEntries(sanitizedEntries);
  }

  return `[unsupported:${typeof value}]`;
};

const writeLog = (level: LogLevel, event: string, meta?: Record<string, unknown>) => {
  const sanitizedMeta = meta ? sanitizeLogValue(meta) as Record<string, unknown> : undefined;
  const entry = {
    ts: new Date().toISOString(),
    ns: LOG_NAMESPACE,
    level,
    event,
    ...(sanitizedMeta ? { meta: sanitizedMeta } : {}),
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

app.use((_req, res, next) => {
  res.locals.cspNonce = randomBytes(16).toString('base64');
  next();
});

app.use(helmet({
  hsts: isProduction
    ? {
        maxAge: 63072000,
        includeSubDomains: true,
        preload: true,
      }
    : false,
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "script-src": [
        "'self'",
        "'strict-dynamic'",
        (_req, res) => `'nonce-${String((res as Response).locals.cspNonce ?? '')}'`,
        'https://static.cloudflareinsights.com',
        "'sha256-xEpMjc29DxPGet3wD8QBTFXJ4vGx60/Y07K8AohTM/M='",
        "'sha256-7/wUdeTePWyHkMlev6uiodRq0R9yxOUkCYi4Vu7T7nw='",
      ],
      "script-src-attr": ["'none'"],
      "style-src": ["'self'", "'unsafe-inline'"],
      "font-src": ["'self'", 'data:'],
      "img-src": cspImageSrc,
      "connect-src": cspConnectSrc,
      "media-src": ["'self'", 'blob:'],
      "object-src": ["'none'"],
      "base-uri": ["'self'"],
      "frame-ancestors": ["'none'"],
      "form-action": ["'self'"],
      "manifest-src": ["'self'"],
      "worker-src": ["'self'", 'blob:'],
      "report-uri": ['/csp-violation-report'],
      "trusted-types": ['default'],
      "require-trusted-types-for": ["'script'"],
      "upgrade-insecure-requests": isProduction ? [] : null,
    },
  },
}));

type CspViolationReport = {
  'document-uri'?: string;
  disposition?: string;
  'effective-directive'?: string;
  'violated-directive'?: string;
  'blocked-uri'?: string;
  'source-file'?: string;
  'line-number'?: number;
  'column-number'?: number;
};

const extractCspViolationReport = (body: unknown): CspViolationReport | null => {
  if (!body || typeof body !== 'object') {
    return null;
  }

  const asRecord = body as Record<string, unknown>;

  if ('csp-report' in asRecord && typeof asRecord['csp-report'] === 'object') {
    return asRecord['csp-report'] as CspViolationReport;
  }

  if (Array.isArray(body) && body.length > 0) {
    const first = body[0];
    if (first && typeof first === 'object') {
      const firstRecord = first as Record<string, unknown>;
      if ('body' in firstRecord && typeof firstRecord.body === 'object') {
        return firstRecord.body as CspViolationReport;
      }
    }
  }

  return null;
};

app.post(
  '/csp-violation-report',
  express.json({ type: ['application/csp-report', 'application/reports+json', 'application/json'] }),
  (req, res) => {
    const report = extractCspViolationReport(req.body);
    if (report) {
      writeLog('warn', 'csp.report_only_violation', {
        disposition: report.disposition,
        effectiveDirective: report['effective-directive'],
        violatedDirective: report['violated-directive'],
        blockedUri: report['blocked-uri'],
        sourceFile: report['source-file'],
        lineNumber: report['line-number'],
        columnNumber: report['column-number'],
        documentUri: report['document-uri'],
        userAgent: req.headers['user-agent'],
      });
    }

    res.status(204).end();
  },
);

const isPrivateIpv4Host = (hostname: string) => {
  const octets = hostname.split('.');
  if (octets.length !== 4) return false;

  const numbers = octets.map((segment) => Number.parseInt(segment, 10));
  if (numbers.some((value) => Number.isNaN(value) || value < 0 || value > 255)) {
    return false;
  }

  const first = numbers[0] ?? -1;
  const second = numbers[1] ?? -1;
  if (first === 10 || first === 127) return true;
  if (first === 192 && second === 168) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 169 && second === 254) return true;
  return false;
};

const isAllowedDevelopmentOrigin = (origin: string) => {
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }

    return (
      parsed.hostname === 'localhost' ||
      parsed.hostname === '::1' ||
      parsed.hostname === '[::1]' ||
      isPrivateIpv4Host(parsed.hostname)
    );
  } catch {
    return false;
  }
};

const isAllowedCorsOrigin = (origin: string | undefined) => {
  if (!origin) {
    return true;
  }

  if (productionOrigin) {
    return origin === productionOrigin;
  }

  return isAllowedDevelopmentOrigin(origin);
};

const corsOrigin = (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
  callback(null, isAllowedCorsOrigin(origin));
};

app.use(cors({
  origin: corsOrigin,
  methods: ['GET', 'POST']
}));

const server = createServer(app);

const getSingleHeaderValue = (header: string | string[] | undefined) => {
  if (Array.isArray(header)) {
    return header[0];
  }

  return header;
};

const getSocketAck = <T extends unknown[]>(ack: unknown) => {
  return typeof ack === 'function' ? ack as (...args: T) => void : undefined;
};

const getForwardedClientAddress = (headers: IncomingHttpHeaders | undefined) => {
  if (!trustProxy) return undefined;

  const forwardedFor = getSingleHeaderValue(headers?.['x-forwarded-for']);
  if (!forwardedFor) return undefined;

  const firstForwardedAddress = forwardedFor.split(',')[0]?.trim();
  return firstForwardedAddress || undefined;
};

const getSocketClientIdentity = (socket: { handshake: { address: string; headers: IncomingHttpHeaders } }) =>
  getForwardedClientAddress(socket.handshake.headers) ||
  socket.handshake.address ||
  'unknown-client';

const getRequestClientIdentity = (req: Request) =>
  getForwardedClientAddress(req.headers) ||
  req.socket.remoteAddress ||
  'unknown-client';

const getProductionRequestHost = (req: IncomingMessage) =>
  getSingleHeaderValue(req.headers.host);

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

    // Same-origin polling requests may omit the Origin header. Only trust the
    // effective Host header here; proxy-only forwarded headers are not a safe
    // authentication signal once traffic reaches the app.
    const requestHost = getProductionRequestHost(req);
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
const socketOwnedRateLimitKeys = new Map<string, Set<string>>();
const pruneExpiredRateLimits = (now: number) => {
  for (const [key, record] of rateLimits.entries()) {
    if (record.resetAt < now) {
      rateLimits.delete(key);
    }
  }

  for (const [socketId, keys] of socketOwnedRateLimitKeys.entries()) {
    const activeKeys = [...keys].filter((key) => rateLimits.has(key));
    if (activeKeys.length === 0) {
      socketOwnedRateLimitKeys.delete(socketId);
      continue;
    }

    socketOwnedRateLimitKeys.set(socketId, new Set(activeKeys));
  }
};

const registerSocketOwnedRateLimitKey = (socketId: string, key: string) => {
  const existingKeys = socketOwnedRateLimitKeys.get(socketId) ?? new Set<string>();
  existingKeys.add(key);
  socketOwnedRateLimitKeys.set(socketId, existingKeys);
};

const consumeRateLimit = (
  key: string,
  limit: number,
  windowMs: number,
  ownerSocketId?: string,
) => {
  const now = Date.now();
  pruneExpiredRateLimits(now);
  let record = rateLimits.get(key);
  if (!record || record.resetAt < now) {
    record = { count: 0, resetAt: now + windowMs };
    rateLimits.set(key, record);
  }
  record.count++;
  if (ownerSocketId) {
    registerSocketOwnedRateLimitKey(ownerSocketId, key);
  }
  return record.count > limit;
};
export const isRateLimited = (socketId: string) => consumeRateLimit(socketId, 15, 2000, socketId);
const buildAuthRateLimitKey = (clientIdentity: string, roomScope: string) => `auth:${clientIdentity}:${roomScope}`;
const isAuthRateLimited = (clientIdentity: string, roomScope: string) =>
  consumeRateLimit(buildAuthRateLimitKey(clientIdentity, roomScope), 8, 10_000);
const isImageRateLimited = (socketId: string) => consumeRateLimit(`${socketId}:image`, 3, 30000, socketId);
const isHttpRequestRateLimited = (clientIdentity: string, scope: string) =>
  consumeRateLimit(`http:${scope}:${clientIdentity}`, 120, 60_000);

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
    .max(900_000),
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

const PIN_HASH_VERSION = 'scrypt:v1';
const PIN_SCRYPT_COST = 1 << 14;
const PIN_SCRYPT_BLOCK_SIZE = 8;
const PIN_SCRYPT_PARALLELIZATION = 1;
const PIN_SCRYPT_KEY_LENGTH = 64;

const createLegacyPinHash = (pin: string, salt: string) =>
  createHash('sha256').update(`${salt}:${pin}`).digest('hex');

const scryptPin = (pin: string, salt: string) =>
  new Promise<Buffer>((resolve, reject) => {
    scrypt(pin, salt, PIN_SCRYPT_KEY_LENGTH, {
      N: PIN_SCRYPT_COST,
      r: PIN_SCRYPT_BLOCK_SIZE,
      p: PIN_SCRYPT_PARALLELIZATION,
    }, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(Buffer.from(derivedKey));
    });
  });

const createPinHash = async (pin: string, salt: string) => {
  const hashBuffer = await scryptPin(pin, salt);
  const hash = hashBuffer.toString('hex');

  return `${PIN_HASH_VERSION}$${hash}`;
};

const splitVersionedPinHash = (pinHash: string) => {
  const [version, hash] = pinHash.split('$', 2);
  if (!version || !hash) {
    return null;
  }

  return { version, hash };
};

const hashShareToken = (shareToken: string) =>
  createHash('sha256').update(`share:${shareToken}`).digest('hex');

const verifyPin = async (room: SyncSession, pin: string) => {
  const versionedHash = splitVersionedPinHash(room.pinHash);
  if (versionedHash?.version === PIN_HASH_VERSION) {
    const expectedHash = Buffer.from(versionedHash.hash, 'hex');
    const providedVersionedHash = await createPinHash(pin, room.pinSalt);
    const providedHash = Buffer.from(providedVersionedHash.split('$', 2)[1] ?? '', 'hex');
    return expectedHash.length === providedHash.length && timingSafeEqual(expectedHash, providedHash);
  }

  // Backward compatibility for rooms created before scrypt migration.
  const expectedLegacyHash = Buffer.from(room.pinHash, 'hex');
  const providedLegacyHash = Buffer.from(createLegacyPinHash(pin, room.pinSalt), 'hex');
  return expectedLegacyHash.length === providedLegacyHash.length && timingSafeEqual(expectedLegacyHash, providedLegacyHash);
};

const verifyShareToken = (room: SyncSession, shareToken: string) => {
  const expectedHash = Buffer.from(room.shareTokenHash, 'hex');
  const providedHash = Buffer.from(hashShareToken(shareToken), 'hex');
  return expectedHash.length === providedHash.length && timingSafeEqual(expectedHash, providedHash);
};

const createParticipantId = () => randomBytes(6).toString('base64url');
const createShareToken = () => randomBytes(18).toString('base64url');
const buildSyncStateSnapshot = (room: SyncSession): SyncState => {
  const snapshotTime = Date.now();
  const elapsedSeconds = room.state.playing
    ? Math.max(0, (snapshotTime - room.state.updatedAt) / 1000)
    : 0;

  return {
    position: room.state.position + elapsedSeconds,
    playing: room.state.playing,
    updatedAt: snapshotTime,
  };
};

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
  socketOwnedRateLimitKeys.clear();
};

export const addNonceToScriptTags = (html: string, nonce: string) => {
  const lowerHtml = html.toLowerCase();
  let cursor = 0;
  let output = '';

  while (cursor < html.length) {
    const scriptStart = lowerHtml.indexOf('<script', cursor);
    if (scriptStart === -1) {
      return output + html.slice(cursor);
    }

    const boundary = lowerHtml[scriptStart + 7];
    if (boundary && ![' ', '\n', '\r', '\t', '>'].includes(boundary)) {
      output += html.slice(cursor, scriptStart + 7);
      cursor = scriptStart + 7;
      continue;
    }

    const insertionPoint = scriptStart + 7;
    output += `${html.slice(cursor, insertionPoint)} nonce="${nonce}"`;
    cursor = insertionPoint;
  }

  return output;
};

export const injectHtmlIntoHead = (html: string, markup: string) => {
  const headCloseIndex = html.toLowerCase().indexOf('</head>');
  if (headCloseIndex === -1) {
    return `${markup}${html}`;
  }

  return `${html.slice(0, headCloseIndex)}${markup}${html.slice(headCloseIndex)}`;
};

export const createRoomForSocket = async (
  socketId: string,
  payload?: { roomId: string; pin: string; displayName?: string },
  clientIdentity = socketId,
): Promise<RoomOperationResult<{
  roomId: string;
  pin: string;
  shareToken: string;
  state: SyncState;
  participants: string[];
  memberProfiles: Array<{ participantId: string; displayName: string }>;
  selfParticipantId: string;
}>> => {
  if (isAuthRateLimited(clientIdentity, 'create')) {
    return { success: false, error: 'Too many authentication attempts. Please wait a moment and try again.' };
  }

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
    pinHash: await createPinHash(pin, pinSalt),
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
    state: buildSyncStateSnapshot(room),
    participants: [participantId],
    memberProfiles: buildParticipantProfiles(room),
    selfParticipantId: participantId,
  };
};

export const joinRoomForSocket = async (
  socketId: string,
  payload: { roomId: string; pin: string; displayName?: string },
  clientIdentity = socketId,
): Promise<RoomOperationResult<{
  roomId: string;
  shareToken: string;
  state: SyncState;
  participants: string[];
  memberProfiles: Array<{ participantId: string; displayName: string }>;
  selfParticipantId?: string;
}>> => {
  const parsedPayload = JoinRoomSchema.safeParse(payload);
  if (!parsedPayload.success) {
    return { success: false, error: 'Invalid room credentials' };
  }

  const roomId = normalizeRoomId(parsedPayload.data.roomId);
  if (isAuthRateLimited(clientIdentity, roomId)) {
    return { success: false, error: 'Too many authentication attempts. Please wait a moment and try again.' };
  }
  const pin = normalizePin(parsedPayload.data.pin);
  const { displayName } = parsedPayload.data;
  const room = rooms.get(roomId);
  if (!room || !await verifyPin(room, pin)) {
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
    state: buildSyncStateSnapshot(room),
    participants: room.memberProfiles.map((member) => member.participantId),
    memberProfiles: buildParticipantProfiles(room),
    ...(attachResult.currentMember ? { selfParticipantId: attachResult.currentMember.participantId } : {}),
  };
};

export const joinRoomByLinkForSocket = async (
  socketId: string,
  payload: { roomId: string; shareToken: string; displayName?: string },
  clientIdentity = socketId,
): Promise<RoomOperationResult<{
  roomId: string;
  shareToken: string;
  state: SyncState;
  participants: string[];
  memberProfiles: Array<{ participantId: string; displayName: string }>;
  selfParticipantId?: string;
}>> => {
  const parsedPayload = LinkJoinRoomSchema.safeParse(payload);
  if (!parsedPayload.success) {
    return { success: false, error: 'Invalid room link' };
  }

  const roomId = normalizeRoomId(parsedPayload.data.roomId);
  if (isAuthRateLimited(clientIdentity, roomId)) {
    return { success: false, error: 'Too many authentication attempts. Please wait a moment and try again.' };
  }
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
    state: buildSyncStateSnapshot(room),
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

  return { success: true as const, state: buildSyncStateSnapshot(room) };
};

export const requestSyncStateForSocket = (socketId: string, roomId: string) => {
  if (isRateLimited(socketId)) {
    return { success: false as const, error: 'Rate limited' };
  }
  const room = rooms.get(roomId);
  if (!room || !isRoomParticipant(room, socketId)) {
    return { success: false as const, error: 'Room not found' };
  }

  return { success: true as const, state: buildSyncStateSnapshot(room) };
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
  const ownedRateLimitKeys = socketOwnedRateLimitKeys.get(socketId);
  if (ownedRateLimitKeys) {
    ownedRateLimitKeys.forEach((key) => {
      rateLimits.delete(key);
    });
    socketOwnedRateLimitKeys.delete(socketId);
  }

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
  const clientIdentity = getSocketClientIdentity(socket);

  socket.on('create_room', async (payload: { roomId: string; pin: string; displayName?: string } | undefined, cb) => {
    const ack = getSocketAck<[RoomOperationResult<{
      roomId: string;
      pin: string;
      shareToken: string;
      state: SyncState;
      participants: string[];
      memberProfiles: Array<{ participantId: string; displayName: string }>;
      selfParticipantId: string;
    }>]> (cb);
    try {
      const response = await createRoomForSocket(socket.id, payload, clientIdentity);
      if (!response.success) {
        writeLog('warn', 'room.create.rejected', {
          socketId: socket.id,
          reason: response.error,
        });
        ack?.(response);
        return;
      }
      writeLog('info', 'room.created', {
        roomId: response.roomId,
        socketId: socket.id,
        participantId: response.selfParticipantId,
      });
      socket.join(response.roomId);
      ack?.(response);
      const room = rooms.get(response.roomId);
      if (room) {
        emitRoomPeople(response.roomId, room);
      }
    } catch (error) {
      writeLog('error', 'room.create.failed', {
        socketId: socket.id,
        message: error instanceof Error ? error.message : String(error),
      });
      ack?.({ success: false, error: 'Unable to create room right now' });
    }
  });

  socket.on('join_room', async (payload: { roomId: string; pin: string; displayName?: string } | undefined, cb) => {
    const ack = getSocketAck<[RoomOperationResult<{
      roomId: string;
      shareToken: string;
      state: SyncState;
      participants: string[];
      memberProfiles: Array<{ participantId: string; displayName: string }>;
      selfParticipantId?: string;
    }>]> (cb);
    try {
      const response = await joinRoomForSocket(socket.id, payload ?? { roomId: '', pin: '' }, clientIdentity);
      if (!response.success) {
        const room = payload?.roomId ? rooms.get(normalizeRoomId(payload.roomId)) : undefined;
        writeLog('warn', 'room.join.denied', {
          socketId: socket.id,
          roomId: payload?.roomId,
          reason: room ? 'bad_pin_or_invalid' : 'missing_room',
        });
        ack?.(response);
        return;
      }

      const room = rooms.get(response.roomId);
      socket.join(response.roomId);

      if (!room) {
        writeLog('warn', 'room.join.denied', {
          socketId: socket.id,
          roomId: payload?.roomId,
          reason: 'missing_room_post_join',
        });
        ack?.({ success: false, error: 'Room not found' });
        return;
      }
      const currentMember = getRoomMember(room, socket.id);
      writeLog('info', 'room.joined', {
        roomId: response.roomId,
        socketId: socket.id,
        participantId: currentMember?.participantId,
        participants: room.memberProfiles.length,
      });
      ack?.(response);
      emitRoomPeople(response.roomId, room);
    } catch (error) {
      writeLog('error', 'room.join.failed', {
        socketId: socket.id,
        roomId: payload?.roomId,
        message: error instanceof Error ? error.message : String(error),
      });
      ack?.({ success: false, error: 'Unable to join room right now' });
    }
  });

  socket.on('join_room_link', async (payload: { roomId: string; shareToken: string; displayName?: string } | undefined, cb) => {
    const ack = getSocketAck<[RoomOperationResult<{
      roomId: string;
      shareToken: string;
      state: SyncState;
      participants: string[];
      memberProfiles: Array<{ participantId: string; displayName: string }>;
      selfParticipantId?: string;
    }>]> (cb);
    try {
      const response = await joinRoomByLinkForSocket(
        socket.id,
        payload ?? { roomId: '', shareToken: '' },
        clientIdentity,
      );
      if (!response.success) {
        writeLog('warn', 'room.link_join.denied', {
          socketId: socket.id,
          roomId: payload?.roomId,
          reason: response.error,
        });
        ack?.(response);
        return;
      }

      const room = rooms.get(response.roomId);
      socket.join(response.roomId);

      if (!room) {
        writeLog('warn', 'room.link_join.denied', {
          socketId: socket.id,
          roomId: payload?.roomId,
          reason: 'missing_room_post_join',
        });
        ack?.({ success: false, error: 'Room not found' });
        return;
      }

      const currentMember = getRoomMember(room, socket.id);
      writeLog('info', 'room.link_joined', {
        roomId: response.roomId,
        socketId: socket.id,
        participantId: currentMember?.participantId,
        participants: room.memberProfiles.length,
      });
      ack?.(response);
      emitRoomPeople(response.roomId, room);
    } catch (error) {
      writeLog('error', 'room.link_join.failed', {
        socketId: socket.id,
        roomId: payload?.roomId,
        message: error instanceof Error ? error.message : String(error),
      });
      ack?.({ success: false, error: 'Unable to join room right now' });
    }
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
    const ack = getSocketAck<[{
      success?: boolean;
      error?: string;
      state?: SyncState;
    }]>(cb);
    const result = requestSyncStateForSocket(socket.id, roomId);
    if (!result.success) {
      writeLog('warn', 'sync_request.rejected', {
        socketId: socket.id,
        roomId,
        reason: result.error,
      });
      ack?.({ success: false, error: result.error });
      return;
    }
    ack?.({ success: true, state: result.state });
  });

  socket.on('set_display_name', (roomId: string, nextDisplayName: string, cb) => {
    const ack = getSocketAck<[RoomOperationResult<{
      memberProfiles: Array<{ participantId: string; displayName: string }>;
    }>]> (cb);
    const result = setDisplayNameForSocket(socket.id, roomId, nextDisplayName);
    if (!result.success) {
      writeLog('warn', 'profile.update.rejected', {
        socketId: socket.id,
        roomId,
        reason: result.error,
      });
      ack?.(result);
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
    ack?.(result);
  });

  socket.on('send_chat_message', (roomId: string, payload: unknown, cb) => {
    const ack = getSocketAck<[RoomOperationResult<{
      message: ChatMessage;
    }>]> (cb);
    const result = sendChatMessageForSocket(socket.id, roomId, payload);
    if (!result.success) {
      writeLog('warn', 'chat.rejected', {
        socketId: socket.id,
        roomId,
        reason: result.error,
      });
      ack?.(result);
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
    ack?.(result);
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
  const indexHtmlPath = path.resolve(clientBuildPath, 'index.html');
  const indexHtmlTemplatePromise = readFile(indexHtmlPath, 'utf8');
  const renderIndexHtml = async (nonce: string) => {
    const bootstrapScript = `<script nonce="${nonce}">(()=>{try{const tt=globalThis.trustedTypes;if(!tt||typeof tt.createPolicy!=='function')return;tt.createPolicy('default',{createHTML:(input)=>input,createScript:(input)=>input,createScriptURL:(input)=>input});}catch{}})();</script>`;
    const html = await indexHtmlTemplatePromise;
    const htmlWithNonce = addNonceToScriptTags(html, nonce);
    return injectHtmlIntoHead(htmlWithNonce, bootstrapScript);
  };

  app.get('/index.html', (_req, res) => {
    res.redirect(302, '/');
  });
  
  // Vite fingerprints asset filenames, so they can be cached aggressively.
  app.use('/assets', express.static(path.resolve(clientBuildPath, 'assets'), {
    maxAge: '1y',
    immutable: true,
  }));
  
  // HTML and unversioned public assets keep a shorter cache window.
  app.use(express.static(clientBuildPath, {
    maxAge: '1h',
    index: false,
  }));

  app.get(/.*/, async (req, res, next) => {
    // Always serve a fresh shell so clients receive the latest asset manifest.
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    try {
      if (isHttpRequestRateLimited(getRequestClientIdentity(req), 'html-shell')) {
        res.status(429).send('Too many requests');
        return;
      }
      const nonce = String(res.locals.cspNonce ?? '');
      res.send(await renderIndexHtml(nonce));
    } catch (error) {
      next(error);
    }
  });
}

const PORT = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 4000;
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

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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

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
  pinHash?: string;     
  fileHash?: string;    
  state: {
    position: number;
    playing: boolean;
    updatedAt: number;
  };
  participants: string[];
}

export const rooms = new Map<string, SyncSession>();

// Keep a lightweight per-socket budget to avoid noisy clients spamming room events.
const rateLimits = new Map<string, { count: number, resetAt: number }>();
export const isRateLimited = (socketId: string) => {
  const now = Date.now();
  let record = rateLimits.get(socketId);
  if (!record || record.resetAt < now) {
    record = { count: 0, resetAt: now + 2000 };
    rateLimits.set(socketId, record);
  }
  record.count++;
  return record.count > 15;
};

export const SeekSchema = z.object({
  position: z.number().nonnegative(),
  playing: z.boolean(),
});

const isRoomParticipant = (room: SyncSession, socketId: string) => {
  return room.participants.includes(socketId);
};

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join_room', (roomId: string, cb) => {
    if (!roomId || typeof roomId !== 'string' || roomId.length > 36) {
      return cb({ success: false, error: 'Invalid room ID' });
    }
    
    socket.join(roomId);

    let room = rooms.get(roomId);
    if (!room) {
      room = {
        id: roomId,
        state: {
          position: 0,
          playing: false,
          updatedAt: Date.now(),
        },
        participants: [socket.id],
      };
      rooms.set(roomId, room);
      console.log(`Room created: ${roomId} by ${socket.id}`);
    } else {
      if (room.participants.length >= 20 && !isRoomParticipant(room, socket.id)) {
         return cb({ success: false, error: 'Room is full' });
      }

      if (!isRoomParticipant(room, socket.id)) {
        room.participants.push(socket.id);
      }

      console.log(`User ${socket.id} joined room ${roomId}`);
    }

    cb({ 
      success: true, 
      state: room.state,
      participants: room.participants,
    });

    io.to(roomId).emit('participants_updated', room.participants);
  });

  socket.on('sync_state', (roomId: string, update: { position: number; playing: boolean }) => {
    if (isRateLimited(socket.id)) return;
    
    const room = rooms.get(roomId);
    if (!room) return;
    if (!isRoomParticipant(room, socket.id)) return;

    // Drop malformed payloads before they can update shared room state.
    const result = SeekSchema.safeParse(update);
    if (!result.success) return;

    room.state.position = update.position;
    room.state.playing = update.playing;
    room.state.updatedAt = Date.now();

    socket.to(roomId).emit('state_updated', room.state);
  });

  socket.on('force_sync_request', (roomId: string, cb) => {
    if (isRateLimited(socket.id)) return;
    const room = rooms.get(roomId);
    if (room && isRoomParticipant(room, socket.id)) {
      cb({ state: room.state });
    }
  });

  socket.on('disconnect', () => {
    rateLimits.delete(socket.id);
    rooms.forEach((room, roomId) => {
      room.participants = room.participants.filter(id => id !== socket.id);
      if (room.participants.length === 0) {
        rooms.delete(roomId);
      }
      io.to(roomId).emit('participants_updated', room.participants);
    });
    console.log('User disconnected:', socket.id);
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
    console.log(`Socket.io server running on port ${PORT}`);
  });
}

export { app, server, io };

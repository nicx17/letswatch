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

app.use(compression()); // Gzip compress text, JS, CSS, JSON

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://static.cloudflareinsights.com"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      connectSrc: ["'self'", "ws:", "wss:", "https://cloudflareinsights.com"],
      mediaSrc: ["'self'", "blob:"],
      upgradeInsecureRequests: null,
    },
  }
})); // Configured Security headers to support local video blobs

const getAllowedOrigins = () => {
  if (process.env.NODE_ENV !== 'production') return '*';
  const appUrl = process.env.APP_URL ? process.env.APP_URL.replace(/\/$/, '') : '*';
  return [appUrl, appUrl.replace('https://', 'http://')]; // Support HTTPS and HTTP
};

app.use(cors({
  origin: getAllowedOrigins(),
  methods: ['GET', 'POST']
}));

const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: getAllowedOrigins(),
    methods: ['GET', 'POST'],
  },
});

interface SyncSession {
  id: string;          
  pinHash?: string;     
  fileHash?: string;    
  leaderId: string;    
  state: {
    position: number;
    playing: boolean;
    updatedAt: number;
  };
  participants: string[];
}

export const rooms = new Map<string, SyncSession>();

// Basic Rate Limiting Structure (10 requests / 2 seconds)
const rateLimits = new Map<string, { count: number, resetAt: number }>();
export const isRateLimited = (socketId: string) => {
  const now = Date.now();
  let record = rateLimits.get(socketId);
  if (!record || record.resetAt < now) {
    record = { count: 0, resetAt: now + 2000 };
    rateLimits.set(socketId, record);
  }
  record.count++;
  return record.count > 15; // Allow 15 events per 2 seconds max
};

export const SeekSchema = z.object({
  position: z.number().nonnegative(),
  playing: z.boolean(),
});

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
        leaderId: socket.id,
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
      if (room.participants.length > 20) {
         return cb({ success: false, error: 'Room is full' });
      }
      room.participants.push(socket.id);
      console.log(`User ${socket.id} joined room ${roomId}`);
    }

    cb({ 
      success: true, 
      isLeader: room.leaderId === socket.id,
      state: room.state
    });

    io.to(roomId).emit('participants_updated', room.participants);
  });

  socket.on('sync_state', (roomId: string, update: { position: number; playing: boolean }) => {
    if (isRateLimited(socket.id)) return;
    
    const room = rooms.get(roomId);
    if (!room) return;

    // State type validation using Zod
    const result = SeekSchema.safeParse(update);
    if (!result.success) return; // Ignore malicious/malformed data

    room.state.position = update.position;
    room.state.playing = update.playing;
    room.state.updatedAt = Date.now();

    socket.to(roomId).emit('state_updated', room.state);
  });

  socket.on('force_sync_request', (roomId: string, cb) => {
    if (isRateLimited(socket.id)) return;
    const room = rooms.get(roomId);
    if (room) {
      cb({ state: room.state });
    }
  });

  socket.on('disconnect', () => {
    rateLimits.delete(socket.id);
    rooms.forEach((room, roomId) => {
      room.participants = room.participants.filter(id => id !== socket.id);
      if (room.participants.length === 0) {
        rooms.delete(roomId);
      } else if (room.leaderId === socket.id) {
        room.leaderId = room.participants[0] || "";
        io.to(roomId).emit('leader_changed', room.leaderId);
      }
      io.to(roomId).emit('participants_updated', room.participants);
    });
    console.log('User disconnected:', socket.id);
  });
});

// Serve frontend in production
if (process.env.NODE_ENV === 'production') {
  // Since __dirname points to server/src when running tsx, we resolve to ../../client/dist
  const clientBuildPath = path.resolve(__dirname, '../../client/dist');
  
  // Set aggressive cache for static assets (1 year), since Vite uses hash bursting
  app.use('/assets', express.static(path.resolve(clientBuildPath, 'assets'), {
    maxAge: '1y',
    immutable: true,
  }));
  
  // Setup generic static serving for everything else (icon etc) with short cache
  app.use(express.static(clientBuildPath, { maxAge: '1h' }));

  app.get(/.*/, (req, res) => {
    // Avoid caching index.html so users always get the latest bundle references
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

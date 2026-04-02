import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import { z } from 'zod';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      connectSrc: ["'self'", "ws:", "wss:"],
      mediaSrc: ["'self'", "blob:"]
    },
  }
})); // Configured Security headers to support local video blobs
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? process.env.APP_URL : ['http://localhost:5173', 'http://127.0.0.1:5173'],
  methods: ['GET', 'POST']
}));

const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' ? process.env.APP_URL : ['http://localhost:5173', 'http://127.0.0.1:5173'],
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

    // Security Enhancement: Only the leader can send sync events to prevent an "Anarchy" exploit.
    if (room.leaderId !== socket.id) {
       return; // Optional: Disconnect or warn user.
    }

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
  const clientBuildPath = path.join(__dirname, '../../client/dist');
  app.use(express.static(clientBuildPath));

  app.get('*', (req, res) => {
    res.sendFile(path.join(clientBuildPath, 'index.html'));
  });
}

const PORT = process.env.PORT || 4000;
if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, () => {
    console.log(`Socket.io server running on port ${PORT}`);
  });
}

export { app, server, io };

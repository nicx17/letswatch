import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { io as Client, Socket } from 'socket.io-client';
import { server, rooms, isRateLimited } from './index.js';

describe('Server Socket Logic Tests', () => {
  let clientSocket1: Socket;
  let clientSocket2: Socket;
  
  beforeAll(async () => {
    // Start listening on a random port for testing
    await new Promise<void>((resolve) => {
      server.listen(() => {
        const port = (server.address() as any).port;
        clientSocket1 = Client(`http://localhost:${port}`);
        clientSocket2 = Client(`http://localhost:${port}`);
        
        let connectCount = 0;
        const checkDone = () => {
          connectCount++;
          if (connectCount === 2) resolve();
        };

        clientSocket1.on('connect', checkDone);
        clientSocket2.on('connect', checkDone);
      });
    });
  });

  afterAll(() => {
    clientSocket1.disconnect();
    clientSocket2.disconnect();
    server.close();
  });

  beforeEach(() => {
    // Clean up rooms before each test
    rooms.clear();
  });

  it('should create a room and assign leader', async () => {
    await new Promise<void>((resolve) => {
      clientSocket1.emit('join_room', 'test_room_1', (res: any) => {
        expect(res.success).toBe(true);
        expect(res.isLeader).toBe(true);
        expect(rooms.get('test_room_1')?.leaderId).toBe(clientSocket1.id);
        resolve();
      });
    });
  });

  it('should ignore sync_state with invalid Zod payload (e.g. negative timestamp)', async () => {
    await new Promise<void>((resolve) => {
      clientSocket1.emit('join_room', 'test_room_2', () => {
        clientSocket1.emit('sync_state', 'test_room_2', { position: 10, playing: true });
        
        setTimeout(() => {
          expect(rooms.get('test_room_2')?.state.position).toBe(10);
          clientSocket1.emit('sync_state', 'test_room_2', { position: -15, playing: false });
          
          setTimeout(() => {
            expect(rooms.get('test_room_2')?.state.position).toBe(10);
            expect(rooms.get('test_room_2')?.state.playing).toBe(true);
            resolve();
          }, 50);
        }, 50);
      });
    });
  });

  it('should prevent non-leaders from sending sync_state', async () => {
    await new Promise<void>((resolve) => {
      clientSocket1.emit('join_room', 'test_room_x', () => {
        clientSocket2.emit('join_room', 'test_room_x', () => {
          clientSocket2.emit('sync_state', 'test_room_x', { position: 999, playing: true });
          
          setTimeout(() => {
            expect(rooms.get('test_room_x')?.state.position).toBe(0);
            expect(rooms.get('test_room_x')?.state.playing).toBe(false);
            resolve();
          }, 50);
        });
      });
    });
  });

});

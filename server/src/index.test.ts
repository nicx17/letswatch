import { beforeEach, describe, expect, it } from 'vitest';
import {
  applySyncStateForSocket,
  createRoomForSocket,
  isRateLimited,
  joinRoomByLinkForSocket,
  joinRoomForSocket,
  resetRuntimeState,
  rooms,
  sendChatMessageForSocket,
} from './index.js';

describe('Server Room Logic', () => {
  beforeEach(() => {
    resetRuntimeState();
  });

  it('creates a room with generated credentials and an opaque participant id', () => {
    const result = createRoomForSocket('socket-1', {
      roomId: 'MOVIENGT',
      pin: '123456',
      displayName: 'Creator',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.roomId).toBe('MOVIENGT');
    expect(result.pin).toBe('123456');
    expect(result.shareToken).toBeTypeOf('string');
    expect(result.selfParticipantId).toBeTypeOf('string');
    expect(result.participants).toContain(result.selfParticipantId);
    expect(rooms.get(result.roomId)?.participants).toContain('socket-1');
  });

  it('joins a room only when the correct pin is provided', () => {
    const created = createRoomForSocket('socket-1', {
      roomId: 'PINCHECK',
      pin: '654321',
      displayName: 'Host',
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const denied = joinRoomForSocket('socket-2', {
      roomId: created.roomId,
      pin: '000000',
      displayName: 'Guest',
    });
    expect(denied.success).toBe(false);
    if (denied.success) return;
    expect(denied.error).toContain('PIN');

    const allowed = joinRoomForSocket('socket-2', {
      roomId: created.roomId,
      pin: created.pin,
      displayName: 'Guest',
    });
    expect(allowed.success).toBe(true);
    if (!allowed.success) return;
    expect(allowed.memberProfiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ displayName: 'Host' }),
        expect.objectContaining({ displayName: 'Guest' }),
      ]),
    );
  });

  it('allows room entry from a share link without requiring the pin', () => {
    const created = createRoomForSocket('socket-1', {
      roomId: 'LINKROOM',
      pin: '654321',
      displayName: 'Host',
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const joined = joinRoomByLinkForSocket('socket-2', {
      roomId: 'linkroom',
      shareToken: created.shareToken,
      displayName: 'Guest',
    });
    expect(joined.success).toBe(true);
    if (!joined.success) return;

    expect(joined.roomId).toBe('LINKROOM');
    expect(joined.memberProfiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ displayName: 'Host' }),
        expect.objectContaining({ displayName: 'Guest' }),
      ]),
    );
  });

  it('ignores invalid sync payloads and accepts valid participant updates', () => {
    const created = createRoomForSocket('socket-1', {
      roomId: 'SYNCROOM',
      pin: '123456',
      displayName: 'Alpha',
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const firstSync = applySyncStateForSocket('socket-1', created.roomId, { position: 10, playing: true });
    expect(firstSync.success).toBe(true);
    expect(rooms.get(created.roomId)?.state.position).toBe(10);

    const invalidSync = applySyncStateForSocket('socket-1', created.roomId, { position: -15, playing: false });
    expect(invalidSync.success).toBe(false);
    expect(rooms.get(created.roomId)?.state.position).toBe(10);
    expect(rooms.get(created.roomId)?.state.playing).toBe(true);
  });

  it('allows another participant in the room to update playback state', () => {
    const created = createRoomForSocket('socket-1', {
      roomId: 'SHARED01',
      pin: '123456',
      displayName: 'Aster',
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const joined = joinRoomForSocket('socket-2', {
      roomId: created.roomId,
      pin: created.pin,
      displayName: 'Briar',
    });
    expect(joined.success).toBe(true);

    const sync = applySyncStateForSocket('socket-2', created.roomId, { position: 999, playing: true });
    expect(sync.success).toBe(true);
    expect(rooms.get(created.roomId)?.state.position).toBe(999);
    expect(rooms.get(created.roomId)?.state.playing).toBe(true);
  });

  it('broadcasts ephemeral chat messages without storing history in rooms', () => {
    const created = createRoomForSocket('socket-1', {
      roomId: 'CHATROOM',
      pin: '123456',
      displayName: 'Nova',
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const joined = joinRoomForSocket('socket-2', {
      roomId: created.roomId,
      pin: created.pin,
      displayName: 'Kai',
    });
    expect(joined.success).toBe(true);

    const chat = sendChatMessageForSocket('socket-1', created.roomId, {
      type: 'text',
      text: 'hello there 😊',
    });
    expect(chat.success).toBe(true);
    if (!chat.success) return;

    expect(chat.message.displayName).toBe('Nova');
    expect(chat.message.type).toBe('text');
    expect(chat.message.text).toBe('hello there 😊');
    expect(chat.message.participantId).toBeTruthy();
    expect(rooms.get(created.roomId)).not.toHaveProperty('messages');
  });

  it('still exposes the lightweight per-socket rate limiter as process-local state', () => {
    let limited = false;
    for (let i = 0; i < 16; i += 1) {
      limited = isRateLimited('socket-rate');
    }

    expect(limited).toBe(true);
  });

  it('rejects duplicate room codes on create', () => {
    const first = createRoomForSocket('socket-1', {
      roomId: 'DUPLIC8',
      pin: '123456',
      displayName: 'Host',
    });
    expect(first.success).toBe(true);

    const duplicate = createRoomForSocket('socket-2', {
      roomId: 'DUPLIC8',
      pin: '654321',
      displayName: 'Guest',
    });
    expect(duplicate.success).toBe(false);
    if (duplicate.success) return;
    expect(duplicate.error).toContain('already in use');
  });
});

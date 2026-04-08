import { beforeEach, describe, expect, it } from 'vitest';
import {
  addNonceToScriptTags,
  applySyncStateForSocket,
  createRoomForSocket,
  disconnectSocket,
  injectHtmlIntoHead,
  isRateLimited,
  io,
  joinRoomByLinkForSocket,
  joinRoomForSocket,
  requestSyncStateForSocket,
  resetRuntimeState,
  rooms,
  sendChatMessageForSocket,
} from './index.js';

describe('Server Room Logic', () => {
  beforeEach(() => {
    resetRuntimeState();
  });

  it('creates a room with generated credentials and an opaque participant id', async () => {
    const result = await createRoomForSocket('socket-1', {
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

  it('joins a room only when the correct pin is provided', async () => {
    const created = await createRoomForSocket('socket-1', {
      roomId: 'PINCHECK',
      pin: '654321',
      displayName: 'Host',
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const denied = await joinRoomForSocket('socket-2', {
      roomId: created.roomId,
      pin: '000000',
      displayName: 'Guest',
    });
    expect(denied.success).toBe(false);
    if (denied.success) return;
    expect(denied.error).toContain('PIN');

    const allowed = await joinRoomForSocket('socket-2', {
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

  it('allows room entry from a share link without requiring the pin', async () => {
    const created = await createRoomForSocket('socket-1', {
      roomId: 'LINKROOM',
      pin: '654321',
      displayName: 'Host',
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const joined = await joinRoomByLinkForSocket('socket-2', {
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

  it('ignores invalid sync payloads and accepts valid participant updates', async () => {
    const created = await createRoomForSocket('socket-1', {
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

  it('allows another participant in the room to update playback state', async () => {
    const created = await createRoomForSocket('socket-1', {
      roomId: 'SHARED01',
      pin: '123456',
      displayName: 'Aster',
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const joined = await joinRoomForSocket('socket-2', {
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

  it('broadcasts ephemeral chat messages without storing history in rooms', async () => {
    const created = await createRoomForSocket('socket-1', {
      roomId: 'CHATROOM',
      pin: '123456',
      displayName: 'Nova',
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const joined = await joinRoomForSocket('socket-2', {
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

  it('rejects duplicate room codes on create', async () => {
    const first = await createRoomForSocket('socket-1', {
      roomId: 'DUPLIC8',
      pin: '123456',
      displayName: 'Host',
    });
    expect(first.success).toBe(true);

    const duplicate = await createRoomForSocket('socket-2', {
      roomId: 'DUPLIC8',
      pin: '654321',
      displayName: 'Guest',
    });
    expect(duplicate.success).toBe(false);
    if (duplicate.success) return;
    expect(duplicate.error).toContain('already in use');
  });

  it('throttles repeated authentication attempts for the same client identity across reconnects', async () => {
    const created = await createRoomForSocket('socket-1', {
      roomId: 'AUTHRAT1',
      pin: '123456',
      displayName: 'Host',
    }, '203.0.113.10');
    expect(created.success).toBe(true);
    if (!created.success) return;

    let lastAttempt = await joinRoomForSocket('socket-auth-0', {
      roomId: created.roomId,
      pin: '000000',
      displayName: 'Guest',
    }, '203.0.113.10');

    for (let attempt = 1; attempt < 10; attempt += 1) {
      lastAttempt = await joinRoomForSocket(`socket-auth-${attempt}`, {
        roomId: created.roomId,
        pin: '000000',
        displayName: 'Guest',
      }, '203.0.113.10');
    }

    expect(lastAttempt.success).toBe(false);
    if (lastAttempt.success) return;
    expect(lastAttempt.error).toContain('Too many authentication attempts');
  });

  it('clears socket-owned image limiter state on disconnect', async () => {
    const created = await createRoomForSocket('socket-1', {
      roomId: 'IMGRATE1',
      pin: '123456',
      displayName: 'Host',
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const chat = sendChatMessageForSocket('socket-1', created.roomId, {
        type: 'image',
        imageDataUrl: 'data:image/png;base64,QUJDRA==',
      });
      expect(chat.success).toBe(true);
    }

    const limited = sendChatMessageForSocket('socket-1', created.roomId, {
      type: 'image',
      imageDataUrl: 'data:image/png;base64,QUJDRA==',
    });
    expect(limited.success).toBe(false);

    disconnectSocket('socket-1');

    const recreated = await createRoomForSocket('socket-1', {
      roomId: 'IMGRATE2',
      pin: '123456',
      displayName: 'Host',
    });
    expect(recreated.success).toBe(true);
    if (!recreated.success) return;

    const afterDisconnect = sendChatMessageForSocket('socket-1', recreated.roomId, {
      type: 'image',
      imageDataUrl: 'data:image/png;base64,QUJDRA==',
    });
    expect(afterDisconnect.success).toBe(true);
  });

  it('returns explicit errors for rejected sync state requests', async () => {
    const created = await createRoomForSocket('socket-1', {
      roomId: 'SYNCREQ1',
      pin: '123456',
      displayName: 'Host',
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const denied = requestSyncStateForSocket('socket-2', created.roomId);
    expect(denied.success).toBe(false);
    if (denied.success) return;
    expect(denied.error).toBe('Room not found');
  });

  it('adds nonces to lowercase and uppercase script tags without matching unrelated tag names', () => {
    const html = '<!doctype html><head></head><body><script src="/a.js"></script><SCRIPT type="module"></SCRIPT><scripture>keep</scripture></body>';
    const updated = addNonceToScriptTags(html, 'nonce-value');

    expect(updated).toContain('<script nonce="nonce-value" src="/a.js"></script>');
    expect(updated).toContain('<SCRIPT nonce="nonce-value" type="module"></SCRIPT>');
    expect(updated).toContain('<scripture>keep</scripture>');
  });

  it('injects bootstrap markup before a closing head tag regardless of case', () => {
    const html = '<html><HEAD><meta charset="utf-8"></HEAD><body></body></html>';
    const updated = injectHtmlIntoHead(html, '<script>bootstrap</script>');

    expect(updated).toContain('<meta charset="utf-8"><script>bootstrap</script></HEAD>');
  });
});

describe('Socket.IO hardening', () => {
  beforeEach(() => {
    resetRuntimeState();
  });

  const registerSocketHandlers = () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const fakeSocket = {
      id: 'socket-handler',
      handshake: { address: '198.51.100.40' },
      on: (event: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(event, handler);
      },
      join: () => undefined,
      to: () => ({ emit: () => undefined }),
    };

    for (const listener of io.listeners('connection')) {
      listener(fakeSocket as never);
    }

    return handlers;
  };

  it('does not crash when malformed join payloads arrive without an acknowledgement callback', async () => {
    const handlers = registerSocketHandlers();
    expect(handlers.has('join_room')).toBe(true);
    expect(handlers.has('join_room_link')).toBe(true);
    expect(handlers.has('create_room')).toBe(true);

    await expect(Promise.resolve(handlers.get('join_room')?.(null))).resolves.toBeUndefined();
    await expect(Promise.resolve(handlers.get('join_room_link')?.(null))).resolves.toBeUndefined();
    await expect(
      Promise.resolve(handlers.get('create_room')?.({ roomId: 'SAFEACK1', pin: '123456', displayName: 'Host' })),
    ).resolves.toBeUndefined();

    expect(rooms.has('SAFEACK1')).toBe(true);
  });

  it('returns force-sync errors through the acknowledgement callback', () => {
    const handlers = registerSocketHandlers();
    expect(handlers.has('force_sync_request')).toBe(true);

    let response: { success?: boolean; error?: string } | undefined;
    handlers.get('force_sync_request')?.('MISSING1', (payload: { success?: boolean; error?: string }) => {
      response = payload;
    });

    expect(response).toEqual({
      success: false,
      error: 'Room not found',
    });
  });
});

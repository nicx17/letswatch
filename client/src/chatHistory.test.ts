import { describe, expect, it } from 'vitest';
import { appendChatMessage, MAX_CHAT_IMAGES, MAX_CHAT_MESSAGES } from './chatHistory';
import type { ChatMessage } from './types';

const textMessage = (id: number): ChatMessage => ({
  id: `text-${id}`,
  participantId: 'p1',
  displayName: 'Viewer',
  type: 'text',
  text: `message ${id}`,
  sentAt: id,
});

const imageMessage = (id: number): ChatMessage => ({
  id: `image-${id}`,
  participantId: 'p1',
  displayName: 'Viewer',
  type: 'image',
  imageDataUrl: 'data:image/png;base64,QUJDRA==',
  sentAt: id,
});

describe('appendChatMessage', () => {
  it('keeps only the most recent messages', () => {
    let history: ChatMessage[] = [];
    for (let id = 0; id < MAX_CHAT_MESSAGES + 5; id += 1) {
      history = appendChatMessage(history, textMessage(id));
    }

    expect(history).toHaveLength(MAX_CHAT_MESSAGES);
    expect(history[0]?.id).toBe('text-5');
  });

  it('drops image data from older images but keeps the newest ones intact', () => {
    let history: ChatMessage[] = [];
    for (let id = 0; id < MAX_CHAT_IMAGES + 3; id += 1) {
      history = appendChatMessage(history, imageMessage(id));
    }

    const withData = history.filter((message) => message.imageDataUrl);
    expect(withData).toHaveLength(MAX_CHAT_IMAGES);
    expect(history.slice(0, 3).every((message) => message.imageDataUrl === undefined)).toBe(true);
    expect(history.at(-1)?.imageDataUrl).toBeDefined();
  });
});

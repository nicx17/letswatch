import type { ChatMessage } from './types';

export const MAX_CHAT_MESSAGES = 120;
// Images arrive as data URLs of up to ~900 KB each, so only the newest ones keep
// their pixels; older image messages stay in the log as placeholders.
export const MAX_CHAT_IMAGES = 30;

export const appendChatMessage = (history: ChatMessage[], message: ChatMessage): ChatMessage[] => {
  const recent = [...history, message].slice(-MAX_CHAT_MESSAGES);
  let imagesKept = 0;

  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const entry = recent[index];
    if (entry.type !== 'image' || !entry.imageDataUrl) continue;

    imagesKept += 1;
    if (imagesKept > MAX_CHAT_IMAGES) {
      recent[index] = { ...entry, imageDataUrl: undefined };
    }
  }

  return recent;
};

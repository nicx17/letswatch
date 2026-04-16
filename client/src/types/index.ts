export interface SyncState {
  playing: boolean;
  position: number;
  updatedAt: number;
}

export interface SyncResponse {
  success?: boolean;
  error?: string;
  state?: SyncState;
  participants?: string[];
  roomId?: string;
  pin?: string;
  shareToken?: string;
  selfParticipantId?: string;
  memberProfiles?: MemberProfile[];
  message?: ChatMessage;
}

export interface MemberProfile {
  participantId: string;
  displayName: string;
}

export interface ChatMessage {
  id: string;
  participantId: string;
  displayName: string;
  type: 'text' | 'image';
  text?: string;
  imageDataUrl?: string;
  sentAt: number;
}

export interface AudioTrackInfo {
  id: string;
  label: string;
  language: string;
  enabled: boolean;
}

export type ThemeName = 'midnight' | 'sunset' | 'forest' | 'ocean' | 'neon' | 'monochrome';

export type JoinMode = 'pin' | 'link' | null;

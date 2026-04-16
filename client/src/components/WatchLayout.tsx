import React from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  Maximize2,
  MessageSquare,
  Minimize2,
  RefreshCw,
  SendHorizontal,
  SmilePlus,
  Upload,
  UserRound,
  Volume2,
} from 'lucide-react';
import { SidebarColumn } from './SidebarColumn';
import type { AudioTrackInfo, ChatMessage, MemberProfile } from '../types';

interface EmojiTextProps {
  text: string;
}

interface ChatPanelProps {
  chatScrollRef: React.RefObject<HTMLDivElement | null>;
  chatInputRef: React.RefObject<HTMLTextAreaElement | null>;
  chatImageInputRef: React.RefObject<HTMLInputElement | null>;
  chatMessages: ChatMessage[];
  chatDraft: string;
  setChatDraft: (val: string) => void;
  isEmojiStripCollapsed: boolean;
  currentParticipantId: string;
  participantsCount: number;
  handleChatKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  handleSendChatMessage: () => void;
  handleEmojiSelect: (emoji: string) => void;
  handleEmojiStripToggle: () => void;
  handleChatImageChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  EmojiText: React.ComponentType<EmojiTextProps>;
  topChatEmojis: string[];
}

function ChatPanel({
  chatScrollRef,
  chatInputRef,
  chatImageInputRef,
  chatMessages,
  chatDraft,
  setChatDraft,
  isEmojiStripCollapsed,
  currentParticipantId,
  participantsCount,
  handleChatKeyDown,
  handleSendChatMessage,
  handleEmojiSelect,
  handleEmojiStripToggle,
  handleChatImageChange,
  EmojiText,
  topChatEmojis,
}: Readonly<ChatPanelProps>) {
  const isEmojiStripOpen = !isEmojiStripCollapsed;

  return (
    <div className="chrome-panel chat-panel rounded-[32px] p-5">
      <div className="chat-panel-head">
        <div>
          <p className="eyebrow">
            <MessageSquare size={14} />
            <span>Live chat</span>
          </p>
        </div>
        <div className="metric-pill px-3 py-2">
          <UserRound size={16} />
          <span className="font-semibold text-[var(--text-main)]">{participantsCount}</span>
        </div>
      </div>

      <div ref={chatScrollRef} className="chat-log">
        {chatMessages.length > 0 ? (
          chatMessages.map((message) => {
            const isOwnMessage = message.participantId === currentParticipantId;
            return (
              <article
                key={message.id}
                className={`chat-message ${isOwnMessage ? 'chat-message-own' : ''}`}
              >
                <div className="chat-message-meta">
                  <span className="chat-message-name">
                    {isOwnMessage ? 'You' : message.displayName}
                  </span>
                  <time className="chat-message-time">
                    {new Date(message.sentAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </time>
                </div>
                <div className="chat-message-bubble">
                  {message.type === 'image' && message.imageDataUrl ? (
                    <img
                      src={message.imageDataUrl}
                      alt={`Shared by ${message.displayName}`}
                      className="chat-image"
                    />
                  ) : (
                    <p><EmojiText text={message.text ?? ''} /></p>
                  )}
                </div>
              </article>
            );
          })
        ) : (
          <div className="chat-empty-state">
            <MessageSquare size={18} />
            <p>No messages yet.</p>
          </div>
        )}
      </div>

      <div className="chat-compose">
        {isEmojiStripOpen ? (
          <div className="emoji-strip" aria-label="Quick emoji reactions">
            {topChatEmojis.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="emoji-chip"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleEmojiSelect(emoji)}
                aria-label={`Add ${emoji}`}
              >
                <EmojiText text={emoji} />
              </button>
            ))}
          </div>
        ) : null}

        <label htmlFor="chat-message-input" className="sr-only">Chat message</label>
        <textarea
          ref={chatInputRef}
          id="chat-message-input"
          name="chatMessage"
          autoComplete="off"
          value={chatDraft}
          onChange={(e) => setChatDraft(e.target.value)}
          onKeyDown={handleChatKeyDown}
          placeholder="Type a message or drop an emoji 😄"
          className="chat-input"
          rows={3}
          maxLength={500}
        />
        <div className="chat-compose-row">
          <span className="chat-compose-hint">Enter sends, Shift+Enter adds a new line</span>
          <div className="chat-compose-actions">
            <button
              type="button"
              onClick={handleEmojiStripToggle}
              className="chat-icon-button"
              aria-label={isEmojiStripCollapsed ? 'Show emoji reactions' : 'Hide emoji reactions'}
              title={isEmojiStripCollapsed ? 'Show emoji reactions' : 'Hide emoji reactions'}
              aria-pressed={isEmojiStripOpen}
            >
              <SmilePlus size={16} />
            </button>
            <button
              type="button"
              onClick={() => chatImageInputRef.current?.click()}
              className="chat-icon-button"
              aria-label="Send image"
              title="Send image"
            >
              <ImagePlus size={16} />
            </button>
            <input
              ref={chatImageInputRef}
              id="chat-image-input"
              name="chatImage"
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              onChange={handleChatImageChange}
              className="hidden"
              aria-label="Upload chat image"
            />
            <button
              type="button"
              onClick={handleSendChatMessage}
              className="primary-button"
              disabled={!chatDraft.trim()}
            >
              <SendHorizontal size={16} />
              <span>Send</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface WatchLayoutProps {
  // Video
  videoRef: React.RefObject<HTMLVideoElement | null>;
  trustedVideoSrc: string | undefined;
  trustedSubtitleSrc: string;
  subtitleSrc: string | null;
  subtitleLabel: string | null;
  videoLabel: string | null;
  audioTracks: AudioTrackInfo[];
  isTheaterMode: boolean;
  handleFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleVideoLoadedMetadata: () => void;
  handlePlay: () => void;
  handlePause: () => void;
  handleSeeked: () => void;
  handleManualSync: () => void;
  handleTheaterToggle: () => void;
  handleAudioTrackSwitch: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  clearVideoFile: () => void;
  handleSubtitleChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  clearSubtitleTrack: () => void;
  // Drift
  drift: number;
  getDriftColor: () => string;
  // Chat
  chatScrollRef: React.RefObject<HTMLDivElement | null>;
  chatInputRef: React.RefObject<HTMLTextAreaElement | null>;
  chatImageInputRef: React.RefObject<HTMLInputElement | null>;
  chatMessages: ChatMessage[];
  chatDraft: string;
  setChatDraft: (val: string) => void;
  isChatCollapsed: boolean;
  isEmojiStripCollapsed: boolean;
  unreadMessages: number;
  currentParticipantId: string;
  participantsCount: number;
  handleChatToggle: () => void;
  handleChatKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  handleSendChatMessage: () => void;
  handleEmojiSelect: (emoji: string) => void;
  handleEmojiStripToggle: () => void;
  handleChatImageChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  EmojiText: React.ComponentType<EmojiTextProps>;
  topChatEmojis: string[];
  // Sidebar
  isConnected: boolean;
  roomId: string;
  roomPin: string;
  roomLinkCopied: boolean;
  displayName: string;
  setDisplayName: (name: string) => void;
  memberProfiles: MemberProfile[];
  handleCopyRoomLink: () => void;
  handleSaveDisplayName: () => void;
}

export function WatchLayout({
  videoRef,
  trustedVideoSrc,
  trustedSubtitleSrc,
  subtitleSrc,
  subtitleLabel,
  videoLabel: _videoLabel,
  audioTracks,
  isTheaterMode,
  handleFileChange,
  handleVideoLoadedMetadata,
  handlePlay,
  handlePause,
  handleSeeked,
  handleManualSync,
  handleTheaterToggle,
  handleAudioTrackSwitch,
  clearVideoFile,
  handleSubtitleChange,
  clearSubtitleTrack,
  drift,
  getDriftColor,
  chatScrollRef,
  chatInputRef,
  chatImageInputRef,
  chatMessages,
  chatDraft,
  setChatDraft,
  isChatCollapsed,
  isEmojiStripCollapsed,
  unreadMessages,
  currentParticipantId,
  participantsCount,
  handleChatToggle,
  handleChatKeyDown,
  handleSendChatMessage,
  handleEmojiSelect,
  handleEmojiStripToggle,
  handleChatImageChange,
  EmojiText,
  topChatEmojis,
  isConnected,
  roomId,
  roomPin,
  roomLinkCopied,
  displayName,
  setDisplayName,
  memberProfiles,
  handleCopyRoomLink,
  handleSaveDisplayName,
}: Readonly<WatchLayoutProps>) {
  const isChatExpanded = !isChatCollapsed;


  return (
    <div className={`watch-layout ${isTheaterMode ? 'watch-layout-theater' : ''}`}>
      <div className={`player-stage ${isTheaterMode ? 'player-stage-theater' : ''}`}>
        <div className={`chrome-panel player-panel overflow-hidden rounded-[36px] p-3 ${isTheaterMode ? 'player-panel-theater' : ''}`}>
          <div className="video-frame">
            <video
              ref={videoRef}
              src={trustedVideoSrc}
              controls
              className={`w-full aspect-video rounded-[28px] outline-none ${isTheaterMode ? 'theater-video' : ''}`}
              onLoadedMetadata={handleVideoLoadedMetadata}
              onPlay={handlePlay}
              onPause={handlePause}
              onSeeked={handleSeeked}
            >
              <track
                key={subtitleSrc ?? 'empty-caption-track'}
                src={trustedSubtitleSrc}
                kind="captions"
                srcLang="en"
                label={subtitleLabel ?? 'Uploaded subtitles'}
                default={Boolean(subtitleSrc)}
              />
            </video>
          </div>

          <div className="player-toolbar mt-4 rounded-[26px] bg-[var(--panel-strong)] px-4 py-4 sm:px-5">
            <div className="flex flex-wrap items-center gap-3">
              <label className="secondary-button cursor-pointer">
                <Upload size={18} />
                <span>Change Video</span>
                <input
                  id="upload-video-toolbar"
                  name="videoFileToolbar"
                  type="file"
                  accept="video/*,.mkv,.mp4,.webm,.mov,.m4v,.avi"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>

              <button type="button" onClick={clearVideoFile} className="secondary-button">
                <span>Remove Video</span>
              </button>

              <button type="button" onClick={handleManualSync} className="secondary-button">
                <RefreshCw size={18} />
                <span>Force Sync</span>
              </button>

              <button
                type="button"
                onClick={handleTheaterToggle}
                className="secondary-button"
                aria-pressed={isTheaterMode}
              >
                {isTheaterMode ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                <span>{isTheaterMode ? 'Exit Theater' : 'Theater Mode'}</span>
              </button>

              {audioTracks.length > 1 && (
                <div className="relative flex items-center bg-[var(--panel-quiet)] rounded-[12px] pl-3 pr-2 py-1.5 focus-within:ring-2 focus-within:ring-[var(--accent)] border border-[var(--border-color)]">
                  <Volume2 size={16} className="text-[var(--text-muted)] mr-2 flex-shrink-0" />
                  <select
                    value={audioTracks.find((t) => t.enabled)?.id ?? ''}
                    onChange={handleAudioTrackSwitch}
                    className="appearance-none bg-transparent text-sm font-medium text-[var(--text-main)] outline-none pr-4 min-w-[80px]"
                  >
                    {audioTracks.map((track) => (
                      <option key={track.id} value={track.id} className="bg-[var(--panel-strong)] text-[var(--text-main)]">
                        {track.label} {track.language ? `(${track.language})` : ''}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="text-[var(--text-muted)] pointer-events-none absolute right-2" />
                </div>
              )}
            </div>

            <div className="metric-pill">
              <span className="text-[11px] font-semibold uppercase tracking-[0.26em] text-[var(--text-muted)]">
                Drift
              </span>
              {drift > 0.5 && <AlertTriangle size={18} className={getDriftColor()} />}
              <span className={`font-mono text-lg font-bold ${getDriftColor()}`}>{drift.toFixed(2)}s</span>
            </div>
          </div>
        </div>

        <div
          className={`chat-shell ${isChatCollapsed ? 'chat-shell-collapsed' : ''} ${isTheaterMode ? 'chat-shell-theater' : ''}`}
        >
          <button
            type="button"
            className="chat-toggle"
            onClick={handleChatToggle}
            aria-expanded={isChatExpanded}
          >
            <div className="chat-toggle-main">
              <MessageSquare size={18} />
              {isChatExpanded ? <span>Room chat</span> : null}
            </div>
            <div className="chat-toggle-side">
              {unreadMessages > 0 ? <span className="chat-badge">{unreadMessages}</span> : null}
              {isChatCollapsed ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
            </div>
          </button>

          {isChatExpanded ? (
            <ChatPanel
              chatScrollRef={chatScrollRef}
              chatInputRef={chatInputRef}
              chatImageInputRef={chatImageInputRef}
              chatMessages={chatMessages}
              chatDraft={chatDraft}
              setChatDraft={setChatDraft}
              isEmojiStripCollapsed={isEmojiStripCollapsed}
              currentParticipantId={currentParticipantId}
              participantsCount={participantsCount}
              handleChatKeyDown={handleChatKeyDown}
              handleSendChatMessage={handleSendChatMessage}
              handleEmojiSelect={handleEmojiSelect}
              handleEmojiStripToggle={handleEmojiStripToggle}
              handleChatImageChange={handleChatImageChange}
              EmojiText={EmojiText}
              topChatEmojis={topChatEmojis}
            />
          ) : null}
        </div>
      </div>

      <SidebarColumn
        isTheaterMode={isTheaterMode}
        isConnected={isConnected}
        participantsCount={participantsCount}
        roomId={roomId}
        roomLinkCopied={roomLinkCopied}
        handleCopyRoomLink={handleCopyRoomLink}
        roomPin={roomPin}
        videoLabel={_videoLabel}
        handleFileChange={handleFileChange}
        videoSrc={trustedVideoSrc ?? null}
        clearVideoFile={clearVideoFile}
        displayName={displayName}
        setDisplayName={setDisplayName}
        handleSaveDisplayName={handleSaveDisplayName}
        subtitleLabel={subtitleLabel}
        handleSubtitleChange={handleSubtitleChange}
        subtitleSrc={subtitleSrc}
        clearSubtitleTrack={clearSubtitleTrack}
        currentParticipantId={currentParticipantId}
        memberProfiles={memberProfiles}
      />
    </div>
  );
}

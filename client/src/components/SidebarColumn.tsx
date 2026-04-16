import React from 'react';
import {
  Check,
  Copy,
  FileText,
  Upload,
  Users,
  WifiOff,
} from 'lucide-react';
import type { MemberProfile } from '../types';

interface SidebarColumnProps {
  isTheaterMode: boolean;
  isConnected: boolean;
  participantsCount: number;
  roomId: string;
  roomLinkCopied: boolean;
  handleCopyRoomLink: () => void;
  roomPin: string;
  videoLabel: string | null;
  videoSrc: string | null;
  handleFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  clearVideoFile: () => void;
  displayName: string;
  setDisplayName: (name: string) => void;
  handleSaveDisplayName: () => void;
  subtitleLabel: string | null;
  subtitleSrc: string | null;
  handleSubtitleChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  clearSubtitleTrack: () => void;
  currentParticipantId: string;
  memberProfiles: MemberProfile[];
}

export function SidebarColumn({
  isTheaterMode,
  isConnected,
  participantsCount,
  roomId,
  roomLinkCopied,
  handleCopyRoomLink,
  roomPin,
  videoLabel,
  videoSrc,
  handleFileChange,
  clearVideoFile,
  displayName,
  setDisplayName,
  handleSaveDisplayName,
  subtitleLabel,
  subtitleSrc,
  handleSubtitleChange,
  clearSubtitleTrack,
  currentParticipantId,
  memberProfiles,
}: Readonly<SidebarColumnProps>) {
  const otherMembers = memberProfiles.filter((member) => member.participantId !== currentParticipantId);
  const currentMemberName =
    memberProfiles.find((member) => member.participantId === currentParticipantId)?.displayName || displayName || 'You';

  return (
    <aside className={`sidebar-column flex flex-col gap-6 ${isTheaterMode ? 'sidebar-column-theater' : ''}`}>
      {!isConnected && (
        <div className="status-card status-card-offline">
          <WifiOff size={24} />
          <div>
            <h3 className="text-base font-semibold">Disconnected</h3>
            <p className="text-sm text-current/80">Reconnecting to the room server.</p>
          </div>
        </div>
      )}

      <div className="chrome-panel rounded-[32px] p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="eyebrow">
              <Users size={14} />
              <span>Session info</span>
            </p>
            <h3 className="mt-3 text-2xl font-semibold tracking-tight text-[var(--text-main)]">Room details</h3>
          </div>

          <div className="metric-pill px-3 py-2">
            <Users size={16} />
            <span className="font-semibold text-[var(--text-main)]">{participantsCount}</span>
          </div>
        </div>

        <div className="mt-7 space-y-5">
          <div>
            <p className="block text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--text-muted)]">
              Room code
            </p>
            <div className="mt-2 rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-quiet)] px-4 py-4 text-center font-mono text-lg font-semibold tracking-[0.08em] text-[var(--text-main)]">
              {roomId}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button type="button" onClick={handleCopyRoomLink} className="secondary-button">
                {roomLinkCopied ? <Check size={16} /> : <Copy size={16} />}
                <span>{roomLinkCopied ? 'Copied Link' : 'Copy Room Link'}</span>
              </button>
              <span className="text-xs text-[var(--text-muted)]">
                Anyone opening the link joins this room right away.
              </span>
            </div>
          </div>

          <div>
            <p className="block text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--text-muted)]">
              Room PIN
            </p>
            <div className="mt-2 rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-quiet)] px-4 py-4 text-center font-mono text-lg font-semibold tracking-[0.12em] text-[var(--text-main)]">
              {roomPin}
            </div>
          </div>

          <div>
            <p className="block text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--text-muted)]">
              Current video
            </p>
            <div className="mt-2 rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-quiet)] px-4 py-4 text-center text-sm font-medium text-[var(--text-main)]">
              {videoLabel ?? 'No local file loaded'}
            </div>
            <div className="mt-3 flex flex-wrap gap-3">
              <label className="secondary-button cursor-pointer">
                <Upload size={16} />
                <span>{videoLabel ? 'Switch Video' : 'Add Video'}</span>
                <input
                  id="upload-video-sidebar"
                  name="videoFileSidebar"
                  type="file"
                  accept="video/*,.mkv,.mp4,.webm,.mov,.m4v,.avi"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>
              {videoSrc ? (
                <button type="button" onClick={clearVideoFile} className="secondary-button">
                  Remove
                </button>
              ) : null}
            </div>
          </div>

          <div>
            <label htmlFor="sidebar-display-name" className="block text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--text-muted)]">
              Your name
            </label>
            <div className="mt-2 flex flex-col gap-3 sm:flex-row">
              <input
                id="sidebar-display-name"
                name="displayNameSidebar"
                type="text"
                autoComplete="name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Choose a chat name"
                className="input-shell flex-1 py-3 text-base"
                maxLength={24}
              />
              <button type="button" onClick={handleSaveDisplayName} className="secondary-button">
                Save
              </button>
            </div>
          </div>

          <div className="role-banner role-banner-shared">
            <Users size={18} />
            <span>Everyone in this room can control playback</span>
          </div>

          <div className="subtitle-card">
            <div className="flex items-start gap-3">
              <div className="subtitle-icon">
                <FileText size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--text-muted)]">
                  Subtitles
                </p>
                <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
                  Any viewer can add local `.vtt` or `.srt` subtitles for their own playback.
                </p>
                <p className="mt-3 truncate text-sm font-medium text-[var(--text-main)]">
                  {subtitleLabel ?? 'No subtitle file loaded'}
                </p>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              <label className="secondary-button cursor-pointer">
                <Upload size={16} />
                <span>{subtitleLabel ? 'Replace Subs' : 'Add Subtitles'}</span>
                <input
                  id="upload-subtitles"
                  name="subtitleFile"
                  type="file"
                  accept=".vtt,.srt,text/vtt,application/x-subrip"
                  onChange={handleSubtitleChange}
                  className="hidden"
                />
              </label>
              {subtitleSrc ? (
                <button type="button" onClick={clearSubtitleTrack} className="secondary-button">
                  Remove
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div className="mt-8 space-y-4 text-sm text-[var(--text-muted)]">
          <div className="member-strip">
            <div className="member-strip-header">
              <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--text-muted)]">
                In the room
              </span>
              <span className="text-sm font-medium text-[var(--text-main)]">{currentMemberName}</span>
            </div>
            <div className="member-chip-row">
              {otherMembers.length > 0 ? (
                otherMembers.map((member) => (
                  <span key={member.participantId} className="member-chip">
                    {member.displayName}
                  </span>
                ))
              ) : (
                <span className="text-sm text-[var(--text-muted)]">Waiting for someone else to join.</span>
              )}
            </div>
          </div>

          <div className="feature-row">
            <span className="feature-dot" />
            <span>Low-latency room sync across connected viewers</span>
          </div>
          <div className="feature-row">
            <span className="feature-dot" />
            <span>Video stays local for full-resolution playback</span>
          </div>
          <div className="feature-row">
            <span className="feature-dot" />
            <span>Theme-aware layout with ambient gradients and glass panels</span>
          </div>
        </div>
      </div>
    </aside>
  );
}

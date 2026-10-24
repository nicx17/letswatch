// Small drifts are expected across browsers, decoders, and networks. Detection and
// correction must share this value, or drift between two thresholds is never fixed.
export const DRIFT_TOLERANCE_SECONDS = 1;

interface PlaybackSnapshot {
  position: number;
  updatedAt: number;
  playing?: boolean;
}

export class SyncController {
  private readonly threshold = DRIFT_TOLERANCE_SECONDS;

  calculateDrift(localTime: number, serverSnapshot: PlaybackSnapshot): number {
    return Math.abs(localTime - this.getTargetTime(serverSnapshot));
  }

  shouldForceSync(drift: number): boolean {
    return drift > this.threshold;
  }

  // True when local playback already agrees with the room, which means a media
  // event was caused by applying room state (or is redundant) and must not be rebroadcast.
  matchesRoomState(local: { position: number; playing: boolean }, roomSnapshot: PlaybackSnapshot | null): boolean {
    if (!roomSnapshot) return false;
    if (Boolean(roomSnapshot.playing) !== local.playing) return false;
    return !this.shouldForceSync(this.calculateDrift(local.position, roomSnapshot));
  }

  getTargetTime(serverSnapshot: PlaybackSnapshot): number {
    const now = Date.now();
    const serverElapsed = serverSnapshot.playing ? (now - serverSnapshot.updatedAt) / 1000 : 0;

    // Followers seek to the server's current notion of playback, not the stale timestamp.
    return serverSnapshot.position + serverElapsed;
  }
}

export class SyncController {
  // Small drifts are expected across browsers, decoders, and networks.
  private threshold = 1.0;
  
  calculateDrift(localTime: number, serverSnapshot: { position: number, updatedAt: number, playing?: boolean }): number {
    const now = Date.now();
    
    // When playback is paused, the server's position should stay fixed.
    const serverElapsed = serverSnapshot.playing ? (now - serverSnapshot.updatedAt) / 1000 : 0;
    const expectedTime = serverSnapshot.position + serverElapsed;
    
    return Math.abs(localTime - expectedTime);
  }

  shouldForceSync(drift: number): boolean {
    return drift > this.threshold;
  }

  getTargetTime(serverSnapshot: { position: number, updatedAt: number, playing?: boolean }): number {
    const now = Date.now();
    const serverElapsed = serverSnapshot.playing ? (now - serverSnapshot.updatedAt) / 1000 : 0;

    // Followers seek to the server's current notion of playback, not the stale timestamp.
    return serverSnapshot.position + serverElapsed;
  }
}

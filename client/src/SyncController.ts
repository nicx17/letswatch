export class SyncController {
  private threshold = 1.0; // 1 second drift allowed
  
  calculateDrift(localTime: number, serverSnapshot: { position: number, updatedAt: number, playing?: boolean }): number {
    const now = Date.now();
    
    // Only calculate elapsed time if video is playing. Not if paused.
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
    return serverSnapshot.position + serverElapsed;
  }
}

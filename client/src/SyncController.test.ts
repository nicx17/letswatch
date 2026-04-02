import { describe, it, expect } from 'vitest';
import { SyncController } from './SyncController';

describe('SyncController', () => {
    it('Should calculate zero drift when perfectly synced', () => {
        const syncController = new SyncController();
        const serverSnapshot = { position: 10, updatedAt: Date.now() - 1000, playing: true };
        const localTime = 11; // If it updated 1 second ago at 10s, local time should be 11.
        
        const drift = syncController.calculateDrift(localTime, serverSnapshot);
        expect(drift).toBeLessThan(0.05); // Allow millisecond variance
    });

    it('Should calculate drift correctly when paused', () => {
        const syncController = new SyncController();
        const serverSnapshot = { position: 15, updatedAt: Date.now() - 5000, playing: false };
        const localTime = 15.5; // E.g., user dragged slightly ahead
        
        const drift = syncController.calculateDrift(localTime, serverSnapshot);
        expect(drift).toBeCloseTo(0.5); // Since playing is false, target time is just position (15).
    });

    it('shouldForceSync should return true if drift exceeds threshold', () => {
        const syncController = new SyncController();
        expect(syncController.shouldForceSync(0.5)).toBe(false);
        expect(syncController.shouldForceSync(1.5)).toBe(true);
    });

    it('Should get expected target time mathematically', () => {
        const syncController = new SyncController();
        const past = Date.now() - 2500; // 2.5 seconds ago
        const serverSnapshot = { position: 30, updatedAt: past, playing: true };
        
        const targetTime = syncController.getTargetTime(serverSnapshot);
        expect(targetTime).toBeGreaterThanOrEqual(32.49);
        expect(targetTime).toBeLessThanOrEqual(32.51);
    });
});
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncController } from './SyncController';

describe('SyncController', () => {
  const syncController = new SyncController();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-17T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calculates zero drift when local playback matches the projected server time', () => {
    const serverSnapshot = {
      position: 10,
      updatedAt: Date.now() - 1000,
      playing: true,
    };

    expect(syncController.calculateDrift(11, serverSnapshot)).toBe(0);
  });

  it('measures drift against the frozen server position when playback is paused', () => {
    const serverSnapshot = {
      position: 15,
      updatedAt: Date.now() - 5000,
      playing: false,
    };

    expect(syncController.calculateDrift(15.5, serverSnapshot)).toBeCloseTo(0.5);
  });

  it('treats an omitted playing flag as not advancing playback time', () => {
    const serverSnapshot = {
      position: 42,
      updatedAt: Date.now() - 3000,
    };

    expect(syncController.calculateDrift(44, serverSnapshot)).toBe(2);
    expect(syncController.getTargetTime(serverSnapshot)).toBe(42);
  });

  it('only forces a sync when drift exceeds the threshold', () => {
    expect(syncController.shouldForceSync(1)).toBe(false);
    expect(syncController.shouldForceSync(1.0001)).toBe(true);
  });

  it('projects the current target time from the server snapshot while playing', () => {
    const serverSnapshot = {
      position: 30,
      updatedAt: Date.now() - 2500,
      playing: true,
    };

    expect(syncController.getTargetTime(serverSnapshot)).toBe(32.5);
  });

  it('returns the snapshot position directly when paused', () => {
    const serverSnapshot = {
      position: 18.25,
      updatedAt: Date.now() - 9000,
      playing: false,
    };

    expect(syncController.getTargetTime(serverSnapshot)).toBe(18.25);
  });
});

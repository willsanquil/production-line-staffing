import { describe, it, expect } from 'vitest';
import { isViewerHeartbeatStale, CLOUD_VIEWER_IDLE_MS } from './cloudViewerSession';

describe('cloudViewerSession', () => {
  it('isViewerHeartbeatStale is true for null/undefined', () => {
    expect(isViewerHeartbeatStale(null, 1_000_000)).toBe(true);
    expect(isViewerHeartbeatStale(undefined, 1_000_000)).toBe(true);
  });

  it('isViewerHeartbeatStale is false for fresh heartbeat', () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    const iso = new Date(now - 60_000).toISOString();
    expect(isViewerHeartbeatStale(iso, now)).toBe(false);
  });

  it('isViewerHeartbeatStale matches idle window', () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    const old = new Date(now - CLOUD_VIEWER_IDLE_MS - 1).toISOString();
    expect(isViewerHeartbeatStale(old, now)).toBe(true);
  });
});

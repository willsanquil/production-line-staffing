/** Idle time with no clicks/keys before auto-return to home (cloud lines). */
export const CLOUD_VIEWER_IDLE_MS = 10 * 60 * 1000;

/** How often we renew the server-side edit lock while editing. */
export const CLOUD_VIEWER_SYNC_MS = 25 * 1000;

const STORAGE_PREFIX = 'staffing-cloud-viewer-';

export function getOrCreateCloudViewerSession(lineId: string): string {
  try {
    const k = STORAGE_PREFIX + lineId;
    const ex = sessionStorage.getItem(k);
    if (ex) return ex;
    const id = crypto.randomUUID();
    sessionStorage.setItem(k, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export function clearCloudViewerSession(lineId: string): void {
  try {
    sessionStorage.removeItem(STORAGE_PREFIX + lineId);
  } catch {
    /* ignore */
  }
}

export function isViewerHeartbeatStale(iso: string | null | undefined, nowMs: number = Date.now()): boolean {
  if (!iso) return true;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) || nowMs - t > CLOUD_VIEWER_IDLE_MS;
}

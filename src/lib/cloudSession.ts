const CLOUD_LINE_ID = 'staffing-cloud-line-id';
const CLOUD_PASSWORD = 'staffing-cloud-password';
const CLOUD_SESSION_EXPIRES_AT = 'staffing-cloud-session-expires-at';
const CLOUD_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export function getCloudSession(): { lineId: string; password: string } | null {
  try {
    const lineId = sessionStorage.getItem(CLOUD_LINE_ID);
    const password = sessionStorage.getItem(CLOUD_PASSWORD);
    const expiresAt = Number(sessionStorage.getItem(CLOUD_SESSION_EXPIRES_AT) ?? '0');
    if (expiresAt > 0 && Date.now() > expiresAt) {
      clearCloudSession();
      return null;
    }
    if (lineId && password) return { lineId, password };
  } catch {
    // ignore
  }
  return null;
}

export function setCloudSession(lineId: string, password: string): void {
  try {
    sessionStorage.setItem(CLOUD_LINE_ID, lineId);
    sessionStorage.setItem(CLOUD_PASSWORD, password);
    sessionStorage.setItem(CLOUD_SESSION_EXPIRES_AT, String(Date.now() + CLOUD_SESSION_TTL_MS));
  } catch {
    // ignore
  }
}

export function clearCloudSession(): void {
  try {
    sessionStorage.removeItem(CLOUD_LINE_ID);
    sessionStorage.removeItem(CLOUD_PASSWORD);
    sessionStorage.removeItem(CLOUD_SESSION_EXPIRES_AT);
  } catch {
    // ignore
  }
}

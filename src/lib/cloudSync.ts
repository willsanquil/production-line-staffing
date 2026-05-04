export const CLOUD_POLL_MS = 4000;
export const CLOUD_POLL_SKIP_AFTER_LOCAL_CHANGE_MS = 12000;

export type CloudSyncAppMode = 'entry' | 'loading-cloud' | 'app';

export interface CloudPollDecisionInput {
  appMode: CloudSyncAppMode;
  cloudLineId: string | null;
  password: string | null;
  saveInProgress: boolean;
  lastLocalChangeAt: number;
  now: number;
}

export function shouldPollCloudLine({
  appMode,
  cloudLineId,
  password,
  saveInProgress,
  lastLocalChangeAt,
  now,
}: CloudPollDecisionInput): boolean {
  if (appMode !== 'app' || !cloudLineId || !password) return false;
  if (saveInProgress) return false;
  return now - lastLocalChangeAt >= CLOUD_POLL_SKIP_AFTER_LOCAL_CHANGE_MS;
}

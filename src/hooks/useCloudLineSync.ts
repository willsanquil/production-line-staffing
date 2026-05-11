import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { RootState } from '../types';
import { clearHydrateCache } from '../lib/initialState';
import {
  CloudConflictError,
  CloudNotEditorError,
  getLineState,
  setLineState,
  viewerPresence,
} from '../lib/cloudLines';
import {
  CLOUD_VIEWER_IDLE_MS,
  CLOUD_VIEWER_SYNC_MS,
  clearCloudViewerSession,
  getOrCreateCloudViewerSession,
  isViewerHeartbeatStale,
} from '../lib/cloudViewerSession';
import { CLOUD_POLL_MS, shouldPollCloudLine, type CloudSyncAppMode } from '../lib/cloudSync';
import { buildPersistedRootState, type LineDraftState } from '../lib/lineDraftState';
import { saveRootState } from '../lib/persist';
import { clearCloudSession, getCloudSession } from '../lib/cloudSession';

interface UseCloudLineSyncOptions {
  appMode: CloudSyncAppMode;
  setAppMode: Dispatch<SetStateAction<CloudSyncAppMode>>;
  cloudLineId: string | null;
  setCloudLineId: Dispatch<SetStateAction<string | null>>;
  cloudPasswordRef: MutableRefObject<string | null>;
  rootStateRef: MutableRefObject<RootState>;
  draftStateRef: MutableRefObject<LineDraftState>;
  setRootState: Dispatch<SetStateAction<RootState>>;
  reloadLineState: () => void;
  persistDebounceMs: number;
  persistDeps: readonly unknown[];
  /** Called when this tab loses the edit lock to another live viewer (e.g. YEET). */
  onViewerKickedToHome?: () => void;
  /** Called after 10 minutes with no clicks/keys while on a cloud line. */
  onIdleReturnToEntry?: () => void;
}

export function useCloudLineSync({
  appMode,
  setAppMode,
  cloudLineId,
  setCloudLineId,
  cloudPasswordRef,
  rootStateRef,
  draftStateRef,
  setRootState,
  reloadLineState,
  persistDebounceMs,
  persistDeps,
  onViewerKickedToHome,
  onIdleReturnToEntry,
}: UseCloudLineSyncOptions) {
  const [cloudConflictBanner, setCloudConflictBanner] = useState(false);
  const [cloudViewerRole, setCloudViewerRole] = useState<'editor' | 'readonly'>('editor');
  const [yeetBusy, setYeetBusy] = useState(false);

  const lastLocalChangeRef = useRef(0);
  const lastUserActivityRef = useRef(Date.now());
  const cloudSaveInProgressRef = useRef(false);
  const pendingCloudPayloadRef = useRef<RootState | null>(null);
  const lastCloudUpdatedAtRef = useRef<string | null>(null);
  const lastCloudVersionRef = useRef<number | null>(null);
  const persistTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistFlushRef = useRef<(() => void) | null>(null);

  const viewerSessionIdRef = useRef<string | null>(null);
  const cloudViewerRoleRef = useRef<'editor' | 'readonly'>('editor');
  const wasHoldingEditorLockRef = useRef(false);
  const kickHandledRef = useRef(false);
  const idleDismissedRef = useRef(false);

  useEffect(() => {
    cloudViewerRoleRef.current = cloudViewerRole;
  }, [cloudViewerRole]);

  useEffect(() => {
    if (!cloudLineId) {
      setCloudViewerRole('editor');
      cloudViewerRoleRef.current = 'editor';
      viewerSessionIdRef.current = null;
      wasHoldingEditorLockRef.current = false;
      kickHandledRef.current = false;
      idleDismissedRef.current = false;
    } else {
      kickHandledRef.current = false;
      idleDismissedRef.current = false;
    }
  }, [cloudLineId]);

  const bumpUserActivity = useCallback(() => {
    lastUserActivityRef.current = Date.now();
  }, []);

  const markLocalChange = useCallback(() => {
    bumpUserActivity();
    if (cloudLineId && cloudViewerRoleRef.current === 'readonly') return;
    lastLocalChangeRef.current = Date.now();
  }, [bumpUserActivity, cloudLineId]);

  const applyConflictRefresh = useCallback(
    (lineId: string, password: string) => {
      getLineState(lineId, password)
        .then(({ rootState: fresh, updatedAt, version }) => {
          lastCloudUpdatedAtRef.current = updatedAt || null;
          lastCloudVersionRef.current = typeof version === 'number' ? version : null;
          setRootState(fresh);
          reloadLineState();
          setCloudConflictBanner(true);
          setTimeout(() => setCloudConflictBanner(false), 6000);
        })
        .catch(() => {});
    },
    [reloadLineState, setRootState]
  );

  const persistPayload = useCallback(
    (payload: RootState) => {
      const lineId = cloudLineId;
      const password = cloudPasswordRef.current;
      if (lineId && password) {
        if (cloudViewerRoleRef.current === 'readonly') {
          return;
        }
        if (cloudSaveInProgressRef.current) {
          pendingCloudPayloadRef.current = payload;
          return;
        }
        cloudSaveInProgressRef.current = true;
        const editorSessionId = viewerSessionIdRef.current ?? undefined;
        setLineState(lineId, password, payload, {
          updatedAt: lastCloudUpdatedAtRef.current ?? undefined,
          version: lastCloudVersionRef.current ?? undefined,
          editorSessionId,
        })
          .then((res) => {
            if (res?.updatedAt) lastCloudUpdatedAtRef.current = res.updatedAt;
            if (typeof res?.version === 'number') lastCloudVersionRef.current = res.version;
          })
          .catch((e) => {
            if (e instanceof CloudConflictError) {
              applyConflictRefresh(lineId, password);
            } else if (e instanceof CloudNotEditorError) {
              cloudViewerRoleRef.current = 'readonly';
              setCloudViewerRole('readonly');
            } else {
              console.error('Cloud save failed:', e);
            }
          })
          .finally(() => {
            cloudSaveInProgressRef.current = false;
            const pendingPayload = pendingCloudPayloadRef.current;
            if (pendingPayload) {
              pendingCloudPayloadRef.current = null;
              setTimeout(() => persistFlushRef.current?.(), 0);
            }
          });
      } else {
        saveRootState(payload);
        clearHydrateCache();
      }
    },
    [applyConflictRefresh, cloudLineId, cloudPasswordRef]
  );

  const flushNow = useCallback(() => {
    if (persistTimeoutRef.current) {
      clearTimeout(persistTimeoutRef.current);
      persistTimeoutRef.current = null;
    }
    persistPayload(buildPersistedRootState(rootStateRef.current, draftStateRef.current));
  }, [draftStateRef, persistPayload, rootStateRef]);

  const schedulePersistForRootEdit = useCallback(() => {
    markLocalChange();
    setTimeout(() => persistFlushRef.current?.(), 0);
  }, [markLocalChange]);

  const setCloudUpdatedAt = useCallback((updatedAt: string | null, version?: number) => {
    lastCloudUpdatedAtRef.current = updatedAt;
    lastCloudVersionRef.current = typeof version === 'number' ? version : null;
  }, []);

  const yeetOtherViewer = useCallback(async () => {
    const lineId = cloudLineId;
    const password = cloudPasswordRef.current;
    const sid = viewerSessionIdRef.current;
    if (!lineId || !password || !sid) return;
    setYeetBusy(true);
    try {
      await viewerPresence(lineId, password, sid, 'yeet');
      cloudViewerRoleRef.current = 'editor';
      setCloudViewerRole('editor');
      wasHoldingEditorLockRef.current = true;
      bumpUserActivity();
    } catch (e) {
      console.error('YEET failed:', e);
    } finally {
      setYeetBusy(false);
    }
  }, [bumpUserActivity, cloudLineId, cloudPasswordRef]);

  useEffect(() => {
    if (appMode !== 'loading-cloud') return;
    const session = getCloudSession();
    if (!session) {
      setAppMode('entry');
      return;
    }
    getLineState(session.lineId, session.password)
      .then(({ rootState: root, updatedAt, version }) => {
        setRootState(root);
        lastCloudUpdatedAtRef.current = updatedAt || null;
        lastCloudVersionRef.current = typeof version === 'number' ? version : null;
        setCloudLineId(session.lineId);
        cloudPasswordRef.current = session.password;
        reloadLineState();
        setAppMode('app');
      })
      .catch(() => {
        clearCloudSession();
        setAppMode('entry');
      });
  }, [appMode, cloudPasswordRef, reloadLineState, setAppMode, setCloudLineId, setRootState]);

  /** Claim or renew viewer lock; refresh readonly/editor role. */
  useEffect(() => {
    if (appMode !== 'app' || !cloudLineId) return;
    const password = cloudPasswordRef.current;
    if (!password) return;
    const sid = getOrCreateCloudViewerSession(cloudLineId);
    viewerSessionIdRef.current = sid;
    let cancelled = false;
    viewerPresence(cloudLineId, password, sid, 'sync')
      .then((r) => {
        if (cancelled) return;
        const role = r.role === 'editor' ? 'editor' : 'readonly';
        cloudViewerRoleRef.current = role;
        setCloudViewerRole(role);
        wasHoldingEditorLockRef.current = role === 'editor';
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [appMode, cloudLineId, cloudPasswordRef]);

  useEffect(() => {
    if (appMode !== 'app' || !cloudLineId) return;
    const password = cloudPasswordRef.current;
    if (!password) return;
    const id = window.setInterval(() => {
      const sid = viewerSessionIdRef.current;
      if (!sid) return;
      viewerPresence(cloudLineId, password, sid, 'sync')
        .then((r) => {
          const role = r.role === 'editor' ? 'editor' : 'readonly';
          cloudViewerRoleRef.current = role;
          setCloudViewerRole(role);
          if (role === 'editor') wasHoldingEditorLockRef.current = true;
        })
        .catch(() => {});
    }, CLOUD_VIEWER_SYNC_MS);
    return () => window.clearInterval(id);
  }, [appMode, cloudLineId, cloudPasswordRef]);

  useEffect(() => {
    if (appMode !== 'app' || !cloudLineId) return;
    const bump = () => bumpUserActivity();
    window.addEventListener('click', bump, true);
    window.addEventListener('keydown', bump, true);
    return () => {
      window.removeEventListener('click', bump, true);
      window.removeEventListener('keydown', bump, true);
    };
  }, [appMode, bumpUserActivity, cloudLineId]);

  useEffect(() => {
    if (appMode !== 'app' || !cloudLineId) return;
    const tick = () => {
      if (idleDismissedRef.current) return;
      if (Date.now() - lastUserActivityRef.current < CLOUD_VIEWER_IDLE_MS) return;
      idleDismissedRef.current = true;
      const lineId = cloudLineId;
      const password = cloudPasswordRef.current;
      const sid = viewerSessionIdRef.current;
      if (lineId && password && sid) {
        viewerPresence(lineId, password, sid, 'release').catch(() => {});
        clearCloudViewerSession(lineId);
      }
      onIdleReturnToEntry?.();
    };
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, [appMode, cloudLineId, onIdleReturnToEntry]);

  useEffect(() => {
    if (appMode !== 'app') return;
    persistFlushRef.current = flushNow;
    const id = setTimeout(() => {
      persistPayload(buildPersistedRootState(rootStateRef.current, draftStateRef.current));
      persistTimeoutRef.current = null;
    }, persistDebounceMs);
    persistTimeoutRef.current = id;
    return () => {
      flushNow();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appMode, flushNow, persistDebounceMs, persistPayload, rootStateRef, draftStateRef, ...persistDeps]);

  useEffect(() => {
    function onLeave() {
      persistFlushRef.current?.();
    }
    window.addEventListener('pagehide', onLeave);
    window.addEventListener('beforeunload', onLeave);
    return () => {
      window.removeEventListener('pagehide', onLeave);
      window.removeEventListener('beforeunload', onLeave);
    };
  }, []);

  useEffect(() => {
    if (appMode !== 'app' || !cloudLineId) return;
    const password = cloudPasswordRef.current;
    if (!password) return;
    const intervalId = setInterval(() => {
      if (
        !shouldPollCloudLine({
          appMode,
          cloudLineId,
          password,
          saveInProgress: cloudSaveInProgressRef.current,
          lastLocalChangeAt: lastLocalChangeRef.current,
          now: Date.now(),
        })
      ) {
        return;
      }
      getLineState(cloudLineId, password)
        .then(({ rootState: root, updatedAt, version, viewerSessionId: serverViewer, viewerHeartbeatAt: serverHb }) => {
          if (cloudSaveInProgressRef.current) return;
          const sid = viewerSessionIdRef.current;
          const iAmEditor =
            Boolean(sid && serverViewer === sid && !isViewerHeartbeatStale(serverHb ?? null));
          const iWasEditor = wasHoldingEditorLockRef.current;
          wasHoldingEditorLockRef.current = iAmEditor;

          if (
            iWasEditor &&
            !iAmEditor &&
            serverViewer != null &&
            serverViewer !== sid &&
            !isViewerHeartbeatStale(serverHb ?? null)
          ) {
            if (!kickHandledRef.current) {
              kickHandledRef.current = true;
              onViewerKickedToHome?.();
            }
            return;
          }

          lastCloudUpdatedAtRef.current = updatedAt || null;
          lastCloudVersionRef.current = typeof version === 'number' ? version : null;
          setRootState(root);
          reloadLineState();
        })
        .catch(() => {});
    }, CLOUD_POLL_MS);
    return () => clearInterval(intervalId);
  }, [appMode, cloudLineId, cloudPasswordRef, onViewerKickedToHome, reloadLineState, setRootState]);

  return {
    cloudConflictBanner,
    cloudViewerRole,
    yeetBusy,
    yeetOtherViewer,
    markLocalChange,
    schedulePersistForRootEdit,
    setCloudUpdatedAt,
  };
}

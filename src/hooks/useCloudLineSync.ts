import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { RootState } from '../types';
import { clearHydrateCache } from '../lib/initialState';
import { CloudConflictError, getLineState, setLineState } from '../lib/cloudLines';
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
}: UseCloudLineSyncOptions) {
  const [cloudConflictBanner, setCloudConflictBanner] = useState(false);
  const lastLocalChangeRef = useRef(0);
  const cloudSaveInProgressRef = useRef(false);
  const pendingCloudPayloadRef = useRef<RootState | null>(null);
  const lastCloudUpdatedAtRef = useRef<string | null>(null);
  const lastCloudVersionRef = useRef<number | null>(null);
  const persistTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistFlushRef = useRef<(() => void) | null>(null);

  const markLocalChange = useCallback(() => {
    lastLocalChangeRef.current = Date.now();
  }, []);

  const applyConflictRefresh = useCallback((lineId: string, password: string) => {
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
  }, [reloadLineState, setRootState]);

  const persistPayload = useCallback((payload: RootState) => {
    const lineId = cloudLineId;
    const password = cloudPasswordRef.current;
    if (lineId && password) {
      if (cloudSaveInProgressRef.current) {
        pendingCloudPayloadRef.current = payload;
        return;
      }
      cloudSaveInProgressRef.current = true;
      setLineState(lineId, password, payload, {
        updatedAt: lastCloudUpdatedAtRef.current ?? undefined,
        version: lastCloudVersionRef.current ?? undefined,
      })
        .then((res) => {
          if (res?.updatedAt) lastCloudUpdatedAtRef.current = res.updatedAt;
          if (typeof res?.version === 'number') lastCloudVersionRef.current = res.version;
        })
        .catch((e) => {
          if (e instanceof CloudConflictError) {
            applyConflictRefresh(lineId, password);
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
  }, [applyConflictRefresh, cloudLineId, cloudPasswordRef]);

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
    // persistDeps is supplied by App to keep this hook focused on persistence orchestration.
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
      if (!shouldPollCloudLine({
        appMode,
        cloudLineId,
        password,
        saveInProgress: cloudSaveInProgressRef.current,
        lastLocalChangeAt: lastLocalChangeRef.current,
        now: Date.now(),
      })) {
        return;
      }
      getLineState(cloudLineId, password)
        .then(({ rootState: root, updatedAt, version }) => {
          if (cloudSaveInProgressRef.current) return;
          lastCloudUpdatedAtRef.current = updatedAt || null;
          lastCloudVersionRef.current = typeof version === 'number' ? version : null;
          setRootState(root);
          reloadLineState();
        })
        .catch(() => {});
    }, CLOUD_POLL_MS);
    return () => clearInterval(intervalId);
  }, [appMode, cloudLineId, cloudPasswordRef, reloadLineState, setRootState]);

  return {
    cloudConflictBanner,
    markLocalChange,
    schedulePersistForRootEdit,
    setCloudUpdatedAt,
  };
}

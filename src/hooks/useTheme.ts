import { useCallback, useEffect, useState } from 'react';
import {
  applyModeToDocument,
  persistMode,
  readStoredMode,
  type ThemeMode,
} from '../lib/theme';

export function useTheme() {
  const [mode, setModeState] = useState<ThemeMode>(() =>
    typeof document !== 'undefined' ? readStoredMode() : 'light'
  );

  useEffect(() => {
    applyModeToDocument(mode);
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    persistMode(next);
  }, []);

  const toggleMode = useCallback(() => {
    setModeState((prev) => {
      const next = prev === 'light' ? 'dark' : 'light';
      persistMode(next);
      return next;
    });
  }, []);

  return { mode, setMode, toggleMode };
}

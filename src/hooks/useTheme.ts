import { useCallback, useEffect, useState } from 'react';
import {
  applyThemeToDocument,
  persistMode,
  persistTheme,
  readStoredMode,
  readStoredTheme,
  type ThemeId,
  type ThemeMode,
} from '../lib/theme';

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeId>(() =>
    typeof document !== 'undefined' ? readStoredTheme() : 'classic'
  );
  const [mode, setModeState] = useState<ThemeMode>(() =>
    typeof document !== 'undefined' ? readStoredMode() : 'light'
  );

  useEffect(() => {
    applyThemeToDocument(theme, mode);
  }, [theme, mode]);

  const setTheme = useCallback((next: ThemeId) => {
    setThemeState(next);
    persistTheme(next);
  }, []);

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

  return { theme, mode, setTheme, setMode, toggleMode };
}

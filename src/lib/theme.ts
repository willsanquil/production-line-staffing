export type ThemeMode = 'light' | 'dark';

export const MODE_STORAGE_KEY = 'pls-mode';

export function parseMode(value: string | null): ThemeMode {
  return value === 'dark' ? 'dark' : 'light';
}

export function readStoredMode(): ThemeMode {
  try {
    return parseMode(localStorage.getItem(MODE_STORAGE_KEY));
  } catch {
    return 'light';
  }
}

export function applyModeToDocument(mode: ThemeMode): void {
  document.documentElement.setAttribute('data-mode', mode);
}

export function persistMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
}

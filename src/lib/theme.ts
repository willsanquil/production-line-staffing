export type ThemeId = 'classic' | 'factory' | 'soft';
export type ThemeMode = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'pls-theme';
export const MODE_STORAGE_KEY = 'pls-mode';

export const THEME_OPTIONS: { id: ThemeId; label: string; hint: string }[] = [
  { id: 'classic', label: 'Classic', hint: 'Tesla red on black/white' },
  { id: 'factory', label: 'Factory', hint: 'Monochrome; red for danger only' },
  { id: 'soft', label: 'Soft', hint: 'Graphite with muted crimson' },
];

export function parseTheme(value: string | null): ThemeId {
  if (value === 'classic' || value === 'factory' || value === 'soft') return value;
  return 'classic';
}

export function parseMode(value: string | null): ThemeMode {
  return value === 'dark' ? 'dark' : 'light';
}

export function readStoredTheme(): ThemeId {
  try {
    return parseTheme(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'classic';
  }
}

export function readStoredMode(): ThemeMode {
  try {
    return parseMode(localStorage.getItem(MODE_STORAGE_KEY));
  } catch {
    return 'light';
  }
}

export function applyThemeToDocument(theme: ThemeId, mode: ThemeMode): void {
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  root.setAttribute('data-mode', mode);
}

export function persistTheme(theme: ThemeId): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* ignore */
  }
}

export function persistMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
}

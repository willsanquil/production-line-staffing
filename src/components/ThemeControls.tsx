import type { ThemeMode } from '../lib/theme';

interface ThemeControlsProps {
  mode: ThemeMode;
  toggleMode: () => void;
}

/** Light/dark mode toggle for app headers. */
export function ThemeControls({ mode, toggleMode }: ThemeControlsProps) {
  return (
    <button
      type="button"
      className="btn-ghost theme-controls-mode cloud-readonly-exempt"
      data-teams-copy-exclude=""
      onClick={toggleMode}
      title={mode === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
      aria-label={mode === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
    >
      {mode === 'light' ? 'Dark' : 'Light'}
    </button>
  );
}

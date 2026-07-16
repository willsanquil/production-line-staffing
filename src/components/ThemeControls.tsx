import { THEME_OPTIONS, type ThemeId, type ThemeMode } from '../lib/theme';

interface ThemeControlsProps {
  theme: ThemeId;
  mode: ThemeMode;
  setTheme: (theme: ThemeId) => void;
  toggleMode: () => void;
}

/** Theme palette + light/dark controls for app headers. */
export function ThemeControls({ theme, mode, setTheme, toggleMode }: ThemeControlsProps) {
  return (
    <div className="theme-controls cloud-readonly-exempt" data-teams-copy-exclude="">
      <label className="theme-controls-label">
        <span className="theme-controls-caption">Theme</span>
        <select
          className="theme-controls-select"
          value={theme}
          aria-label="Color theme"
          onChange={(e) => setTheme(e.target.value as ThemeId)}
        >
          {THEME_OPTIONS.map((opt) => (
            <option key={opt.id} value={opt.id} title={opt.hint}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="btn-ghost theme-controls-mode"
        onClick={toggleMode}
        title={mode === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
        aria-label={mode === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
      >
        {mode === 'light' ? 'Dark' : 'Light'}
      </button>
    </div>
  );
}

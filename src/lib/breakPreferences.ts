import type { BreakPreference } from '../types';

export interface BreakPreferenceOption {
  value: BreakPreference;
  label: string;
}

/** Break preference choices for a profile dropdown, scaled to rotation count. */
export function getBreakPreferenceOptions(rotationCount: number): BreakPreferenceOption[] {
  const n = Math.min(6, Math.max(1, rotationCount));
  const slotLabels = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth'];
  const options: BreakPreferenceOption[] = [{ value: 'no_preference', label: 'No preference (auto)' }];
  for (let r = 1; r <= n; r++) {
    const slot = slotLabels[r - 1] ?? `Break ${r}`;
    options.push({
      value: `prefer_rotation_${r}` as BreakPreference,
      label: `Prefer ${slot} break`,
    });
  }
  if (n <= 3) {
    options.push(
      { value: 'prefer_early', label: 'Prefer early (legacy)' },
      { value: 'prefer_late', label: 'Prefer late (legacy)' }
    );
  }
  return options;
}

/** Normalize stored preference when rotation count changes (e.g. rot 5 on a 3-rot line). */
export function normalizeBreakPreference(
  pref: BreakPreference | undefined,
  rotationCount: number
): BreakPreference {
  const p = pref ?? 'no_preference';
  const rotMatch = /^prefer_rotation_(\d+)$/.exec(p);
  if (rotMatch) {
    const rot = parseInt(rotMatch[1], 10);
    if (rot < 1 || rot > rotationCount) return 'no_preference';
  }
  return p;
}

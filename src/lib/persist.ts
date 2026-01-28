import type { AppState, SavedConfig, SavedDay, SlotsByArea } from '../types';
import { AREA_IDS } from '../types';

const KEY_STATE = 'staffing-app-state';
const KEY_CONFIGS = 'staffing-app-configs';
const KEY_DAYS = 'staffing-app-days';

function nanoid(): string {
  return Math.random().toString(36).slice(2, 11);
}

export function loadState(): AppState | null {
  try {
    const raw = localStorage.getItem(KEY_STATE);
    if (!raw) return null;
    return JSON.parse(raw) as AppState;
  } catch {
    return null;
  }
}

export function saveState(state: AppState): void {
  localStorage.setItem(KEY_STATE, JSON.stringify(state));
}

/** Export full app state as JSON string (for backup / restore). */
export function exportStateToJson(state: AppState): string {
  return JSON.stringify({ ...state, _exportedAt: new Date().toISOString() }, null, 2);
}

/** Import from a previously exported JSON string. Returns state or null if invalid. */
export function importStateFromJson(json: string): AppState | null {
  try {
    const data = JSON.parse(json) as Record<string, unknown>;
    if (!data || !Array.isArray(data.roster) || !data.slots || typeof data.slots !== 'object') return null;
    return data as unknown as AppState;
  } catch {
    return null;
  }
}

export function loadSavedConfigs(): SavedConfig[] {
  try {
    const raw = localStorage.getItem(KEY_CONFIGS);
    if (!raw) return [];
    return JSON.parse(raw) as SavedConfig[];
  } catch {
    return [];
  }
}

function saveConfigsList(configs: SavedConfig[]): void {
  localStorage.setItem(KEY_CONFIGS, JSON.stringify(configs));
}

export function addSavedConfig(name: string, slots: SlotsByArea, note?: string): SavedConfig {
  const configs = loadSavedConfigs();
  const newOne: SavedConfig = {
    id: nanoid(),
    name,
    note,
    savedAt: new Date().toISOString(),
    slots: JSON.parse(JSON.stringify(slots)),
  };
  configs.unshift(newOne);
  saveConfigsList(configs);
  return newOne;
}

export function loadSavedDays(): SavedDay[] {
  try {
    const raw = localStorage.getItem(KEY_DAYS);
    if (!raw) return [];
    return JSON.parse(raw) as SavedDay[];
  } catch {
    return [];
  }
}

function saveDaysList(days: SavedDay[]): void {
  localStorage.setItem(KEY_DAYS, JSON.stringify(days));
}

export function addSavedDay(
  date: string,
  state: AppState,
  name?: string
): SavedDay {
  const days = loadSavedDays();
  const newOne: SavedDay = {
    id: nanoid(),
    date,
    name,
    savedAt: new Date().toISOString(),
    roster: JSON.parse(JSON.stringify(state.roster)),
    slots: JSON.parse(JSON.stringify(state.slots)),
    leadSlots: JSON.parse(JSON.stringify(state.leadSlots)),
    juicedAreas: state.juicedAreas ? JSON.parse(JSON.stringify(state.juicedAreas)) : {},
    deJuicedAreas: state.deJuicedAreas ? JSON.parse(JSON.stringify(state.deJuicedAreas)) : {},
    sectionTasks: JSON.parse(JSON.stringify(state.sectionTasks)),
    schedule: JSON.parse(JSON.stringify(state.schedule)),
    dayNotes: state.dayNotes,
    documents: [...state.documents],
    breakSchedules: state.breakSchedules ? JSON.parse(JSON.stringify(state.breakSchedules)) : {},
  };
  days.push(newOne);
  saveDaysList(days);
  return newOne;
}

export function removeSavedDay(id: string): void {
  const days = loadSavedDays().filter((d) => d.id !== id);
  saveDaysList(days);
}

export function exportConfigJson(slots: SlotsByArea): string {
  return JSON.stringify({ slots, exportedAt: new Date().toISOString() }, null, 2);
}

export function importConfigJson(
  json: string,
  currentSlots: SlotsByArea
): SlotsByArea {
  const data = JSON.parse(json) as { slots: SlotsByArea };
  if (!data || typeof data.slots !== 'object') throw new Error('Invalid format');
  const imported = data.slots as Record<string, Array<{ id: string; personId: string | null }>>;
  const result = JSON.parse(JSON.stringify(currentSlots)) as SlotsByArea;
  for (const areaId of AREA_IDS) {
    const curr = result[areaId];
    const impr = imported[areaId];
    if (!curr || !Array.isArray(impr)) continue;
    for (let i = 0; i < curr.length && i < impr.length; i++) {
      curr[i].personId = impr[i].personId ?? null;
    }
  }
  return result;
}

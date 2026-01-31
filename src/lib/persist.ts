import type { AppState, LineState, RootState, RosterPerson, SavedConfig, SavedDay, SlotsByArea } from '../types';
import { AREA_IDS } from '../types';
import { getDefaultICLineConfig } from './lineConfig';
import { normalizeSlotsToCapacity } from '../data/initialState';

const KEY_STATE = 'staffing-app-state';
const KEY_CONFIGS = 'staffing-app-configs';
const KEY_DAYS = 'staffing-app-days';

function nanoid(): string {
  return Math.random().toString(36).slice(2, 11);
}

/** Load legacy single-line state (for migration). */
export function loadState(): AppState | null {
  try {
    const raw = localStorage.getItem(KEY_STATE);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data?.currentLineId != null && data?.lines != null && data?.lineStates != null) {
      return null;
    }
    return data as AppState;
  } catch {
    return null;
  }
}

export function saveState(state: AppState): void {
  localStorage.setItem(KEY_STATE, JSON.stringify(state));
}

function normalizeRosterPerson(p: RosterPerson): RosterPerson {
  const { defaultLineId: _d, ...rest } = p as RosterPerson & { defaultLineId?: string };
  return {
    ...rest,
    flexedToLineId: p.flexedToLineId ?? null,
    lead: p.lead ?? false,
    ot: p.ot ?? false,
    otHereToday: p.otHereToday ?? false,
    late: p.late ?? false,
    leavingEarly: p.leavingEarly ?? false,
    breakPreference: p.breakPreference ?? 'no_preference',
    areasWantToLearn: p.areasWantToLearn ?? [],
  };
}

/** If root has globalRoster (old format), migrate to per-line rosters and return new root. */
function migrateGlobalRosterToPerLine(root: {
  currentLineId: string;
  lines: { id: string }[];
  lineStates: Record<string, Partial<AppState>>;
  globalRoster?: RosterPerson[];
}): RootState | null {
  if (!Array.isArray(root.globalRoster)) return null;
  const lineIds = root.lines.map((l) => l.id);
  const rostersByLine: Record<string, RosterPerson[]> = {};
  for (const lineId of lineIds) rostersByLine[lineId] = [];
  for (const p of root.globalRoster) {
    const homeLineId = (p as RosterPerson & { defaultLineId?: string }).defaultLineId ?? root.currentLineId;
    const target = lineIds.includes(homeLineId) ? homeLineId : root.currentLineId;
    if (!rostersByLine[target]) rostersByLine[target] = [];
    rostersByLine[target].push(normalizeRosterPerson(p));
  }
  const lineStates: Record<string, LineState> = {};
  for (const [lineId, state] of Object.entries(root.lineStates || {})) {
    const roster = rostersByLine[lineId] ?? state.roster ?? [];
    lineStates[lineId] = { ...state, roster } as LineState;
  }
  return {
    currentLineId: root.currentLineId,
    lines: root.lines as import('../types').LineConfig[],
    lineStates,
  };
}

/** Load root state (multi-line). Migrates old globalRoster to per-line rosters. */
export function loadRootState(): RootState | null {
  try {
    const raw = localStorage.getItem(KEY_STATE);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data?.currentLineId != null && Array.isArray(data?.lines) && data?.lineStates != null) {
      const root = data as RootState & { globalRoster?: RosterPerson[] };
      const migrated = migrateGlobalRosterToPerLine(root);
      if (migrated) return migrated;
      const lineStates: Record<string, LineState> = {};
      for (const [lineId, state] of Object.entries(root.lineStates || {})) {
        const s = state as AppState;
        const roster = Array.isArray(s?.roster) ? s.roster.map(normalizeRosterPerson) : [];
        lineStates[lineId] = { ...s, roster } as LineState;
      }
      return { currentLineId: root.currentLineId, lines: root.lines, lineStates };
    }
    const legacy = data as AppState;
    if (legacy && Array.isArray(legacy.roster) && legacy.slots && typeof legacy.slots === 'object') {
      const ic = getDefaultICLineConfig();
      const slots = normalizeSlotsToCapacity(legacy.slots, legacy.areaCapacityOverrides);
      const roster = (legacy.roster ?? []).map(normalizeRosterPerson);
      return {
        currentLineId: ic.id,
        lines: [ic],
        lineStates: {
          [ic.id]: {
            roster,
            slots,
            leadSlots: legacy.leadSlots ?? {},
            juicedAreas: legacy.juicedAreas ?? {},
            deJuicedAreas: legacy.deJuicedAreas ?? {},
            sectionTasks: legacy.sectionTasks ?? {},
            schedule: legacy.schedule ?? [],
            dayNotes: legacy.dayNotes ?? '',
            documents: legacy.documents ?? [],
            breakSchedules: legacy.breakSchedules ?? {},
            areaCapacityOverrides: legacy.areaCapacityOverrides ?? {},
            areaNameOverrides: legacy.areaNameOverrides ?? {},
            slotLabelsByArea: legacy.slotLabelsByArea ?? {},
          },
        },
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveRootState(root: RootState): void {
  localStorage.setItem(KEY_STATE, JSON.stringify(root));
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
  name?: string,
  lineId?: string
): SavedDay {
  const days = loadSavedDays();
  const newOne: SavedDay = {
    id: nanoid(),
    date,
    name,
    savedAt: new Date().toISOString(),
    lineId,
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

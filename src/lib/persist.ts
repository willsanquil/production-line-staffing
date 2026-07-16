import type { AppState, LineState, RootState, RosterPerson, SavedDay, SlotsByArea } from '../types';
import { getDefaultICLineConfig } from './lineConfig';
import { normalizeSlotsToCapacity } from '../data/initialState';

const KEY_STATE = 'staffing-app-state';
const KEY_DAYS = 'staffing-app-days';

const BACKUP_FORMAT = 'production-line-staffing-root' as const;
const BACKUP_VERSION = 1;

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
  const { defaultLineId: _defaultLineId, ...rest } = p as RosterPerson & { defaultLineId?: string };
  void _defaultLineId;
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
    defaultAreaId: p.defaultAreaId ?? null,
    defaultSlotIndex: p.defaultSlotIndex ?? null,
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

function normalizeRootFromParsed(data: {
  currentLineId: string;
  lines: RootState['lines'];
  lineStates: Record<string, AppState | LineState>;
  globalRoster?: RosterPerson[];
}): RootState | null {
  const migrated = migrateGlobalRosterToPerLine(data);
  if (migrated) return migrated;
  const lineStates: Record<string, LineState> = {};
  for (const [lineId, state] of Object.entries(data.lineStates || {})) {
    const s = state as AppState;
    const roster = Array.isArray(s?.roster) ? s.roster.map(normalizeRosterPerson) : [];
    lineStates[lineId] = { ...s, roster } as LineState;
  }
  if (!data.currentLineId || !Array.isArray(data.lines) || data.lines.length === 0) return null;
  if (!lineStates[data.currentLineId]) return null;
  return { currentLineId: data.currentLineId, lines: data.lines, lineStates };
}

/** Load root state (multi-line). Migrates old globalRoster to per-line rosters. */
export function loadRootState(): RootState | null {
  try {
    const raw = localStorage.getItem(KEY_STATE);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data?.currentLineId != null && Array.isArray(data?.lines) && data?.lineStates != null) {
      return normalizeRootFromParsed(data as RootState & { globalRoster?: RosterPerson[] });
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

/** Export full multi-line root state as JSON (preferred backup format). */
export function exportRootStateToJson(root: RootState): string {
  return JSON.stringify(
    {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      root,
    },
    null,
    2
  );
}

/** @deprecated Prefer exportRootStateToJson — single-line export for legacy callers. */
export function exportStateToJson(state: AppState): string {
  return JSON.stringify({ ...state, _exportedAt: new Date().toISOString() }, null, 2);
}

export type ImportedBackup =
  | { kind: 'root'; root: RootState }
  | { kind: 'line'; state: AppState };

/**
 * Import backup JSON. Accepts:
 * - New multi-line RootState envelope (`format: production-line-staffing-root`)
 * - Bare RootState (`currentLineId` + `lines` + `lineStates`)
 * - Legacy single-line AppState (`roster` + `slots`)
 */
export function importBackupFromJson(json: string): ImportedBackup | null {
  try {
    const data = JSON.parse(json) as Record<string, unknown>;
    if (!data || typeof data !== 'object') return null;

    if (data.format === BACKUP_FORMAT && data.root && typeof data.root === 'object') {
      const root = normalizeRootFromParsed(data.root as RootState);
      return root ? { kind: 'root', root } : null;
    }

    if (
      typeof data.currentLineId === 'string' &&
      Array.isArray(data.lines) &&
      data.lineStates &&
      typeof data.lineStates === 'object'
    ) {
      const root = normalizeRootFromParsed(data as unknown as RootState);
      return root ? { kind: 'root', root } : null;
    }

    if (Array.isArray(data.roster) && data.slots && typeof data.slots === 'object') {
      return { kind: 'line', state: data as unknown as AppState };
    }

    return null;
  } catch {
    return null;
  }
}

/** @deprecated Prefer importBackupFromJson — returns AppState only for legacy single-line files. */
export function importStateFromJson(json: string): AppState | null {
  const result = importBackupFromJson(json);
  if (!result) return null;
  if (result.kind === 'line') return result.state;
  const line = result.root.lineStates[result.root.currentLineId];
  return line ?? null;
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
    leadBreakCoverage: state.leadBreakCoverage ? JSON.parse(JSON.stringify(state.leadBreakCoverage)) : {},
    areaBreakCoverageEnabled: state.areaBreakCoverageEnabled ? JSON.parse(JSON.stringify(state.areaBreakCoverageEnabled)) : {},
    areaRequiresTrainedOrExpertOverrides: state.areaRequiresTrainedOrExpertOverrides
      ? JSON.parse(JSON.stringify(state.areaRequiresTrainedOrExpertOverrides))
      : {},
    slotBreakCoverageEnabled: state.slotBreakCoverageEnabled
      ? JSON.parse(JSON.stringify(state.slotBreakCoverageEnabled))
      : {},
  };
  days.push(newOne);
  saveDaysList(days);
  return newOne;
}

export function removeSavedDay(id: string): void {
  const days = loadSavedDays().filter((d) => d.id !== id);
  saveDaysList(days);
}

/** Apply slot personIds from a slots-only JSON onto current slots (legacy config import). */
export function importConfigJson(json: string, currentSlots: SlotsByArea): SlotsByArea {
  const data = JSON.parse(json) as { slots: SlotsByArea };
  if (!data || typeof data.slots !== 'object') throw new Error('Invalid format');
  const imported = data.slots as Record<string, Array<{ id: string; personId: string | null }>>;
  const result = JSON.parse(JSON.stringify(currentSlots)) as SlotsByArea;
  for (const areaId of Object.keys(imported)) {
    const curr = result[areaId];
    const impr = imported[areaId];
    if (!curr || !Array.isArray(impr)) continue;
    for (let i = 0; i < curr.length && i < impr.length; i++) {
      curr[i].personId = impr[i].personId ?? null;
    }
  }
  return result;
}

import type { AppState, AreaConfigInLine, LeadSlots, LineConfig, LineState, RootState, Slot, SlotsByArea } from '../types';
import { loadRootState } from './persist';
import { getInitialState, getEmptyLineState, normalizeSlotsToLineCapacity } from '../data/initialState';
import { getDefaultICLineConfig, getDefaultNICLineConfig, getLeadSlotKeys } from './lineConfig';

/** Old (pre-Flip-as-floats) IC/NIC area shape used by previously-saved root states.
 * If a stored line still matches this exactly AND has no float slots, we know the user
 * never customized it and we can safely upgrade them to the new defaults. */
const LEGACY_IC_AREAS: ReadonlyArray<Pick<AreaConfigInLine, 'id' | 'minSlots' | 'maxSlots'>> = [
  { id: 'area_14_5', minSlots: 3, maxSlots: 4 },
  { id: 'area_courtyard', minSlots: 4, maxSlots: 7 },
  { id: 'area_bonding', minSlots: 11, maxSlots: 13 },
  { id: 'area_testing', minSlots: 2, maxSlots: 3 },
  { id: 'area_potting', minSlots: 3, maxSlots: 5 },
  { id: 'area_end_of_line', minSlots: 4, maxSlots: 4 },
  { id: 'area_flip', minSlots: 1, maxSlots: 2 },
];

/** True when the stored line config exactly matches the pre-migration IC/NIC defaults
 * and has no user-added floats — i.e. it's safe to swap in the new defaults. */
function isLegacyStockICLine(line: LineConfig): boolean {
  if (line.id !== 'ic' && line.id !== 'nic') return false;
  if (line.floatSlots && line.floatSlots.length > 0) return false;
  if (!Array.isArray(line.areas) || line.areas.length !== LEGACY_IC_AREAS.length) return false;
  for (let i = 0; i < LEGACY_IC_AREAS.length; i++) {
    const want = LEGACY_IC_AREAS[i];
    const got = line.areas[i];
    if (!got || got.id !== want.id || got.minSlots !== want.minSlots || got.maxSlots !== want.maxSlots) {
      return false;
    }
  }
  return true;
}

/** Upgrade a stock-old IC/NIC pair (line + state) to the new defaults:
 * - Replace areas/floatSlots/combinedSections with the new defaults.
 * - Move any people previously in area_flip into the two Flip floats.
 * - Drop area_flip entries from per-area state maps.
 * - Pre-enable per-slot break coverage for 14.5 and Testing so floats prioritize them. */
function upgradeLegacyICLine(
  line: LineConfig,
  state: Partial<LineState> | undefined
): { line: LineConfig; state: Partial<LineState> | undefined } {
  const fresh = line.id === 'nic' ? getDefaultNICLineConfig() : getDefaultICLineConfig();
  const upgraded: LineConfig = {
    ...line,
    areas: fresh.areas.map((a) => ({ ...a })),
    floatSlots: (fresh.floatSlots ?? []).map((f) => ({ ...f, supportedAreaIds: [...f.supportedAreaIds] })),
    combinedSections: [],
  };
  if (!state) return { line: upgraded, state };

  const flipSlots: Slot[] = state.slots?.area_flip ?? [];
  const flipPeople: (string | null)[] = flipSlots.map((s) => s.personId ?? null).filter((id) => id != null);

  const nextSlots: SlotsByArea = { ...(state.slots ?? {}) };
  delete nextSlots.area_flip;
  for (let i = 0; i < (fresh.floatSlots ?? []).length; i++) {
    const f = fresh.floatSlots![i];
    const personId = flipPeople[i] ?? null;
    nextSlots[f.id] = [{ id: `${f.id}_slot`, personId, disabled: false, locked: false }];
  }

  const sectionTasks = { ...(state.sectionTasks ?? {}) };
  delete (sectionTasks as Record<string, unknown>).area_flip;

  const slotBreakCoverageEnabled: Record<string, Record<string, boolean>> = {
    ...(state.slotBreakCoverageEnabled ?? {}),
  };
  for (const areaId of ['area_14_5', 'area_testing']) {
    const areaSlots = nextSlots[areaId] ?? [];
    if (areaSlots.length === 0) continue;
    const map: Record<string, boolean> = { ...(slotBreakCoverageEnabled[areaId] ?? {}) };
    for (const s of areaSlots) map[s.id] = true;
    slotBreakCoverageEnabled[areaId] = map;
  }

  const stripAreaKey = <T extends Record<string, unknown>>(obj: T | undefined): T | undefined => {
    if (!obj) return obj;
    if (!('area_flip' in obj)) return obj;
    const next = { ...obj } as Record<string, unknown>;
    delete next.area_flip;
    return next as T;
  };

  const upgradedState: Partial<LineState> = {
    ...state,
    slots: nextSlots,
    sectionTasks,
    juicedAreas: stripAreaKey(state.juicedAreas),
    deJuicedAreas: stripAreaKey(state.deJuicedAreas),
    breakSchedules: stripAreaKey(state.breakSchedules) ?? {},
    areaBreakCoverageEnabled: stripAreaKey(state.areaBreakCoverageEnabled),
    areaCapacityOverrides: stripAreaKey(state.areaCapacityOverrides),
    areaNameOverrides: stripAreaKey(state.areaNameOverrides),
    slotLabelsByArea: stripAreaKey(state.slotLabelsByArea),
    areaRequiresTrainedOrExpertOverrides: stripAreaKey(state.areaRequiresTrainedOrExpertOverrides),
    slotBreakCoverageEnabled,
  };

  // Roster: clear defaultAreaId for anyone whose default was area_flip.
  if (Array.isArray(state.roster)) {
    upgradedState.roster = state.roster.map((p) =>
      p.defaultAreaId === 'area_flip' ? { ...p, defaultAreaId: null, defaultSlotIndex: null } : p
    );
  }

  return { line: upgraded, state: upgradedState };
}

function normalizeLineState(state: Partial<LineState>, lineConfig: LineConfig): LineState {
  const capacityOverrides = state.areaCapacityOverrides ?? {};
  const slots = normalizeSlotsToLineCapacity(state.slots ?? {}, lineConfig, capacityOverrides);
  const leadSlots: LeadSlots = {};
  for (const key of getLeadSlotKeys(lineConfig)) {
    leadSlots[key] = state.leadSlots?.[key] ?? null;
  }
  const sectionTasks = state.sectionTasks ?? {};
  for (const a of lineConfig.areas) {
    if (!sectionTasks[a.id]) sectionTasks[a.id] = [];
  }
  const roster = Array.isArray(state.roster) ? state.roster : [];
  return {
    ...state,
    roster,
    slots,
    leadSlots,
    juicedAreas: state.juicedAreas ?? {},
    deJuicedAreas: state.deJuicedAreas ?? {},
    sectionTasks,
    schedule: state.schedule ?? getInitialState().schedule,
    dayNotes: state.dayNotes ?? '',
    documents: state.documents ?? [],
    breakSchedules: state.breakSchedules ?? {},
    areaCapacityOverrides: capacityOverrides,
    areaNameOverrides: state.areaNameOverrides ?? {},
    slotLabelsByArea: state.slotLabelsByArea ?? {},
  } as LineState;
}

/** Single source of truth: load from localStorage once at app load. Returns full root state (multi-line) or builds default. */
let cachedRoot: RootState | null = null;

/** Clear cache so next getHydratedRootState() reads from localStorage (e.g. after save). */
export function clearHydrateCache(): void {
  cachedRoot = null;
}

export function getHydratedRootState(): RootState {
  if (cachedRoot) return cachedRoot;
  try {
    const root = loadRootState();
    if (root && root.lines?.length && root.lineStates) {
      // Migration: if only IC exists, add NIC so users can flex between IC and NIC
      const hasNic = root.lines.some((l) => l.id === 'nic');
      if (!hasNic && root.lines.length === 1 && root.lines[0].id === 'ic') {
        const nic = getDefaultNICLineConfig();
        root.lines = [...root.lines, nic];
        root.lineStates[nic.id] = getEmptyLineState(nic);
      }
      // Migration: upgrade any stock-old IC/NIC line (legacy 7-area layout with area_flip
      // and no float slots) to the new layout (6 areas + 2 Flip floats covering 14.5 + Testing).
      // User-customized lines are detected by isLegacyStockICLine() and skipped.
      const nextLines: LineConfig[] = [];
      const nextStates: Record<string, LineState> = { ...root.lineStates };
      let migrated = false;
      for (const line of root.lines) {
        if (isLegacyStockICLine(line)) {
          const { line: newLine, state: newState } = upgradeLegacyICLine(line, root.lineStates[line.id]);
          nextLines.push(newLine);
          if (newState) nextStates[line.id] = newState as LineState;
          migrated = true;
        } else {
          nextLines.push(line);
        }
      }
      if (migrated) {
        root.lines = nextLines;
        root.lineStates = nextStates;
      }
      const current = root.lineStates[root.currentLineId];
      const config = root.lines.find((l) => l.id === root.currentLineId);
      if (config && current) {
        root.lineStates[root.currentLineId] = normalizeLineState(current, config);
      } else if (config && !current) {
        root.lineStates[root.currentLineId] = getEmptyLineState(config);
      }
      cachedRoot = root;
      return cachedRoot;
    }
  } catch {
    // fall through to default
  }
  const ic = getDefaultICLineConfig();
  const nic = getDefaultNICLineConfig();
  // Fresh install: empty state shaped to the IC line config (correct slot/float/lead keys)
  // with the demo roster carried over from the legacy seed.
  const seed = getInitialState();
  const icState: LineState = { ...getEmptyLineState(ic), roster: seed.roster };
  // Pre-enable per-slot break coverage for 14.5 + Testing so Flip floats prioritize covering them.
  const slotBreakCoverageEnabled: Record<string, Record<string, boolean>> = {};
  for (const areaId of ['area_14_5', 'area_testing']) {
    const areaSlots = icState.slots[areaId] ?? [];
    if (areaSlots.length === 0) continue;
    slotBreakCoverageEnabled[areaId] = Object.fromEntries(areaSlots.map((s) => [s.id, true]));
  }
  icState.slotBreakCoverageEnabled = slotBreakCoverageEnabled;
  cachedRoot = {
    currentLineId: ic.id,
    lines: [ic, nic],
    lineStates: {
      [ic.id]: icState,
      [nic.id]: getEmptyLineState(nic),
    },
  };
  return cachedRoot;
}

/** Current line state (includes that line's stored roster). Prefer getHydratedRootState() for multi-line UI. */
export function getHydratedState(): AppState {
  const root = getHydratedRootState();
  const state = root.lineStates[root.currentLineId];
  const config = root.lines.find((l) => l.id === root.currentLineId);
  if (config && state) return state as AppState;
  if (config) return getEmptyLineState(config) as AppState;
  return getInitialState();
}

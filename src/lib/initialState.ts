import type { AppState, LeadSlots, LineConfig, LineState, RootState } from '../types';
import { loadRootState } from './persist';
import { getInitialState, getEmptyLineState, normalizeSlotsToLineCapacity } from '../data/initialState';
import { getDefaultICLineConfig, getLeadSlotKeys } from './lineConfig';

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

export function getHydratedRootState(): RootState {
  if (cachedRoot) return cachedRoot;
  try {
    const root = loadRootState();
    if (root && root.lines?.length && root.lineStates) {
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
  const defaultState = getInitialState();
  cachedRoot = {
    currentLineId: ic.id,
    lines: [ic],
    lineStates: { [ic.id]: defaultState },
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

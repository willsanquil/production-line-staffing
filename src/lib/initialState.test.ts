import { describe, it, expect, beforeEach } from 'vitest';
import { clearHydrateCache, getHydratedRootState } from './initialState';
import type { LineConfig, LineState, RootState } from '../types';

const STORAGE_KEY = 'staffing-app-state';

/** Build a "stock-old" pre-Flip-as-floats IC line config, exactly as it was persisted before. */
function legacyICLine(): LineConfig {
  return {
    id: 'ic',
    name: 'IC',
    areas: [
      { id: 'area_14_5', name: '14.5', minSlots: 3, maxSlots: 4, requiresTrainedOrExpert: false },
      { id: 'area_courtyard', name: 'Courtyard', minSlots: 4, maxSlots: 7, requiresTrainedOrExpert: false },
      {
        id: 'area_bonding',
        name: 'Bonding',
        minSlots: 11,
        maxSlots: 13,
        requiresTrainedOrExpert: false,
        defaultSlotLabels: [
          'Float', '100s', '100s/200s', '100s/200s', '200s/300s', '200s/300s',
          '300s/400s', '300s/400s', '400/s', 'Rework', 'Manual Review',
        ],
      },
      { id: 'area_testing', name: 'Testing', minSlots: 2, maxSlots: 3, requiresTrainedOrExpert: false },
      { id: 'area_potting', name: 'Potting', minSlots: 3, maxSlots: 5, requiresTrainedOrExpert: false },
      { id: 'area_end_of_line', name: 'End Of Line', minSlots: 4, maxSlots: 4, requiresTrainedOrExpert: false },
      { id: 'area_flip', name: 'Flip', minSlots: 1, maxSlots: 2, requiresTrainedOrExpert: false },
    ],
    leadAreaIds: ['area_end_of_line', 'area_courtyard', 'area_bonding'],
    combinedSections: [['area_14_5', 'area_flip']],
    breaksEnabled: true,
    breaksScope: 'station',
    breakRotations: 3,
  };
}

function makeSlot(id: string, personId: string | null = null) {
  return { id, personId, disabled: false, locked: false };
}

function legacyICState(): Partial<LineState> {
  return {
    roster: [
      { id: 'p1', name: 'Alex', absent: false, lead: false, ot: false, late: false, leavingEarly: false, skills: {} },
      { id: 'p2', name: 'Bo', absent: false, lead: false, ot: false, late: false, leavingEarly: false, skills: {}, defaultAreaId: 'area_flip', defaultSlotIndex: 0 },
    ],
    slots: {
      area_14_5: [makeSlot('a14_1'), makeSlot('a14_2'), makeSlot('a14_3')],
      area_courtyard: [makeSlot('ac_1'), makeSlot('ac_2'), makeSlot('ac_3'), makeSlot('ac_4')],
      area_bonding: Array.from({ length: 11 }, (_, i) => makeSlot(`ab_${i}`)),
      area_testing: [makeSlot('at_1'), makeSlot('at_2')],
      area_potting: [makeSlot('ap_1'), makeSlot('ap_2'), makeSlot('ap_3')],
      area_end_of_line: [makeSlot('ae_1'), makeSlot('ae_2'), makeSlot('ae_3'), makeSlot('ae_4')],
      area_flip: [makeSlot('af_1', 'p1'), makeSlot('af_2', 'p2')],
    },
    leadSlots: { area_end_of_line: null, area_courtyard: null, area_bonding: null },
    sectionTasks: { area_flip: [{ id: 't1', text: 'old flip task', done: false }] },
    juicedAreas: { area_flip: true },
    deJuicedAreas: {},
    breakSchedules: {},
    areaCapacityOverrides: {},
    areaNameOverrides: {},
    slotLabelsByArea: {},
    areaRequiresTrainedOrExpertOverrides: {},
    slotBreakCoverageEnabled: {},
  };
}

function persistRoot(root: RootState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(root));
  clearHydrateCache();
}

describe('getHydratedRootState — legacy IC migration', () => {
  beforeEach(() => {
    localStorage.clear();
    clearHydrateCache();
  });

  it('upgrades a stock-old IC line to the new layout and moves Flip people into floats', () => {
    persistRoot({
      currentLineId: 'ic',
      lines: [legacyICLine()],
      lineStates: { ic: legacyICState() as LineState },
    });

    const root = getHydratedRootState();
    const ic = root.lines.find((l) => l.id === 'ic')!;
    expect(ic.areas.find((a) => a.id === 'area_flip')).toBeUndefined();
    expect(ic.areas.map((a) => a.id)).toEqual([
      'area_14_5', 'area_courtyard', 'area_bonding', 'area_testing', 'area_potting', 'area_end_of_line',
    ]);
    expect(ic.floatSlots?.map((f) => f.id).sort()).toEqual(['flip_1', 'flip_2']);
    expect(ic.combinedSections).toEqual([]);

    const state = root.lineStates.ic;
    expect(state.slots.area_flip).toBeUndefined();
    expect(state.slots.flip_1?.[0]?.personId).toBe('p1');
    expect(state.slots.flip_2?.[0]?.personId).toBe('p2');
    expect((state.sectionTasks as Record<string, unknown>).area_flip).toBeUndefined();
    expect(state.juicedAreas?.area_flip).toBeUndefined();

    // Pre-enables break coverage for 14.5 and Testing.
    const cov14 = state.slotBreakCoverageEnabled?.area_14_5 ?? {};
    expect(Object.values(cov14).every((v) => v === true)).toBe(true);
    const covTest = state.slotBreakCoverageEnabled?.area_testing ?? {};
    expect(Object.values(covTest).every((v) => v === true)).toBe(true);

    // Roster: defaultAreaId === 'area_flip' is cleared.
    const bo = state.roster.find((p) => p.id === 'p2');
    expect(bo?.defaultAreaId).toBeNull();
    expect(bo?.defaultSlotIndex).toBeNull();
  });

  it('leaves a customized IC line alone (e.g. capacity override)', () => {
    const customized = legacyICLine();
    customized.areas[0] = { ...customized.areas[0], minSlots: 1 }; // user changed 14.5 min
    persistRoot({
      currentLineId: 'ic',
      lines: [customized],
      lineStates: { ic: legacyICState() as LineState },
    });

    const root = getHydratedRootState();
    const ic = root.lines.find((l) => l.id === 'ic')!;
    expect(ic.areas.find((a) => a.id === 'area_flip')).toBeDefined();
    expect(ic.floatSlots ?? []).toHaveLength(0);
  });

  it('leaves an IC line with user-added float slots alone', () => {
    const withFloat = legacyICLine();
    withFloat.floatSlots = [{ id: 'my_float', name: 'My Float', supportedAreaIds: ['area_bonding'] }];
    persistRoot({
      currentLineId: 'ic',
      lines: [withFloat],
      lineStates: { ic: legacyICState() as LineState },
    });

    const root = getHydratedRootState();
    const ic = root.lines.find((l) => l.id === 'ic')!;
    expect(ic.areas.find((a) => a.id === 'area_flip')).toBeDefined();
    expect(ic.floatSlots).toEqual([{ id: 'my_float', name: 'My Float', supportedAreaIds: ['area_bonding'] }]);
  });

  it('fresh install (no localStorage) builds the new IC defaults with break coverage enabled', () => {
    localStorage.clear();
    clearHydrateCache();
    const root = getHydratedRootState();
    const ic = root.lines.find((l) => l.id === 'ic')!;
    expect(ic.areas.find((a) => a.id === 'area_flip')).toBeUndefined();
    expect(ic.floatSlots?.map((f) => f.id).sort()).toEqual(['flip_1', 'flip_2']);
    const cov = root.lineStates.ic.slotBreakCoverageEnabled?.area_14_5 ?? {};
    expect(Object.values(cov).every((v) => v === true)).toBe(true);
  });
});

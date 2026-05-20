import { describe, it, expect } from 'vitest';
import { getDefaultICLineConfig } from './lineConfig';
import { getEmptyLineState } from '../data/initialState';
import { extractDayAssignments, buildDayLogSnapshot } from './dayLogExtract';

describe('dayLogExtract', () => {
  it('extracts primary slot assignments and lead rows', () => {
    const config = getDefaultICLineConfig();
    const state = getEmptyLineState(config);
    const p1 = state.roster[0] ?? { id: 'p1', name: 'Alex', absent: false, lead: false, ot: false, late: false, leavingEarly: false, skills: {} };
    const p2 = { ...p1, id: 'p2', name: 'Blake' };
    state.roster = [p1, p2];
    const pottingId = 'area_potting';
    state.slots[pottingId] = [
      { id: 's1', personId: 'p1' },
      { id: 's2', personId: 'p2' },
    ];
    const leadKeys = config.leadAreaIds ?? [];
    if (leadKeys[0]) {
      state.leadSlots[leadKeys[0]] = 'p1';
    }
    state.breakSchedules = {
      [pottingId]: {
        p1: { breakRotation: 1, lunchRotation: 1 },
        p2: { breakRotation: 2, lunchRotation: 2 },
      },
    };

    const rows = extractDayAssignments({
      lineConfig: config,
      roster: state.roster,
      slots: state.slots,
      leadSlots: state.leadSlots,
      breakSchedules: state.breakSchedules,
    });

    const primaryPotting = rows.filter((r) => r.assignmentType === 'primary' && r.areaId === pottingId);
    expect(primaryPotting).toHaveLength(2);
    expect(primaryPotting.map((r) => r.personName).sort()).toEqual(['Alex', 'Blake']);
    expect(primaryPotting.find((r) => r.personId === 'p1')?.breakRotation).toBe(1);

    const leads = rows.filter((r) => r.assignmentType === 'lead');
    expect(leads.length).toBeGreaterThanOrEqual(1);
    expect(leads.some((r) => r.personId === 'p1')).toBe(true);
  });

  it('buildDayLogSnapshot includes roster and slots', () => {
    const config = getDefaultICLineConfig();
    const state = getEmptyLineState(config);
    const snap = buildDayLogSnapshot({
      lineConfig: config,
      roster: state.roster,
      slots: state.slots,
      leadSlots: state.leadSlots,
    });
    expect(snap.lineConfig.id).toBe(config.id);
    expect(snap.slots).toBeDefined();
    expect(Object.keys(snap.slots).length).toBeGreaterThan(0);
  });
});

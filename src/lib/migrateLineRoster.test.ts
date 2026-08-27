import { describe, it, expect } from 'vitest';
import { getDefaultICLineConfig, getDefaultIC2LineConfig } from './lineConfig';
import { getEmptyLineState } from '../data/initialState';
import { mergeLineStateFromSource } from './migrateLineRoster';
import type { RosterPerson, SlotsByArea } from '../types';

describe('mergeLineStateFromSource', () => {
  it('copies roster and extends skills for new 2.0 areas', () => {
    const ic = getDefaultICLineConfig();
    const ic2 = getDefaultIC2LineConfig();
    const target = getEmptyLineState(ic2);
    const person: RosterPerson = {
      id: 'p1',
      name: 'Alex',
      absent: false,
      lead: false,
      ot: false,
      late: false,
      leavingEarly: false,
      skills: { area_14_5: 'trained', area_courtyard: 'training' },
    };
    const source = {
      ...getEmptyLineState(ic),
      roster: [person],
    };
    const merged = mergeLineStateFromSource(ic2, target, source);
    expect(merged.roster).toHaveLength(1);
    expect(merged.roster[0].skills.area_14_5).toBe('trained');
    expect(merged.roster[0].skills.area_25_9k_inspections).toBe('no_experience');
  });

  it('maps legacy area_flip assignments to flip floats', () => {
    const ic = getDefaultICLineConfig();
    const ic2 = getDefaultIC2LineConfig();
    const target = getEmptyLineState(ic2);
    const sourceSlots: SlotsByArea = {
      area_flip: [{ id: 'f1', personId: 'flipper', disabled: false, locked: false }],
    };
    const source = { ...getEmptyLineState(ic), slots: sourceSlots };
    const merged = mergeLineStateFromSource(ic2, target, source);
    expect(merged.slots.flip_1?.[0]?.personId).toBe('flipper');
  });
});

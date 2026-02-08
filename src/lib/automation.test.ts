import { describe, it, expect } from 'vitest';
import { stretchAssignments } from './automation';
import type { RosterPerson, SlotsByArea } from '../types';

/** Helper: build a minimal RosterPerson with defaults. */
function makePerson(overrides: Partial<RosterPerson> & { id: string; skills: RosterPerson['skills'] }): RosterPerson {
  return {
    name: overrides.id,
    absent: false,
    lead: false,
    ot: false,
    late: false,
    leavingEarly: false,
    ...overrides,
  };
}

describe('stretchAssignments', () => {
  it('respects areaRequiresTrainedOrExpertFn when filling anchor slots', () => {
    // area_a requires trained/expert. We have one expert and one no_experience person.
    // The anchor slot fill should guarantee the expert gets placed in area_a.
    const roster: RosterPerson[] = [
      makePerson({ id: 'expert1', skills: { area_a: 'expert' } }),
      makePerson({ id: 'newbie1', skills: { area_a: 'no_experience' } }),
    ];
    const slots: SlotsByArea = {
      area_a: [
        { id: 's1', personId: null },
        { id: 's2', personId: null },
      ],
    };

    const result = stretchAssignments(
      roster,
      slots,
      new Set(),
      ['area_a'],
      (areaId: string) => areaId === 'area_a'
    );

    // area_a requires trained/expert — at least one slot should have the expert
    const assignedIds = (result['area_a'] ?? []).map((s) => s.personId).filter(Boolean);
    expect(assignedIds).toContain('expert1');
  });

  it('excludes no_experience people from areas that require trained/expert', () => {
    // Only one person with no_experience for area_a, and area_a requires trained/expert.
    // That person should NOT be assigned to area_a.
    const roster: RosterPerson[] = [
      makePerson({ id: 'newbie1', skills: { area_a: 'no_experience' } }),
    ];
    const slots: SlotsByArea = {
      area_a: [
        { id: 's1', personId: null },
      ],
    };

    const result = stretchAssignments(
      roster,
      slots,
      new Set(),
      ['area_a'],
      (areaId: string) => areaId === 'area_a'
    );

    // The no_experience person should NOT be placed in area_a
    expect(result['area_a'][0].personId).toBeNull();
  });

  it('allows no_experience people when area does not require trained/expert', () => {
    // area_a does NOT require trained/expert (fn returns false).
    // The no_experience person should be assigned normally.
    const roster: RosterPerson[] = [
      makePerson({ id: 'newbie1', skills: { area_a: 'no_experience' } }),
    ];
    const slots: SlotsByArea = {
      area_a: [
        { id: 's1', personId: null },
      ],
    };

    const result = stretchAssignments(
      roster,
      slots,
      new Set(),
      ['area_a'],
      () => false
    );

    // The no_experience person should be placed since area doesn't require experience
    expect(result['area_a'][0].personId).toBe('newbie1');
  });
});

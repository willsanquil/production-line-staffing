import { describe, it, expect } from 'vitest';
import { applyDefaultPositionsThenSpread, fillRemainingAssignments, stretchAssignments } from './automation';
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

describe('assignment fallback matching', () => {
  it('fillRemainingAssignments places everyone when a valid full matching exists', () => {
    // area_a + area_b, one open slot each.
    // p1 can only do area_a (area_b requires trained/expert for this test).
    // p2 can do both and is "better" at area_a.
    // Greedy can pick p2 for area_a and strand p1; matching must place both.
    const roster: RosterPerson[] = [
      makePerson({ id: 'p1', skills: { area_a: 'training', area_b: 'no_experience' } }),
      makePerson({ id: 'p2', skills: { area_a: 'expert', area_b: 'trained' } }),
    ];
    const slots: SlotsByArea = {
      area_a: [{ id: 'a1', personId: null }],
      area_b: [{ id: 'b1', personId: null }],
    };

    const result = fillRemainingAssignments(
      roster,
      slots,
      {},
      new Set(),
      {},
      { area_a: { min: 1, max: 1 }, area_b: { min: 1, max: 1 } },
      ['area_a', 'area_b'],
      (areaId: string) => areaId === 'area_b'
    );

    const assigned = new Set(
      ['area_a', 'area_b']
        .flatMap((aid) => (result[aid] ?? []).map((s) => s.personId))
        .filter((id): id is string => id != null)
    );
    expect(assigned.has('p1')).toBe(true);
    expect(assigned.has('p2')).toBe(true);
  });

  it('applyDefaultPositionsThenSpread places everyone when possible after defaults', () => {
    const roster: RosterPerson[] = [
      makePerson({ id: 'p1', skills: { area_a: 'training', area_b: 'no_experience' } }),
      makePerson({ id: 'p2', skills: { area_a: 'expert', area_b: 'trained' } }),
    ];
    const slots: SlotsByArea = {
      area_a: [{ id: 'a1', personId: null }],
      area_b: [{ id: 'b1', personId: null }],
    };

    const result = applyDefaultPositionsThenSpread(
      roster,
      slots,
      {},
      new Set(),
      {},
      { area_a: { min: 1, max: 1 }, area_b: { min: 1, max: 1 } },
      ['area_a', 'area_b'],
      (areaId: string) => areaId === 'area_b'
    );

    const assigned = new Set(
      ['area_a', 'area_b']
        .flatMap((aid) => (result[aid] ?? []).map((s) => s.personId))
        .filter((id): id is string => id != null)
    );
    expect(assigned.has('p1')).toBe(true);
    expect(assigned.has('p2')).toBe(true);
  });
});

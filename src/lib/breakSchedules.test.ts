import { describe, it, expect } from 'vitest';
import { generateBreakSchedules, optimizeFloatBreakRotations } from './breakSchedules';
import type { RosterPerson, SkillLevel } from '../types';

describe('optimizeFloatBreakRotations', () => {
  const makeSlot = (personId: string | null) => ({ id: `s_${personId ?? 'empty'}`, personId });

  it('moves float break to idle slot when current slot has coverage needs', () => {
    // Float supports area_a. area_a has breaks in slots 1 and 2.
    // Float currently assigned slot 2. Should move to slot 3 (idle).
    const schedules = {
      float_1: { jake: { breakRotation: 2 as const, lunchRotation: 2 as const } },
      area_a: {
        sarah: { breakRotation: 1 as const, lunchRotation: 1 as const },
        mike: { breakRotation: 2 as const, lunchRotation: 2 as const },
      },
    };
    const result = optimizeFloatBreakRotations(
      schedules,
      [{ id: 'float_1', name: 'Float 1', supportedAreaIds: ['area_a'] }],
      { float_1: [makeSlot('jake')], area_a: [makeSlot('sarah'), makeSlot('mike')] },
      3,
    );
    expect(result.float_1!.jake.breakRotation).toBe(3);
  });

  it('keeps float in place when already optimal', () => {
    // Float on slot 3, area_a has breaks in 1 and 2. Already optimal.
    const schedules = {
      float_1: { jake: { breakRotation: 3 as const, lunchRotation: 3 as const } },
      area_a: {
        sarah: { breakRotation: 1 as const, lunchRotation: 1 as const },
        mike: { breakRotation: 2 as const, lunchRotation: 2 as const },
      },
    };
    const result = optimizeFloatBreakRotations(
      schedules,
      [{ id: 'float_1', name: 'Float 1', supportedAreaIds: ['area_a'] }],
      { float_1: [makeSlot('jake')], area_a: [makeSlot('sarah'), makeSlot('mike')] },
      3,
    );
    expect(result.float_1!.jake.breakRotation).toBe(3);
  });

  it('returns schedules unchanged when no float slots', () => {
    const schedules = { area_a: { sarah: { breakRotation: 1 as const, lunchRotation: 1 as const } } };
    const result = optimizeFloatBreakRotations(schedules, [], {}, 3);
    expect(result).toEqual(schedules);
  });

  it('skips floats with no person assigned', () => {
    const schedules = {
      float_1: {},
      area_a: { sarah: { breakRotation: 1 as const, lunchRotation: 1 as const } },
    };
    const result = optimizeFloatBreakRotations(
      schedules,
      [{ id: 'float_1', name: 'Float 1', supportedAreaIds: ['area_a'] }],
      { float_1: [makeSlot(null)] },
      3,
    );
    expect(result).toEqual(schedules);
  });

  it('coordinates multiple floats to avoid both dodging the same slot', () => {
    // Both floats support area_a. area_a has breaks in slots 1, 2, 3.
    // Float A is on slot 1, Float B is on slot 2.
    // After optimization: one float should pick the slot with least need considering the other.
    // With 3 people on break across 3 slots and 2 floats, at least one slot will be uncovered.
    // Floats should spread out: ideally they DON'T both pick the same slot.
    const schedules = {
      float_a: { jake: { breakRotation: 1 as const, lunchRotation: 1 as const } },
      float_b: { ann: { breakRotation: 2 as const, lunchRotation: 2 as const } },
      area_a: {
        p1: { breakRotation: 1 as const, lunchRotation: 1 as const },
        p2: { breakRotation: 2 as const, lunchRotation: 2 as const },
        p3: { breakRotation: 3 as const, lunchRotation: 3 as const },
      },
    };
    const result = optimizeFloatBreakRotations(
      schedules,
      [
        { id: 'float_a', name: 'Float A', supportedAreaIds: ['area_a'] },
        { id: 'float_b', name: 'Float B', supportedAreaIds: ['area_a'] },
      ],
      {
        float_a: [makeSlot('jake')],
        float_b: [makeSlot('ann')],
        area_a: [makeSlot('p1'), makeSlot('p2'), makeSlot('p3')],
      },
      3,
    );
    // The two floats should NOT have the same break rotation
    expect(result.float_a!.jake.breakRotation).not.toBe(result.float_b!.ann.breakRotation);
  });
});

describe('Flip-as-floats coverage (IC default scenario)', () => {
  function makePerson(id: string, areas: string[], skill: SkillLevel = 'trained'): RosterPerson {
    const skills: Record<string, SkillLevel> = {};
    for (const a of areas) skills[a] = skill;
    return {
      id,
      name: id,
      absent: false,
      lead: false,
      ot: false,
      late: false,
      leavingEarly: false,
      breakPreference: 'no_preference',
      skills,
    };
  }

  it('whenever 14.5 or Testing has someone on break, at least one Flip float is available', () => {
    // Scenario: 14.5 has 2 trained inspectors, Testing has 1 person, plus 2 Flip floats
    // (the new IC default). Run the full pipeline and verify per-rotation coverage.
    const roster: RosterPerson[] = [
      makePerson('p_a', ['area_14_5']),
      makePerson('p_b', ['area_14_5']),
      makePerson('p_t', ['area_testing']),
      makePerson('flip1', ['area_14_5', 'area_testing']),
      makePerson('flip2', ['area_14_5', 'area_testing']),
    ];
    const slots = {
      area_14_5: [
        { id: 's_a', personId: 'p_a' },
        { id: 's_b', personId: 'p_b' },
      ],
      area_testing: [{ id: 's_t', personId: 'p_t' }],
      flip_1: [{ id: 's_f1', personId: 'flip1' }],
      flip_2: [{ id: 's_f2', personId: 'flip2' }],
    };

    const raw = generateBreakSchedules(
      roster,
      slots,
      ['area_14_5', 'area_testing', 'flip_1', 'flip_2'],
      {
        rotationCount: 3,
        scope: 'station',
        floatSupportedAreaIds: new Set(['area_14_5', 'area_testing']),
      },
    );
    const optimized = optimizeFloatBreakRotations(
      raw,
      [
        { id: 'flip_1', name: 'Flip 1', supportedAreaIds: ['area_14_5', 'area_testing'] },
        { id: 'flip_2', name: 'Flip 2', supportedAreaIds: ['area_14_5', 'area_testing'] },
      ],
      slots,
      3,
    );

    // For every rotation in which someone in 14.5 or Testing is on break,
    // at least one Flip float must NOT be on break (i.e. is available to cover).
    for (let rot = 1; rot <= 3; rot++) {
      const someoneOnBreak =
        Object.values(optimized.area_14_5 ?? {}).some((e) => e.breakRotation === rot) ||
        Object.values(optimized.area_testing ?? {}).some((e) => e.breakRotation === rot);
      if (!someoneOnBreak) continue;
      const flip1Rot = optimized.flip_1?.flip1?.breakRotation;
      const flip2Rot = optimized.flip_2?.flip2?.breakRotation;
      const availableFloats =
        (flip1Rot !== rot ? 1 : 0) + (flip2Rot !== rot ? 1 : 0);
      expect(availableFloats).toBeGreaterThanOrEqual(1);
    }
  });

  it('the two Flip floats break together in the rotation with no coverage need', () => {
    // Scenario mirrors the IC default: 14.5 has 2 people, Test Loop has 1, both Flip floats
    // support both. With 3 rotations, 14.5 fills slots 1 + 2 and Test Loop fills slot 1, so
    // rotation 3 has zero break events. Both Flip floats should land there together since
    // there is no coverage cost to doing so (and operationally it's preferred — they go to
    // lunch / break together).
    const roster: RosterPerson[] = [
      makePerson('p_a', ['area_14_5']),
      makePerson('p_b', ['area_14_5']),
      makePerson('p_t', ['area_testing']),
      makePerson('flip1', ['area_14_5', 'area_testing']),
      makePerson('flip2', ['area_14_5', 'area_testing']),
    ];
    const slots = {
      area_14_5: [
        { id: 's_a', personId: 'p_a' },
        { id: 's_b', personId: 'p_b' },
      ],
      area_testing: [{ id: 's_t', personId: 'p_t' }],
      flip_1: [{ id: 's_f1', personId: 'flip1' }],
      flip_2: [{ id: 's_f2', personId: 'flip2' }],
    };

    const raw = generateBreakSchedules(
      roster,
      slots,
      ['area_14_5', 'area_testing', 'flip_1', 'flip_2'],
      { rotationCount: 3, scope: 'station' },
    );
    const optimized = optimizeFloatBreakRotations(
      raw,
      [
        { id: 'flip_1', name: 'Flip 1', supportedAreaIds: ['area_14_5', 'area_testing'] },
        { id: 'flip_2', name: 'Flip 2', supportedAreaIds: ['area_14_5', 'area_testing'] },
      ],
      slots,
      3,
    );

    expect(optimized.flip_1?.flip1?.breakRotation).toBe(optimized.flip_2?.flip2?.breakRotation);
  });

  it('floats are split across rotations when togetherness would drop coverage', () => {
    // 14.5 has 2 people on break (rot 1, rot 2), Test Loop 1 person on break (rot 2). Floats
    // cannot all break together: rot 2 has 2 simultaneous break events, so at least one float
    // must be available there. Coverage cost wins over togetherness.
    const roster: RosterPerson[] = [
      makePerson('a1', ['area_14_5']),
      makePerson('a2', ['area_14_5']),
      makePerson('t1', ['area_testing']),
      makePerson('flipA', ['area_14_5', 'area_testing']),
      makePerson('flipB', ['area_14_5', 'area_testing']),
    ];
    const slots = {
      area_14_5: [
        { id: 's_a1', personId: 'a1' },
        { id: 's_a2', personId: 'a2' },
      ],
      area_testing: [{ id: 's_t1', personId: 't1' }],
      flip_a: [{ id: 's_fa', personId: 'flipA' }],
      flip_b: [{ id: 's_fb', personId: 'flipB' }],
    };

    // Pre-seed: a1 rot 1, a2 rot 2, t1 rot 2 (so rot 2 has 2 simultaneous break events).
    const seeded = {
      area_14_5: {
        a1: { breakRotation: 1 as const, lunchRotation: 1 as const },
        a2: { breakRotation: 2 as const, lunchRotation: 2 as const },
      },
      area_testing: {
        t1: { breakRotation: 2 as const, lunchRotation: 2 as const },
      },
      flip_a: { flipA: { breakRotation: 1 as const, lunchRotation: 1 as const } },
      flip_b: { flipB: { breakRotation: 2 as const, lunchRotation: 2 as const } },
    };

    const optimized = optimizeFloatBreakRotations(
      seeded,
      [
        { id: 'flip_a', name: 'Flip A', supportedAreaIds: ['area_14_5', 'area_testing'] },
        { id: 'flip_b', name: 'Flip B', supportedAreaIds: ['area_14_5', 'area_testing'] },
      ],
      slots,
      3,
    );

    // Neither float should be on break in rot 2 (where two areas need cover simultaneously).
    expect(optimized.flip_a?.flipA?.breakRotation).not.toBe(2);
    expect(optimized.flip_b?.flipB?.breakRotation).not.toBe(2);
    // Only one Flip person can be free during rot 2 to cover one area; the other area is
    // necessarily uncovered. The optimizer doesn't fix that here — it just shouldn't make
    // it worse by having BOTH floats on break in rot 2.
    void roster;
  });
});

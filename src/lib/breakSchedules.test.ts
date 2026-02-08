import { describe, it, expect } from 'vitest';
import { optimizeFloatBreakRotations } from './breakSchedules';

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

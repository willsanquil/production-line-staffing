import { describe, it, expect } from 'vitest';
import { computeFloatCoverage } from './floatCoverage';
import type { ComputeFloatCoverageInput } from './floatCoverage';
import type { FloatSlotConfig, SlotsByArea, BreakSchedulesByArea } from '../types';

/** Helper: build a minimal input with defaults. */
function makeInput(overrides: Partial<ComputeFloatCoverageInput> = {}): ComputeFloatCoverageInput {
  return {
    floatSlots: [],
    slots: {},
    breakSchedules: {},
    rotationCount: 3,
    areaIdsInSectionOrder: [],
    areaLabels: {},
    ...overrides,
  };
}

describe('computeFloatCoverage', () => {
  // ── Test 1: Empty floats → empty result ──────────────────────────────
  it('returns empty results when there are no float slots', () => {
    const input = makeInput();
    const result = computeFloatCoverage(input);

    expect(result.floatSchedule).toEqual({});
    expect(result.areaCoverage).toEqual({});
    expect(result.coverageSummary).toEqual([]);
  });

  // ── Test 2: Float assigned to area with someone on break → covers that area ──
  it('assigns a float to cover an area where someone is on break', () => {
    const floatSlots: FloatSlotConfig[] = [
      { id: 'float_1', name: 'Float 1', supportedAreaIds: ['area_a'] },
    ];
    const slots: SlotsByArea = {
      float_1: [{ id: 'f1s0', personId: 'floatPerson' }],
      area_a: [{ id: 'a1s0', personId: 'workerA' }],
    };
    const breakSchedules: BreakSchedulesByArea = {
      float_1: { floatPerson: { breakRotation: 2, lunchRotation: 2 } },
      area_a: { workerA: { breakRotation: 1, lunchRotation: 1 } },
    };

    const result = computeFloatCoverage(
      makeInput({
        floatSlots,
        slots,
        breakSchedules,
        rotationCount: 3,
        areaIdsInSectionOrder: ['area_a'],
        areaLabels: { area_a: 'Area A', float_1: 'Float 1' },
      })
    );

    // Float should cover area_a during rotation 1 (workerA is on break; slot index 0)
    expect(result.floatSchedule['float_1'][1]).toEqual({
      type: 'covering',
      areaId: 'area_a',
      slotIndex: 0,
    });
    // Rotation 2 is the float's own break
    expect(result.floatSchedule['float_1'][2]).toEqual({ type: 'on_break' });
    // Rotation 3: no one on break in area_a → idle
    expect(result.floatSchedule['float_1'][3]).toEqual({ type: 'idle' });
  });

  // ── Test 3: Float on break → on_break for that slot ──────────────────
  it('marks the float as on_break during its own break rotation', () => {
    const floatSlots: FloatSlotConfig[] = [
      { id: 'float_1', name: 'Float 1', supportedAreaIds: ['area_a'] },
    ];
    const slots: SlotsByArea = {
      float_1: [{ id: 'f1s0', personId: 'floatPerson' }],
      area_a: [{ id: 'a1s0', personId: 'workerA' }],
    };
    const breakSchedules: BreakSchedulesByArea = {
      float_1: { floatPerson: { breakRotation: 3, lunchRotation: 3 } },
      area_a: { workerA: { breakRotation: 3, lunchRotation: 3 } },
    };

    const result = computeFloatCoverage(
      makeInput({
        floatSlots,
        slots,
        breakSchedules,
        rotationCount: 3,
        areaIdsInSectionOrder: ['area_a'],
        areaLabels: { area_a: 'Area A', float_1: 'Float 1' },
      })
    );

    // Rotation 3: float is on break, even though area_a person is also on break
    expect(result.floatSchedule['float_1'][3]).toEqual({ type: 'on_break' });
  });

  // ── Test 4: Float with no person → all idle ──────────────────────────
  it('marks all rotations as idle when float has no person assigned', () => {
    const floatSlots: FloatSlotConfig[] = [
      { id: 'float_1', name: 'Float 1', supportedAreaIds: ['area_a'] },
    ];
    const slots: SlotsByArea = {
      float_1: [{ id: 'f1s0', personId: null }],
      area_a: [{ id: 'a1s0', personId: 'workerA' }],
    };
    const breakSchedules: BreakSchedulesByArea = {
      area_a: { workerA: { breakRotation: 1, lunchRotation: 1 } },
    };

    const result = computeFloatCoverage(
      makeInput({
        floatSlots,
        slots,
        breakSchedules,
        rotationCount: 3,
        areaIdsInSectionOrder: ['area_a'],
        areaLabels: { area_a: 'Area A', float_1: 'Float 1' },
      })
    );

    expect(result.floatSchedule['float_1'][1]).toEqual({ type: 'idle' });
    expect(result.floatSchedule['float_1'][2]).toEqual({ type: 'idle' });
    expect(result.floatSchedule['float_1'][3]).toEqual({ type: 'idle' });
  });

  // ── Test 5: Multiple areas need coverage same slot → picks first in section order ──
  it('picks the first area in section order when multiple areas need coverage in the same slot', () => {
    const floatSlots: FloatSlotConfig[] = [
      { id: 'float_1', name: 'Float 1', supportedAreaIds: ['area_a', 'area_b'] },
    ];
    const slots: SlotsByArea = {
      float_1: [{ id: 'f1s0', personId: 'floatPerson' }],
      area_a: [{ id: 'a1s0', personId: 'workerA' }],
      area_b: [{ id: 'b1s0', personId: 'workerB' }],
    };
    const breakSchedules: BreakSchedulesByArea = {
      float_1: { floatPerson: { breakRotation: 3, lunchRotation: 3 } },
      area_a: { workerA: { breakRotation: 1, lunchRotation: 1 } },
      area_b: { workerB: { breakRotation: 1, lunchRotation: 1 } },
    };

    const result = computeFloatCoverage(
      makeInput({
        floatSlots,
        slots,
        breakSchedules,
        rotationCount: 3,
        // area_a comes first in section order
        areaIdsInSectionOrder: ['area_a', 'area_b'],
        areaLabels: { area_a: 'Area A', area_b: 'Area B', float_1: 'Float 1' },
      })
    );

    // Rotation 1: both areas need coverage, float picks area_a (first in order; slot index 0)
    expect(result.floatSchedule['float_1'][1]).toEqual({
      type: 'covering',
      areaId: 'area_a',
      slotIndex: 0,
    });
  });

  it('rotates priority by rotation so later supported areas are covered too', () => {
    const floatSlots: FloatSlotConfig[] = [
      { id: 'float_1', name: 'Float 1', supportedAreaIds: ['area_a', 'area_b'] },
    ];
    const slots: SlotsByArea = {
      float_1: [{ id: 'f1s0', personId: 'floatPerson' }],
      area_a: [
        { id: 'a1s0', personId: 'workerA' },
        { id: 'a2s0', personId: 'workerA2' },
      ],
      area_b: [
        { id: 'b1s0', personId: 'workerB' },
        { id: 'b2s0', personId: 'workerB2' },
      ],
    };
    const breakSchedules: BreakSchedulesByArea = {
      float_1: { floatPerson: { breakRotation: 3, lunchRotation: 3 } },
      area_a: { workerA: { breakRotation: 1, lunchRotation: 1 }, workerA2: { breakRotation: 2, lunchRotation: 2 } },
      area_b: { workerB: { breakRotation: 1, lunchRotation: 1 }, workerB2: { breakRotation: 2, lunchRotation: 2 } },
    };

    const result = computeFloatCoverage(
      makeInput({
        floatSlots,
        slots,
        breakSchedules,
        rotationCount: 3,
        areaIdsInSectionOrder: ['area_a', 'area_b'],
        areaLabels: { area_a: 'Area A', area_b: 'Area B', float_1: 'Float 1' },
      })
    );

    // Rotation 1: workerA (area_a slot 0) on break → float covers area_a
    expect(result.floatSchedule['float_1'][1]).toEqual({
      type: 'covering',
      areaId: 'area_a',
      slotIndex: 0,
    });
    // Rotation 2: workerA2 and workerB2 on break; startIdx = (2-1) % 2 = 1 → area_b first, float covers area_b slot 1
    expect(result.floatSchedule['float_1'][2]).toEqual({
      type: 'covering',
      areaId: 'area_b',
      slotIndex: 1,
    });
  });

  // ── Test 6: Person covered → coveredByFloatId is set ─────────────────
  it('records coverage info when a person is covered by a float', () => {
    const floatSlots: FloatSlotConfig[] = [
      { id: 'float_1', name: 'Float 1', supportedAreaIds: ['area_a'] },
    ];
    const slots: SlotsByArea = {
      float_1: [{ id: 'f1s0', personId: 'floatPerson' }],
      area_a: [{ id: 'a1s0', personId: 'workerA' }],
    };
    const breakSchedules: BreakSchedulesByArea = {
      float_1: { floatPerson: { breakRotation: 2, lunchRotation: 2 } },
      area_a: { workerA: { breakRotation: 1, lunchRotation: 1 } },
    };

    const result = computeFloatCoverage(
      makeInput({
        floatSlots,
        slots,
        breakSchedules,
        rotationCount: 3,
        areaIdsInSectionOrder: ['area_a'],
        areaLabels: { area_a: 'Area A', float_1: 'Float 1' },
      })
    );

    const coverage = result.areaCoverage['area_a'];
    expect(coverage).toBeDefined();
    const workerCoverage = coverage!.find((c) => c.personId === 'workerA');
    expect(workerCoverage).toBeDefined();
    expect(workerCoverage!.coveredByFloatId).toBe('float_1');
    expect(workerCoverage!.coveredByFloatName).toBe('Float 1');
    expect(workerCoverage!.coveredByPersonName).toBe('floatPerson');
  });

  // ── Test 7: Person uncovered (float elsewhere) → coveredByFloatId is null ──
  it('records null coverage when a person is not covered by any float', () => {
    const floatSlots: FloatSlotConfig[] = [
      { id: 'float_1', name: 'Float 1', supportedAreaIds: ['area_a', 'area_b'] },
    ];
    const slots: SlotsByArea = {
      float_1: [{ id: 'f1s0', personId: 'floatPerson' }],
      area_a: [{ id: 'a1s0', personId: 'workerA' }],
      area_b: [{ id: 'b1s0', personId: 'workerB' }],
    };
    const breakSchedules: BreakSchedulesByArea = {
      float_1: { floatPerson: { breakRotation: 3, lunchRotation: 3 } },
      // Both workers on break at rotation 1 — only one can be covered
      area_a: { workerA: { breakRotation: 1, lunchRotation: 1 } },
      area_b: { workerB: { breakRotation: 1, lunchRotation: 1 } },
    };

    const result = computeFloatCoverage(
      makeInput({
        floatSlots,
        slots,
        breakSchedules,
        rotationCount: 3,
        // area_a first → float covers area_a, not area_b
        areaIdsInSectionOrder: ['area_a', 'area_b'],
        areaLabels: { area_a: 'Area A', area_b: 'Area B', float_1: 'Float 1' },
      })
    );

    // workerA should be covered (area_a is first)
    const coverageA = result.areaCoverage['area_a']!.find((c) => c.personId === 'workerA');
    expect(coverageA!.coveredByFloatId).toBe('float_1');

    // workerB should NOT be covered (float is busy covering area_a)
    const coverageB = result.areaCoverage['area_b']!.find((c) => c.personId === 'workerB');
    expect(coverageB!.coveredByFloatId).toBeNull();
    expect(coverageB!.coveredByFloatName).toBeNull();
    expect(coverageB!.coveredByPersonName).toBeNull();
  });

  // ── Test 8: Areas without float support → excluded from areaCoverage ──
  it('excludes areas without float support from areaCoverage', () => {
    const floatSlots: FloatSlotConfig[] = [
      { id: 'float_1', name: 'Float 1', supportedAreaIds: ['area_a'] },
    ];
    const slots: SlotsByArea = {
      float_1: [{ id: 'f1s0', personId: 'floatPerson' }],
      area_a: [{ id: 'a1s0', personId: 'workerA' }],
      area_b: [{ id: 'b1s0', personId: 'workerB' }],
    };
    const breakSchedules: BreakSchedulesByArea = {
      float_1: { floatPerson: { breakRotation: 2, lunchRotation: 2 } },
      area_a: { workerA: { breakRotation: 1, lunchRotation: 1 } },
      area_b: { workerB: { breakRotation: 1, lunchRotation: 1 } },
    };

    const result = computeFloatCoverage(
      makeInput({
        floatSlots,
        slots,
        breakSchedules,
        rotationCount: 3,
        areaIdsInSectionOrder: ['area_a', 'area_b'],
        areaLabels: { area_a: 'Area A', area_b: 'Area B', float_1: 'Float 1' },
      })
    );

    // area_a has float support → should be in areaCoverage
    expect(result.areaCoverage['area_a']).toBeDefined();
    // area_b has NO float support → should NOT be in areaCoverage
    expect(result.areaCoverage['area_b']).toBeUndefined();
  });

  // ── Test 9: Summary shows uncovered when float on break same time as area person ──
  it('marks summary slot as uncovered when float is on break while area person is on break', () => {
    const floatSlots: FloatSlotConfig[] = [
      { id: 'float_1', name: 'Float 1', supportedAreaIds: ['area_a'] },
    ];
    const slots: SlotsByArea = {
      float_1: [{ id: 'f1s0', personId: 'floatPerson' }],
      area_a: [{ id: 'a1s0', personId: 'workerA' }],
    };
    const breakSchedules: BreakSchedulesByArea = {
      float_1: { floatPerson: { breakRotation: 2, lunchRotation: 2 } },
      // workerA is on break rotation 2, same as the float
      area_a: { workerA: { breakRotation: 2, lunchRotation: 2 } },
    };

    const result = computeFloatCoverage(
      makeInput({
        floatSlots,
        slots,
        breakSchedules,
        rotationCount: 3,
        areaIdsInSectionOrder: ['area_a'],
        areaLabels: { area_a: 'Area A', float_1: 'Float 1' },
      })
    );

    const summaryRow = result.coverageSummary.find((r) => r.areaId === 'area_a');
    expect(summaryRow).toBeDefined();

    // Rotation 2: worker on break, float also on break → uncovered
    const slot2 = summaryRow!.slots.find((s) => s.rotation === 2);
    expect(slot2!.peopleOnBreak).toBe(1);
    expect(slot2!.uncovered).toBe(true);
    expect(slot2!.coveredByFloatId).toBeNull();

    // Rotation 1: no one on break → covered (trivially, 0 people on break)
    const slot1 = summaryRow!.slots.find((s) => s.rotation === 1);
    expect(slot1!.peopleOnBreak).toBe(0);
    expect(slot1!.uncovered).toBe(false);
  });

  // ── Test 10: Summary only includes float-supported areas ─────────────
  it('only includes float-supported areas in coverageSummary', () => {
    const floatSlots: FloatSlotConfig[] = [
      { id: 'float_1', name: 'Float 1', supportedAreaIds: ['area_a'] },
    ];
    const slots: SlotsByArea = {
      float_1: [{ id: 'f1s0', personId: 'floatPerson' }],
      area_a: [{ id: 'a1s0', personId: 'workerA' }],
      area_b: [{ id: 'b1s0', personId: 'workerB' }],
    };
    const breakSchedules: BreakSchedulesByArea = {
      float_1: { floatPerson: { breakRotation: 2, lunchRotation: 2 } },
      area_a: { workerA: { breakRotation: 1, lunchRotation: 1 } },
      area_b: { workerB: { breakRotation: 1, lunchRotation: 1 } },
    };

    const result = computeFloatCoverage(
      makeInput({
        floatSlots,
        slots,
        breakSchedules,
        rotationCount: 3,
        areaIdsInSectionOrder: ['area_a', 'area_b'],
        areaLabels: { area_a: 'Area A', area_b: 'Area B', float_1: 'Float 1' },
      })
    );

    const summaryAreaIds = result.coverageSummary.map((r) => r.areaId);
    expect(summaryAreaIds).toContain('area_a');
    expect(summaryAreaIds).not.toContain('area_b');
  });
});

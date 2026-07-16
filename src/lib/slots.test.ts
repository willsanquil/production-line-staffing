import { describe, expect, it } from 'vitest';
import type { SlotsByArea } from '../types';
import { clearAreaAssignments, moveOrSwapSlotPerson } from './slots';

describe('clearAreaAssignments', () => {
  it('clears only the requested area and preserves other areas', () => {
    const slots: SlotsByArea = {
      area_a: [
        { id: 'a1', personId: 'p1' },
        { id: 'a2', personId: 'p2' },
      ],
      area_b: [
        { id: 'b1', personId: 'p3' },
      ],
    };

    const next = clearAreaAssignments(slots, 'area_a');

    expect(next.area_a?.map((s) => s.personId)).toEqual([null, null]);
    expect(next.area_b?.map((s) => s.personId)).toEqual(['p3']);
  });

  it('does not clear locked slots', () => {
    const slots: SlotsByArea = {
      area_a: [
        { id: 'a1', personId: 'p1', locked: true },
        { id: 'a2', personId: 'p2', locked: false },
      ],
    };

    const next = clearAreaAssignments(slots, 'area_a');

    expect(next.area_a?.map((s) => s.personId)).toEqual(['p1', null]);
  });
});

describe('moveOrSwapSlotPerson', () => {
  it('moves a person into an empty slot across areas', () => {
    const slots: SlotsByArea = {
      courtyard: [{ id: 'c1', personId: 'alice' }],
      bonding: [{ id: 'b1', personId: null }],
    };

    const next = moveOrSwapSlotPerson(
      slots,
      { areaId: 'courtyard', slotId: 'c1' },
      { areaId: 'bonding', slotId: 'b1' },
    );

    expect(next?.courtyard?.map((s) => s.personId)).toEqual([null]);
    expect(next?.bonding?.map((s) => s.personId)).toEqual(['alice']);
  });

  it('swaps people when the target slot is occupied', () => {
    const slots: SlotsByArea = {
      courtyard: [{ id: 'c1', personId: 'alice' }],
      bonding: [{ id: 'b1', personId: 'bob' }],
    };

    const next = moveOrSwapSlotPerson(
      slots,
      { areaId: 'courtyard', slotId: 'c1' },
      { areaId: 'bonding', slotId: 'b1' },
    );

    expect(next?.courtyard?.map((s) => s.personId)).toEqual(['bob']);
    expect(next?.bonding?.map((s) => s.personId)).toEqual(['alice']);
  });

  it('rejects locked or disabled targets and sources', () => {
    const slots: SlotsByArea = {
      courtyard: [{ id: 'c1', personId: 'alice', locked: true }],
      bonding: [{ id: 'b1', personId: null }],
      float: [{ id: 'f1', personId: 'cara' }],
      off: [{ id: 'o1', personId: null, disabled: true }],
    };

    expect(
      moveOrSwapSlotPerson(slots, { areaId: 'courtyard', slotId: 'c1' }, { areaId: 'bonding', slotId: 'b1' }),
    ).toBeNull();
    expect(
      moveOrSwapSlotPerson(slots, { areaId: 'float', slotId: 'f1' }, { areaId: 'off', slotId: 'o1' }),
    ).toBeNull();
  });
});

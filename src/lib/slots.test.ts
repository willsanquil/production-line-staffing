import { describe, expect, it } from 'vitest';
import type { SlotsByArea } from '../types';
import { clearAreaAssignments } from './slots';

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

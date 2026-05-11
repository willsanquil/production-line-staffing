import { describe, it, expect } from 'vitest';
import { synthesizeCoverageFloats, mirrorVirtualFloatBreaksToStations, COVERAGE_FLOAT_PREFIX } from './coverageStations';
import type { SlotsByArea, BreakSchedulesByArea } from '../types';

const slotsBase: SlotsByArea = {
  area_flip: [
    { id: 'flip_s0', personId: 'manuel' },
    { id: 'flip_s1', personId: 'marcus' },
  ],
  area_14_5: [
    { id: 'a14_s0', personId: 'junior' },
    { id: 'a14_s1', personId: 'tracy' },
  ],
  area_testing: [
    { id: 'at_s0', personId: 'shanda' },
  ],
};

const labels = {
  area_flip: 'Flip',
  area_14_5: '14.5',
  area_testing: 'Test Loop',
};

describe('synthesizeCoverageFloats', () => {
  it('returns no floats when areaCoversBreaksFor is empty', () => {
    const out = synthesizeCoverageFloats({}, slotsBase, labels);
    expect(out.virtualFloats).toEqual([]);
    expect(out.virtualSlots).toEqual({});
    expect(out.links).toEqual([]);
  });

  it('synthesizes one virtual float per enabled, staffed slot in a coverage station', () => {
    const out = synthesizeCoverageFloats(
      { area_flip: ['area_14_5', 'area_testing'] },
      slotsBase,
      labels,
    );
    expect(out.virtualFloats).toHaveLength(2);
    expect(out.virtualFloats[0].id).toBe(`${COVERAGE_FLOAT_PREFIX}area_flip_flip_s0`);
    expect(out.virtualFloats[0].name).toBe('Flip #1');
    expect(out.virtualFloats[0].supportedAreaIds).toEqual(['area_14_5', 'area_testing']);
    expect(out.virtualFloats[1].name).toBe('Flip #2');
    // Virtual slot mirrors the source station's slot (same id + person).
    const vId0 = out.virtualFloats[0].id;
    expect(out.virtualSlots[vId0]?.[0]?.personId).toBe('manuel');
    expect(out.virtualSlots[vId0]?.[0]?.id).toBe('flip_s0');
  });

  it('skips disabled and empty slots', () => {
    const slots: SlotsByArea = {
      area_flip: [
        { id: 'flip_s0', personId: 'manuel' },
        { id: 'flip_s1', personId: null },
        { id: 'flip_s2', personId: 'extra', disabled: true },
      ],
    };
    const out = synthesizeCoverageFloats({ area_flip: ['area_14_5'] }, slots, labels);
    expect(out.virtualFloats).toHaveLength(1);
    expect(out.virtualFloats[0].name).toBe('Flip #1');
  });

  it('drops self-references in supportedAreaIds (a station cannot cover its own breaks)', () => {
    const out = synthesizeCoverageFloats(
      { area_flip: ['area_flip', 'area_14_5'] },
      slotsBase,
      labels,
    );
    expect(out.virtualFloats[0].supportedAreaIds).toEqual(['area_14_5']);
  });
});

describe('mirrorVirtualFloatBreaksToStations', () => {
  it('copies the virtual float break entry into the source station entry', () => {
    const links = [
      { floatId: '__cov_area_flip_flip_s0', stationId: 'area_flip', stationSlotId: 'flip_s0', personId: 'manuel' },
      { floatId: '__cov_area_flip_flip_s1', stationId: 'area_flip', stationSlotId: 'flip_s1', personId: 'marcus' },
    ];
    const schedules: BreakSchedulesByArea = {
      area_flip: {
        manuel: { breakRotation: 1, lunchRotation: 1 },
        marcus: { breakRotation: 1, lunchRotation: 1 },
      },
      __cov_area_flip_flip_s0: {
        manuel: { breakRotation: 3, lunchRotation: 3 },
      },
      __cov_area_flip_flip_s1: {
        marcus: { breakRotation: 1, lunchRotation: 1 },
      },
    };
    const result = mirrorVirtualFloatBreaksToStations(schedules, links);
    expect(result.area_flip?.manuel?.breakRotation).toBe(3);
    expect(result.area_flip?.marcus?.breakRotation).toBe(1);
  });

  it('is a no-op when there are no links', () => {
    const schedules: BreakSchedulesByArea = {
      area_flip: { manuel: { breakRotation: 2, lunchRotation: 2 } },
    };
    const result = mirrorVirtualFloatBreaksToStations(schedules, []);
    expect(result).toEqual(schedules);
  });
});

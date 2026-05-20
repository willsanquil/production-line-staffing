import { describe, it, expect } from 'vitest';
import type { DayLogDetail } from '../types';
import { SHIFT_HOURS } from './dayLogConstants';
import { aggregatePersonStationMatrix, comparePeopleAtStation } from './dayLogReports';

function makeLog(
  workDate: string,
  assignments: DayLogDetail['assignments'],
  shiftHours = SHIFT_HOURS
): DayLogDetail {
  return {
    id: `log-${workDate}`,
    workDate,
    loggedAt: `${workDate}T18:00:00Z`,
    shiftHours,
    assignmentCount: assignments.length,
    snapshot: {},
    assignments,
  };
}

describe('dayLogReports', () => {
  it('counts days at station per person', () => {
    const logs = [
      makeLog('2026-05-01', [
        {
          personId: 'a',
          personName: 'Alex',
          assignmentType: 'primary',
          areaId: 'area_potting',
          areaName: 'Potting',
          slotIndex: 0,
          slotLabel: null,
          breakRotation: null,
          lunchRotation: null,
          skillLevel: null,
        },
      ]),
      makeLog('2026-05-02', [
        {
          personId: 'a',
          personName: 'Alex',
          assignmentType: 'primary',
          areaId: 'area_potting',
          areaName: 'Potting',
          slotIndex: 0,
          slotLabel: null,
          breakRotation: null,
          lunchRotation: null,
          skillLevel: null,
        },
      ]),
      makeLog('2026-05-03', [
        {
          personId: 'b',
          personName: 'Blake',
          assignmentType: 'primary',
          areaId: 'area_potting',
          areaName: 'Potting',
          slotIndex: 0,
          slotLabel: null,
          breakRotation: null,
          lunchRotation: null,
          skillLevel: null,
        },
      ]),
    ];
    const matrix = aggregatePersonStationMatrix(logs);
    const alexPotting = matrix.find((r) => r.personId === 'a' && r.areaId === 'area_potting');
    const blakePotting = matrix.find((r) => r.personId === 'b' && r.areaId === 'area_potting');
    expect(alexPotting?.days).toBe(2);
    expect(alexPotting?.estimatedHours).toBe(SHIFT_HOURS * 2);
    expect(blakePotting?.days).toBe(1);
  });

  it('compares two people at a station', () => {
    const logs = [
      makeLog('2026-05-01', [
        {
          personId: 'a',
          personName: 'Alex',
          assignmentType: 'primary',
          areaId: 'area_potting',
          areaName: 'Potting',
          slotIndex: 0,
          slotLabel: null,
          breakRotation: null,
          lunchRotation: null,
          skillLevel: null,
        },
      ]),
      makeLog('2026-05-02', [
        {
          personId: 'b',
          personName: 'Blake',
          assignmentType: 'primary',
          areaId: 'area_potting',
          areaName: 'Potting',
          slotIndex: 0,
          slotLabel: null,
          breakRotation: null,
          lunchRotation: null,
          skillLevel: null,
        },
      ]),
    ];
    const cmp = comparePeopleAtStation(logs, 'a', 'b', 'area_potting');
    expect(cmp).toHaveLength(1);
    expect(cmp[0].personA.days).toBe(1);
    expect(cmp[0].personB.days).toBe(1);
  });
});

import type { DayLogDetail } from '../types';

export interface PersonStationStats {
  personId: string;
  personName: string;
  areaId: string;
  areaName: string;
  days: number;
  estimatedHours: number;
}

export interface StationTotalStats {
  areaId: string;
  areaName: string;
  assignmentDays: number;
  estimatedHours: number;
}

export interface PersonCompareResult {
  areaId: string;
  areaName: string;
  personA: { personId: string; personName: string; days: number; estimatedHours: number };
  personB: { personId: string; personName: string; days: number; estimatedHours: number };
}

/** Aggregate primary assignments across multiple day logs. */
export function aggregatePersonStationMatrix(logs: DayLogDetail[]): PersonStationStats[] {
  const map = new Map<string, PersonStationStats>();
  for (const log of logs) {
    const hours = log.shiftHours > 0 ? log.shiftHours : 8;
    for (const a of log.assignments) {
      if (a.assignmentType !== 'primary') continue;
      const key = `${a.personId}\0${a.areaId}`;
      const cur = map.get(key);
      if (cur) {
        cur.days += 1;
        cur.estimatedHours += hours;
      } else {
        map.set(key, {
          personId: a.personId,
          personName: a.personName,
          areaId: a.areaId,
          areaName: a.areaName,
          days: 1,
          estimatedHours: hours,
        });
      }
    }
  }
  return [...map.values()].sort(
    (x, y) => y.days - x.days || x.personName.localeCompare(y.personName)
  );
}

export function aggregateStationTotals(logs: DayLogDetail[]): StationTotalStats[] {
  const map = new Map<string, StationTotalStats>();
  for (const log of logs) {
    const hours = log.shiftHours > 0 ? log.shiftHours : 8;
    for (const a of log.assignments) {
      if (a.assignmentType !== 'primary') continue;
      const cur = map.get(a.areaId);
      if (cur) {
        cur.assignmentDays += 1;
        cur.estimatedHours += hours;
      } else {
        map.set(a.areaId, {
          areaId: a.areaId,
          areaName: a.areaName,
          assignmentDays: 1,
          estimatedHours: hours,
        });
      }
    }
  }
  return [...map.values()].sort((x, y) => y.assignmentDays - x.assignmentDays);
}

export function comparePeopleAtStation(
  logs: DayLogDetail[],
  personAId: string,
  personBId: string,
  areaId?: string
): PersonCompareResult[] {
  const areas = new Map<string, string>();
  for (const log of logs) {
    for (const a of log.assignments) {
      if (a.assignmentType !== 'primary') continue;
      if (areaId && a.areaId !== areaId) continue;
      areas.set(a.areaId, a.areaName);
    }
  }

  const results: PersonCompareResult[] = [];
  for (const [aid, aname] of areas) {
    let daysA = 0;
    let hoursA = 0;
    let daysB = 0;
    let hoursB = 0;
    let nameA = '';
    let nameB = '';
    for (const log of logs) {
      const h = log.shiftHours > 0 ? log.shiftHours : 8;
      const atA = log.assignments.some(
        (x) => x.assignmentType === 'primary' && x.personId === personAId && x.areaId === aid
      );
      const atB = log.assignments.some(
        (x) => x.assignmentType === 'primary' && x.personId === personBId && x.areaId === aid
      );
      if (atA) {
        daysA += 1;
        hoursA += h;
        const row = log.assignments.find((x) => x.personId === personAId && x.areaId === aid);
        if (row) nameA = row.personName;
      }
      if (atB) {
        daysB += 1;
        hoursB += h;
        const row = log.assignments.find((x) => x.personId === personBId && x.areaId === aid);
        if (row) nameB = row.personName;
      }
    }
    if (daysA > 0 || daysB > 0) {
      results.push({
        areaId: aid,
        areaName: aname,
        personA: { personId: personAId, personName: nameA || personAId, days: daysA, estimatedHours: hoursA },
        personB: { personId: personBId, personName: nameB || personBId, days: daysB, estimatedHours: hoursB },
      });
    }
  }
  return results.sort((x, y) => y.personA.days + y.personB.days - (x.personA.days + x.personB.days));
}

export function defaultDateRangeDays(days: number): { fromDate: string; toDate: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  return {
    fromDate: from.toISOString().slice(0, 10),
    toDate: to.toISOString().slice(0, 10),
  };
}

export function uniquePeopleFromLogs(logs: DayLogDetail[]): Array<{ id: string; name: string }> {
  const map = new Map<string, string>();
  for (const log of logs) {
    for (const a of log.assignments) {
      if (a.assignmentType === 'primary' || a.assignmentType === 'lead') {
        map.set(a.personId, a.personName);
      }
    }
  }
  return [...map.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function uniqueStationsFromLogs(logs: DayLogDetail[]): Array<{ id: string; name: string }> {
  const map = new Map<string, string>();
  for (const log of logs) {
    for (const a of log.assignments) {
      if (a.assignmentType === 'primary') {
        map.set(a.areaId, a.areaName);
      }
    }
  }
  return [...map.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

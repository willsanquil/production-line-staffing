import type { BreakPreference, BreakRotation, LunchRotation, RosterPerson, SlotsByArea } from '../types';
import type { SkillLevel } from '../types';
import { AREA_IDS } from '../types';
import type { BreakSchedulesByArea } from '../types';
import { BREAK_LINE_WIDE_KEY } from './lineConfig';

const SKILL_SCORE: Record<SkillLevel, number> = {
  no_experience: 0,
  training: 1,
  trained: 2,
  expert: 3,
};

interface Bucket {
  skillSum: number;
  personIds: string[];
}

/** Which rotation(s) fit a preference (early = 1, late = N). */
function preferredRotations(pref: BreakPreference | undefined, rotationCount: number): number[] {
  if (pref === 'prefer_early') return [1];
  if (pref === 'prefer_late') return [rotationCount];
  return Array.from({ length: rotationCount }, (_, i) => i + 1);
}

/**
 * Assign one person to a bucket so that the line always has coverage.
 * 1) Spread first: prefer the rotation with the fewest people.
 * 2) Then respect preference (early/late) among rotations with the same count.
 * 3) Then balance skill (lower skill sum in bucket).
 */
function assignToBestBucket(
  personId: string,
  skillScore: number,
  preference: BreakPreference | undefined,
  buckets: Record<number, Bucket>,
  rotationCount: number
): number {
  const preferred = preferredRotations(preference, rotationCount);
  const rotations = Array.from({ length: rotationCount }, (_, i) => i + 1);
  const allowed = preferred.length < rotationCount ? rotations.filter((r) => preferred.includes(r)) : rotations;
  const sorted = [...allowed].sort((a, b) => {
    const countA = buckets[a].personIds.length;
    const countB = buckets[b].personIds.length;
    if (countA !== countB) return countA - countB;
    const prefA = preferred.includes(a) ? 0 : 1;
    const prefB = preferred.includes(b) ? 0 : 1;
    if (prefA !== prefB) return prefA - prefB;
    return buckets[a].skillSum - buckets[b].skillSum;
  });
  const bestRot = sorted[0] ?? 1;
  buckets[bestRot].skillSum += skillScore;
  buckets[bestRot].personIds.push(personId);
  return bestRot;
}

function runAssignmentForPeople(
  people: { personId: string; skillScore: number; preference: BreakPreference }[],
  rotationCount: number
): Record<string, { breakRotation: BreakRotation; lunchRotation: LunchRotation }> {
  const breakBuckets: Record<number, Bucket> = {};
  const lunchBuckets: Record<number, Bucket> = {};
  for (let r = 1; r <= rotationCount; r++) {
    breakBuckets[r] = { skillSum: 0, personIds: [] };
    lunchBuckets[r] = { skillSum: 0, personIds: [] };
  }
  const prefOrder = (pref: BreakPreference) =>
    pref === 'prefer_early' ? 0 : pref === 'prefer_late' ? 2 : 1;
  people.sort((a, b) => {
    if (b.skillScore !== a.skillScore) return b.skillScore - a.skillScore;
    return prefOrder(a.preference) - prefOrder(b.preference);
  });
  const assignments: Record<string, { breakRotation: BreakRotation; lunchRotation: LunchRotation }> = {};
  for (const { personId, skillScore, preference } of people) {
    const breakRot = assignToBestBucket(personId, skillScore, preference, breakBuckets, rotationCount);
    const lunchRot = assignToBestBucket(personId, skillScore, preference, lunchBuckets, rotationCount);
    assignments[personId] = {
      breakRotation: breakRot as BreakRotation,
      lunchRotation: lunchRot as LunchRotation,
    };
  }
  return assignments;
}

export interface GenerateBreakSchedulesOptions {
  /** Area IDs to process (default: AREA_IDS). */
  areaIds?: string[];
  /** Number of rotations (1–6). Default 3. */
  rotationCount?: number;
  /** 'line' = one set for whole line; 'station' = per area. Default 'station'. */
  scope?: 'line' | 'station';
  /** Lead slots (personId per area) to include in line-wide. */
  leadSlots?: Record<string, string | null>;
}

/**
 * Generate break and lunch rotation assignments. Spreads people across rotations for coverage.
 * Respects preferences when possible. Supports line-wide or per-station and 1–6 rotations.
 */
export function generateBreakSchedules(
  roster: RosterPerson[],
  slotsByArea: SlotsByArea,
  areaIds: string[] = [...AREA_IDS],
  options: GenerateBreakSchedulesOptions = {}
): BreakSchedulesByArea {
  const { rotationCount = 3, scope = 'station', leadSlots = {} } = options;
  const n = Math.min(6, Math.max(1, rotationCount));
  const result: BreakSchedulesByArea = {};

  if (scope === 'line') {
    const personIds = new Set<string>();
    for (const areaId of areaIds) {
      const slots = slotsByArea[areaId] ?? [];
      for (const s of slots) {
        if (s.personId) personIds.add(s.personId);
      }
      const leadId = leadSlots[areaId];
      if (leadId) personIds.add(leadId);
    }
    const people = Array.from(personIds).map((id) => {
      const p = roster.find((r) => r.id === id);
      const areaId = areaIds[0];
      const skillScore = p && areaId ? SKILL_SCORE[p.skills[areaId as keyof typeof p.skills] ?? 'no_experience'] : 0;
      const preference = p?.breakPreference ?? 'no_preference';
      return { personId: id, skillScore, preference };
    });
    if (people.length > 0) {
      result[BREAK_LINE_WIDE_KEY] = runAssignmentForPeople(people, n);
    }
    return result;
  }

  for (const areaId of areaIds) {
    const slots = slotsByArea[areaId] ?? [];
    const personIds = slots.map((s) => s.personId).filter(Boolean) as string[];
    if (personIds.length === 0) continue;

    const people = personIds.map((id) => {
      const p = roster.find((r) => r.id === id);
      const skillScore = p ? SKILL_SCORE[p.skills[areaId as keyof typeof p.skills] ?? 'no_experience'] : 0;
      const preference = p?.breakPreference ?? 'no_preference';
      return { personId: id, skillScore, preference };
    });

    result[areaId] = runAssignmentForPeople(people, n);
  }

  return result;
}

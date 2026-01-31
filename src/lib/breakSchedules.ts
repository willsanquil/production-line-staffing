import type { BreakPreference, BreakRotation, LunchRotation, RosterPerson, SlotsByArea } from '../types';
import type { SkillLevel } from '../types';
import { AREA_IDS } from '../types';
import type { BreakSchedulesByArea } from '../types';

const SKILL_SCORE: Record<SkillLevel, number> = {
  no_experience: 0,
  training: 1,
  trained: 2,
  expert: 3,
};

type Rotation = BreakRotation; // 1 | 2 | 3

interface Bucket {
  skillSum: number;
  personIds: string[];
}

/** Which rotation(s) fit a preference for "best" overlap (early = 1, late = 3). */
function preferredRotations(pref: BreakPreference | undefined): Rotation[] {
  if (pref === 'prefer_early') return [1];
  if (pref === 'prefer_late') return [3];
  return [1, 2, 3];
}

/**
 * Assign one person to a bucket so that the line always has coverage.
 * 1) Spread first: prefer the rotation with the fewest people (so no two go at the same time when possible).
 * 2) Then respect preference (early/late) among rotations with the same count.
 * 3) Then balance skill (lower skill sum in bucket).
 */
function assignToBestBucket(
  personId: string,
  skillScore: number,
  preference: BreakPreference | undefined,
  buckets: Record<Rotation, Bucket>
): Rotation {
  const preferred = preferredRotations(preference);
  const rotations = [1, 2, 3] as Rotation[];
  const allowed = preferred.length < 3 ? rotations.filter((r) => preferred.includes(r)) : rotations;
  // Sort by: smallest person count first (spread), then preference match, then lowest skill sum
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

/** Generate break and lunch rotation assignments per area. Spreads people across rotations so the line always has coverage (no two in same area on same break/lunch). Respects preferences when possible. */
export function generateBreakSchedules(
  roster: RosterPerson[],
  slotsByArea: SlotsByArea,
  areaIds: string[] = [...AREA_IDS]
): BreakSchedulesByArea {
  const result: BreakSchedulesByArea = {};

  for (const areaId of areaIds) {
    const slots = slotsByArea[areaId] ?? [];
    const personIds = slots.map((s) => s.personId).filter(Boolean) as string[];
    if (personIds.length === 0) continue;

    const people = personIds.map((id) => {
      const p = roster.find((r) => r.id === id);
      const skillScore = p ? SKILL_SCORE[p.skills[areaId] ?? 'no_experience'] : 0;
      const preference = p?.breakPreference ?? 'no_preference';
      return { personId: id, skillScore, preference };
    });

    // Sort: experts first, then by preference (early first) so we place constrained people first
    const prefOrder = (pref: BreakPreference) =>
      pref === 'prefer_early' ? 0 : pref === 'prefer_late' ? 2 : 1;
    people.sort((a, b) => {
      if (b.skillScore !== a.skillScore) return b.skillScore - a.skillScore;
      return prefOrder(a.preference) - prefOrder(b.preference);
    });

    const breakBuckets: Record<Rotation, Bucket> = {
      1: { skillSum: 0, personIds: [] },
      2: { skillSum: 0, personIds: [] },
      3: { skillSum: 0, personIds: [] },
    };
    const lunchBuckets: Record<Rotation, Bucket> = {
      1: { skillSum: 0, personIds: [] },
      2: { skillSum: 0, personIds: [] },
      3: { skillSum: 0, personIds: [] },
    };

    const areaAssignments: Record<string, { breakRotation: BreakRotation; lunchRotation: LunchRotation }> = {};

    for (const { personId, skillScore, preference } of people) {
      const breakRot = assignToBestBucket(personId, skillScore, preference, breakBuckets);
      const lunchRot = assignToBestBucket(personId, skillScore, preference, lunchBuckets);
      areaAssignments[personId] = { breakRotation: breakRot, lunchRotation: lunchRot };
    }

    result[areaId] = areaAssignments;
  }

  return result;
}

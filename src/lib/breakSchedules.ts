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

/** Which rotation(s) fit a preference (early = 1, middle = center, late = N). */
function preferredRotations(pref: BreakPreference | undefined, rotationCount: number): number[] {
  if (pref === 'prefer_early') return [1];
  if (pref === 'prefer_late') return [rotationCount];
  // 'prefer_middle' and 'no_preference' (default) both prefer middle rotations
  const mid = Math.ceil(rotationCount / 2);
  return rotationCount % 2 === 1 ? [mid] : [mid, mid + 1];
}

/**
 * Assign one person to a bucket. Coverage first: always prefer the rotation with the fewest people.
 * Preference and skill only break ties. This ensures we never stack everyone in one slot.
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
  const isLowSkill = skillScore <= 1;
  const sorted = [...rotations].sort((a, b) => {
    const countA = buckets[a].personIds.length;
    const countB = buckets[b].personIds.length;
    if (countA !== countB) return countA - countB;
    const prefA = preferred.includes(a) ? 0 : 1;
    const prefB = preferred.includes(b) ? 0 : 1;
    if (prefA !== prefB) return prefA - prefB;
    const sumA = buckets[a].skillSum;
    const sumB = buckets[b].skillSum;
    if (isLowSkill) return sumB - sumA;
    return sumA - sumB;
  });
  const bestRot = sorted[0] ?? 1;
  buckets[bestRot].skillSum += skillScore;
  buckets[bestRot].personIds.push(personId);
  return bestRot;
}

/**
 * When there are ≤ rotationCount people, each must get a distinct slot (full coverage).
 * Assign by preference: give each person their preferred rotation if still available.
 */
function runAssignmentDistinct(
  people: { personId: string; skillScore: number; preference: BreakPreference }[],
  rotationCount: number
): Record<string, { breakRotation: BreakRotation; lunchRotation: LunchRotation }> {
  const assignments: Record<string, { breakRotation: BreakRotation; lunchRotation: LunchRotation }> = {};
  const assignedRotations = new Set<number>();
  const peopleBySpecificity = [...people].sort((a, b) => {
    const order = (p: BreakPreference) =>
      p === 'prefer_early' ? 0 : p === 'prefer_middle' ? 1 : p === 'prefer_late' ? 2 : 3;
    return order(a.preference) - order(b.preference);
  });
  for (const { personId, preference } of peopleBySpecificity) {
    const preferred = preferredRotations(preference, rotationCount);
    const available = preferred.filter((r) => !assignedRotations.has(r));
    const rot = available[0] ?? Array.from({ length: rotationCount }, (_, i) => i + 1).find((r) => !assignedRotations.has(r)) ?? 1;
    assignedRotations.add(rot);
    assignments[personId] = { breakRotation: rot as BreakRotation, lunchRotation: rot as LunchRotation };
  }
  return assignments;
}

function runAssignmentForPeople(
  people: { personId: string; skillScore: number; preference: BreakPreference }[],
  rotationCount: number
): Record<string, { breakRotation: BreakRotation; lunchRotation: LunchRotation }> {
  if (people.length <= rotationCount) {
    return runAssignmentDistinct(people, rotationCount);
  }
  const breakBuckets: Record<number, Bucket> = {};
  for (let r = 1; r <= rotationCount; r++) {
    breakBuckets[r] = { skillSum: 0, personIds: [] };
  }
  const prefOrder = (pref: BreakPreference) =>
    pref === 'prefer_early' ? 0 : pref === 'prefer_late' ? 2 : 1;
  people.sort((a, b) => {
    if (b.skillScore !== a.skillScore) return b.skillScore - a.skillScore;
    return prefOrder(a.preference) - prefOrder(b.preference);
  });
  const assignments: Record<string, { breakRotation: BreakRotation; lunchRotation: LunchRotation }> = {};
  for (const { personId, skillScore, preference } of people) {
    const rot = assignToBestBucket(personId, skillScore, preference, breakBuckets, rotationCount);
    assignments[personId] = {
      breakRotation: rot as BreakRotation,
      lunchRotation: rot as LunchRotation,
    };
  }
  return assignments;
}

/** Assign one person to a rotation that isn't in usedInGroup; prefer rotation with smallest count. */
function assignLinkedPersonToBucket(
  personId: string,
  skillScore: number,
  preference: BreakPreference | undefined,
  buckets: Record<number, Bucket>,
  rotationCount: number,
  usedInGroup: Set<number>
): number {
  const preferred = preferredRotations(preference, rotationCount);
  const rotations = Array.from({ length: rotationCount }, (_, i) => i + 1);
  const allowed = rotations.filter((r) => !usedInGroup.has(r));
  const isLowSkill = skillScore <= 1;
  const sorted = [...allowed].sort((a, b) => {
    const countA = buckets[a].personIds.length;
    const countB = buckets[b].personIds.length;
    if (countA !== countB) return countA - countB;
    const prefA = preferred.includes(a) ? 0 : 1;
    const prefB = preferred.includes(b) ? 0 : 1;
    if (prefA !== prefB) return prefA - prefB;
    const sumA = buckets[a].skillSum;
    const sumB = buckets[b].skillSum;
    if (isLowSkill) return sumB - sumA;
    return sumA - sumB;
  });
  const bestRot = sorted[0] ?? 1;
  buckets[bestRot].skillSum += skillScore;
  buckets[bestRot].personIds.push(personId);
  return bestRot;
}

/**
 * Per-area assignment when some slots are linked (same label): people in a linked group get distinct rotations.
 * Float slots (indices in floatSlotIndices) are assigned last so others get preferred break slots.
 */
function runAssignmentWithLinkedSlots(
  peopleWithSlot: { personId: string; skillScore: number; preference: BreakPreference; slotIndex: number }[],
  rotationCount: number,
  linkedGroups: number[][],
  floatSlotIndices: number[] = []
): Record<string, { breakRotation: BreakRotation; lunchRotation: LunchRotation }> {
  const assignments: Record<string, { breakRotation: BreakRotation; lunchRotation: LunchRotation }> = {};
  const breakBuckets: Record<number, Bucket> = {};
  for (let r = 1; r <= rotationCount; r++) {
    breakBuckets[r] = { skillSum: 0, personIds: [] };
  }
  const floatSet = new Set(floatSlotIndices);
  const prefOrder = (p: BreakPreference) =>
    p === 'prefer_early' ? 0 : p === 'prefer_late' ? 2 : 1;
  const assignedPersonIds = new Set<string>();

  for (const group of linkedGroups) {
    const groupPeople = peopleWithSlot
      .filter((p) => group.includes(p.slotIndex))
      .sort((a, b) => prefOrder(a.preference) - prefOrder(b.preference));
    const usedInGroup = new Set<number>();
    for (const { personId, skillScore, preference } of groupPeople) {
      const rot = assignLinkedPersonToBucket(
        personId,
        skillScore,
        preference,
        breakBuckets,
        rotationCount,
        usedInGroup
      );
      usedInGroup.add(rot);
      assignedPersonIds.add(personId);
      assignments[personId] = { breakRotation: rot as BreakRotation, lunchRotation: rot as LunchRotation };
    }
  }

  const remaining = peopleWithSlot
    .filter((p) => !assignedPersonIds.has(p.personId))
    .sort((a, b) => (floatSet.has(a.slotIndex) ? 1 : 0) - (floatSet.has(b.slotIndex) ? 1 : 0));
  for (const { personId, skillScore, preference } of remaining) {
    const rot = assignToBestBucket(personId, skillScore, preference, breakBuckets, rotationCount);
    assignments[personId] = { breakRotation: rot as BreakRotation, lunchRotation: rot as LunchRotation };
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
  /** Per area: groups of slot indices that share a break slot (e.g. same role); people in a group get distinct rotations. */
  linkedSlotsByArea?: Record<string, number[][]>;
  /** Per area: slot indices whose role contains "float"; they are assigned breaks last so others get preferred slots. */
  floatSlotIndicesByArea?: Record<string, number[]>;
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
  const { rotationCount = 3, scope = 'station', leadSlots = {}, linkedSlotsByArea = {}, floatSlotIndicesByArea = {} } = options;
  const n = Math.min(6, Math.max(1, rotationCount));
  const result: BreakSchedulesByArea = {};

  if (scope === 'line') {
    const personIds = new Set<string>();
    const personAreas: Record<string, string[]> = {};
    for (const areaId of areaIds) {
      const slots = slotsByArea[areaId] ?? [];
      for (const s of slots) {
        if (s.personId) {
          personIds.add(s.personId);
          if (!personAreas[s.personId]) personAreas[s.personId] = [];
          personAreas[s.personId].push(areaId);
        }
      }
      const leadId = leadSlots[areaId];
      if (leadId) {
        personIds.add(leadId);
        if (!personAreas[leadId]) personAreas[leadId] = [];
        personAreas[leadId].push(areaId);
      }
    }
    const people = Array.from(personIds).map((id) => {
      const p = roster.find((r) => r.id === id);
      const areas = personAreas[id] ?? [];
      let skillScore = 0;
      if (p && areas.length > 0) {
        const sum = areas.reduce(
          (acc, areaId) => acc + SKILL_SCORE[p.skills[areaId as keyof typeof p.skills] ?? 'no_experience'],
          0
        );
        skillScore = sum / areas.length;
      }
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
    const peopleWithSlot: { personId: string; skillScore: number; preference: BreakPreference; slotIndex: number }[] = [];
    for (let i = 0; i < slots.length; i++) {
      const personId = slots[i].personId;
      if (!personId) continue;
      const p = roster.find((r) => r.id === personId);
      const skillScore = p ? SKILL_SCORE[p.skills[areaId as keyof typeof p.skills] ?? 'no_experience'] : 0;
      const preference = p?.breakPreference ?? 'no_preference';
      peopleWithSlot.push({ personId, skillScore, preference, slotIndex: i });
    }
    if (peopleWithSlot.length === 0) continue;

    const linkedGroups = linkedSlotsByArea[areaId] ?? [];
    const floatIndices = floatSlotIndicesByArea[areaId] ?? [];
    const people = peopleWithSlot.map(({ personId, skillScore, preference }) => ({ personId, skillScore, preference }));

    if (linkedGroups.length > 0 || floatIndices.length > 0) {
      result[areaId] = runAssignmentWithLinkedSlots(peopleWithSlot, n, linkedGroups, floatIndices);
    } else {
      result[areaId] = runAssignmentForPeople(people, n);
    }
  }

  return result;
}

import type { AreaId, DeJuicedAreas, JuicedAreas, RosterPerson, SlotsByArea } from '../types';
import { AREA_IDS, AREA_CAPACITY, areaRequiresTrainedOrExpert } from '../types';

export type EffectiveCapacity = Record<AreaId, { min: number; max: number }>;

const SKILL_ORDER = { expert: 4, trained: 3, training: 2, no_experience: 1 } as const;

function scoreForArea(person: RosterPerson, areaId: AreaId): number {
  return SKILL_ORDER[person.skills[areaId]] ?? 0;
}

/** Fisher–Yates shuffle; returns new array. */
function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Areas that require experience cannot accept people with no experience in that area. */
function eligibleForArea(
  person: RosterPerson,
  areaId: AreaId,
  areaRequiresTrainedOrExpertFn: (id: string) => boolean = areaRequiresTrainedOrExpert
): boolean {
  if (!areaRequiresTrainedOrExpertFn(areaId)) return true;
  const level = person.skills[areaId as keyof typeof person.skills] ?? 'no_experience';
  return level !== 'no_experience';
}

/** Best trained or expert for this area not yet in assigned set, or null. */
function takeBestTrainedOrExpert(
  pool: RosterPerson[],
  assigned: Set<string>,
  areaId: AreaId,
  areaRequiresTrainedOrExpertFn: (id: string) => boolean = areaRequiresTrainedOrExpert
): RosterPerson | null {
  const skillOk = (p: RosterPerson) => {
    const s = p.skills[areaId] ?? 'no_experience';
    return s === 'trained' || s === 'expert';
  };
  const candidate = pool
    .filter((p) => !assigned.has(p.id) && eligibleForArea(p, areaId, areaRequiresTrainedOrExpertFn) && skillOk(p))
    .sort((a, b) => scoreForArea(b, areaId) - scoreForArea(a, areaId))[0];
  return candidate ?? null;
}

/** Copy slots to out; preserve personId for locked slots and return their personIds so automation skips those people elsewhere. */
function copySlotsPreservingLocked(slotsByArea: SlotsByArea, areaIds: string[]): { out: SlotsByArea; assignedFromLocked: Set<string> } {
  const assignedFromLocked = new Set<string>();
  const out = {} as SlotsByArea;
  for (const areaId of areaIds) {
    const list = slotsByArea[areaId] ?? [];
    out[areaId] = list.map((s) => {
      if (s.locked && s.personId) assignedFromLocked.add(s.personId);
      return { ...s, personId: s.locked ? s.personId : null };
    });
  }
  return { out, assignedFromLocked };
}

/** Phase 1: assign first enabled, unlocked slot of each area that requires trained/expert to a trained or expert person. */
function fillAnchorSlots(
  out: SlotsByArea,
  pool: RosterPerson[],
  assigned: Set<string>,
  areaIds: string[],
  areaRequiresTrainedOrExpertFn: (id: string) => boolean = areaRequiresTrainedOrExpert
): void {
  for (const areaId of areaIds) {
    const list = out[areaId] ?? [];
    if (!areaRequiresTrainedOrExpertFn(areaId) || list.length === 0) continue;
    const firstEnabledIdx = list.findIndex((s) => !s.disabled && !s.locked);
    if (firstEnabledIdx === -1) continue;
    const person = takeBestTrainedOrExpert(pool, assigned, areaId, areaRequiresTrainedOrExpertFn);
    if (person) {
      out[areaId][firstEnabledIdx].personId = person.id;
      assigned.add(person.id);
    }
  }
}

/** Randomize: assign available people to slots (one per slot), no double booking. Locked slots are left unchanged. */
export function randomizeAssignments(
  roster: RosterPerson[],
  slotsByArea: SlotsByArea,
  leadAssignedPersonIds: Set<string> = new Set(),
  areaIds: string[] = [...AREA_IDS],
  areaRequiresTrainedOrExpertFn?: (areaId: string) => boolean
): SlotsByArea {
  const requiresFn = areaRequiresTrainedOrExpertFn ?? areaRequiresTrainedOrExpert;
  const available = roster.filter(
    (p) =>
      !p.absent &&
      !leadAssignedPersonIds.has(p.id) &&
      (!p.ot || p.otHereToday)
  );
  const { out, assignedFromLocked } = copySlotsPreservingLocked(slotsByArea, areaIds);
  const used = new Set(assignedFromLocked);
  fillAnchorSlots(out, available, used, areaIds, requiresFn);
  const shuffledRemaining = shuffle(available.filter((p) => !used.has(p.id)));
  for (const areaId of areaIds) {
    const list = out[areaId] ?? [];
    for (let i = 0; i < list.length; i++) {
      if (list[i].disabled || list[i].locked || list[i].personId != null) continue;
      const person = shuffledRemaining.find((p) => !used.has(p.id) && eligibleForArea(p, areaId, requiresFn));
      if (person) {
        out[areaId][i].personId = person.id;
        used.add(person.id);
      }
    }
  }
  return out;
}

/** Spread talent: assign best-available per slot. Juiced areas filled first, de-juiced last. Excludes people assigned as leads. Areas with "needs experience" cannot get no_experience. Disabled slots are skipped. */
export function spreadTalent(
  roster: RosterPerson[],
  slotsByArea: SlotsByArea,
  juicedAreas: JuicedAreas = {},
  leadAssignedPersonIds: Set<string> = new Set(),
  deJuicedAreas: DeJuicedAreas = {},
  capacity?: EffectiveCapacity | null,
  areaIds: string[] = [...AREA_IDS],
  areaRequiresTrainedOrExpertFn?: (areaId: string) => boolean
): SlotsByArea {
  const requiresFn = areaRequiresTrainedOrExpertFn ?? areaRequiresTrainedOrExpert;
  const cap = capacity ?? AREA_CAPACITY;
  const available = shuffle(
    roster.filter(
      (p) =>
        !p.absent &&
        !leadAssignedPersonIds.has(p.id) &&
        (!p.ot || p.otHereToday)
    )
  );
  const { out, assignedFromLocked } = copySlotsPreservingLocked(slotsByArea, areaIds);
  const assigned = new Set(assignedFromLocked);
  fillAnchorSlots(out, available, assigned, areaIds, requiresFn);
  const fillableIdx = (areaId: AreaId) =>
    (out[areaId] ?? []).map((_, i) => i).filter((i) => !out[areaId][i].disabled && !out[areaId][i].locked);
  const minSlotOrder: { areaId: AreaId; slotIdx: number }[] = [];
  for (const areaId of areaIds) {
    const c = cap[areaId];
    if (c) fillableIdx(areaId).slice(0, c.min).forEach((slotIdx) => minSlotOrder.push({ areaId, slotIdx }));
  }
  minSlotOrder.sort((a, b) => {
    const priority = (areaId: AreaId) =>
      juicedAreas[areaId] ? 1 : deJuicedAreas[areaId] ? -1 : 0;
    const pA = priority(a.areaId);
    const pB = priority(b.areaId);
    if (pB !== pA) return pB - pA;
    if (a.areaId !== b.areaId) return areaIds.indexOf(a.areaId) - areaIds.indexOf(b.areaId);
    return a.slotIdx - b.slotIdx;
  });
  const overflowOrder: { areaId: AreaId; slotIdx: number }[] = [];
  for (const areaId of areaIds) {
    const c = cap[areaId];
    if (c) fillableIdx(areaId).slice(c.min).forEach((slotIdx) => overflowOrder.push({ areaId, slotIdx }));
  }
  const slotOrder = [...minSlotOrder, ...overflowOrder];
  for (const { areaId, slotIdx } of slotOrder) {
    const slot = out[areaId]?.[slotIdx];
    if (!slot || slot.personId != null) continue;
    const candidates = [...available]
      .filter((p) => !assigned.has(p.id) && eligibleForArea(p, areaId, requiresFn))
      .sort((a, b) => scoreForArea(b, areaId) - scoreForArea(a, areaId));
    if (candidates.length > 0) {
      slot.personId = candidates[0].id;
      assigned.add(candidates[0].id);
    }
  }
  return out;
}

/** MAX SPEED: experts in their places. Deterministic — best skill match per slot, no shuffle. Disabled slots are skipped. */
export function maxSpeedAssignments(
  roster: RosterPerson[],
  slotsByArea: SlotsByArea,
  juicedAreas: JuicedAreas = {},
  leadAssignedPersonIds: Set<string> = new Set(),
  deJuicedAreas: DeJuicedAreas = {},
  capacity?: EffectiveCapacity | null,
  areaIds: string[] = [...AREA_IDS],
  areaRequiresTrainedOrExpertFn?: (areaId: string) => boolean
): SlotsByArea {
  const requiresFn = areaRequiresTrainedOrExpertFn ?? areaRequiresTrainedOrExpert;
  const cap = capacity ?? AREA_CAPACITY;
  const available = roster.filter(
    (p) =>
      !p.absent &&
      !leadAssignedPersonIds.has(p.id) &&
      (!p.ot || p.otHereToday)
  );
  const { out, assignedFromLocked } = copySlotsPreservingLocked(slotsByArea, areaIds);
  const assigned = new Set(assignedFromLocked);
  fillAnchorSlots(out, available, assigned, areaIds, requiresFn);
  const fillableIdx = (areaId: AreaId) =>
    (out[areaId] ?? []).map((_, i) => i).filter((i) => !out[areaId][i].disabled && !out[areaId][i].locked);
  const minSlotOrder: { areaId: AreaId; slotIdx: number }[] = [];
  for (const areaId of areaIds) {
    const c = cap[areaId];
    if (c) fillableIdx(areaId).slice(0, c.min).forEach((slotIdx) => minSlotOrder.push({ areaId, slotIdx }));
  }
  minSlotOrder.sort((a, b) => {
    const priority = (areaId: AreaId) =>
      juicedAreas[areaId] ? 1 : deJuicedAreas[areaId] ? -1 : 0;
    const pA = priority(a.areaId);
    const pB = priority(b.areaId);
    if (pB !== pA) return pB - pA;
    if (a.areaId !== b.areaId) return areaIds.indexOf(a.areaId) - areaIds.indexOf(b.areaId);
    return a.slotIdx - b.slotIdx;
  });
  const overflowOrder: { areaId: AreaId; slotIdx: number }[] = [];
  for (const areaId of areaIds) {
    const c = cap[areaId];
    if (c) fillableIdx(areaId).slice(c.min).forEach((slotIdx) => overflowOrder.push({ areaId, slotIdx }));
  }
  const slotOrder = [...minSlotOrder, ...overflowOrder];
  for (const { areaId, slotIdx } of slotOrder) {
    const slot = out[areaId]?.[slotIdx];
    if (!slot || slot.personId != null) continue;
    const candidates = [...available]
      .filter((p) => !assigned.has(p.id) && eligibleForArea(p, areaId, requiresFn))
      .sort((a, b) => scoreForArea(b, areaId) - scoreForArea(a, areaId));
    if (candidates.length > 0) {
      slot.personId = candidates[0].id;
      assigned.add(candidates[0].id);
    }
  }
  return out;
}

/** Stretch score: higher = more "outside comfort zone" (no_exp/training, and want to learn this area). */
function stretchScoreForArea(person: RosterPerson, areaId: AreaId): number {
  const skillNum = scoreForArea(person, areaId);
  const wantToLearn = (person.areasWantToLearn ?? []).includes(areaId);
  return (wantToLearn ? 100 : 0) + (3 - skillNum);
}

/** Light stretch: mix of best-fit and stretch. ~35% of slot picks prefer stretch (training/no_exp, prefer want-to-learn). Disabled slots are skipped. */
export function lightStretchAssignments(
  roster: RosterPerson[],
  slotsByArea: SlotsByArea,
  juicedAreas: JuicedAreas = {},
  leadAssignedPersonIds: Set<string> = new Set(),
  deJuicedAreas: DeJuicedAreas = {},
  capacity?: EffectiveCapacity | null,
  areaIds: string[] = [...AREA_IDS],
  areaRequiresTrainedOrExpertFn?: (areaId: string) => boolean
): SlotsByArea {
  const requiresFn = areaRequiresTrainedOrExpertFn ?? areaRequiresTrainedOrExpert;
  const cap = capacity ?? AREA_CAPACITY;
  const available = shuffle(
    roster.filter(
      (p) =>
        !p.absent &&
        !leadAssignedPersonIds.has(p.id) &&
        (!p.ot || p.otHereToday)
    )
  );
  const { out, assignedFromLocked } = copySlotsPreservingLocked(slotsByArea, areaIds);
  const assigned = new Set(assignedFromLocked);
  fillAnchorSlots(out, available, assigned, areaIds, requiresFn);
  const fillableIdx = (areaId: AreaId) =>
    (out[areaId] ?? []).map((_, i) => i).filter((i) => !out[areaId][i].disabled && !out[areaId][i].locked);
  const minSlotOrder: { areaId: AreaId; slotIdx: number }[] = [];
  for (const areaId of areaIds) {
    const c = cap[areaId];
    if (c) fillableIdx(areaId).slice(0, c.min).forEach((slotIdx) => minSlotOrder.push({ areaId, slotIdx }));
  }
  minSlotOrder.sort((a, b) => {
    const priority = (areaId: AreaId) =>
      juicedAreas[areaId] ? 1 : deJuicedAreas[areaId] ? -1 : 0;
    const pA = priority(a.areaId);
    const pB = priority(b.areaId);
    if (pB !== pA) return pB - pA;
    if (a.areaId !== b.areaId) return areaIds.indexOf(a.areaId) - areaIds.indexOf(b.areaId);
    return a.slotIdx - b.slotIdx;
  });
  const overflowOrder: { areaId: AreaId; slotIdx: number }[] = [];
  for (const areaId of areaIds) {
    const c = cap[areaId];
    if (c) fillableIdx(areaId).slice(c.min).forEach((slotIdx) => overflowOrder.push({ areaId, slotIdx }));
  }
  const slotOrder = [...minSlotOrder, ...overflowOrder];
  const LIGHT_STRETCH_CHANCE = 0.35;
  for (const { areaId, slotIdx } of slotOrder) {
    const slot = out[areaId]?.[slotIdx];
    if (!slot || slot.personId != null) continue;
    const eligible = [...available].filter((p) => !assigned.has(p.id) && eligibleForArea(p, areaId, requiresFn));
    if (eligible.length === 0) continue;
    const useStretch = Math.random() < LIGHT_STRETCH_CHANCE;
    const stretchCandidates = eligible.filter(
      (p) => (SKILL_ORDER[p.skills[areaId] ?? 'no_experience'] ?? 0) <= 2
    );
    const pool = useStretch && stretchCandidates.length > 0 ? stretchCandidates : eligible;
    pool.sort((a, b) => {
      if (useStretch && stretchCandidates.length > 0) {
        return stretchScoreForArea(b, areaId) - stretchScoreForArea(a, areaId);
      }
      return scoreForArea(b, areaId) - scoreForArea(a, areaId);
    });
    slot.personId = pool[0].id;
    assigned.add(pool[0].id);
  }
  return out;
}

/** STRETCH: push team outside comfort zone. Prefer people in no_exp/training and areas they want to learn. */
export function stretchAssignments(
  roster: RosterPerson[],
  slotsByArea: SlotsByArea,
  leadAssignedPersonIds: Set<string> = new Set(),
  areaIds: string[] = [...AREA_IDS]
): SlotsByArea {
  const available = shuffle(
    roster.filter(
      (p) =>
        !p.absent &&
        !leadAssignedPersonIds.has(p.id) &&
        (!p.ot || p.otHereToday)
    )
  );
  const { out, assignedFromLocked } = copySlotsPreservingLocked(slotsByArea, areaIds);
  const assigned = new Set(assignedFromLocked);
  fillAnchorSlots(out, available, assigned, areaIds);
  const slotOrder: { areaId: AreaId; slotIdx: number }[] = [];
  for (const areaId of areaIds) {
    const list = out[areaId] ?? [];
    for (let slotIdx = 0; slotIdx < list.length; slotIdx++) {
      if (!list[slotIdx].disabled && !list[slotIdx].locked) slotOrder.push({ areaId, slotIdx });
    }
  }
  shuffle(slotOrder);
  for (const { areaId, slotIdx } of slotOrder) {
    const slot = out[areaId]?.[slotIdx];
    if (slot.personId != null) continue;
    const candidates = [...available]
      .filter((p) => !assigned.has(p.id) && eligibleForArea(p, areaId, requiresFn))
      .sort((a, b) => stretchScoreForArea(b, areaId) - stretchScoreForArea(a, areaId));
    if (candidates.length > 0) {
      slot.personId = candidates[0].id;
      assigned.add(candidates[0].id);
    }
  }
  return out;
}

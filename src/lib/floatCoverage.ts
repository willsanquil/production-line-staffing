import type { FloatSlotConfig, SlotsByArea, BreakSchedulesByArea } from '../types';

// ── Types ──────────────────────────────────────────────────────────────

export type FloatSlotActivity =
  | { type: 'covering'; areaId: string; slotIndex: number }
  | { type: 'on_break' }
  | { type: 'idle' };

/** Per-float schedule: floatSlotId → rotation → activity. */
export type FloatScheduleMap = Record<string, Record<number, FloatSlotActivity>>;

export interface PersonBreakCoverage {
  personId: string;
  breakRotation: number;
  coveredByFloatId: string | null;
  coveredByFloatName: string | null;
  /** Stores the float's assigned person ID (the UI component resolves this to a display name). */
  coveredByPersonName: string | null;
}

/** Per-area break coverage: areaId → list of person coverage entries. */
export type AreaBreakCoverage = Record<string, PersonBreakCoverage[]>;

export interface CoverageSummarySlot {
  rotation: number;
  peopleOnBreak: number;
  coveredByFloatId: string | null;
  coveredByFloatName: string | null;
  /** True if peopleOnBreak > 0 and no float is covering this area during this rotation. */
  uncovered: boolean;
}

export interface CoverageSummaryRow {
  areaId: string;
  areaLabel: string;
  slots: CoverageSummarySlot[];
}

export interface ComputeFloatCoverageInput {
  floatSlots: FloatSlotConfig[];
  slots: SlotsByArea;
  breakSchedules: BreakSchedulesByArea;
  rotationCount: number;
  areaIdsInSectionOrder: string[];
  areaLabels: Record<string, string>;
  /** Per area: groups of slot indices that share a label (e.g. Inside/Outside lanes).
   * People in a linked group cover each other when only one is on break. */
  linkedSlotsByArea?: Record<string, number[][]>;
  /** Per-slot "needs break coverage": areaId -> slotId -> true. When set, prefer covering these slots first. */
  slotBreakCoverageEnabled?: Record<string, Record<string, boolean>>;
}

export interface FloatCoverageResult {
  floatSchedule: FloatScheduleMap;
  areaCoverage: AreaBreakCoverage;
  coverageSummary: CoverageSummaryRow[];
}

// ── Implementation ─────────────────────────────────────────────────────

/**
 * Compute float coverage: what each float does per rotation, which persons
 * are covered/uncovered, and a gap-analysis summary for float-supported areas.
 */
export function computeFloatCoverage(input: ComputeFloatCoverageInput): FloatCoverageResult {
  const {
    floatSlots,
    slots,
    breakSchedules,
    rotationCount,
    areaIdsInSectionOrder,
    areaLabels,
    linkedSlotsByArea = {},
    slotBreakCoverageEnabled = {},
  } = input;

  /** True if this (areaId, slotIndex) has "needs break coverage" enabled. */
  const slotNeedsCoverage = (areaId: string, slotIndex: number): boolean => {
    const areaSlots = slots[areaId] ?? [];
    const slotId = areaSlots[slotIndex]?.id;
    return !!slotId && !!slotBreakCoverageEnabled[areaId]?.[slotId];
  };

  if (floatSlots.length === 0) {
    return { floatSchedule: {}, areaCoverage: {}, coverageSummary: [] };
  }

  // ── Step 1: Build the float schedule ─────────────────────────────────
  // Track which (areaId, rotation) pairs are already claimed by a float.
  // Each subsequent float only covers areas that still need it.
  const coveredByRotation: Record<number, Set<string>> = {};
  for (let r = 1; r <= rotationCount; r++) {
    coveredByRotation[r] = new Set<string>();
  }

  const floatSchedule: FloatScheduleMap = {};

  for (const float of floatSlots) {
    const schedule: Record<number, FloatSlotActivity> = {};
    const floatSlotSlots = slots[float.id] ?? [];
    const floatPersonId = floatSlotSlots[0]?.personId ?? null;
    const supportedAreaIdsInOrder = areaIdsInSectionOrder.filter((areaId) =>
      float.supportedAreaIds.includes(areaId)
    );
    const supportedAreaIds =
      supportedAreaIdsInOrder.length > 0 ? supportedAreaIdsInOrder : [...float.supportedAreaIds];

    // Get the float person's own break rotation
    const floatBreakEntry = floatPersonId
      ? breakSchedules[float.id]?.[floatPersonId]
      : undefined;
    const floatBreakRotation = floatBreakEntry?.breakRotation ?? null;

    for (let rot = 1; rot <= rotationCount; rot++) {
      // If no person assigned to this float → idle
      if (!floatPersonId) {
        schedule[rot] = { type: 'idle' };
        continue;
      }

      // If it's the float's own break rotation → on_break
      if (floatBreakRotation !== null && rot === floatBreakRotation) {
        schedule[rot] = { type: 'on_break' };
        continue;
      }

      // Find a supported area with someone on break this rotation that is NOT already
      // covered. Prefer slots that have "needs break coverage" enabled.
      let foundArea: string | null = null;
      let foundSlotIndex = 0;
      const startIdx = supportedAreaIds.length > 0 ? ((rot - 1) % supportedAreaIds.length) : 0;

      // First pass: only consider slots that have "needs break coverage" enabled.
      for (let i = 0; i < supportedAreaIds.length; i++) {
        const areaId = supportedAreaIds[(startIdx + i) % supportedAreaIds.length];
        if (coveredByRotation[rot].has(areaId)) continue;
        const areaBreaks = breakSchedules[areaId];
        if (!areaBreaks) continue;
        const areaSlots = slots[areaId] ?? [];
        for (let si = 0; si < areaSlots.length; si++) {
          if (!slotNeedsCoverage(areaId, si)) continue;
          const personId = areaSlots[si].personId;
          if (!personId) continue;
          const entry = areaBreaks[personId];
          if (entry?.breakRotation === rot) {
            foundArea = areaId;
            foundSlotIndex = si;
            break;
          }
        }
        if (foundArea) break;
      }

      // Second pass: if no slot with "needs break coverage" found, use any slot on break.
      if (!foundArea) {
        for (let i = 0; i < supportedAreaIds.length; i++) {
          const areaId = supportedAreaIds[(startIdx + i) % supportedAreaIds.length];
          if (coveredByRotation[rot].has(areaId)) continue;
          const areaBreaks = breakSchedules[areaId];
          if (!areaBreaks) continue;
          const areaSlots = slots[areaId] ?? [];
          for (let si = 0; si < areaSlots.length; si++) {
            const personId = areaSlots[si].personId;
            if (!personId) continue;
            const entry = areaBreaks[personId];
            if (entry?.breakRotation === rot) {
              foundArea = areaId;
              foundSlotIndex = si;
              break;
            }
          }
          if (foundArea) break;
        }
      }

      if (foundArea) {
        schedule[rot] = { type: 'covering', areaId: foundArea, slotIndex: foundSlotIndex };
        coveredByRotation[rot].add(foundArea);
      } else {
        schedule[rot] = { type: 'idle' };
      }
    }

    floatSchedule[float.id] = schedule;
  }

  // ── Step 2: Build set of all float-supported area IDs ────────────────

  const floatSupportedAreaIds = new Set<string>();
  for (const float of floatSlots) {
    for (const areaId of float.supportedAreaIds) {
      floatSupportedAreaIds.add(areaId);
    }
  }

  // ── Step 3: Build areaCoverage ───────────────────────────────────────

  // Build a map from personId → slot index for linked-group lookup
  const personSlotIndex: Record<string, Record<string, number>> = {}; // areaId → personId → slotIndex
  for (const areaId of areaIdsInSectionOrder) {
    const areaSlots = slots[areaId] ?? [];
    const map: Record<string, number> = {};
    for (let i = 0; i < areaSlots.length; i++) {
      if (areaSlots[i].personId) map[areaSlots[i].personId!] = i;
    }
    personSlotIndex[areaId] = map;
  }

  const areaCoverage: AreaBreakCoverage = {};

  for (const areaId of areaIdsInSectionOrder) {
    if (!floatSupportedAreaIds.has(areaId)) continue;

    const areaBreaks = breakSchedules[areaId];
    if (!areaBreaks) continue;

    const linkedGroups = linkedSlotsByArea[areaId] ?? [];
    const personCoverages: PersonBreakCoverage[] = [];

    for (const [personId, entry] of Object.entries(areaBreaks)) {
      const breakRot = entry.breakRotation;

      // Check if any float's schedule shows 'covering' this area during this person's break rotation
      let coveredByFloatId: string | null = null;
      let coveredByFloatName: string | null = null;
      let coveredByPersonName: string | null = null;

      for (const float of floatSlots) {
        const activity = floatSchedule[float.id]?.[breakRot];
        if (activity && activity.type === 'covering' && activity.areaId === areaId) {
          coveredByFloatId = float.id;
          coveredByFloatName = float.name;
          // Get the person assigned to this float
          const floatSlotSlots = slots[float.id] ?? [];
          coveredByPersonName = floatSlotSlots[0]?.personId ?? null;
          break;
        }
      }

      // If no float is covering, check linked-slot self-coverage:
      // a partner in the same linked group who is NOT on break covers this person.
      if (!coveredByFloatId && linkedGroups.length > 0) {
        const mySlotIdx = personSlotIndex[areaId]?.[personId];
        if (mySlotIdx !== undefined) {
          const myGroup = linkedGroups.find((g) => g.includes(mySlotIdx));
          if (myGroup) {
            const areaSlots = slots[areaId] ?? [];
            for (const partnerIdx of myGroup) {
              if (partnerIdx === mySlotIdx) continue;
              const partnerId = areaSlots[partnerIdx]?.personId;
              if (!partnerId) continue;
              const partnerBreak = areaBreaks[partnerId]?.breakRotation;
              // Partner is NOT on break this rotation → they cover
              if (partnerBreak !== breakRot) {
                coveredByFloatId = '__self_coverage__';
                coveredByFloatName = null;
                coveredByPersonName = partnerId;
                break;
              }
            }
          }
        }
      }

      personCoverages.push({
        personId,
        breakRotation: breakRot,
        coveredByFloatId,
        coveredByFloatName,
        coveredByPersonName,
      });
    }

    areaCoverage[areaId] = personCoverages;
  }

  // ── Step 4: Build coverageSummary ────────────────────────────────────

  const coverageSummary: CoverageSummaryRow[] = [];

  for (const areaId of areaIdsInSectionOrder) {
    if (!floatSupportedAreaIds.has(areaId)) continue;

    const summarySlots: CoverageSummarySlot[] = [];
    const areaBreaks = breakSchedules[areaId];

    for (let rot = 1; rot <= rotationCount; rot++) {
      // Count people on break in this area this rotation
      let peopleOnBreak = 0;
      if (areaBreaks) {
        for (const entry of Object.values(areaBreaks)) {
          if (entry.breakRotation === rot) {
            peopleOnBreak++;
          }
        }
      }

      // Check if any float is covering this area this rotation
      let coveredByFloatId: string | null = null;
      let coveredByFloatName: string | null = null;

      for (const float of floatSlots) {
        const activity = floatSchedule[float.id]?.[rot];
        if (activity && activity.type === 'covering' && activity.areaId === areaId) {
          coveredByFloatId = float.id;
          coveredByFloatName = float.name;
          break;
        }
      }

      // Check if all people on break this rotation are covered (by float or linked partner)
      const areaPersonCoverages = areaCoverage[areaId] ?? [];
      const allBreaksCovered = areaPersonCoverages
        .filter((pc) => pc.breakRotation === rot)
        .every((pc) => pc.coveredByFloatId !== null);
      const uncovered = peopleOnBreak > 0 && !allBreaksCovered;

      summarySlots.push({
        rotation: rot,
        peopleOnBreak,
        coveredByFloatId,
        coveredByFloatName,
        uncovered,
      });
    }

    coverageSummary.push({
      areaId,
      areaLabel: areaLabels[areaId] ?? areaId,
      slots: summarySlots,
    });
  }

  return { floatSchedule, areaCoverage, coverageSummary };
}

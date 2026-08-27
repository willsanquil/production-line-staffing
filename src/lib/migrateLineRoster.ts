import type { AreaId, LineConfig, LineState, RosterPerson, RootState, SkillLevel, SlotsByArea } from '../types';
import { getAreaIds } from './lineConfig';

type StringRecord = Record<string, unknown>;

/** Copy per-area maps, keeping only keys that exist on the target line. */
function copyMatchingKeys<T extends StringRecord>(source: T | undefined, allowed: Set<string>): Partial<T> {
  if (!source) return {};
  const out: StringRecord = {};
  for (const [key, value] of Object.entries(source)) {
    if (allowed.has(key)) out[key] = value;
  }
  return out as Partial<T>;
}

/** Copy nested slot maps (e.g. slotBreakCoverageEnabled) for matching areas. */
function copyNestedSlotMaps(
  source: Record<string, Record<string, boolean>> | undefined,
  targetSlots: SlotsByArea,
  allowedAreas: Set<string>
): Record<string, Record<string, boolean>> {
  const out: Record<string, Record<string, boolean>> = {};
  if (!source) return out;
  for (const areaId of Object.keys(targetSlots)) {
    if (!allowedAreas.has(areaId)) continue;
    const srcMap = source[areaId];
    if (!srcMap) continue;
    const targetSlotIds = new Set((targetSlots[areaId] ?? []).map((s) => s.id));
    const mapped: Record<string, boolean> = {};
    for (const [slotId, enabled] of Object.entries(srcMap)) {
      if (targetSlotIds.has(slotId)) mapped[slotId] = enabled;
    }
    if (Object.keys(mapped).length > 0) out[areaId] = mapped;
  }
  return out;
}

function migratePerson(person: RosterPerson, targetAreaIds: string[]): RosterPerson {
  const skills: Record<AreaId, SkillLevel> = { ...person.skills };
  for (const areaId of targetAreaIds) {
    if (!(areaId in skills)) skills[areaId] = 'no_experience';
  }
  // Legacy flip station skill can seed float columns in the roster grid.
  const legacyFlip = skills.area_flip;
  if (legacyFlip && legacyFlip !== 'no_experience') {
    if (!skills.flip_1 || skills.flip_1 === 'no_experience') skills.flip_1 = legacyFlip;
    if (!skills.flip_2 || skills.flip_2 === 'no_experience') skills.flip_2 = legacyFlip;
  }
  delete skills.area_flip;

  let defaultAreaId = person.defaultAreaId ?? null;
  let defaultSlotIndex = person.defaultSlotIndex ?? null;
  if (defaultAreaId === 'area_flip') {
    defaultAreaId = null;
    defaultSlotIndex = null;
  } else if (defaultAreaId && !targetAreaIds.includes(defaultAreaId)) {
    defaultAreaId = null;
    defaultSlotIndex = null;
  }

  return {
    ...person,
    skills,
    flexedToLineId: null,
    defaultAreaId,
    defaultSlotIndex,
    areasWantToLearn: (person.areasWantToLearn ?? []).filter((a) => targetAreaIds.includes(a)),
  };
}

function sourceSlotsForArea(source: SlotsByArea, areaId: string) {
  if (source[areaId]) return source[areaId];
  if (areaId === 'flip_1') return source.area_flip?.slice(0, 1);
  if (areaId === 'flip_2') return source.area_flip?.slice(1, 2);
  return undefined;
}

/** Copy slot assignments from source onto target slot ids (by index). */
export function migrateSlotsFromSource(source: SlotsByArea, target: SlotsByArea): SlotsByArea {
  const out: SlotsByArea = {};
  for (const [areaId, targetSlots] of Object.entries(target)) {
    const sourceSlots = sourceSlotsForArea(source, areaId);
    out[areaId] = targetSlots.map((slot, i) => {
      const src = sourceSlots?.[i];
      if (!src?.personId) return slot;
      return {
        ...slot,
        personId: src.personId,
        disabled: src.disabled ?? false,
        locked: src.locked ?? false,
      };
    });
  }
  return out;
}

/** Merge operational data from a 1.0 line into a 2.0 line state (roster, slots, labels, etc.). */
export function mergeLineStateFromSource(
  targetConfig: LineConfig,
  targetState: LineState,
  sourceState: LineState
): LineState {
  const targetAreaIds = getAreaIds(targetConfig);
  const allowed = new Set(targetAreaIds);

  const roster = (sourceState.roster ?? []).map((p) => migratePerson(p, targetAreaIds));
  const slots = migrateSlotsFromSource(sourceState.slots ?? {}, targetState.slots ?? {});

  return {
    ...targetState,
    roster,
    slots,
    leadSlots: { ...targetState.leadSlots, ...(sourceState.leadSlots ?? {}) },
    juicedAreas: copyMatchingKeys(sourceState.juicedAreas, allowed),
    deJuicedAreas: copyMatchingKeys(sourceState.deJuicedAreas, allowed),
    slotLabelsByArea: copyMatchingKeys(sourceState.slotLabelsByArea, allowed),
    areaCapacityOverrides: copyMatchingKeys(sourceState.areaCapacityOverrides, allowed),
    areaNameOverrides: copyMatchingKeys(sourceState.areaNameOverrides, allowed),
    areaRequiresTrainedOrExpertOverrides: copyMatchingKeys(sourceState.areaRequiresTrainedOrExpertOverrides, allowed),
    areaBreakCoverageEnabled: copyMatchingKeys(sourceState.areaBreakCoverageEnabled, allowed),
    areaCoversBreaksFor: copyMatchingKeys(sourceState.areaCoversBreaksFor, allowed),
    slotBreakCoverageEnabled: copyNestedSlotMaps(sourceState.slotBreakCoverageEnabled, slots, allowed),
    leadBreakCoverage: sourceState.leadBreakCoverage ? { ...sourceState.leadBreakCoverage } : targetState.leadBreakCoverage,
    // Break rotations differ (3 → 5); regenerate after import.
    breakSchedules: {},
    breakSchedulesManual: false,
  };
}

export function applyRosterImportToRoot(
  root: RootState,
  targetLineId: string,
  sourceState: LineState
): RootState {
  const config = root.lines.find((l) => l.id === targetLineId);
  const targetState = root.lineStates[targetLineId];
  if (!config || !targetState) {
    throw new Error(`Target line ${targetLineId} not found in root state`);
  }
  return {
    ...root,
    lineStates: {
      ...root.lineStates,
      [targetLineId]: mergeLineStateFromSource(config, targetState, sourceState),
    },
  };
}

import type {
  AreaNameOverrides,
  BreakSchedulesByArea,
  LineConfig,
  LineState,
  RosterPerson,
  SkillLevel,
  SlotLabelsByArea,
  SlotsByArea,
} from '../types';
import {
  BREAK_LINE_WIDE_KEY,
  getAreaIds,
  getBreaksScope,
  getEffectiveAreaLabelsForLine,
  getLeadSlotKeys,
  getLeadSlotLabel,
  getSlotLabelForLine,
} from './lineConfig';

export type DayLogAssignmentType = 'primary' | 'lead' | 'float_cover';

/** Row shape for DB insert and client reports (camelCase). */
export interface ExtractedDayAssignment {
  personId: string;
  personName: string;
  assignmentType: DayLogAssignmentType;
  areaId: string;
  areaName: string;
  slotIndex: number | null;
  slotLabel: string | null;
  breakRotation: number | null;
  lunchRotation: number | null;
  skillLevel: SkillLevel | null;
}

export interface DayLogSnapshotPayload {
  lineConfig: Pick<LineConfig, 'id' | 'name' | 'areas' | 'floatSlots' | 'leadAreaIds' | 'leadSlotNames' | 'combinedSections' | 'breaksScope' | 'breakRotations'>;
  roster: Array<{ id: string; name: string }>;
  slots: SlotsByArea;
  leadSlots: Record<string, string | null>;
  breakSchedules?: BreakSchedulesByArea;
  areaNameOverrides?: AreaNameOverrides;
  slotLabelsByArea?: SlotLabelsByArea;
  juicedAreas?: Partial<Record<string, boolean>>;
  dayNotes?: string;
}

export interface DayLogExtractInput {
  lineConfig: LineConfig;
  roster: RosterPerson[];
  slots: SlotsByArea;
  leadSlots: Record<string, string | null>;
  breakSchedules?: BreakSchedulesByArea;
  areaNameOverrides?: AreaNameOverrides;
  slotLabelsByArea?: SlotLabelsByArea;
  juicedAreas?: Partial<Record<string, boolean>>;
  dayNotes?: string;
}

function rosterMap(roster: RosterPerson[]): Map<string, RosterPerson> {
  return new Map(roster.map((p) => [p.id, p]));
}

function breakForPerson(
  breakSchedules: BreakSchedulesByArea | undefined,
  config: LineConfig,
  areaId: string,
  personId: string
): { breakRotation: number | null; lunchRotation: number | null } {
  if (!breakSchedules) return { breakRotation: null, lunchRotation: null };
  const scope = getBreaksScope(config);
  const key = scope === 'line' ? BREAK_LINE_WIDE_KEY : areaId;
  const entry = breakSchedules[key]?.[personId];
  if (!entry) return { breakRotation: null, lunchRotation: null };
  return { breakRotation: entry.breakRotation, lunchRotation: entry.lunchRotation };
}

/**
 * Build normalized assignment rows from current line staffing (primary slots + leads).
 */
export function extractDayAssignments(input: DayLogExtractInput): ExtractedDayAssignment[] {
  const { lineConfig, roster, slots, leadSlots, breakSchedules, areaNameOverrides, slotLabelsByArea } =
    input;
  const people = rosterMap(roster);
  const areaLabels = getEffectiveAreaLabelsForLine(lineConfig, areaNameOverrides ?? null);
  const rows: ExtractedDayAssignment[] = [];

  for (const areaId of getAreaIds(lineConfig)) {
    const areaSlots = slots[areaId] ?? [];
    const floatMeta = (lineConfig.floatSlots ?? []).find((f) => f.id === areaId);
    const areaName = floatMeta?.name ?? areaLabels[areaId] ?? areaId;

    areaSlots.forEach((slot, slotIndex) => {
      if (!slot.personId || slot.disabled) return;
      const person = people.get(slot.personId);
      if (!person) return;
      const { breakRotation, lunchRotation } = breakForPerson(
        breakSchedules,
        lineConfig,
        areaId,
        slot.personId
      );
      rows.push({
        personId: slot.personId,
        personName: person.name,
        assignmentType: 'primary',
        areaId,
        areaName,
        slotIndex,
        slotLabel: getSlotLabelForLine(lineConfig, areaId, slotIndex, slotLabelsByArea ?? null),
        breakRotation,
        lunchRotation,
        skillLevel: person.skills[areaId] ?? null,
      });
    });
  }

  for (const leadKey of getLeadSlotKeys(lineConfig)) {
    const personId = leadSlots[leadKey];
    if (!personId) continue;
    const person = people.get(personId);
    if (!person) continue;
    const areaName = getLeadSlotLabel(lineConfig, leadKey, areaLabels);
    const { breakRotation, lunchRotation } = breakForPerson(
      breakSchedules,
      lineConfig,
      leadKey,
      personId
    );
    rows.push({
      personId,
      personName: person.name,
      assignmentType: 'lead',
      areaId: leadKey,
      areaName,
      slotIndex: null,
      slotLabel: null,
      breakRotation,
      lunchRotation,
      skillLevel: null,
    });
  }

  return rows;
}

export function buildDayLogSnapshot(input: DayLogExtractInput): DayLogSnapshotPayload {
  const { lineConfig, roster, slots, leadSlots, breakSchedules, areaNameOverrides, slotLabelsByArea, juicedAreas, dayNotes } =
    input;
  return {
    lineConfig: {
      id: lineConfig.id,
      name: lineConfig.name,
      areas: lineConfig.areas,
      floatSlots: lineConfig.floatSlots,
      leadAreaIds: lineConfig.leadAreaIds,
      leadSlotNames: lineConfig.leadSlotNames,
      combinedSections: lineConfig.combinedSections,
      breaksScope: lineConfig.breaksScope,
      breakRotations: lineConfig.breakRotations,
    },
    roster: roster.map((p) => ({ id: p.id, name: p.name })),
    slots,
    leadSlots,
    breakSchedules,
    areaNameOverrides,
    slotLabelsByArea,
    juicedAreas,
    dayNotes: dayNotes ?? '',
  };
}

/** Build log payload from line state + config (cloud log button). */
export function buildDayLogExtractInput(
  lineConfig: LineConfig,
  lineState: Pick<
    LineState,
    | 'roster'
    | 'slots'
    | 'leadSlots'
    | 'breakSchedules'
    | 'areaNameOverrides'
    | 'slotLabelsByArea'
    | 'juicedAreas'
    | 'dayNotes'
  >
): DayLogExtractInput {
  return {
    lineConfig,
    roster: lineState.roster,
    slots: lineState.slots,
    leadSlots: lineState.leadSlots,
    breakSchedules: lineState.breakSchedules,
    areaNameOverrides: lineState.areaNameOverrides,
    slotLabelsByArea: lineState.slotLabelsByArea,
    juicedAreas: lineState.juicedAreas,
    dayNotes: lineState.dayNotes,
  };
}

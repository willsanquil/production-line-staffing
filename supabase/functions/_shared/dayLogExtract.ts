/** Deno edge copy of assignment extraction (keep in sync with src/lib/dayLogExtract.ts). */

const BREAK_LINE_WIDE_KEY = '__line__';

type LineConfigLike = {
  id: string;
  name: string;
  areas: { id: string; name: string; defaultSlotLabels?: string[] }[];
  floatSlots?: { id: string; name: string; supportedAreaIds: string[] }[];
  leadAreaIds?: string[];
  leadSlotNames?: string[];
  combinedSections: [string, string][];
  breaksScope?: 'line' | 'station';
  breakRotations?: number;
};

type RosterPersonLike = {
  id: string;
  name: string;
  skills: Record<string, string>;
};

export type DbDayAssignment = {
  person_id: string;
  person_name: string;
  assignment_type: 'primary' | 'lead' | 'float_cover';
  area_id: string;
  area_name: string;
  slot_index: number | null;
  slot_label: string | null;
  break_rotation: number | null;
  lunch_rotation: number | null;
  skill_level: string | null;
};

function getAreaIds(config: LineConfigLike): string[] {
  const areaIds = config.areas.map((a) => a.id);
  const floatIds = (config.floatSlots ?? []).map((f) => f.id);
  return [...areaIds, ...floatIds];
}

function getBreaksScope(config: LineConfigLike): 'line' | 'station' {
  return config.breaksScope ?? 'station';
}

function getLeadSlotKeys(config: LineConfigLike): string[] {
  const names = config.leadSlotNames;
  if (names && names.length > 0) return names.map((_, i) => String(i));
  return config.leadAreaIds ?? [];
}

function getEffectiveAreaLabels(
  config: LineConfigLike,
  nameOverrides?: Record<string, string> | null
): Record<string, string> {
  const base: Record<string, string> = {};
  for (const a of config.areas) base[a.id] = a.name;
  for (const f of config.floatSlots ?? []) base[f.id] = f.name;
  if (!nameOverrides) return base;
  const out = { ...base };
  for (const areaId of Object.keys(nameOverrides)) {
    const custom = nameOverrides[areaId];
    if (custom != null && custom.trim() !== '') out[areaId] = custom.trim();
  }
  return out;
}

function getLeadSlotLabel(
  config: LineConfigLike,
  key: string,
  areaLabels: Record<string, string>
): string {
  const names = config.leadSlotNames;
  if (names && names.length > 0) {
    const i = parseInt(key, 10);
    const name = names[i];
    return name?.trim() || `Lead ${i + 1}`;
  }
  return areaLabels[key] ?? key;
}

function getSlotLabel(
  config: LineConfigLike,
  areaId: string,
  slotIndex: number,
  slotLabelsByArea?: Record<string, string[]> | null
): string | null {
  const custom = slotLabelsByArea?.[areaId]?.[slotIndex];
  if (custom != null && custom.trim() !== '') return custom.trim();
  const area = config.areas.find((a) => a.id === areaId);
  const def = area?.defaultSlotLabels?.[slotIndex];
  if (def != null && def.trim() !== '') return def.trim();
  return `Slot ${slotIndex + 1}`;
}

function breakForPerson(
  breakSchedules: Record<string, Record<string, { breakRotation: number; lunchRotation: number }>> | undefined,
  config: LineConfigLike,
  areaId: string,
  personId: string
): { break_rotation: number | null; lunch_rotation: number | null } {
  if (!breakSchedules) return { break_rotation: null, lunch_rotation: null };
  const key = getBreaksScope(config) === 'line' ? BREAK_LINE_WIDE_KEY : areaId;
  const entry = breakSchedules[key]?.[personId];
  if (!entry) return { break_rotation: null, lunch_rotation: null };
  return { break_rotation: entry.breakRotation, lunch_rotation: entry.lunchRotation };
}

export function extractDayAssignmentsDb(input: {
  lineConfig: LineConfigLike;
  roster: RosterPersonLike[];
  slots: Record<string, { personId: string | null; disabled?: boolean }[]>;
  leadSlots: Record<string, string | null>;
  breakSchedules?: Record<string, Record<string, { breakRotation: number; lunchRotation: number }>>;
  areaNameOverrides?: Record<string, string>;
  slotLabelsByArea?: Record<string, string[]>;
}): DbDayAssignment[] {
  const { lineConfig, roster, slots, leadSlots, breakSchedules, areaNameOverrides, slotLabelsByArea } =
    input;
  const people = new Map(roster.map((p) => [p.id, p]));
  const areaLabels = getEffectiveAreaLabels(lineConfig, areaNameOverrides ?? null);
  const rows: DbDayAssignment[] = [];

  for (const areaId of getAreaIds(lineConfig)) {
    const areaSlots = slots[areaId] ?? [];
    const floatMeta = (lineConfig.floatSlots ?? []).find((f) => f.id === areaId);
    const areaName = floatMeta?.name ?? areaLabels[areaId] ?? areaId;

    areaSlots.forEach((slot, slotIndex) => {
      if (!slot.personId || slot.disabled) return;
      const person = people.get(slot.personId);
      if (!person) return;
      const br = breakForPerson(breakSchedules, lineConfig, areaId, slot.personId);
      rows.push({
        person_id: slot.personId,
        person_name: person.name,
        assignment_type: 'primary',
        area_id: areaId,
        area_name: areaName,
        slot_index: slotIndex,
        slot_label: getSlotLabel(lineConfig, areaId, slotIndex, slotLabelsByArea ?? null),
        break_rotation: br.break_rotation,
        lunch_rotation: br.lunch_rotation,
        skill_level: person.skills[areaId] ?? null,
      });
    });
  }

  for (const leadKey of getLeadSlotKeys(lineConfig)) {
    const personId = leadSlots[leadKey];
    if (!personId) continue;
    const person = people.get(personId);
    if (!person) continue;
    const br = breakForPerson(breakSchedules, lineConfig, leadKey, personId);
    rows.push({
      person_id: personId,
      person_name: person.name,
      assignment_type: 'lead',
      area_id: leadKey,
      area_name: getLeadSlotLabel(lineConfig, leadKey, areaLabels),
      slot_index: null,
      slot_label: null,
      break_rotation: br.break_rotation,
      lunch_rotation: br.lunch_rotation,
      skill_level: null,
    });
  }

  return rows;
}

export function buildDayLogSnapshotJson(input: {
  lineConfig: LineConfigLike;
  roster: RosterPersonLike[];
  slots: Record<string, unknown>;
  leadSlots: Record<string, string | null>;
  breakSchedules?: Record<string, unknown>;
  areaNameOverrides?: Record<string, string>;
  slotLabelsByArea?: Record<string, string[]>;
  juicedAreas?: Record<string, boolean>;
  dayNotes?: string;
}): Record<string, unknown> {
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

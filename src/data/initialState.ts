import type { AppState, AreaId, AreaCapacityOverrides, LeadSlots, LineConfig, LineState, RosterPerson, ScheduleHour, SlotsByArea, TaskItem, TasksByArea } from '../types';
import type { SkillLevel } from '../types';
import { AREA_IDS, LEAD_SLOT_AREAS } from '../types';
import { getEffectiveCapacity } from '../lib/areaConfig';
import { getEffectiveCapacityForLine, getLeadSlotKeys } from '../lib/lineConfig';
import { buildSeedRoster } from './seedRoster';

function nanoid(): string {
  return Math.random().toString(36).slice(2, 11);
}

function emptySlot(): { id: string; personId: string | null; disabled?: boolean; locked?: boolean } {
  return { id: nanoid(), personId: null, disabled: false, locked: false };
}

function emptyTask(): TaskItem {
  return { id: nanoid(), text: '', done: false };
}

function defaultSlots(capacityOverrides?: AreaCapacityOverrides | null): SlotsByArea {
  const cap = getEffectiveCapacity(capacityOverrides);
  const out = {} as SlotsByArea;
  for (const areaId of AREA_IDS) {
    const n = cap[areaId].min;
    out[areaId] = Array.from({ length: n }, () => emptySlot());
  }
  return out;
}

function defaultSectionTasks(): TasksByArea {
  const out = {} as TasksByArea;
  for (const areaId of AREA_IDS) {
    out[areaId] = [];
  }
  return out;
}

function defaultLeadSlots(): LeadSlots {
  const out = {} as LeadSlots;
  for (const areaId of LEAD_SLOT_AREAS) {
    out[areaId] = null;
  }
  return out;
}

/** Create a new roster person. defaultLineId = line they’re added on. Pass areaIds for skills init. */
export function createEmptyPerson(name: string, areaIds?: string[]): RosterPerson {
  const ids = areaIds ?? AREA_IDS;
  const skills = {} as Record<AreaId, SkillLevel>;
  for (const areaId of ids) {
    skills[areaId] = 'no_experience';
  }
  return {
    id: nanoid(),
    name: name.trim() || 'New Person',
    absent: false,
    lead: false,
    ot: false,
    late: false,
    leavingEarly: false,
    breakPreference: 'no_preference',
    skills,
    areasWantToLearn: [],
    flexedToLineId: null,
  };
}

/** Create a new OT pool person (ot: true, otHereToday: false so they do not slot until marked here). */
export function createEmptyOTPerson(name: string, areaIds?: string[]): RosterPerson {
  const person = createEmptyPerson(name.trim() || 'New OT', areaIds);
  return { ...person, ot: true, otHereToday: false };
}

/** Hours 6–17. Break 8:30, 14:00, 16:00 (15min, 3 rot); Lunch 11:30 (30min, 3 rot). */
function defaultSchedule(): ScheduleHour[] {
  const hours: ScheduleHour[] = [];
  for (let h = 6; h <= 17; h++) {
    const taskList: TaskItem[] = [];
    let breakRotation: 1 | 2 | 3 | undefined;
    let lunchRotation: 1 | 2 | 3 | undefined;
    if (h === 8) breakRotation = 1; // 8:30 break (rot 1,2,3 in this hour)
    if (h === 14) breakRotation = 2;
    if (h === 16) breakRotation = 3;
    if (h === 11) lunchRotation = 1; // Lunch 11:30 (rot 1,2,3)
    if (h === 12) lunchRotation = 2;
    hours.push({ hour: h, taskList, breakRotation, lunchRotation });
  }
  return hours;
}

export function getInitialState(): AppState {
  return {
    roster: buildSeedRoster(),
    slots: defaultSlots(),
    leadSlots: defaultLeadSlots(),
    juicedAreas: {},
    deJuicedAreas: {},
    sectionTasks: defaultSectionTasks(),
    schedule: defaultSchedule(),
    dayNotes: '',
    documents: [],
    breakSchedules: {},
  };
}

export function createEmptySlot() {
  return emptySlot();
}

/** Ensure each area has between min and max slots (uses effective capacity from overrides when provided). */
export function normalizeSlotsToCapacity(slots: SlotsByArea, capacityOverrides?: AreaCapacityOverrides | null): SlotsByArea {
  const cap = getEffectiveCapacity(capacityOverrides);
  const out = {} as SlotsByArea;
  for (const areaId of AREA_IDS) {
    const { min, max } = cap[areaId];
    const curr = slots[areaId] ?? [];
    let list = [...curr];
    if (list.length < min) {
      for (let i = list.length; i < min; i++) list.push(emptySlot());
    }
    if (list.length > max) {
      list = list.slice(0, max);
    }
    out[areaId] = list;
  }
  return out;
}

/** Normalize slots to a line's capacity (for custom lines). */
export function normalizeSlotsToLineCapacity(
  slots: SlotsByArea,
  config: LineConfig,
  capacityOverrides?: AreaCapacityOverrides | null
): SlotsByArea {
  const cap = getEffectiveCapacityForLine(config, capacityOverrides);
  const out = {} as SlotsByArea;
  for (const areaId of Object.keys(cap)) {
    const { min, max } = cap[areaId];
    const curr = slots[areaId] ?? [];
    let list = [...curr];
    if (list.length < min) {
      for (let i = list.length; i < min; i++) list.push(emptySlot());
    }
    if (list.length > max) {
      list = list.slice(0, max);
    }
    out[areaId] = list;
  }
  return out;
}

/** Empty line state for a given line config (empty roster, min slots per area). */
export function getEmptyLineState(config: LineConfig): LineState {
  const cap = getEffectiveCapacityForLine(config, null);
  const slots: SlotsByArea = {};
  for (const areaId of Object.keys(cap)) {
    const n = cap[areaId].min;
    slots[areaId] = Array.from({ length: n }, () => emptySlot());
  }
  const sectionTasks: TasksByArea = {};
  for (const a of config.areas) {
    sectionTasks[a.id] = [];
  }
  const leadSlots: LeadSlots = {};
  for (const key of getLeadSlotKeys(config)) {
    leadSlots[key] = null;
  }
  return {
    roster: [],
    slots,
    leadSlots,
    juicedAreas: {},
    deJuicedAreas: {},
    sectionTasks,
    schedule: defaultSchedule(),
    dayNotes: '',
    documents: [],
    breakSchedules: {},
    areaCapacityOverrides: {},
    areaNameOverrides: {},
    slotLabelsByArea: {},
  };
}
export function createEmptyTask(text = '') {
  const t = emptyTask();
  t.text = text;
  return t;
}

export { nanoid };

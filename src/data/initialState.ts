import type { AppState, AreaId, AreaCapacityOverrides, LeadSlots, RosterPerson, ScheduleHour, SlotsByArea, TaskItem, TasksByArea } from '../types';
import type { SkillLevel } from '../types';
import { AREA_IDS, LEAD_SLOT_AREAS } from '../types';
import { getEffectiveCapacity } from '../lib/areaConfig';
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

/** Create a new roster person with default skills (no_experience). */
export function createEmptyPerson(name: string): RosterPerson {
  const skills = {} as Record<AreaId, SkillLevel>;
  for (const areaId of AREA_IDS) {
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
  };
}

/** Create a new OT pool person (ot: true, otHereToday: false so they do not slot until marked here). */
export function createEmptyOTPerson(name: string): RosterPerson {
  const person = createEmptyPerson(name.trim() || 'New OT');
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
export function createEmptyTask(text = '') {
  const t = emptyTask();
  t.text = text;
  return t;
}

export { nanoid };

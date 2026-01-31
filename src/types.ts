export type SkillLevel = 'no_experience' | 'training' | 'trained' | 'expert';

/** Break preference for schedule generation: early = rot 1, late = rot 3. */
export type BreakPreference = 'prefer_early' | 'prefer_late' | 'no_preference';

export const AREA_IDS = [
  'area_14_5',
  'area_courtyard',
  'area_bonding',
  'area_testing',
  'area_potting',
  'area_end_of_line',
  'area_flip',
] as const;

export type AreaId = string;

/** Order of sections on the line. Combined 14.5 & Flip is one section; others are single areas. */
export const COMBINED_14_5_FLIP: readonly [AreaId, AreaId] = ['area_14_5', 'area_flip'];
export const LINE_SECTIONS: readonly (AreaId | readonly [AreaId, AreaId])[] = [
  COMBINED_14_5_FLIP,
  'area_courtyard',
  'area_bonding',
  'area_testing',
  'area_potting',
  'area_end_of_line',
];
export type LineSection = (typeof LINE_SECTIONS)[number];

export function isCombinedSection(s: LineSection): s is readonly [AreaId, AreaId] {
  return Array.isArray(s);
}

/** Every area except Flip must have at least one Trained or Expert to run. */
export function areaRequiresTrainedOrExpert(areaId: AreaId): boolean {
  return areaId !== 'area_flip';
}

export const AREA_LABELS: Record<AreaId, string> = {
  area_14_5: '14.5',
  area_courtyard: 'Courtyard',
  area_bonding: 'Bonding',
  area_testing: 'Testing',
  area_potting: 'Potting',
  area_end_of_line: 'End Of Line',
  area_flip: 'Flip',
};

export const AREA_CAPACITY: Record<AreaId, { min: number; max: number }> = {
  area_14_5: { min: 3, max: 4 },
  area_courtyard: { min: 4, max: 7 },
  area_bonding: { min: 11, max: 13 },
  area_testing: { min: 2, max: 3 },
  area_potting: { min: 3, max: 5 },
  area_end_of_line: { min: 4, max: 4 },
  area_flip: { min: 1, max: 2 },
};

/** Bonding area slot names (positional; index 0 = first slot, etc.). Default when no custom slot labels. */
export const BONDING_SLOT_LABELS: readonly string[] = [
  'Float',
  '100s',
  '100s/200s',
  '100s/200s',
  '200s/300s',
  '200s/300s',
  '300s/400s',
  '300s/400s',
  '400/s',
  'Rework',
  'Manual Review',
];

/** User overrides for min/max slots per area. */
export type AreaCapacityOverrides = Partial<Record<AreaId, { min: number; max: number }>>;
/** User overrides for area display names. */
export type AreaNameOverrides = Partial<Record<AreaId, string>>;
/** User overrides for slot names: areaId -> array of labels by slot index. */
export type SlotLabelsByArea = Partial<Record<AreaId, string[]>>;

export interface RosterPerson {
  id: string;
  name: string;
  absent: boolean;
  lead: boolean;
  ot: boolean;
  /** When true, OT person is available for slotting today (default false = not here). */
  otHereToday?: boolean;
  late: boolean;
  leavingEarly: boolean;
  /** Used when generating break schedules for best overlap. */
  breakPreference?: BreakPreference;
  skills: Record<AreaId, SkillLevel>;
  /** Area IDs this person wants to learn (opt-in for training assignments in report). */
  areasWantToLearn?: AreaId[];
  /** When set, person is temporarily assigned to this line and appears on that line's roster (skills retained). */
  flexedToLineId?: string | null;
}

export interface Slot {
  id: string;
  personId: string | null;
  /** When true, slot is not staffed (excluded from min staffing and automation). */
  disabled?: boolean;
  /** When true, Spread/Randomize (and other automation) leave this slot's assignment unchanged. */
  locked?: boolean;
}

export interface TaskItem {
  id: string;
  text: string;
  done: boolean;
}

export type BreakRotation = 1 | 2 | 3;
export type LunchRotation = 1 | 2 | 3;

export interface ScheduleHour {
  hour: number; // 6-17 (6am-5pm display, 6pm is end)
  taskList: TaskItem[];
  breakRotation?: BreakRotation;
  lunchRotation?: LunchRotation;
}

export interface AreaSlots {
  [key: string]: Slot[];
}
export type SlotsByArea = Record<AreaId, Slot[]>;

export interface SectionTasks {
  [key: string]: TaskItem[];
}
export type TasksByArea = Record<AreaId, TaskItem[]>;

export interface SavedConfig {
  id: string;
  name: string;
  note?: string;
  savedAt: string; // ISO
  slots: SlotsByArea;
}

/** Area-specific lead roles (one person per area). */
export const LEAD_SLOT_AREAS = ['area_end_of_line', 'area_courtyard', 'area_bonding'] as const;
export type LeadSlotAreaId = string;
export type LeadSlots = Record<string, string | null>;

/** Per-area "juice" flag: when on, Spread talent prioritizes that area with higher skill. */
export type JuicedAreas = Partial<Record<AreaId, boolean>>;

/** Per-area "de-juice" flag: when on, Spread talent fills this area last (opposite of juice). */
export type DeJuicedAreas = Partial<Record<AreaId, boolean>>;

/** Per-area break/lunch rotation assignments (personId -> rotation). Generated after Spread/Randomize. */
export type BreakSchedulesByArea = Partial<
  Record<AreaId, Record<string, { breakRotation: BreakRotation; lunchRotation: LunchRotation }>>
>;

export interface SavedDay {
  id: string;
  date: string; // YYYY-MM-DD
  name?: string;
  savedAt: string;
  /** Line this day was saved for (e.g. IC, NIC). */
  lineId?: string;
  roster: RosterPerson[];
  slots: SlotsByArea;
  leadSlots: LeadSlots;
  juicedAreas?: JuicedAreas;
  deJuicedAreas?: DeJuicedAreas;
  sectionTasks: TasksByArea;
  schedule: ScheduleHour[];
  dayNotes: string;
  documents: string[];
  breakSchedules?: BreakSchedulesByArea;
}

export interface AppState {
  roster: RosterPerson[];
  slots: SlotsByArea;
  leadSlots: LeadSlots;
  juicedAreas: JuicedAreas;
  deJuicedAreas: DeJuicedAreas;
  sectionTasks: TasksByArea;
  schedule: ScheduleHour[];
  dayNotes: string;
  documents: string[];
  breakSchedules?: BreakSchedulesByArea;
  areaCapacityOverrides?: AreaCapacityOverrides;
  areaNameOverrides?: AreaNameOverrides;
  slotLabelsByArea?: SlotLabelsByArea;
}

/** Single area definition when building a line (name, capacity, optional default slot labels). */
export interface AreaConfigInLine {
  id: string;
  name: string;
  minSlots: number;
  maxSlots: number;
  /** Default slot names by index (e.g. Bonding: Float, 100s, ...). Omit for "Slot 1", "Slot 2". */
  defaultSlotLabels?: string[];
  /** If false, area can run without a trained/expert (e.g. flex). Default true. */
  requiresTrainedOrExpert?: boolean;
}

/** Full definition of a line: name, sections (areas), which have leads, optional combined sections. */
export interface LineConfig {
  id: string;
  name: string;
  areas: AreaConfigInLine[];
  /** Area IDs that have a lead slot (one person per area). */
  leadAreaIds: string[];
  /** Pairs of area IDs to show as one combined section (e.g. 14.5 & Flip). */
  combinedSections: [string, string][];
}

/** Same shape as AppState; each line has its own roster and slots. */
export type LineState = AppState;

/** Root multi-line state: which line is open and per-line state (each line has its own roster). */
export interface RootState {
  currentLineId: string;
  lines: LineConfig[];
  lineStates: Record<string, LineState>;
}

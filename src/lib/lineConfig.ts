import type { LineConfig, AreaCapacityOverrides, AreaNameOverrides, SlotLabelsByArea } from '../types';

export const DEFAULT_IC_LINE_ID = 'ic';

/** Built-in IC line (one half of MIC): same areas and layout as the original app. */
export function getDefaultICLineConfig(): LineConfig {
  return {
    id: DEFAULT_IC_LINE_ID,
    name: 'IC',
    areas: [
      { id: 'area_14_5', name: '14.5', minSlots: 3, maxSlots: 4, requiresTrainedOrExpert: true },
      { id: 'area_courtyard', name: 'Courtyard', minSlots: 4, maxSlots: 7, requiresTrainedOrExpert: true },
      { id: 'area_bonding', name: 'Bonding', minSlots: 11, maxSlots: 13, requiresTrainedOrExpert: true, defaultSlotLabels: ['Float', '100s', '100s/200s', '100s/200s', '200s/300s', '200s/300s', '300s/400s', '300s/400s', '400/s', 'Rework', 'Manual Review'] },
      { id: 'area_testing', name: 'Testing', minSlots: 2, maxSlots: 3, requiresTrainedOrExpert: true },
      { id: 'area_potting', name: 'Potting', minSlots: 3, maxSlots: 5, requiresTrainedOrExpert: true },
      { id: 'area_end_of_line', name: 'End Of Line', minSlots: 4, maxSlots: 4, requiresTrainedOrExpert: true },
      { id: 'area_flip', name: 'Flip', minSlots: 1, maxSlots: 2, requiresTrainedOrExpert: false },
    ],
    leadAreaIds: ['area_end_of_line', 'area_courtyard', 'area_bonding'],
    combinedSections: [['area_14_5', 'area_flip']],
    breaksEnabled: true,
    breaksScope: 'station',
    breakRotations: 3,
  };
}

/** Area IDs in display order (combined pairs appear once, as the first id in the pair). */
export function getAreaIds(config: LineConfig): string[] {
  return config.areas.map((a) => a.id);
}

/** Sections in display order: each element is either a single area id or a [id, id] pair. */
export function getLineSections(config: LineConfig): (string | readonly [string, string])[] {
  const combinedSet = new Set<string>();
  for (const [a, b] of config.combinedSections) {
    combinedSet.add(a);
    combinedSet.add(b);
  }
  const result: (string | readonly [string, string])[] = [];
  for (const area of config.areas) {
    if (combinedSet.has(area.id)) {
      const pair = config.combinedSections.find(([x]) => x === area.id);
      if (pair) result.push(pair);
      continue;
    }
    const inPairAsSecond = config.combinedSections.some(([, b]) => b === area.id);
    if (!inPairAsSecond) result.push(area.id);
  }
  return result;
}

/** Base capacity (min/max) per area from config. */
export function getBaseCapacity(config: LineConfig): Record<string, { min: number; max: number }> {
  const out: Record<string, { min: number; max: number }> = {};
  for (const a of config.areas) {
    out[a.id] = { min: a.minSlots, max: a.maxSlots };
  }
  return out;
}

/** Base area labels from config. */
export function getBaseAreaLabels(config: LineConfig): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of config.areas) {
    out[a.id] = a.name;
  }
  return out;
}

/** Default slot labels for an area (from config); undefined = use "Slot 1", "Slot 2". */
export function getDefaultSlotLabels(config: LineConfig, areaId: string): string[] | undefined {
  const area = config.areas.find((a) => a.id === areaId);
  return area?.defaultSlotLabels;
}

/** Linked slot groups for an area: slots that share the same label must not share the same break rotation.
 * Returns array of groups, each group is an array of slot indices (e.g. [[2,3],[4,5]] for 100s/200s and 200s/300s).
 */
export function getLinkedSlotGroupsForArea(
  config: LineConfig,
  areaId: string,
  slotCount: number,
  slotLabelsByArea?: SlotLabelsByArea | null
): number[][] {
  const byLabel: Record<string, number[]> = {};
  for (let i = 0; i < slotCount; i++) {
    const label = getSlotLabelForLine(config, areaId, i, slotLabelsByArea);
    if (!byLabel[label]) byLabel[label] = [];
    byLabel[label].push(i);
  }
  return Object.values(byLabel).filter((g) => g.length > 1);
}

/** Whether the area requires at least one trained or expert to run. Default false (unchecked). */
export function areaRequiresTrainedOrExpertFromConfig(config: LineConfig, areaId: string): boolean {
  const area = config.areas.find((a) => a.id === areaId);
  return area?.requiresTrainedOrExpert === true;
}

export function isCombinedSection(section: string | readonly [string, string]): section is readonly [string, string] {
  return Array.isArray(section);
}

/** Generate a stable id for a new area from name (for build-your-own). */
export function areaIdFromName(name: string, existingIds: Set<string>): string {
  const base = 'area_' + name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  let id = base;
  let n = 0;
  while (existingIds.has(id)) {
    n++;
    id = `${base}_${n}`;
  }
  return id;
}

/** Create a new line config with a single default area (for empty "build your own" start). */
export function createEmptyLineConfig(name: string, lineId?: string): LineConfig {
  const id = lineId ?? 'line_' + Math.random().toString(36).slice(2, 9);
  return {
    id,
    name: name.trim() || 'New Line',
    areas: [],
    leadAreaIds: [],
    combinedSections: [],
    breaksEnabled: true,
    breaksScope: 'station',
    breakRotations: 3,
  };
}

/** Break options from line config (with defaults). */
export function getBreaksEnabled(config: LineConfig): boolean {
  return config.breaksEnabled !== false;
}
export function getBreaksScope(config: LineConfig): 'line' | 'station' {
  return config.breaksScope ?? 'station';
}
export function getBreakRotations(config: LineConfig): number {
  const n = config.breakRotations ?? 3;
  return Math.min(6, Math.max(1, n));
}

/** Key used in breakSchedules for line-wide assignments. */
export const BREAK_LINE_WIDE_KEY = '__line__';

/** Lead slot keys for this line: either "0","1",... when using leadSlotNames, or area IDs from leadAreaIds. */
export function getLeadSlotKeys(config: LineConfig): string[] {
  const names = config.leadSlotNames;
  if (names && names.length > 0) {
    return names.map((_, i) => String(i));
  }
  return config.leadAreaIds ?? [];
}

/** Display label for a lead slot key. */
export function getLeadSlotLabel(
  config: LineConfig,
  key: string,
  areaLabels?: Record<string, string> | null
): string {
  const names = config.leadSlotNames;
  if (names && names.length > 0) {
    const i = parseInt(key, 10);
    const name = names[i];
    return name?.trim() || `Lead ${i + 1}`;
  }
  return areaLabels?.[key] ?? key;
}

/** Effective capacity (min/max) for a line, with optional overrides. */
export function getEffectiveCapacityForLine(
  config: LineConfig,
  overrides?: AreaCapacityOverrides | null
): Record<string, { min: number; max: number }> {
  const base = getBaseCapacity(config);
  if (!overrides) return base;
  const out = { ...base };
  for (const areaId of Object.keys(overrides)) {
    const ov = overrides[areaId];
    if (!ov) continue;
    const cur = out[areaId];
    if (cur) {
      out[areaId] = {
        min: ov.min ?? cur.min,
        max: ov.max ?? cur.max,
      };
      if (out[areaId].min > out[areaId].max) out[areaId].max = out[areaId].min;
    }
  }
  return out;
}

/** Effective area labels for a line, with optional name overrides. */
export function getEffectiveAreaLabelsForLine(
  config: LineConfig,
  nameOverrides?: AreaNameOverrides | null
): Record<string, string> {
  const base = getBaseAreaLabels(config);
  if (!nameOverrides) return base;
  const out = { ...base };
  for (const areaId of Object.keys(nameOverrides)) {
    const custom = nameOverrides[areaId];
    if (custom != null && custom.trim() !== '') out[areaId] = custom.trim();
  }
  return out;
}

/** Slot label for an area/slot; uses config defaultSlotLabels if no user override. */
export function getSlotLabelForLine(
  config: LineConfig,
  areaId: string,
  slotIndex: number,
  slotLabelsByArea?: SlotLabelsByArea | null
): string {
  const userArr = slotLabelsByArea?.[areaId];
  const user = userArr?.[slotIndex];
  if (user != null && user.trim() !== '') return user.trim();
  const defaults = getDefaultSlotLabels(config, areaId);
  if (defaults?.[slotIndex]) return defaults[slotIndex];
  return `Slot ${slotIndex + 1}`;
}

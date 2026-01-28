import type { AreaId, AreaCapacityOverrides, AreaNameOverrides, SlotLabelsByArea } from '../types';
import { AREA_IDS, AREA_CAPACITY, AREA_LABELS, BONDING_SLOT_LABELS } from '../types';

export function getEffectiveCapacity(
  overrides?: AreaCapacityOverrides | null
): Record<AreaId, { min: number; max: number }> {
  const out = {} as Record<AreaId, { min: number; max: number }>;
  for (const areaId of AREA_IDS) {
    const base = AREA_CAPACITY[areaId];
    const ov = overrides?.[areaId];
    out[areaId] = ov
      ? { min: ov.min ?? base.min, max: ov.max ?? base.max }
      : { ...base };
  }
  return out;
}

export function getEffectiveAreaLabels(
  nameOverrides?: AreaNameOverrides | null
): Record<AreaId, string> {
  const out = {} as Record<AreaId, string>;
  for (const areaId of AREA_IDS) {
    const custom = nameOverrides?.[areaId];
    out[areaId] = (custom != null && custom.trim() !== '') ? custom.trim() : AREA_LABELS[areaId];
  }
  return out;
}

export function getSlotLabel(
  areaId: AreaId,
  slotIndex: number,
  slotLabelsByArea?: SlotLabelsByArea | null
): string {
  const arr = slotLabelsByArea?.[areaId];
  const custom = arr?.[slotIndex];
  if (custom != null && custom.trim() !== '') return custom.trim();
  if (areaId === 'area_bonding' && BONDING_SLOT_LABELS[slotIndex]) {
    return BONDING_SLOT_LABELS[slotIndex];
  }
  return `Slot ${slotIndex + 1}`;
}

import type { AreaId, SlotsByArea } from '../types';

/** Clear assigned people from one area, preserving locked slots. */
export function clearAreaAssignments(slots: SlotsByArea, areaId: AreaId): SlotsByArea {
  const areaSlots = slots[areaId] ?? [];
  return {
    ...slots,
    [areaId]: areaSlots.map((slot) => (slot.locked ? slot : { ...slot, personId: null })),
  };
}

import type { AreaId, SlotsByArea } from '../types';

/** Clear assigned people from one area, preserving locked slots. */
export function clearAreaAssignments(slots: SlotsByArea, areaId: AreaId): SlotsByArea {
  const areaSlots = slots[areaId] ?? [];
  return {
    ...slots,
    [areaId]: areaSlots.map((slot) => (slot.locked ? slot : { ...slot, personId: null })),
  };
}

export type SlotRef = { areaId: string; slotId: string };

/**
 * Move a person from one slot to another. If the target has someone, swap.
 * Returns null when the transfer is invalid (missing slots, locked/disabled, empty source, same slot).
 */
export function moveOrSwapSlotPerson(
  slots: SlotsByArea,
  from: SlotRef,
  to: SlotRef,
): SlotsByArea | null {
  if (from.areaId === to.areaId && from.slotId === to.slotId) return null;

  const fromList = slots[from.areaId];
  const toList = slots[to.areaId];
  if (!fromList || !toList) return null;

  const fromSlot = fromList.find((s) => s.id === from.slotId);
  const toSlot = toList.find((s) => s.id === to.slotId);
  if (!fromSlot?.personId) return null;
  if (fromSlot.locked || fromSlot.disabled) return null;
  if (!toSlot || toSlot.locked || toSlot.disabled) return null;

  const movingPersonId = fromSlot.personId;
  const displacedPersonId = toSlot.personId;

  const patchArea = (areaId: string, list: typeof fromList) =>
    list.map((s) => {
      if (areaId === from.areaId && s.id === from.slotId) return { ...s, personId: displacedPersonId };
      if (areaId === to.areaId && s.id === to.slotId) return { ...s, personId: movingPersonId };
      return s;
    });

  if (from.areaId === to.areaId) {
    return { ...slots, [from.areaId]: patchArea(from.areaId, fromList) };
  }

  return {
    ...slots,
    [from.areaId]: patchArea(from.areaId, fromList),
    [to.areaId]: patchArea(to.areaId, toList),
  };
}

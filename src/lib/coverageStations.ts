import type { FloatSlotConfig, SlotsByArea, BreakSchedulesByArea } from '../types';

/** Prefix used to namespace virtual float ids derived from coverage stations.
 * The virtual id encodes the source station and slot so we can mirror rotations back. */
export const COVERAGE_FLOAT_PREFIX = '__cov_';

export interface VirtualFloatLink {
  /** The synthetic float id (used as a fake areaId by the scheduler). */
  floatId: string;
  /** Source station areaId the float was synthesized from. */
  stationId: string;
  /** Slot id in the source station whose person is mirrored to this virtual float. */
  stationSlotId: string;
  /** Person assigned to this virtual float (mirrored from the station slot). */
  personId: string;
}

export interface SynthesizedCoverage {
  /** Virtual float configs to feed into the break scheduler / optimizer / LineView. */
  virtualFloats: FloatSlotConfig[];
  /** Slot map fragment for the virtual floats. Each is a 1-slot pseudo-area whose
   * person mirrors the source station slot. */
  virtualSlots: SlotsByArea;
  /** Links between virtual floats and their source station+slot, so we can mirror
   * the optimizer's break-rotation choice back to the station's break record. */
  links: VirtualFloatLink[];
}

/** Build virtual floats from each enabled, staffed slot of every coverage station.
 *
 * A "coverage station" is any station whose `areaCoversBreaksFor[stationId]` is a
 * non-empty list of supported area ids. Each enabled, non-disabled slot in the
 * station with an assigned person becomes one virtual float so the existing float
 * coverage machinery (break optimization + Break Coverage rows in the UI) applies
 * unchanged. Empty / disabled slots are skipped — they have no one to send out.
 */
export function synthesizeCoverageFloats(
  areaCoversBreaksFor: Record<string, string[]>,
  slots: SlotsByArea,
  areaLabels: Record<string, string>,
): SynthesizedCoverage {
  const virtualFloats: FloatSlotConfig[] = [];
  const virtualSlots: SlotsByArea = {};
  const links: VirtualFloatLink[] = [];

  for (const [stationId, supportedIdsRaw] of Object.entries(areaCoversBreaksFor)) {
    if (!Array.isArray(supportedIdsRaw) || supportedIdsRaw.length === 0) continue;
    // Defensive: drop self-references and missing ids.
    const supportedIds = supportedIdsRaw.filter((id) => id && id !== stationId);
    if (supportedIds.length === 0) continue;

    const stationSlots = slots[stationId] ?? [];
    const stationLabel = areaLabels[stationId] ?? stationId;
    let counter = 0;

    stationSlots.forEach((s) => {
      if (s.disabled) return;
      if (!s.personId) return;
      counter += 1;
      const floatId = `${COVERAGE_FLOAT_PREFIX}${stationId}_${s.id}`;
      virtualFloats.push({
        id: floatId,
        name: `${stationLabel} #${counter}`,
        supportedAreaIds: [...supportedIds],
      });
      virtualSlots[floatId] = [{ id: s.id, personId: s.personId }];
      links.push({ floatId, stationId, stationSlotId: s.id, personId: s.personId });
    });
  }

  return { virtualFloats, virtualSlots, links };
}

/** Mirror the optimized break rotation of each virtual float back into the source
 * station's break schedule, so the station's table shows the rotation the optimizer
 * actually picked (which may differ from what the area-level scheduler initially
 * assigned to keep coverage intact). */
export function mirrorVirtualFloatBreaksToStations(
  schedules: BreakSchedulesByArea,
  links: VirtualFloatLink[],
): BreakSchedulesByArea {
  if (links.length === 0) return schedules;
  const next: BreakSchedulesByArea = { ...schedules };
  for (const link of links) {
    const virtualEntry = next[link.floatId]?.[link.personId];
    if (!virtualEntry) continue;
    const stationMap = { ...(next[link.stationId] ?? {}) };
    stationMap[link.personId] = { ...virtualEntry };
    next[link.stationId] = stationMap;
  }
  return next;
}

import type { AppState, LeadSlots } from '../types';
import { LEAD_SLOT_AREAS } from '../types';
import { loadState } from './persist';
import { getInitialState, normalizeSlotsToCapacity } from '../data/initialState';

function defaultLeadSlots(): LeadSlots {
  const out = {} as LeadSlots;
  for (const areaId of LEAD_SLOT_AREAS) {
    out[areaId] = null;
  }
  return out;
}

/** Single source of truth: load from localStorage once at app load, or use defaults. Never overwrites after mount. */
let cached: AppState | null = null;

export function getHydratedState(): AppState {
  if (cached) return cached;
  try {
    const loaded = loadState();
    if (loaded) {
      const defaults = getInitialState();
      const slots =
        loaded.slots != null && typeof loaded.slots === 'object'
          ? normalizeSlotsToCapacity(loaded.slots, loaded.areaCapacityOverrides)
          : defaults.slots;
      const roster = Array.isArray(loaded.roster)
        ? loaded.roster.map((p) => ({
            ...p,
            lead: p.lead ?? false,
            ot: p.ot ?? false,
            otHereToday: p.otHereToday ?? false,
            late: p.late ?? false,
            leavingEarly: p.leavingEarly ?? false,
            breakPreference: p.breakPreference ?? 'no_preference',
            areasWantToLearn: p.areasWantToLearn ?? [],
          }))
        : defaults.roster;
      cached = {
        ...defaults,
        ...loaded,
        roster,
        slots,
        leadSlots: loaded.leadSlots ?? defaultLeadSlots(),
        juicedAreas: loaded.juicedAreas ?? {},
        deJuicedAreas: loaded.deJuicedAreas ?? {},
        breakSchedules: loaded.breakSchedules ?? {},
        areaCapacityOverrides: loaded.areaCapacityOverrides ?? {},
        areaNameOverrides: loaded.areaNameOverrides ?? {},
        slotLabelsByArea: loaded.slotLabelsByArea ?? {},
      };
      return cached;
    }
  } catch {
    // Invalid or missing saved state: use fresh state
  }
  cached = getInitialState();
  return cached;
}

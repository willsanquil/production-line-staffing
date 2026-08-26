import type { LineConfig, LineState, RootState } from '../types';
import { getEmptyLineState } from '../data/initialState';
import {
  getDefaultICLineConfig,
  getDefaultNICLineConfig,
  getDefaultIC2LineConfig,
  getDefaultNIC2LineConfig,
  getBuiltInLineConfigByName,
} from './lineConfig';

/** Pre-enable per-slot break coverage for 14.5 + Testing (Flip float priority). */
function withDefaultFlipBreakCoverage(state: LineState): LineState {
  const slotBreakCoverageEnabled: Record<string, Record<string, boolean>> = {
    ...(state.slotBreakCoverageEnabled ?? {}),
  };
  for (const areaId of ['area_14_5', 'area_testing']) {
    const areaSlots = state.slots[areaId] ?? [];
    if (areaSlots.length === 0) continue;
    slotBreakCoverageEnabled[areaId] = Object.fromEntries(areaSlots.map((s) => [s.id, true]));
  }
  return { ...state, slotBreakCoverageEnabled };
}

/** Empty root state for a built-in MIC line preset (cloud line creation). */
export function buildPresetCloudRootState(config: LineConfig): RootState {
  const lineState = withDefaultFlipBreakCoverage(getEmptyLineState(config));
  return {
    currentLineId: config.id,
    lines: [config],
    lineStates: { [config.id]: lineState },
  };
}

export function buildPresetCloudRootStateByName(lineName: string): RootState | null {
  const config = getBuiltInLineConfigByName(lineName);
  if (!config) return null;
  return buildPresetCloudRootState(config);
}

export const CLOUD_LINE_PRESETS = {
  ic: getDefaultICLineConfig(),
  nic: getDefaultNICLineConfig(),
  ic2: getDefaultIC2LineConfig(),
  nic2: getDefaultNIC2LineConfig(),
} as const;

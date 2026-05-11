import type { AppState, LineState, RootState } from '../types';

export type LineDraftState = Pick<
  AppState,
  | 'slots'
  | 'leadSlots'
  | 'juicedAreas'
  | 'deJuicedAreas'
  | 'sectionTasks'
  | 'schedule'
  | 'dayNotes'
  | 'documents'
  | 'breakSchedules'
  | 'leadBreakCoverage'
  | 'areaBreakCoverageEnabled'
  | 'areaCapacityOverrides'
  | 'areaNameOverrides'
  | 'slotLabelsByArea'
  | 'areaRequiresTrainedOrExpertOverrides'
  | 'slotBreakCoverageEnabled'
  | 'areaCoversBreaksFor'
>;

export function extractLineDraftState(lineState: Partial<LineState>): LineDraftState {
  return {
    slots: lineState.slots ?? {},
    leadSlots: lineState.leadSlots ?? {},
    juicedAreas: lineState.juicedAreas ?? {},
    deJuicedAreas: lineState.deJuicedAreas ?? {},
    sectionTasks: lineState.sectionTasks ?? {},
    schedule: lineState.schedule ?? [],
    dayNotes: lineState.dayNotes ?? '',
    documents: lineState.documents ?? [],
    breakSchedules: lineState.breakSchedules ?? {},
    leadBreakCoverage: lineState.leadBreakCoverage ?? {},
    areaBreakCoverageEnabled: lineState.areaBreakCoverageEnabled ?? {},
    areaCapacityOverrides: lineState.areaCapacityOverrides ?? {},
    areaNameOverrides: lineState.areaNameOverrides ?? {},
    slotLabelsByArea: lineState.slotLabelsByArea ?? {},
    areaRequiresTrainedOrExpertOverrides: lineState.areaRequiresTrainedOrExpertOverrides ?? {},
    slotBreakCoverageEnabled: lineState.slotBreakCoverageEnabled ?? {},
    areaCoversBreaksFor: lineState.areaCoversBreaksFor ?? {},
  };
}

export function buildPersistedRootState(root: RootState, draft: LineDraftState): RootState {
  const currentLineState = root.lineStates[root.currentLineId];
  return {
    ...root,
    lineStates: {
      ...root.lineStates,
      [root.currentLineId]: { ...currentLineState, ...draft } as LineState,
    },
  };
}

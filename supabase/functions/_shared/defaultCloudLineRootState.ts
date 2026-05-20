function nanoid(): string {
  return Math.random().toString(36).slice(2, 11);
}

/** Minimal default line config and empty state for a new cloud line (matches create-line). */
export function buildDefaultRootState(lineId: string, lineName: string) {
  const areaId = 'area_general';
  const config = {
    id: lineId,
    name: lineName.trim() || 'New Line',
    areas: [
      { id: areaId, name: 'General', minSlots: 1, maxSlots: 10, requiresTrainedOrExpert: true },
    ],
    leadAreaIds: [] as string[],
    combinedSections: [] as [string, string][],
    breaksEnabled: true,
    breaksScope: 'line' as const,
    breakRotations: 3,
  };
  const slots: Record<string, { id: string; personId: string | null }[]> = {};
  slots[areaId] = [{ id: nanoid(), personId: null }];
  const sectionTasks: Record<string, unknown[]> = {};
  sectionTasks[areaId] = [];
  const schedule = Array.from({ length: 12 }, (_, i) => ({
    hour: i + 6,
    taskList: [],
    breakRotation: undefined,
    lunchRotation: undefined,
  }));
  const lineState = {
    roster: [],
    slots,
    leadSlots: {},
    juicedAreas: {},
    deJuicedAreas: {},
    sectionTasks,
    schedule,
    dayNotes: '',
    documents: [],
    breakSchedules: {},
    areaCapacityOverrides: {},
    areaNameOverrides: {},
    slotLabelsByArea: {},
  };
  return {
    currentLineId: lineId,
    lines: [config],
    lineStates: { [lineId]: lineState },
  };
}

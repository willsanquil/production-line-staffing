import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { AppState, AreaId, BreakPreference, RosterPerson, SavedDay, SlotsByArea, TaskItem } from './types';
import type { SkillLevel } from './types';
import { AREA_IDS, LEAD_SLOT_AREAS, LINE_SECTIONS } from './types';

const SKILL_SCORE: Record<SkillLevel, number> = {
  no_experience: 0,
  training: 1,
  trained: 2,
  expert: 3,
};

/** Overall line health: average knowledge (0–3) of everyone on the line in their assigned role. */
function getLineHealthScore(
  slots: SlotsByArea,
  leadSlots: Record<string, string | null>,
  roster: { id: string; skills: Record<AreaId, SkillLevel> }[],
  areaIds: string[],
  leadAreaIds: string[]
): number | null {
  let sum = 0;
  let count = 0;
  for (const areaId of areaIds) {
    const areaSlots = slots[areaId] ?? [];
    for (const slot of areaSlots) {
      if (!slot.personId) continue;
      const p = roster.find((r) => r.id === slot.personId);
      if (p) {
        sum += SKILL_SCORE[p.skills[areaId] ?? 'no_experience'];
        count++;
      }
    }
  }
  for (const areaId of leadAreaIds) {
    const personId = leadSlots[areaId];
    if (!personId) continue;
    const p = roster.find((r) => r.id === personId);
    if (p) {
      sum += SKILL_SCORE[p.skills[areaId] ?? 'no_experience'];
      count++;
    }
  }
  return count > 0 ? sum / count : null;
}
import { getHydratedRootState } from './lib/initialState';
import { getRosterForLine, getFlexedInPersonIds } from './lib/personLabel';
import { sortByFirstName } from './lib/rosterSort';
import { getEffectiveCapacity, getEffectiveAreaLabels, getSlotLabel as getSlotLabelIC } from './lib/areaConfig';
import {
  getAreaIds,
  getLineSections,
  getEffectiveCapacityForLine,
  getEffectiveAreaLabelsForLine,
  getSlotLabelForLine,
  areaRequiresTrainedOrExpertFromConfig,
  getDefaultICLineConfig,
  getBreaksEnabled,
  getBreaksScope,
  getBreakRotations,
  BREAK_LINE_WIDE_KEY,
} from './lib/lineConfig';
import { createEmptyPerson, createEmptyOTPerson, createEmptySlot, getEmptyLineState, normalizeSlotsToCapacity, normalizeSlotsToLineCapacity } from './data/initialState';
import { RosterGrid } from './components/RosterGrid';
import { LeadSlotsSection } from './components/LeadSlotsSection';
import { AreaStaffing } from './components/AreaStaffing';
import { CombinedAreaStaffing } from './components/CombinedAreaStaffing';
import { LineView } from './components/LineView';
import { DayTimeline } from './components/DayTimeline';
import { NotesAndDocuments } from './components/NotesAndDocuments';
import { DayBank } from './components/DayBank';
import { TrainingReport } from './components/TrainingReport';
import { randomizeAssignments, spreadTalent, maxSpeedAssignments, lightStretchAssignments } from './lib/automation';
import { generateBreakSchedules } from './lib/breakSchedules';
import { saveRootState, loadSavedDays, addSavedDay, removeSavedDay, exportStateToJson, importStateFromJson } from './lib/persist';
import { saveToFile, overwriteFile, openFromFile, isSaveToFileSupported } from './lib/fileStorage';
import { getLineState, setLineState } from './lib/cloudLines';
import { getCloudSession, clearCloudSession, EntryScreen } from './components/EntryScreen';
import { LineManager } from './components/LineManager';
import { BuildLineWizard } from './components/BuildLineWizard';
import { BreakTable } from './components/BreakTable';

const FULL_STAFF = 30;

const PERSIST_DEBOUNCE_MS = 400;

function getAssignedPersonIds(slots: SlotsByArea, areaIds: string[]): Set<string> {
  const set = new Set<string>();
  for (const areaId of areaIds) {
    const areaSlots = slots[areaId] ?? [];
    for (const slot of areaSlots) {
      if (slot.personId) set.add(slot.personId);
    }
  }
  return set;
}

/** Find which line's roster contains this person (their home line). */
function findPersonHomeLine(lineStates: Record<string, import('./types').LineState>, personId: string): string | null {
  for (const [lineId, state] of Object.entries(lineStates)) {
    if (state?.roster?.some((p) => p.id === personId)) return lineId;
  }
  return null;
}

/** Update one person in root state (in their home line's roster). */
function updatePersonInRoot(
  root: import('./types').RootState,
  personId: string,
  updater: (p: RosterPerson) => RosterPerson
): import('./types').RootState {
  const homeLineId = findPersonHomeLine(root.lineStates, personId);
  if (homeLineId == null) return root;
  const lineState = root.lineStates[homeLineId];
  const roster = (lineState?.roster ?? []).map((p) => (p.id === personId ? updater(p) : p));
  return {
    ...root,
    lineStates: { ...root.lineStates, [homeLineId]: { ...lineState, roster } },
  };
}

const rootInitial = getHydratedRootState();
const firstLineState = rootInitial.lineStates[rootInitial.currentLineId] ?? getEmptyLineState(getDefaultICLineConfig());

type AppMode = 'entry' | 'loading-cloud' | 'app';

export default function App() {
  const [appMode, setAppMode] = useState<AppMode>(() => (getCloudSession() ? 'loading-cloud' : 'entry'));
  const [cloudLineId, setCloudLineId] = useState<string | null>(null);
  const cloudPasswordRef = useRef<string | null>(null);

  const [rootState, setRootState] = useState(rootInitial);
  const [view, setView] = useState<'staffing' | 'line-manager' | 'build-line'>('staffing');

  const [slots, setSlots] = useState(firstLineState.slots);
  const [leadSlots, setLeadSlots] = useState(firstLineState.leadSlots);
  const [juicedAreas, setJuicedAreas] = useState(firstLineState.juicedAreas ?? {});
  const [deJuicedAreas, setDeJuicedAreas] = useState(firstLineState.deJuicedAreas ?? {});
  const [sectionTasks, setSectionTasks] = useState(firstLineState.sectionTasks);
  const [schedule, setSchedule] = useState(firstLineState.schedule);
  const [dayNotes, setDayNotes] = useState(firstLineState.dayNotes ?? '');
  const [documents, setDocuments] = useState<string[]>(firstLineState.documents ?? []);
  const [breakSchedules, setBreakSchedules] = useState(firstLineState.breakSchedules ?? {});
  const [savedDays, setSavedDays] = useState(() => loadSavedDays());
  const [rosterVisible, setRosterVisible] = useState(true);
  const [adminVisible, setAdminVisible] = useState(true);
  const [breakScheduleVisibleByArea, setBreakScheduleVisibleByArea] = useState<Partial<Record<AreaId, boolean>>>({});
  const [areaCapacityOverrides, setAreaCapacityOverrides] = useState(firstLineState.areaCapacityOverrides ?? {});
  const [areaNameOverrides, setAreaNameOverrides] = useState(firstLineState.areaNameOverrides ?? {});
  const [slotLabelsByArea, setSlotLabelsByArea] = useState(firstLineState.slotLabelsByArea ?? {});

  const currentConfig = useMemo(
    () => rootState.lines.find((l) => l.id === rootState.currentLineId),
    [rootState.lines, rootState.currentLineId]
  );
  const areaIds = useMemo(
    () => (currentConfig ? (currentConfig.id === 'ic' ? [...AREA_IDS] : getAreaIds(currentConfig)) : []),
    [currentConfig]
  );
  const lineSections = useMemo(
    () => (currentConfig ? (currentConfig.id === 'ic' ? LINE_SECTIONS : getLineSections(currentConfig)) : []),
    [currentConfig]
  );
  const leadAreaIds = useMemo(
    () => (currentConfig ? (currentConfig.id === 'ic' ? [...LEAD_SLOT_AREAS] : currentConfig.leadAreaIds) : []),
    [currentConfig]
  );
  const effectiveCapacity = useMemo(
    () =>
      currentConfig
        ? currentConfig.id === 'ic'
          ? getEffectiveCapacity(areaCapacityOverrides)
          : getEffectiveCapacityForLine(currentConfig, areaCapacityOverrides)
        : ({} as Record<string, { min: number; max: number }>),
    [currentConfig, areaCapacityOverrides]
  );
  const areaLabels = useMemo(
    () =>
      currentConfig
        ? currentConfig.id === 'ic'
          ? getEffectiveAreaLabels(areaNameOverrides)
          : getEffectiveAreaLabelsForLine(currentConfig, areaNameOverrides)
        : {},
    [currentConfig, areaNameOverrides]
  );
  const getSlotLabel = useCallback(
    (areaId: string, slotIndex: number) =>
      currentConfig && currentConfig.id !== 'ic'
        ? getSlotLabelForLine(currentConfig, areaId, slotIndex, slotLabelsByArea)
        : getSlotLabelIC(areaId, slotIndex, slotLabelsByArea),
    [currentConfig, slotLabelsByArea]
  );
  const areaRequiresTrainedOrExpert = useCallback(
    (areaId: string) =>
      currentConfig ? areaRequiresTrainedOrExpertFromConfig(currentConfig, areaId) : true,
    [currentConfig]
  );

  const roster = useMemo(
    () => sortByFirstName(getRosterForLine(rootState.currentLineId, rootState.lineStates)),
    [rootState.currentLineId, rootState.lineStates]
  );
  const flexedInPersonIds = useMemo(
    () => getFlexedInPersonIds(rootState.currentLineId, rootState.lineStates),
    [rootState.currentLineId, rootState.lineStates]
  );

  const stateRef = useRef({ slots, leadSlots, juicedAreas, deJuicedAreas, sectionTasks, schedule, dayNotes, documents, breakSchedules, areaCapacityOverrides, areaNameOverrides, slotLabelsByArea });
  stateRef.current = { slots, leadSlots, juicedAreas, deJuicedAreas, sectionTasks, schedule, dayNotes, documents, breakSchedules, areaCapacityOverrides, areaNameOverrides, slotLabelsByArea };
  const rootStateRef = useRef(rootState);
  rootStateRef.current = rootState;

  useEffect(() => {
    if (appMode !== 'loading-cloud') return;
    const session = getCloudSession();
    if (!session) {
      setAppMode('entry');
      return;
    }
    getLineState(session.lineId, session.password)
      .then((root) => {
        setRootState(root);
        setCloudLineId(session.lineId);
        cloudPasswordRef.current = session.password;
        setAppMode('app');
      })
      .catch(() => {
        clearCloudSession();
        setAppMode('entry');
      });
  }, [appMode]);

  useEffect(() => {
    const lineState = rootState.lineStates[rootState.currentLineId];
    if (!lineState) return;
    setSlots(lineState.slots ?? {});
    setLeadSlots(lineState.leadSlots ?? {});
    setJuicedAreas(lineState.juicedAreas ?? {});
    setDeJuicedAreas(lineState.deJuicedAreas ?? {});
    setSectionTasks(lineState.sectionTasks ?? {});
    setSchedule(lineState.schedule ?? []);
    setDayNotes(lineState.dayNotes ?? '');
    setDocuments(lineState.documents ?? []);
    setBreakSchedules(lineState.breakSchedules ?? {});
    setAreaCapacityOverrides(lineState.areaCapacityOverrides ?? {});
    setAreaNameOverrides(lineState.areaNameOverrides ?? {});
    setSlotLabelsByArea(lineState.slotLabelsByArea ?? {});
  }, [rootState.currentLineId, rootState.lineStates]);

  const persistTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (appMode !== 'app') return;
    const id = setTimeout(() => {
      const root = rootStateRef.current;
      const payload = {
        ...root,
        lineStates: {
          ...root.lineStates,
          [root.currentLineId]: { ...root.lineStates[root.currentLineId], ...stateRef.current } as AppState,
        },
      };
      const lineId = cloudLineId;
      const password = cloudPasswordRef.current;
      if (lineId && password) {
        setLineState(lineId, password, payload).catch((e) => {
          console.error('Cloud save failed:', e);
        });
      } else {
        saveRootState(payload);
      }
      persistTimeoutRef.current = null;
    }, PERSIST_DEBOUNCE_MS);
    persistTimeoutRef.current = id;
    return () => {
      if (persistTimeoutRef.current) {
        clearTimeout(persistTimeoutRef.current);
        persistTimeoutRef.current = null;
      }
      const root = rootStateRef.current;
      const payload = {
        ...root,
        lineStates: {
          ...root.lineStates,
          [root.currentLineId]: { ...root.lineStates[root.currentLineId], ...stateRef.current } as AppState,
        },
      };
      const lineId = cloudLineId;
      const password = cloudPasswordRef.current;
      if (lineId && password) {
        setLineState(lineId, password, payload).catch((e) => console.error('Cloud save failed:', e));
      } else {
        saveRootState(payload);
      }
    };
  }, [appMode, cloudLineId, slots, leadSlots, juicedAreas, deJuicedAreas, sectionTasks, schedule, dayNotes, documents, breakSchedules, areaCapacityOverrides, areaNameOverrides, slotLabelsByArea]);

  const allAssignedPersonIds = useMemo(() => getAssignedPersonIds(slots, areaIds), [slots, areaIds]);
  const leadAssignedPersonIds = useMemo(() => {
    const set = new Set<string>();
    for (const areaId of leadAreaIds) {
      if (leadSlots[areaId]) set.add(leadSlots[areaId]!);
    }
    return set;
  }, [leadSlots, leadAreaIds]);
  const grandTotal = useMemo(
    () => allAssignedPersonIds.size + leadAssignedPersonIds.size,
    [allAssignedPersonIds, leadAssignedPersonIds]
  );
  const grandTotalPct = useMemo(
    () => (FULL_STAFF > 0 ? Math.round((grandTotal / FULL_STAFF) * 100) : 0),
    [grandTotal]
  );

  const lineHealthScore = useMemo(
    () => getLineHealthScore(slots, leadSlots, roster, areaIds, leadAreaIds),
    [slots, leadSlots, roster, areaIds, leadAreaIds]
  );
  const lineHealthSpectrumPosition =
    lineHealthScore != null ? (lineHealthScore / 3) * 100 : null;

  const setSlotAssignment = useCallback((areaId: AreaId, slotId: string, personId: string | null) => {
    setSlots((prev) => ({
      ...prev,
      [areaId]: prev[areaId].map((s) =>
        s.id === slotId ? { ...s, personId } : s
      ),
    }));
  }, []);

  const setSlotsForArea = useCallback((areaId: AreaId, newSlots: SlotsByArea[AreaId]) => {
    setSlots((prev) => ({ ...prev, [areaId]: newSlots }));
  }, []);

  const setSectionTasksForArea = useCallback((areaId: AreaId, tasks: TaskItem[]) => {
    setSectionTasks((prev) => ({ ...prev, [areaId]: tasks }));
  }, []);

  const setLeadSlot = useCallback((areaId: string, personId: string | null) => {
    setLeadSlots((prev) => ({ ...prev, [areaId]: personId }));
    if (personId) {
      setSlots((prev) => {
        const next = {} as SlotsByArea;
        for (const aid of areaIds) {
          const list = prev[aid];
          if (list) next[aid] = list.map((s) => (s.personId === personId ? { ...s, personId: null } : s));
        }
        return { ...prev, ...next };
      });
    }
  }, [areaIds]);

  const handleNameChange = useCallback((personId: string, name: string) => {
    setRootState((prev) => updatePersonInRoot(prev, personId, (p) => ({ ...p, name: name.trim() || p.name })));
  }, []);

  const handleAddPerson = useCallback((name: string) => {
    const person = createEmptyPerson(name, areaIds);
    setRootState((prev) => {
      const lineState = prev.lineStates[prev.currentLineId];
      const roster = [...(lineState?.roster ?? []), person];
      return { ...prev, lineStates: { ...prev.lineStates, [prev.currentLineId]: { ...lineState, roster } } };
    });
  }, [areaIds]);

  const handleRemovePerson = useCallback((personId: string) => {
    const person = roster.find((p) => p.id === personId);
    const name = person?.name ?? 'this person';
    if (!window.confirm(`Are you sure you want to remove ${name} from the roster?`)) return;
    const homeLineId = findPersonHomeLine(rootState.lineStates, personId);
    if (homeLineId != null) {
      setRootState((prev) => {
        const lineState = prev.lineStates[homeLineId];
        const roster = (lineState?.roster ?? []).filter((p) => p.id !== personId);
        return { ...prev, lineStates: { ...prev.lineStates, [homeLineId]: { ...lineState, roster } } };
      });
    }
    setSlots((prev) => {
      const next = {} as SlotsByArea;
      for (const areaId of areaIds) {
        const list = prev[areaId];
        if (list) next[areaId] = list.map((s) => (s.personId === personId ? { ...s, personId: null } : s));
      }
      return { ...prev, ...next };
    });
    setLeadSlots((prev) => {
      const next = { ...prev };
      for (const areaId of leadAreaIds) {
        if (next[areaId] === personId) next[areaId] = null;
      }
      return next;
    });
  }, [roster, rootState.lineStates, areaIds, leadAreaIds]);

  const handleToggleAbsent = useCallback((personId: string, absent: boolean) => {
    setRootState((prev) => updatePersonInRoot(prev, personId, (p) => ({ ...p, absent })));
  }, []);

  const handleToggleLead = useCallback((personId: string, lead: boolean) => {
    setRootState((prev) => updatePersonInRoot(prev, personId, (p) => ({ ...p, lead })));
  }, []);

  const handleToggleOT = useCallback((personId: string, ot: boolean) => {
    setRootState((prev) =>
      updatePersonInRoot(prev, personId, (p) => ({ ...p, ot, otHereToday: ot ? false : p.otHereToday }))
    );
  }, []);

  const handleToggleOTHereToday = useCallback((personId: string, otHereToday: boolean) => {
    setRootState((prev) => updatePersonInRoot(prev, personId, (p) => ({ ...p, otHereToday })));
  }, []);

  const handleAddOT = useCallback((name: string) => {
    const person = createEmptyOTPerson(name, areaIds);
    setRootState((prev) => {
      const lineState = prev.lineStates[prev.currentLineId];
      const roster = [...(lineState?.roster ?? []), person];
      return { ...prev, lineStates: { ...prev.lineStates, [prev.currentLineId]: { ...lineState, roster } } };
    });
  }, [areaIds]);

  const handleToggleLate = useCallback((personId: string, late: boolean) => {
    setRootState((prev) => updatePersonInRoot(prev, personId, (p) => ({ ...p, late })));
  }, []);

  const handleToggleLeavingEarly = useCallback((personId: string, leavingEarly: boolean) => {
    setRootState((prev) => updatePersonInRoot(prev, personId, (p) => ({ ...p, leavingEarly })));
  }, []);

  const handleFlexedToLineChange = useCallback((personId: string, lineId: string | null) => {
    setRootState((prev) =>
      updatePersonInRoot(prev, personId, (p) => ({ ...p, flexedToLineId: lineId || undefined }))
    );
  }, []);

  const handleToggleJuice = useCallback((areaId: AreaId, juiced: boolean) => {
    setJuicedAreas((prev) => ({ ...prev, [areaId]: juiced }));
    if (juiced) setDeJuicedAreas((prev) => ({ ...prev, [areaId]: false }));
  }, []);
  const handleToggleDeJuice = useCallback((areaId: AreaId, deJuiced: boolean) => {
    setDeJuicedAreas((prev) => ({ ...prev, [areaId]: deJuiced }));
    if (deJuiced) setJuicedAreas((prev) => ({ ...prev, [areaId]: false }));
  }, []);

  const handleBreakPreferenceChange = useCallback((personId: string, breakPreference: BreakPreference) => {
    setRootState((prev) => updatePersonInRoot(prev, personId, (p) => ({ ...p, breakPreference })));
  }, []);

  const handleSkillChange = useCallback((personId: string, areaId: AreaId, level: SkillLevel) => {
    setRootState((prev) =>
      updatePersonInRoot(prev, personId, (p) => ({ ...p, skills: { ...p.skills, [areaId]: level } }))
    );
  }, []);

  const handleAreasWantToLearnChange = useCallback((personId: string, areaId: AreaId, checked: boolean) => {
    setRootState((prev) =>
      updatePersonInRoot(prev, personId, (p) => {
        const list = p.areasWantToLearn ?? [];
        if (checked) return { ...p, areasWantToLearn: list.includes(areaId) ? list : [...list, areaId] };
        return { ...p, areasWantToLearn: list.filter((a) => a !== areaId) };
      })
    );
  }, []);

  const handleAreaRequiresTrainedOrExpertChange = useCallback((areaId: string, value: boolean) => {
    setRootState((prev) => {
      const lineIndex = prev.lines.findIndex((l) => l.id === prev.currentLineId);
      if (lineIndex === -1) return prev;
      const line = prev.lines[lineIndex];
      const areaIndex = line.areas.findIndex((a) => a.id === areaId);
      if (areaIndex === -1) return prev;
      const areas = line.areas.slice();
      areas[areaIndex] = { ...areas[areaIndex], requiresTrainedOrExpert: value };
      const lines = prev.lines.slice();
      lines[lineIndex] = { ...line, areas };
      return { ...prev, lines };
    });
  }, []);

  const handleAreaCapacityChange = useCallback((areaId: AreaId, payload: { min?: number; max?: number }) => {
    const nextMin = payload.min != null && !Number.isNaN(payload.min) ? Math.max(1, Math.round(payload.min)) : undefined;
    const nextMax = payload.max != null && !Number.isNaN(payload.max) ? Math.max(1, Math.round(payload.max)) : undefined;
    setAreaCapacityOverrides((prev) => {
      const base = effectiveCapacity[areaId];
      const next = {
        ...prev[areaId],
        min: nextMin ?? base.min,
        max: nextMax ?? base.max,
      };
      if (next.min > next.max) next.max = next.min;
      return { ...prev, [areaId]: next };
    });
    setSlots((prev) => {
      const cap = getEffectiveCapacity({ ...areaCapacityOverrides, [areaId]: { min: nextMin ?? effectiveCapacity[areaId].min, max: nextMax ?? effectiveCapacity[areaId].max } })[areaId];
      const list = prev[areaId] ?? [];
      let nextList = [...list];
      if (cap.max < nextList.length) nextList = nextList.slice(0, cap.max);
      if (cap.min > nextList.length) {
        for (let i = nextList.length; i < cap.min; i++) nextList.push(createEmptySlot());
      }
      return { ...prev, [areaId]: nextList };
    });
  }, [effectiveCapacity, areaCapacityOverrides]);

  const handleAreaNameChange = useCallback((areaId: AreaId, name: string) => {
    setAreaNameOverrides((prev) => ({ ...prev, [areaId]: name.trim() || undefined }));
  }, []);

  const handleSlotLabelChange = useCallback((areaId: AreaId, slotIndex: number, value: string) => {
    setSlotLabelsByArea((prev) => {
      const arr = prev[areaId] ?? [];
      const next = [...arr];
      while (next.length <= slotIndex) next.push('');
      next[slotIndex] = value;
      return { ...prev, [areaId]: next };
    });
  }, []);

  const handleClearLine = useCallback(() => {
    setSlots((prev) => {
      const next = {} as SlotsByArea;
      for (const areaId of areaIds) {
        const list = prev[areaId];
        if (list) next[areaId] = list.map((s) => ({ ...s, personId: null }));
      }
      return { ...prev, ...next };
    });
    setBreakSchedules({});
  }, [areaIds]);

  const handleSaveDay = useCallback((date: string, name?: string) => {
    const state = stateRef.current;
    addSavedDay(
      date,
      { roster, slots: state.slots, leadSlots: state.leadSlots, juicedAreas: state.juicedAreas, deJuicedAreas: state.deJuicedAreas, sectionTasks: state.sectionTasks, schedule: state.schedule, dayNotes: state.dayNotes, documents: state.documents, breakSchedules: state.breakSchedules },
      name,
      rootState.currentLineId
    );
    setSavedDays(loadSavedDays());
  }, [roster, rootState.currentLineId]);

  const handleLoadDay = useCallback((day: SavedDay) => {
    const targetLineId = day.lineId ?? rootState.currentLineId;
    const targetConfig = rootState.lines.find((l) => l.id === targetLineId);
    const normalizedSlots =
      targetConfig && targetConfig.id !== 'ic'
        ? normalizeSlotsToLineCapacity(day.slots, targetConfig, areaCapacityOverrides)
        : normalizeSlotsToCapacity(day.slots, areaCapacityOverrides);
    const lineStateForDay = {
      roster: rootState.lineStates[targetLineId]?.roster ?? [],
      slots: normalizedSlots,
      leadSlots: day.leadSlots ?? Object.fromEntries((targetConfig?.leadAreaIds ?? leadAreaIds).map((id) => [id, null])),
      juicedAreas: day.juicedAreas ?? {},
      deJuicedAreas: day.deJuicedAreas ?? {},
      sectionTasks: day.sectionTasks ?? {},
      schedule: day.schedule ?? [],
      dayNotes: day.dayNotes ?? '',
      documents: day.documents ?? [],
      breakSchedules: day.breakSchedules ?? {},
      areaCapacityOverrides: areaCapacityOverrides ?? {},
      areaNameOverrides: areaNameOverrides ?? {},
      slotLabelsByArea: slotLabelsByArea ?? {},
    };
    setRootState((prev) => {
      let next: typeof prev = { ...prev, currentLineId: targetLineId, lineStates: { ...prev.lineStates, [targetLineId]: lineStateForDay } };
      for (const p of day.roster) {
        const normalized: RosterPerson = {
          ...p,
          lead: p.lead ?? false,
          ot: p.ot ?? false,
          otHereToday: p.otHereToday ?? false,
          late: p.late ?? false,
          leavingEarly: p.leavingEarly ?? false,
          breakPreference: p.breakPreference ?? 'no_preference',
          areasWantToLearn: p.areasWantToLearn ?? [],
          flexedToLineId: targetLineId,
        };
        const homeLineId = findPersonHomeLine(next.lineStates, p.id);
        if (homeLineId != null) {
          next = updatePersonInRoot(next, p.id, () => normalized);
        } else {
          const ls = next.lineStates[targetLineId];
          const roster = [...(ls?.roster ?? []), normalized];
          next = { ...next, lineStates: { ...next.lineStates, [targetLineId]: { ...ls, roster } } };
        }
      }
      return next;
    });
    setSlots(normalizedSlots);
    setLeadSlots(lineStateForDay.leadSlots);
    setJuicedAreas(lineStateForDay.juicedAreas);
    setDeJuicedAreas(lineStateForDay.deJuicedAreas);
    setSectionTasks(lineStateForDay.sectionTasks);
    setSchedule(lineStateForDay.schedule);
    setDayNotes(lineStateForDay.dayNotes);
    setDocuments(lineStateForDay.documents);
    setBreakSchedules(lineStateForDay.breakSchedules ?? {});
  }, [areaCapacityOverrides, areaNameOverrides, leadAreaIds, rootState.currentLineId, rootState.lineStates, slotLabelsByArea]);

  const handleRandomize = useCallback(() => {
    const nextSlots = randomizeAssignments(roster, slots, leadAssignedPersonIds, areaIds, areaRequiresTrainedOrExpert);
    setSlots(nextSlots);
    if (currentConfig && getBreaksEnabled(currentConfig)) {
      setBreakSchedules(
        generateBreakSchedules(roster, nextSlots, areaIds, {
          rotationCount: getBreakRotations(currentConfig),
          scope: getBreaksScope(currentConfig),
          leadSlots,
        })
      );
    } else {
      setBreakSchedules({});
    }
  }, [roster, slots, leadAssignedPersonIds, areaIds, currentConfig, leadSlots, areaRequiresTrainedOrExpert]);

  const handleSpreadTalent = useCallback(() => {
    const nextSlots = spreadTalent(roster, slots, juicedAreas, leadAssignedPersonIds, deJuicedAreas, effectiveCapacity, areaIds, areaRequiresTrainedOrExpert);
    setSlots(nextSlots);
    if (currentConfig && getBreaksEnabled(currentConfig)) {
      setBreakSchedules(
        generateBreakSchedules(roster, nextSlots, areaIds, {
          rotationCount: getBreakRotations(currentConfig),
          scope: getBreaksScope(currentConfig),
          leadSlots,
        })
      );
    } else {
      setBreakSchedules({});
    }
  }, [roster, slots, juicedAreas, deJuicedAreas, leadAssignedPersonIds, effectiveCapacity, areaIds, currentConfig, leadSlots]);

  const handleMaxSpeed = useCallback(() => {
    const nextSlots = maxSpeedAssignments(roster, slots, juicedAreas, leadAssignedPersonIds, deJuicedAreas, effectiveCapacity, areaIds, areaRequiresTrainedOrExpert);
    setSlots(nextSlots);
    if (currentConfig && getBreaksEnabled(currentConfig)) {
      setBreakSchedules(
        generateBreakSchedules(roster, nextSlots, areaIds, {
          rotationCount: getBreakRotations(currentConfig),
          scope: getBreaksScope(currentConfig),
          leadSlots,
        })
      );
    } else {
      setBreakSchedules({});
    }
  }, [roster, slots, juicedAreas, deJuicedAreas, leadAssignedPersonIds, effectiveCapacity, areaIds, currentConfig, leadSlots, areaRequiresTrainedOrExpert]);

  const handleLightStretch = useCallback(() => {
    const nextSlots = lightStretchAssignments(roster, slots, juicedAreas, leadAssignedPersonIds, deJuicedAreas, effectiveCapacity, areaIds, areaRequiresTrainedOrExpert);
    setSlots(nextSlots);
    if (currentConfig && getBreaksEnabled(currentConfig)) {
      setBreakSchedules(
        generateBreakSchedules(roster, nextSlots, areaIds, {
          rotationCount: getBreakRotations(currentConfig),
          scope: getBreaksScope(currentConfig),
          leadSlots,
        })
      );
    } else {
      setBreakSchedules({});
    }
  }, [roster, slots, juicedAreas, deJuicedAreas, leadAssignedPersonIds, effectiveCapacity, areaIds, currentConfig, leadSlots, areaRequiresTrainedOrExpert]);

  const handleRemoveDay = useCallback((id: string) => {
    removeSavedDay(id);
    setSavedDays(loadSavedDays());
  }, []);

  const handleOpenLine = useCallback((lineId: string) => {
    setRootState((prev) => ({
      ...prev,
      lineStates: {
        ...prev.lineStates,
        [prev.currentLineId]: { ...prev.lineStates[prev.currentLineId], ...stateRef.current },
      },
      currentLineId: lineId,
    }));
    setView('staffing');
  }, []);

  const handleBuildNewLine = useCallback(() => setView('build-line'), []);

  const handleBuildLineComplete = useCallback((config: import('./types').LineConfig) => {
    const emptyState = getEmptyLineState(config);
    setRootState((prev) => ({
      ...prev,
      lines: [...prev.lines, config],
      lineStates: { ...prev.lineStates, [config.id]: emptyState },
      currentLineId: config.id,
    }));
    setView('staffing');
  }, []);

  const handleBuildLineCancel = useCallback(() => setView('line-manager'), []);

  const handleDeleteLine = useCallback((lineId: string) => {
    const line = rootState.lines.find((l) => l.id === lineId);
    const lineName = line?.name ?? 'this line';
    if (rootState.lines.length <= 1) {
      alert('You need at least one line. Create another line first if you want to remove this one.');
      return;
    }
    const message = `Are you sure you want to delete the line "${lineName}"?\n\nThis will permanently remove its roster, slot assignments, leads, and all saved state for this line. This cannot be undone.`;
    if (!window.confirm(message)) return;
    setRootState((prev) => {
      const newLines = prev.lines.filter((l) => l.id !== lineId);
      const newLineStates = { ...prev.lineStates };
      delete newLineStates[lineId];
      const nextCurrentLineId =
        prev.currentLineId === lineId
          ? (newLines[0]?.id ?? prev.currentLineId)
          : prev.currentLineId;
      return {
        ...prev,
        lines: newLines,
        lineStates: newLineStates,
        currentLineId: nextCurrentLineId,
      };
    });
    if (rootState.currentLineId === lineId) {
      setView('staffing');
    }
  }, [rootState.lines, rootState.currentLineId]);

  const importFileRef = useRef<HTMLInputElement>(null);
  const savedFileHandleRef = useRef<FileSystemFileHandle | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const applyImportedState = useCallback((imported: AppState) => {
    const currentLineId = rootStateRef.current.currentLineId;
    const normalized = (imported.roster ?? []).map((p: RosterPerson) => ({
      ...p,
      lead: p.lead ?? false,
      ot: p.ot ?? false,
      otHereToday: p.otHereToday ?? false,
      late: p.late ?? false,
      leavingEarly: p.leavingEarly ?? false,
      breakPreference: p.breakPreference ?? 'no_preference',
      areasWantToLearn: p.areasWantToLearn ?? [],
      flexedToLineId: p.flexedToLineId ?? null,
    }));
    setRootState((prev) => ({
      ...prev,
      lineStates: {
        ...prev.lineStates,
        [currentLineId]: { ...prev.lineStates[currentLineId], roster: normalized.length ? normalized : prev.lineStates[currentLineId]?.roster ?? [] },
      },
    }));
    const normalizedSlots =
      currentConfig && currentConfig.id !== 'ic'
        ? normalizeSlotsToLineCapacity(imported.slots, currentConfig, imported.areaCapacityOverrides)
        : normalizeSlotsToCapacity(imported.slots, imported.areaCapacityOverrides);
    setSlots(normalizedSlots);
    setLeadSlots(imported.leadSlots ?? Object.fromEntries(leadAreaIds.map((id) => [id, null])));
    setJuicedAreas(imported.juicedAreas ?? {});
    setDeJuicedAreas(imported.deJuicedAreas ?? {});
    setSectionTasks(imported.sectionTasks ?? {});
    setSchedule(imported.schedule ?? []);
    setDayNotes(imported.dayNotes ?? '');
    setDocuments(imported.documents ?? []);
    setBreakSchedules(imported.breakSchedules ?? {});
    setAreaCapacityOverrides(imported.areaCapacityOverrides ?? {});
    setAreaNameOverrides(imported.areaNameOverrides ?? {});
    setSlotLabelsByArea(imported.slotLabelsByArea ?? {});
    setSavedDays(loadSavedDays());
  }, [currentConfig, leadAreaIds]);

  const handleSaveToFile = useCallback(async () => {
    const root = rootStateRef.current;
    const rosterForLine = getRosterForLine(root.currentLineId, root.lineStates);
    const state: AppState = { ...stateRef.current, roster: rosterForLine };
    try {
      let written = false;
      if (savedFileHandleRef.current) {
        written = await overwriteFile(state, savedFileHandleRef.current);
      }
      if (!written) {
        const handle = await saveToFile(state);
        if (handle) {
          savedFileHandleRef.current = handle;
          written = true;
        }
      }
      if (written) {
        setSaveMessage('Saved');
        setTimeout(() => setSaveMessage(null), 2000);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not save file.');
    }
  }, []);

  const handleOpenFromFile = useCallback(async () => {
    try {
      const imported = await openFromFile();
      if (imported) applyImportedState(imported);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not open file.');
    }
  }, [applyImportedState]);

  const handleExportBackup = useCallback(() => {
    const root = rootStateRef.current;
    const rosterForLine = getRosterForLine(root.currentLineId, root.lineStates);
    const state: AppState = { ...stateRef.current, roster: rosterForLine };
    const json = exportStateToJson(state);
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `staffing-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, []);

  const handleImportBackup = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const imported = importStateFromJson(text);
      if (!imported) {
        alert('Invalid backup file.');
        return;
      }
      applyImportedState(imported);
    };
    reader.readAsText(file);
    e.target.value = '';
  }, [applyImportedState]);

  const handleLeaveLine = useCallback(() => {
    clearCloudSession();
    setCloudLineId(null);
    cloudPasswordRef.current = null;
    setRootState(getHydratedRootState());
  }, []);

  if (appMode === 'entry') {
    return (
      <EntryScreen
        onSelectLocal={() => setAppMode('app')}
        onJoinGroup={(root, lineId, password) => {
          setRootState(root);
          setCloudLineId(lineId);
          cloudPasswordRef.current = password;
          setAppMode('app');
        }}
      />
    );
  }

  if (appMode === 'loading-cloud') {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <p>Loading group line…</p>
      </div>
    );
  }

  if (view === 'line-manager') {
    return (
      <>
        <header className="app-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <span>Production Line Staffing</span>
        </header>
        <LineManager
          rootState={rootState}
          onOpenLine={handleOpenLine}
          onBuildNew={handleBuildNewLine}
          onDeleteLine={handleDeleteLine}
          onBack={() => setView('staffing')}
        />
      </>
    );
  }

  if (view === 'build-line') {
    const existingAreaIds = new Set(rootState.lines.flatMap((l) => l.areas.map((a) => a.id)));
    return (
      <>
        <header className="app-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <span>Production Line Staffing</span>
        </header>
        <BuildLineWizard
          existingAreaIds={existingAreaIds}
          onComplete={handleBuildLineComplete}
          onCancel={handleBuildLineCancel}
        />
      </>
    );
  }

  if (!currentConfig) {
    return (
      <>
        <header className="app-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <span>Production Line Staffing</span>
          <button type="button" onClick={() => setView('line-manager')} style={{ padding: '8px 16px' }}>
            Lines
          </button>
        </header>
        <p style={{ padding: 24 }}>No line selected. Open a line or build your own.</p>
      </>
    );
  }

  if (!adminVisible) {
    return (
      <>
        <header className="app-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <span>Production Line Staffing — {currentConfig.name}{cloudLineId ? ' (Group)' : ''}</span>
          {cloudLineId && (
            <button type="button" onClick={handleLeaveLine} style={{ marginRight: 8, padding: '6px 12px', fontSize: '0.9rem' }}>
              Leave line
            </button>
          )}
          <button type="button" onClick={() => setView('line-manager')} style={{ marginRight: 8 }}>
            Lines
          </button>
          <button
            type="button"
            onClick={() => setAdminVisible(true)}
            style={{ padding: '8px 16px', fontSize: '1rem', fontWeight: 600 }}
          >
            Show admin
          </button>
        </header>
        <LineView
          slots={slots}
          roster={roster}
          leadSlots={leadSlots}
          areaLabels={areaLabels}
          slotLabelsByArea={slotLabelsByArea}
          effectiveCapacity={effectiveCapacity}
          totalOnLine={grandTotal}
          fullStaff={FULL_STAFF}
          staffingPct={grandTotalPct}
          lineHealthScore={lineHealthScore}
          lineSections={[...lineSections]}
          leadAreaIds={leadAreaIds}
          getSlotLabel={getSlotLabel}
          areaRequiresTrainedOrExpert={areaRequiresTrainedOrExpert}
        />
        <div style={{ maxWidth: 520, margin: '0 auto', padding: '0 12px 24px' }}>
          <TrainingReport roster={roster} slots={slots} areaLabels={areaLabels} effectiveCapacity={effectiveCapacity} presentationMode areaIds={areaIds} />
        </div>
      </>
    );
  }

  return (
    <>
      <header className="app-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <span>Production Line Staffing — {currentConfig.name}{cloudLineId ? ' (Group)' : ''}</span>
        {cloudLineId && (
          <button type="button" onClick={handleLeaveLine} style={{ marginRight: 4, padding: '6px 12px', fontSize: '0.9rem' }}>
            Leave line
          </button>
        )}
        <button type="button" onClick={() => setView('line-manager')} style={{ marginRight: 4 }}>
          Lines
        </button>
        <button
          type="button"
          onClick={() => setAdminVisible(false)}
          title="Compact view for screenshot or phone"
          style={{ padding: '6px 12px', fontSize: '0.9rem' }}
        >
          Hide admin
        </button>
      </header>

      <RosterGrid
        roster={roster}
        flexedInPersonIds={flexedInPersonIds}
        visible={rosterVisible}
        areaLabels={areaLabels}
        areaIds={areaIds}
        lines={rootState.lines}
        currentLineId={rootState.currentLineId}
        onToggleVisible={() => setRosterVisible((v) => !v)}
        onNameChange={handleNameChange}
        onRemovePerson={handleRemovePerson}
        onAddPerson={handleAddPerson}
        onAddOT={handleAddOT}
        onToggleAbsent={handleToggleAbsent}
        onToggleLead={handleToggleLead}
        onToggleOT={handleToggleOT}
        onToggleOTHereToday={handleToggleOTHereToday}
        onToggleLate={handleToggleLate}
        onToggleLeavingEarly={handleToggleLeavingEarly}
        onBreakPreferenceChange={handleBreakPreferenceChange}
        onSkillChange={handleSkillChange}
        onAreasWantToLearnChange={handleAreasWantToLearnChange}
        onFlexedToLineChange={handleFlexedToLineChange}
      />

      <div className="totals-and-leads-row" style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', marginBottom: 12 }}>
        <div className="grand-total" style={{ marginBottom: 0 }}>
          Total people on line: {grandTotal} ({grandTotalPct}%) — Full staff: {FULL_STAFF}
        </div>
        <div className="seniority-spectrum-wrap" style={{ marginBottom: 0, minWidth: 160 }}>
          <div className="seniority-spectrum-label" style={{ fontSize: '0.75rem', marginBottom: 4 }}>
            Line health
          </div>
          <div className="seniority-spectrum" style={{ position: 'relative', height: 14, borderRadius: 4, overflow: 'hidden', display: 'flex' }}>
            <div className="skill-no_experience" style={{ flex: 1, minWidth: 0 }} />
            <div className="skill-training" style={{ flex: 1, minWidth: 0 }} />
            <div className="skill-trained" style={{ flex: 1, minWidth: 0 }} />
            <div className="skill-expert" style={{ flex: 1, minWidth: 0 }} />
            {lineHealthSpectrumPosition != null && (
              <div
                className="seniority-spectrum-arrow"
                style={{
                  position: 'absolute',
                  left: `clamp(4px, ${lineHealthSpectrumPosition}%, calc(100% - 8px))`,
                  top: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: 0,
                  height: 0,
                  borderLeft: '5px solid transparent',
                  borderRight: '5px solid transparent',
                  borderTop: '7px solid #1a1a1a',
                  filter: 'drop-shadow(0 0 1px #fff)',
                  pointerEvents: 'none',
                }}
                title={`Line avg: ${(lineHealthScore ?? 0).toFixed(1)} / 3`}
              />
            )}
          </div>
        </div>
        <LeadSlotsSection
          roster={roster}
          leadSlots={leadSlots}
          areaLabels={areaLabels}
          leadAreaIds={leadAreaIds}
          onLeadSlotChange={setLeadSlot}
        />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" onClick={handleSpreadTalent}>Spread talent</button>
        <button type="button" onClick={handleRandomize}>Randomize</button>
        <button type="button" onClick={handleMaxSpeed} title="Experts in their places — best skill match, deterministic">MAX SPEED</button>
        <button type="button" onClick={handleLightStretch} title="Some of the team in no-experience or training positions">Light stretch</button>
        {/* STRETCH temporarily disabled
        <button type="button" onClick={handleStretch} title="Push team outside comfort zone; prefer areas they want to learn">STRETCH</button>
        */}
        <button type="button" onClick={handleClearLine}>Clear line</button>
      </div>

      <div className="areas-grid">
        {lineSections.map((section) => {
          const isCombined = Array.isArray(section);
          if (isCombined) {
            const [idA, idB] = section as [string, string];
            return (
              <CombinedAreaStaffing
                key={`${idA}-${idB}`}
                combinedLabel={`${areaLabels[idA] ?? idA} & ${areaLabels[idB] ?? idB}`}
                areaIdA={idA}
                areaIdB={idB}
                areaLabelA={areaLabels[idA] ?? idA}
                areaLabelB={areaLabels[idB] ?? idB}
                slotsA={slots[idA] ?? []}
                slotsB={slots[idB] ?? []}
                minA={effectiveCapacity[idA]?.min ?? 1}
                maxA={effectiveCapacity[idA]?.max ?? 1}
                minB={effectiveCapacity[idB]?.min ?? 1}
                maxB={effectiveCapacity[idB]?.max ?? 1}
                slotLabelsA={slotLabelsByArea[idA]}
                slotLabelsB={slotLabelsByArea[idB]}
                sectionTasksA={sectionTasks[idA] ?? []}
                sectionTasksB={sectionTasks[idB] ?? []}
                roster={roster}
                allAssignedPersonIds={allAssignedPersonIds}
                leadAssignedPersonIds={leadAssignedPersonIds}
                juicedA={!!juicedAreas[idA]}
                juicedB={!!juicedAreas[idB]}
                deJuicedA={!!deJuicedAreas[idA]}
                deJuicedB={!!deJuicedAreas[idB]}
                onToggleJuice={handleToggleJuice}
                onToggleDeJuice={handleToggleDeJuice}
                onCapacityChange={handleAreaCapacityChange}
                onSlotLabelChange={handleSlotLabelChange}
                onSlotsChange={setSlotsForArea}
                onSectionTasksChange={setSectionTasksForArea}
                onAssign={setSlotAssignment}
                breakScheduleA={currentConfig && getBreaksEnabled(currentConfig) ? breakSchedules?.[idA] : undefined}
                breakScheduleB={currentConfig && getBreaksEnabled(currentConfig) ? breakSchedules?.[idB] : undefined}
                showBreakSchedule={currentConfig && getBreaksEnabled(currentConfig) && breakScheduleVisibleByArea[idA] !== false}
                onToggleBreakSchedule={() =>
                  setBreakScheduleVisibleByArea((prev) => ({
                    ...prev,
                    [idA]: prev[idA] === false,
                  }))
                }
                requiresTrainedOrExpertA={areaRequiresTrainedOrExpert(idA)}
                requiresTrainedOrExpertB={areaRequiresTrainedOrExpert(idB)}
                onRequiresTrainedOrExpertChangeA={(value) => handleAreaRequiresTrainedOrExpertChange(idA, value)}
                onRequiresTrainedOrExpertChangeB={(value) => handleAreaRequiresTrainedOrExpertChange(idB, value)}
              />
            );
          }
          const areaId = section as string;
          return (
            <AreaStaffing
              key={areaId}
              areaId={areaId}
              areaLabel={areaLabels[areaId] ?? areaId}
              minSlots={effectiveCapacity[areaId]?.min ?? 1}
              maxSlots={effectiveCapacity[areaId]?.max ?? 1}
              slotLabels={slotLabelsByArea[areaId]}
              slots={slots[areaId] ?? []}
              roster={roster}
              allAssignedPersonIds={allAssignedPersonIds}
              leadAssignedPersonIds={leadAssignedPersonIds}
              juiced={!!juicedAreas[areaId]}
              deJuiced={!!deJuicedAreas[areaId]}
              onToggleJuice={handleToggleJuice}
              onToggleDeJuice={handleToggleDeJuice}
              onAreaNameChange={handleAreaNameChange}
              onCapacityChange={handleAreaCapacityChange}
              onSlotLabelChange={handleSlotLabelChange}
              sectionTasks={sectionTasks[areaId] ?? []}
              onSlotsChange={setSlotsForArea}
              onSectionTasksChange={setSectionTasksForArea}
              onAssign={setSlotAssignment}
              breakSchedule={currentConfig && getBreaksEnabled(currentConfig) ? breakSchedules?.[areaId] : undefined}
              showBreakSchedule={currentConfig && getBreaksEnabled(currentConfig) && breakScheduleVisibleByArea[areaId] !== false}
              onToggleBreakSchedule={() =>
                setBreakScheduleVisibleByArea((prev) => ({
                  ...prev,
                  [areaId]: prev[areaId] === false,
                }))
              }
              requiresTrainedOrExpert={areaRequiresTrainedOrExpert(areaId)}
              onRequiresTrainedOrExpertChange={(value) => handleAreaRequiresTrainedOrExpertChange(areaId, value)}
            />
          );
        })}
      </div>

      <TrainingReport roster={roster} slots={slots} areaLabels={areaLabels} effectiveCapacity={effectiveCapacity} areaIds={areaIds} />

      <NotesAndDocuments
        dayNotes={dayNotes}
        documents={documents}
        onDayNotesChange={setDayNotes}
        onDocumentsChange={setDocuments}
      />

      <DayTimeline schedule={schedule} onScheduleChange={setSchedule} />

      {currentConfig && getBreaksEnabled(currentConfig) && (() => {
        const rotationCount = getBreakRotations(currentConfig);
        const scope = getBreaksScope(currentConfig);
        if (scope === 'line') {
          const lineAssignments = breakSchedules?.[BREAK_LINE_WIDE_KEY];
          if (!lineAssignments || Object.keys(lineAssignments).length === 0) return null;
          const people = Object.keys(lineAssignments).map((id) => {
            const p = roster.find((r) => r.id === id);
            return { id, name: p?.name ?? id };
          });
          return (
            <BreakTable
              people={people}
              assignments={lineAssignments}
              rotationCount={rotationCount}
              title="Break schedule (line-wide)"
            />
          );
        }
        return (
          <>
            {areaIds.map((areaId) => {
              const assignments = breakSchedules?.[areaId];
              if (!assignments || Object.keys(assignments).length === 0) return null;
              const people = Object.keys(assignments).map((id) => {
                const p = roster.find((r) => r.id === id);
                return { id, name: p?.name ?? id };
              });
              return (
                <BreakTable
                  key={areaId}
                  people={people}
                  assignments={assignments}
                  rotationCount={rotationCount}
                  title={`Break schedule — ${areaLabels[areaId] ?? areaId}`}
                />
              );
            })}
          </>
        );
      })()}

      <div className="save-load-section" style={{ marginBottom: 12 }}>
        <h3 style={{ marginTop: 0 }}>Save &amp; open (file)</h3>
        <p style={{ fontSize: '0.9rem', color: '#555', margin: '0 0 8px 0' }}>
          Save your roster and settings to a real file on your computer. Once saved, use Save again to overwrite the same file. Open loads from a file you previously saved.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          {isSaveToFileSupported() ? (
            <>
              <button type="button" onClick={handleSaveToFile}>Save to file</button>
              {saveMessage && <span style={{ color: '#27ae60', fontWeight: 500 }}>✓ {saveMessage}</span>}
              <button type="button" onClick={handleOpenFromFile}>Open from file</button>
            </>
          ) : (
            <span style={{ fontSize: '0.9rem', color: '#666' }}>
              Save to file is supported in Chrome and Edge. Use the buttons below in other browsers.
            </span>
          )}
        </div>
        <p style={{ fontSize: '0.85rem', color: '#666', margin: '12px 0 8px 0' }}>
          Or download / import a one-off backup (works in any browser):
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <button type="button" onClick={handleExportBackup}>Download backup</button>
          <input
            ref={importFileRef}
            type="file"
            accept=".json,application/json"
            onChange={handleImportBackup}
            style={{ display: 'none' }}
            aria-hidden
          />
          <button type="button" onClick={() => importFileRef.current?.click()}>Import backup</button>
        </div>
      </div>

      <DayBank
        savedDays={savedDays}
        onLoadDay={handleLoadDay}
        onSaveCurrentDay={handleSaveDay}
        onRemoveDay={handleRemoveDay}
      />
    </>
  );
}

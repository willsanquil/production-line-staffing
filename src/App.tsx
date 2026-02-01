import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { AppState, AreaId, BreakPreference, RootState, RosterPerson, SavedDay, SlotsByArea, TaskItem } from './types';
import type { SkillLevel } from './types';
import { AREA_IDS, LINE_SECTIONS } from './types';

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
  leadSlotKeys: string[]
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
  for (const key of leadSlotKeys) {
    const personId = leadSlots[key];
    if (!personId) continue;
    const p = roster.find((r) => r.id === personId);
    if (p) {
      const areaForSkill = /^\d+$/.test(key) ? areaIds[0] : key;
      sum += SKILL_SCORE[p.skills[areaForSkill] ?? 'no_experience'];
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
  areaIdFromName,
  getLeadSlotKeys,
  getLeadSlotLabel,
  getLinkedSlotGroupsForArea,
  getFloatSlotIndicesForArea,
} from './lib/lineConfig';
import { createEmptyPerson, createEmptyOTPerson, createEmptySlot, getEmptyLineState, normalizeSlotsToCapacity, normalizeSlotsToLineCapacity } from './data/initialState';
import { RosterGrid } from './components/RosterGrid';
import { LeadSlotsSection } from './components/LeadSlotsSection';
import { AreaStaffing } from './components/AreaStaffing';
import { CombinedAreaStaffing } from './components/CombinedAreaStaffing';
import { LineView } from './components/LineView';
import { DayBank } from './components/DayBank';
import { TrainingReport } from './components/TrainingReport';
import { randomizeAssignments, spreadTalent, fillRemainingAssignments } from './lib/automation';
import { generateBreakSchedules } from './lib/breakSchedules';
import { saveRootState, loadSavedDays, addSavedDay, removeSavedDay, exportStateToJson, importStateFromJson } from './lib/persist';
import { saveToFile, overwriteFile, openFromFile, isSaveToFileSupported } from './lib/fileStorage';
import { getLineState, setLineState, createCloudLine, deleteCloudLine } from './lib/cloudLines';
import { getCloudSession, setCloudSession, clearCloudSession, EntryScreen } from './components/EntryScreen';
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
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareLinkCopied, setShareLinkCopied] = useState(false);
  const [shareName, setShareName] = useState('');
  const [directLinkPassword, setDirectLinkPassword] = useState('');
  const [directLinkError, setDirectLinkError] = useState<string | null>(null);
  const [directLinkLoading, setDirectLinkLoading] = useState(false);

  const cloudLineFromUrl = useMemo(() => {
    if (typeof window === 'undefined') return null;
    const p = new URLSearchParams(window.location.search);
    return p.get('cloudLine');
  }, []);
  const [sharePassword, setSharePassword] = useState('');
  const [shareError, setShareError] = useState<string | null>(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [showAddStationForm, setShowAddStationForm] = useState(false);
  const [addStationName, setAddStationName] = useState('');
  const [addStationMin, setAddStationMin] = useState(2);
  const [addStationMax, setAddStationMax] = useState(5);
  const [addStationHasLead, setAddStationHasLead] = useState(false);
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
  const leadSlotKeys = useMemo(
    () => (currentConfig ? getLeadSlotKeys(currentConfig) : []),
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
  const lastLocalChangeRef = useRef(0);
  const cloudSaveInProgressRef = useRef(false);

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
        cloudSaveInProgressRef.current = true;
        setLineState(lineId, password, payload)
          .catch((e) => console.error('Cloud save failed:', e))
          .finally(() => {
            cloudSaveInProgressRef.current = false;
          });
      } else {
        saveRootState(payload);
      }
    };
  }, [appMode, cloudLineId, rootState, slots, leadSlots, juicedAreas, deJuicedAreas, sectionTasks, schedule, dayNotes, documents, breakSchedules, areaCapacityOverrides, areaNameOverrides, slotLabelsByArea]);

  // When in cloud mode, poll for updates so other users' changes show up (live-ish updates).
  // Skip applying poll for a while after any local slot/lead change so we don't overwrite the user's
  // edit with stale server state before the debounced save has completed.
  const CLOUD_POLL_MS = 4000;
  const CLOUD_POLL_SKIP_AFTER_LOCAL_CHANGE_MS = 12000;
  useEffect(() => {
    if (appMode !== 'app' || !cloudLineId) return;
    const password = cloudPasswordRef.current;
    if (!password) return;
    const intervalId = setInterval(() => {
      if (Date.now() - lastLocalChangeRef.current < CLOUD_POLL_SKIP_AFTER_LOCAL_CHANGE_MS) return;
      if (cloudSaveInProgressRef.current) return;
      getLineState(cloudLineId, password)
        .then((root) => {
          if (cloudSaveInProgressRef.current) return;
          setRootState(root);
        })
        .catch(() => { /* ignore poll errors (e.g. network) */ });
    }, CLOUD_POLL_MS);
    return () => clearInterval(intervalId);
  }, [appMode, cloudLineId]);

  const allAssignedPersonIds = useMemo(() => getAssignedPersonIds(slots, areaIds), [slots, areaIds]);
  const leadAssignedPersonIds = useMemo(() => {
    const set = new Set<string>();
    for (const key of leadSlotKeys) {
      if (leadSlots[key]) set.add(leadSlots[key]!);
    }
    return set;
  }, [leadSlots, leadSlotKeys]);
  const grandTotal = useMemo(
    () => allAssignedPersonIds.size + leadAssignedPersonIds.size,
    [allAssignedPersonIds, leadAssignedPersonIds]
  );
  const grandTotalPct = useMemo(
    () => (FULL_STAFF > 0 ? Math.round((grandTotal / FULL_STAFF) * 100) : 0),
    [grandTotal]
  );

  const lineHealthScore = useMemo(
    () => getLineHealthScore(slots, leadSlots, roster, areaIds, leadSlotKeys),
    [slots, leadSlots, roster, areaIds, leadSlotKeys]
  );
  const lineHealthSpectrumPosition =
    lineHealthScore != null ? (lineHealthScore / 3) * 100 : null;

  /** Break schedule data for presentation mode: full schedules, rotation count, scope. */
  const presentationBreakData = useMemo(() => {
    if (!currentConfig || !getBreaksEnabled(currentConfig) || !breakSchedules) return null;
    const rotationCount = getBreakRotations(currentConfig);
    const scope = getBreaksScope(currentConfig);
    return { breakSchedules, rotationCount, breaksScope: scope };
  }, [currentConfig, breakSchedules]);

  const setSlotAssignment = useCallback((areaId: AreaId, slotId: string, personId: string | null) => {
    setSlots((prev) => ({
      ...prev,
      [areaId]: prev[areaId].map((s) =>
        s.id === slotId ? { ...s, personId } : s
      ),
    }));
  }, []);

  const setSlotsForArea = useCallback((areaId: AreaId, newSlots: SlotsByArea[AreaId]) => {
    lastLocalChangeRef.current = Date.now();
    setSlots((prev) => ({ ...prev, [areaId]: newSlots }));
  }, []);

  const setSectionTasksForArea = useCallback((areaId: AreaId, tasks: TaskItem[]) => {
    setSectionTasks((prev) => ({ ...prev, [areaId]: tasks }));
  }, []);

  const setLeadSlot = useCallback((areaId: string, personId: string | null) => {
    lastLocalChangeRef.current = Date.now();
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
      for (const key of leadSlotKeys) {
        if (next[key] === personId) next[key] = null;
      }
      return next;
    });
  }, [roster, rootState.lineStates, areaIds, leadSlotKeys]);

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

  const handleAddStation = useCallback(
    (name: string, minSlots: number, maxSlots: number, hasLeadRole: boolean) => {
      const trimmedName = name.trim();
      if (!trimmedName) return;
      const min = Math.max(1, Math.round(minSlots));
      const max = Math.max(1, Math.round(maxSlots));
      const slotsCount = Math.min(min, max);
      setRootState((prev) => {
        const lineIndex = prev.lines.findIndex((l) => l.id === prev.currentLineId);
        if (lineIndex === -1) return prev;
        const line = prev.lines[lineIndex];
        if (line.id === 'ic') return prev;
        const existingIds = new Set(prev.lines.flatMap((l) => l.areas.map((a) => a.id)));
        const areaId = areaIdFromName(trimmedName, existingIds);
        const newArea = {
          id: areaId,
          name: trimmedName,
          minSlots: min,
          maxSlots: max > min ? max : min,
          requiresTrainedOrExpert: false,
        };
        const areas = [...line.areas, newArea];
        const nextLeadAreaIds =
          hasLeadRole && !(line.leadSlotNames && line.leadSlotNames.length > 0)
            ? [...(line.leadAreaIds ?? []), areaId]
            : (line.leadAreaIds ?? []);
        const lines = prev.lines.slice();
        lines[lineIndex] = { ...line, areas, leadAreaIds: nextLeadAreaIds };

        const lineState = prev.lineStates[prev.currentLineId];
        if (!lineState) return { ...prev, lines };
        const newSlots = { ...lineState.slots, [areaId]: Array.from({ length: slotsCount }, () => createEmptySlot()) };
        const newSectionTasks = { ...lineState.sectionTasks, [areaId]: [] };
        const newLeadSlots = hasLeadRole ? { ...lineState.leadSlots, [areaId]: null } : lineState.leadSlots;
        const roster = (lineState.roster ?? []).map((p) => ({
          ...p,
          skills: { ...p.skills, [areaId]: 'no_experience' as SkillLevel },
        }));
        const newLineState = {
          ...lineState,
          slots: newSlots,
          sectionTasks: newSectionTasks,
          leadSlots: newLeadSlots,
          roster,
        };
        const lineStates = { ...prev.lineStates, [prev.currentLineId]: newLineState };
        return { ...prev, lines, lineStates };
      });
    },
    []
  );

  const handleAreaCapacityChange = useCallback((areaId: AreaId, payload: { min?: number; max?: number }) => {
    const base = effectiveCapacity[areaId];
    if (!base) return;
    lastLocalChangeRef.current = Date.now();
    const nextMin = payload.min != null && !Number.isNaN(payload.min) ? Math.max(1, Math.round(payload.min)) : undefined;
    const nextMax = payload.max != null && !Number.isNaN(payload.max) ? Math.max(1, Math.round(payload.max)) : undefined;
    const cap = {
      min: nextMin ?? base.min,
      max: nextMax ?? base.max,
    };
    if (cap.min > cap.max) cap.max = cap.min;
    setAreaCapacityOverrides((prev) => ({
      ...prev,
      [areaId]: { ...prev[areaId], min: cap.min, max: cap.max },
    }));
    setSlots((prev) => {
      const list = prev[areaId] ?? [];
      let nextList = [...list];
      if (cap.max < nextList.length) nextList = nextList.slice(0, cap.max);
      if (cap.min > nextList.length) {
        for (let i = nextList.length; i < cap.min; i++) nextList.push(createEmptySlot());
      }
      return { ...prev, [areaId]: nextList };
    });
  }, [effectiveCapacity]);

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

  const handleRegenerateBreaks = useCallback(() => {
    if (!currentConfig || !getBreaksEnabled(currentConfig)) return;
    const linkedSlotsByArea: Record<string, number[][]> = {};
    const floatSlotIndicesByArea: Record<string, number[]> = {};
    for (const areaId of areaIds) {
      const areaSlots = slots[areaId] ?? [];
      linkedSlotsByArea[areaId] = getLinkedSlotGroupsForArea(currentConfig, areaId, areaSlots.length, slotLabelsByArea);
      floatSlotIndicesByArea[areaId] = getFloatSlotIndicesForArea(currentConfig, areaId, areaSlots.length, slotLabelsByArea);
    }
    setBreakSchedules(
      generateBreakSchedules(roster, slots, areaIds, {
        rotationCount: getBreakRotations(currentConfig),
        scope: getBreaksScope(currentConfig),
        leadSlots,
        linkedSlotsByArea,
        floatSlotIndicesByArea,
      })
    );
  }, [currentConfig, areaIds, slots, roster, leadSlots, slotLabelsByArea]);

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
      leadSlots:
        day.leadSlots ??
        Object.fromEntries((targetConfig ? getLeadSlotKeys(targetConfig) : leadSlotKeys).map((id) => [id, null])),
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
  }, [areaCapacityOverrides, areaNameOverrides, leadSlotKeys, rootState.currentLineId, rootState.lineStates, slotLabelsByArea]);

  const handleRandomize = useCallback(() => {
    const nextSlots = randomizeAssignments(roster, slots, leadAssignedPersonIds, areaIds, areaRequiresTrainedOrExpert);
    setSlots(nextSlots);
    if (currentConfig && getBreaksEnabled(currentConfig)) {
      const linkedSlotsByArea: Record<string, number[][]> = {};
      for (const areaId of areaIds) {
        const areaSlots = nextSlots[areaId] ?? [];
        linkedSlotsByArea[areaId] = getLinkedSlotGroupsForArea(currentConfig, areaId, areaSlots.length, slotLabelsByArea);
      }
      setBreakSchedules(
        generateBreakSchedules(roster, nextSlots, areaIds, {
          rotationCount: getBreakRotations(currentConfig),
          scope: getBreaksScope(currentConfig),
          leadSlots,
          linkedSlotsByArea,
        })
      );
    } else {
      setBreakSchedules({});
    }
  }, [roster, slots, leadAssignedPersonIds, areaIds, currentConfig, leadSlots, areaRequiresTrainedOrExpert, slotLabelsByArea]);

  const handleSpreadTalent = useCallback(() => {
    const nextSlots = spreadTalent(roster, slots, juicedAreas, leadAssignedPersonIds, deJuicedAreas, effectiveCapacity, areaIds, areaRequiresTrainedOrExpert);
    setSlots(nextSlots);
    if (currentConfig && getBreaksEnabled(currentConfig)) {
      const linkedSlotsByArea: Record<string, number[][]> = {};
      const floatSlotIndicesByArea: Record<string, number[]> = {};
      for (const areaId of areaIds) {
        const areaSlots = nextSlots[areaId] ?? [];
        linkedSlotsByArea[areaId] = getLinkedSlotGroupsForArea(currentConfig, areaId, areaSlots.length, slotLabelsByArea);
        floatSlotIndicesByArea[areaId] = getFloatSlotIndicesForArea(currentConfig, areaId, areaSlots.length, slotLabelsByArea);
      }
      setBreakSchedules(
        generateBreakSchedules(roster, nextSlots, areaIds, {
          rotationCount: getBreakRotations(currentConfig),
          scope: getBreaksScope(currentConfig),
          leadSlots,
          linkedSlotsByArea,
          floatSlotIndicesByArea,
        })
      );
    } else {
      setBreakSchedules({});
    }
  }, [roster, slots, juicedAreas, deJuicedAreas, leadAssignedPersonIds, effectiveCapacity, areaIds, currentConfig, leadSlots, slotLabelsByArea]);

  const handleFillRemaining = useCallback(() => {
    const nextSlots = fillRemainingAssignments(roster, slots, juicedAreas, leadAssignedPersonIds, deJuicedAreas, effectiveCapacity, areaIds, areaRequiresTrainedOrExpert);
    setSlots(nextSlots);
    if (currentConfig && getBreaksEnabled(currentConfig)) {
      const linkedSlotsByArea: Record<string, number[][]> = {};
      const floatSlotIndicesByArea: Record<string, number[]> = {};
      for (const areaId of areaIds) {
        const areaSlots = nextSlots[areaId] ?? [];
        linkedSlotsByArea[areaId] = getLinkedSlotGroupsForArea(currentConfig, areaId, areaSlots.length, slotLabelsByArea);
        floatSlotIndicesByArea[areaId] = getFloatSlotIndicesForArea(currentConfig, areaId, areaSlots.length, slotLabelsByArea);
      }
      setBreakSchedules(
        generateBreakSchedules(roster, nextSlots, areaIds, {
          rotationCount: getBreakRotations(currentConfig),
          scope: getBreaksScope(currentConfig),
          leadSlots,
          linkedSlotsByArea,
          floatSlotIndicesByArea,
        })
      );
    } else {
      setBreakSchedules({});
    }
  }, [roster, slots, juicedAreas, deJuicedAreas, leadAssignedPersonIds, effectiveCapacity, areaIds, currentConfig, leadSlots, slotLabelsByArea]);

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
  const addToRosterFileRef = useRef<HTMLInputElement>(null);
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
    setLeadSlots(imported.leadSlots ?? Object.fromEntries(leadSlotKeys.map((id) => [id, null])));
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
  }, [currentConfig, leadSlotKeys]);

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

  const handleAddToRosterFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const text = reader.result as string;
        const imported = importStateFromJson(text);
        if (!imported || !Array.isArray(imported.roster)) {
          alert('Invalid file or no roster in file.');
          e.target.value = '';
          return;
        }
        setRootState((prev) => {
          const lineId = prev.currentLineId;
          const currentRoster = prev.lineStates[lineId]?.roster ?? [];
          const toAdd: RosterPerson[] = (imported.roster as RosterPerson[]).map((p) => {
            const id = Math.random().toString(36).slice(2, 11);
            const skills = { ...p.skills } as Record<AreaId, SkillLevel>;
            for (const aid of areaIds) {
              if (skills[aid] === undefined) skills[aid] = 'no_experience';
            }
            return {
              ...p,
              id,
              skills,
              areasWantToLearn: p.areasWantToLearn ?? [],
              flexedToLineId: null,
            };
          });
          return {
            ...prev,
            lineStates: {
              ...prev.lineStates,
              [lineId]: {
                ...prev.lineStates[lineId],
                roster: [...currentRoster, ...toAdd],
              },
            },
          };
        });
      };
      reader.readAsText(file);
      e.target.value = '';
    },
    [areaIds]
  );

  const handleAddToRoster = useCallback(() => {
    addToRosterFileRef.current?.click();
  }, []);

  const handleLeaveLine = useCallback(() => {
    clearCloudSession();
    setCloudLineId(null);
    cloudPasswordRef.current = null;
    setRootState(getHydratedRootState());
  }, []);

  const handleGoHome = useCallback(() => {
    clearCloudSession();
    setCloudLineId(null);
    cloudPasswordRef.current = null;
    setRootState(getHydratedRootState());
    setAppMode('entry');
  }, []);

  const handleShareSubmit = useCallback(() => {
    if (!shareName.trim() || !sharePassword) {
      setShareError('Name and password required');
      return;
    }
    setShareLoading(true);
    setShareError(null);
    const root = rootStateRef.current;
    const lineId = root.currentLineId;
    const lineConfig = root.lines.find((l) => l.id === lineId);
    const lineState = root.lineStates[lineId];
    if (!lineConfig || !lineState) {
      setShareError('Current line not found');
      setShareLoading(false);
      return;
    }
    const shareRootState: RootState = {
      currentLineId: lineId,
      lines: [lineConfig],
      lineStates: { [lineId]: lineState },
    };
    createCloudLine(shareName.trim(), sharePassword, shareRootState)
      .then(({ lineId: newCloudLineId }) => {
        setCloudSession(newCloudLineId, sharePassword);
        setCloudLineId(newCloudLineId);
        cloudPasswordRef.current = sharePassword;
        setRootState(shareRootState);
        setShowShareModal(false);
        setShareName('');
        setSharePassword('');
      })
      .catch((e) => setShareError(e instanceof Error ? e.message : String(e)))
      .finally(() => setShareLoading(false));
  }, [shareName, sharePassword]);

  const handleDeleteCloudLine = useCallback(() => {
    const password = cloudPasswordRef.current;
    if (!cloudLineId || !password) return;
    const msg = 'Are you sure you want to delete this line from the cloud? Anyone with the password can delete it. This cannot be undone.';
    if (!window.confirm(msg)) return;
    deleteCloudLine(cloudLineId, password)
      .then(() => {
        clearCloudSession();
        setCloudLineId(null);
        cloudPasswordRef.current = null;
        setRootState(getHydratedRootState());
        setAppMode('entry');
      })
      .catch((e) => alert(e instanceof Error ? e.message : String(e)));
  }, [cloudLineId]);

  const handleCopyShareLink = useCallback(() => {
    if (!cloudLineId) return;
    const url = `${window.location.origin}${window.location.pathname}?cloudLine=${cloudLineId}`;
    navigator.clipboard.writeText(url).then(() => {
      setShareLinkCopied(true);
      setTimeout(() => setShareLinkCopied(false), 3000);
    }).catch(() => {
      alert(`Share this link:\n\n${url}`);
    });
  }, [cloudLineId]);

  const handleDirectLinkView = useCallback(() => {
    if (!cloudLineFromUrl || !directLinkPassword.trim()) {
      setDirectLinkError('Enter the line password');
      return;
    }
    setDirectLinkError(null);
    setDirectLinkLoading(true);
    getLineState(cloudLineFromUrl, directLinkPassword.trim())
      .then((root) => {
        setRootState(root);
        setCloudLineId(cloudLineFromUrl);
        cloudPasswordRef.current = directLinkPassword.trim();
        setCloudSession(cloudLineFromUrl, directLinkPassword.trim());
        setAdminVisible(false);
        setAppMode('app');
        if (typeof window !== 'undefined' && window.history.replaceState) {
          const url = new URL(window.location.href);
          url.searchParams.delete('cloudLine');
          window.history.replaceState({}, '', url.pathname + url.search);
        }
      })
      .catch((e) => setDirectLinkError(e instanceof Error ? e.message : String(e)))
      .finally(() => setDirectLinkLoading(false));
  }, [cloudLineFromUrl, directLinkPassword]);

  if (appMode === 'entry') {
    if (cloudLineFromUrl) {
      return (
        <div style={{ padding: 24, maxWidth: 400, margin: '0 auto', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.5rem', marginBottom: 8 }}>View this line</h1>
          <p style={{ color: '#666', marginBottom: 20 }}>Enter the line password to view the staffing sheet.</p>
          {directLinkError && (
            <div style={{ background: '#fee', padding: 12, borderRadius: 8, marginBottom: 16 }}>{directLinkError}</div>
          )}
          <div style={{ marginBottom: 16 }}>
            <input
              type="password"
              value={directLinkPassword}
              onChange={(e) => setDirectLinkPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleDirectLinkView()}
              placeholder="Line password"
              style={{ width: '100%', padding: '12px 14px', fontSize: '1rem', borderRadius: 8, border: '1px solid #ccc', boxSizing: 'border-box' }}
              autoFocus
            />
          </div>
          <button
            type="button"
            onClick={handleDirectLinkView}
            disabled={directLinkLoading || !directLinkPassword.trim()}
            style={{ padding: '12px 24px', fontSize: '1rem', fontWeight: 600, borderRadius: 8, border: 'none', background: '#1a73e8', color: '#fff', cursor: 'pointer' }}
          >
            {directLinkLoading ? 'Loading…' : 'View'}
          </button>
          <p style={{ marginTop: 24 }}>
            <button
              type="button"
              onClick={() => window.location.assign(window.location.pathname)}
              style={{ padding: '8px 16px', fontSize: '0.9rem', background: 'transparent', border: '1px solid #ccc', borderRadius: 8, cursor: 'pointer' }}
            >
              Use app normally
            </button>
          </p>
        </div>
      );
    }
    const entryExistingAreaIds = new Set(rootState.lines.flatMap((l) => l.areas.map((a) => a.id)));
    return (
      <EntryScreen
        existingAreaIds={entryExistingAreaIds}
        onSelectLocal={() => setAppMode('app')}
        onJoinGroup={(root, lineId, password) => {
          setRootState(root);
          setCloudLineId(lineId);
          cloudPasswordRef.current = password;
          setAppMode('app');
        }}
        onJoinGroupPresentation={(root, lineId, password) => {
          setRootState(root);
          setCloudLineId(lineId);
          cloudPasswordRef.current = password;
          setAdminVisible(false);
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
          <button type="button" onClick={handleGoHome} style={{ padding: '8px 16px' }}>
            Home
          </button>
        </header>
        <LineManager
          rootState={rootState}
          canShare={!cloudLineId}
          onShareClick={() => {
            setShareName(currentConfig?.name ?? '');
            setSharePassword('');
            setShareError(null);
            setShowShareModal(true);
          }}
          onOpenLine={handleOpenLine}
          onBuildNew={handleBuildNewLine}
          onDeleteLine={handleDeleteLine}
          onBack={() => setView('staffing')}
        />
        {showShareModal && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000,
            }}
            onClick={() => !shareLoading && setShowShareModal(false)}
          >
            <div
              style={{
                background: '#fff',
                padding: 24,
                borderRadius: 12,
                maxWidth: 400,
                width: '90%',
                boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h2 style={{ marginTop: 0, marginBottom: 16 }}>Share line to cloud</h2>
              {shareError && (
                <div style={{ background: '#fee', padding: 10, borderRadius: 8, marginBottom: 12 }}>{shareError}</div>
              )}
              <label style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>Line name</label>
              <input
                type="text"
                value={shareName}
                onChange={(e) => setShareName(e.target.value)}
                placeholder="e.g. IC Line"
                style={{ width: '100%', padding: '10px 12px', marginBottom: 12, boxSizing: 'border-box' }}
              />
              <label style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>Password</label>
              <input
                type="password"
                value={sharePassword}
                onChange={(e) => setSharePassword(e.target.value)}
                placeholder="Others need this to join"
                style={{ width: '100%', padding: '10px 12px', marginBottom: 16, boxSizing: 'border-box' }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={handleShareSubmit} disabled={shareLoading} style={{ padding: '10px 18px', fontWeight: 600 }}>
                  {shareLoading ? 'Sharing…' : 'Share'}
                </button>
                <button type="button" onClick={() => setShowShareModal(false)} disabled={shareLoading} style={{ padding: '10px 18px' }}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  if (view === 'build-line') {
    const existingAreaIds = new Set(rootState.lines.flatMap((l) => l.areas.map((a) => a.id)));
    return (
      <>
        <header className="app-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <span>Production Line Staffing</span>
          <button type="button" onClick={handleGoHome} style={{ padding: '8px 16px' }}>
            Home
          </button>
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
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={handleGoHome} style={{ padding: '8px 16px' }}>
              Home
            </button>
            <button type="button" onClick={() => setView('line-manager')} style={{ padding: '8px 16px' }}>
              Lines
            </button>
          </div>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button" onClick={handleGoHome} style={{ padding: '6px 12px', fontSize: '0.9rem' }}>
              Home
            </button>
          {cloudLineId && (
            <>
              <button type="button" onClick={handleCopyShareLink} style={{ padding: '6px 12px', fontSize: '0.9rem', background: shareLinkCopied ? '#27ae60' : undefined, color: shareLinkCopied ? '#fff' : undefined }}>
                {shareLinkCopied ? 'Link Copied!' : 'Share Link'}
              </button>
              <button type="button" onClick={handleLeaveLine} style={{ padding: '6px 12px', fontSize: '0.9rem' }}>
                Leave line
              </button>
              <button
                type="button"
                onClick={handleDeleteCloudLine}
                title="Remove this line from the cloud (requires password)"
                style={{ padding: '6px 12px', fontSize: '0.9rem', color: '#c0392b', borderColor: '#c0392b' }}
              >
                Delete line from cloud
              </button>
            </>
          )}
          <button type="button" onClick={() => setView('line-manager')}>
            Lines
          </button>
          <button
            type="button"
            onClick={() => setAdminVisible(true)}
              style={{ padding: '8px 16px', fontSize: '1rem', fontWeight: 600 }}
            >
              Show admin
            </button>
          </div>
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
          leadSlotKeys={leadSlotKeys}
          getLeadSlotLabel={(key) => getLeadSlotLabel(currentConfig!, key, areaLabels)}
          getSlotLabel={getSlotLabel}
          areaRequiresTrainedOrExpert={areaRequiresTrainedOrExpert}
          breakSchedules={presentationBreakData?.breakSchedules}
          rotationCount={presentationBreakData?.rotationCount}
          breaksScope={presentationBreakData?.breaksScope}
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button type="button" onClick={handleGoHome} style={{ padding: '6px 12px', fontSize: '0.9rem' }}>
            Home
          </button>
          {cloudLineId && (
            <>
              <button type="button" onClick={handleLeaveLine} style={{ padding: '6px 12px', fontSize: '0.9rem' }}>
                Leave line
              </button>
              <button
                type="button"
                onClick={handleDeleteCloudLine}
                title="Remove this line from the cloud"
                style={{ padding: '6px 12px', fontSize: '0.9rem', color: '#c0392b', borderColor: '#c0392b' }}
              >
                Delete line from cloud
              </button>
            </>
          )}
          <button type="button" onClick={() => setView('line-manager')}>
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
        </div>
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
        saveMessage={saveMessage}
        onSaveToFile={handleSaveToFile}
        onOpenFromFile={handleOpenFromFile}
        onAddToRoster={handleAddToRoster}
        isSaveToFileSupported={isSaveToFileSupported}
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
          leadSlotKeys={leadSlotKeys}
          getLeadSlotLabel={(key) => getLeadSlotLabel(currentConfig!, key, areaLabels)}
          areaIds={areaIds}
          onLeadSlotChange={setLeadSlot}
        />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" onClick={handleSpreadTalent}>Spread talent</button>
        <button type="button" onClick={handleFillRemaining}>Fill remaining</button>
        <button type="button" onClick={handleRandomize}>Randomize</button>
        {/* STRETCH temporarily disabled
        <button type="button" onClick={handleStretch} title="Push team outside comfort zone; prefer areas they want to learn">STRETCH</button>
        */}
        <button type="button" onClick={handleClearLine}>Clear line</button>
        {currentConfig && getBreaksEnabled(currentConfig) && (
          <button type="button" onClick={handleRegenerateBreaks} title="Regenerate break schedule from current assignments and preferences">
            Regenerate breaks
          </button>
        )}
      </div>

      {currentConfig && currentConfig.id !== 'ic' && (
        <div style={{ marginBottom: 16 }}>
          {!showAddStationForm ? (
            <button
              type="button"
              onClick={() => setShowAddStationForm(true)}
              style={{ padding: '8px 14px', fontSize: '0.95rem' }}
            >
              + Add station
            </button>
          ) : (
            <div
              style={{
                background: '#f8f9fa',
                border: '1px solid #dee2e6',
                borderRadius: 8,
                padding: 14,
                maxWidth: 420,
              }}
            >
              <h3 style={{ margin: '0 0 10px 0', fontSize: '1rem' }}>Add station</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 10 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ minWidth: 70 }}>Name</span>
                  <input
                    type="text"
                    value={addStationName}
                    onChange={(e) => setAddStationName(e.target.value)}
                    placeholder="e.g. Assembly"
                    style={{ padding: '6px 10px', width: 140 }}
                    autoFocus
                  />
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ minWidth: 70 }}>Min slots</span>
                  <input
                    type="number"
                    min={1}
                    value={addStationMin}
                    onChange={(e) => setAddStationMin(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    style={{ padding: '6px 10px', width: 56 }}
                  />
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ minWidth: 70 }}>Max slots</span>
                  <input
                    type="number"
                    min={1}
                    value={addStationMax}
                    onChange={(e) => setAddStationMax(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    style={{ padding: '6px 10px', width: 56 }}
                  />
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={addStationHasLead}
                    onChange={(e) => setAddStationHasLead(e.target.checked)}
                  />
                  <span>Has lead role</span>
                </label>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => {
                    handleAddStation(addStationName, addStationMin, addStationMax, addStationHasLead);
                    setAddStationName('');
                    setAddStationMin(2);
                    setAddStationMax(5);
                    setAddStationHasLead(false);
                    setShowAddStationForm(false);
                  }}
                  disabled={!addStationName.trim()}
                  style={{ padding: '6px 14px', fontWeight: 600 }}
                >
                  Add
                </button>
                <button type="button" onClick={() => setShowAddStationForm(false)} style={{ padding: '6px 14px' }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

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
              requiresTrainedOrExpert={areaRequiresTrainedOrExpert(areaId)}
              onRequiresTrainedOrExpertChange={(value) => handleAreaRequiresTrainedOrExpertChange(areaId, value)}
            />
          );
        })}
      </div>

      <TrainingReport roster={roster} slots={slots} areaLabels={areaLabels} effectiveCapacity={effectiveCapacity} areaIds={areaIds} />

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
        <input
          ref={addToRosterFileRef}
          type="file"
          accept=".json,application/json"
          onChange={handleAddToRosterFileChange}
          style={{ display: 'none' }}
          aria-hidden
        />
        <p style={{ fontSize: '0.85rem', color: '#666', margin: '0 0 8px 0' }}>
          Download or import a one-off backup (works in any browser):
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

import { lazy, Suspense, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { AppState, AreaId, BreakPreference, FloatSlotConfig, RootState, RosterPerson, SavedDay, SlotsByArea } from './types';
import type { SkillLevel } from './types';
import { SKILL_SCORE } from './lib/skill';

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
import { getSlotLabel as getSlotLabelIC } from './lib/areaConfig';
import {
  getAreaIds,
  getLineSections,
  getRosterAreaIds,
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
  getFloatSlots,
  LEAD_COVERAGE_PREFIX,
} from './lib/lineConfig';
import { createEmptyPerson, createEmptyOTPerson, createEmptySlot, getEmptyLineState, normalizeSlotsToCapacity, normalizeSlotsToLineCapacity } from './data/initialState';
import { RosterGrid } from './components/RosterGrid';
import { LeadSlotsSection } from './components/LeadSlotsSection';
import { AreaStaffing } from './components/AreaStaffing';
import { CombinedAreaStaffing } from './components/CombinedAreaStaffing';
import { UnslottedBank } from './components/UnslottedBank';
import { DayBank } from './components/DayBank';
import { randomizeAssignments, applyDefaultPositionsThenSpread, fillRemainingAssignments } from './lib/automation';
import { generateBreakSchedules, optimizeFloatBreakRotations } from './lib/breakSchedules';
import { clearAreaAssignments } from './lib/slots';
import { loadSavedDays, addSavedDay, removeSavedDay, exportStateToJson, importStateFromJson } from './lib/persist';
import { saveToFile, overwriteFile, openFromFile, isSaveToFileSupported } from './lib/fileStorage';
import { getLineState, createCloudLine, deleteCloudLine, listCloudLines } from './lib/cloudLines';
import { getCloudSession, setCloudSession, clearCloudSession } from './lib/cloudSession';
import { BreakTable } from './components/BreakTable';
import { PersonProfileModal } from './components/PersonProfileModal';
import { TrainingReport } from './components/TrainingReport';
import { useCloudLineSync } from './hooks/useCloudLineSync';
import { buildPersistedRootState, extractLineDraftState } from './lib/lineDraftState';

const PERSIST_DEBOUNCE_MS = 300;

const LineManager = lazy(() => import('./components/LineManager').then((mod) => ({ default: mod.LineManager })));
const EntryScreen = lazy(() => import('./components/EntryScreen').then((mod) => ({ default: mod.EntryScreen })));
const BuildLineWizard = lazy(() => import('./components/BuildLineWizard').then((mod) => ({ default: mod.BuildLineWizard })));
const LineView = lazy(() => import('./components/LineView').then((mod) => ({ default: mod.LineView })));
const StaffTheLineWizard = lazy(() => import('./components/StaffTheLineWizard').then((mod) => ({ default: mod.StaffTheLineWizard })));

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
  const [leadBreakCoverage, setLeadBreakCoverage] = useState<Record<string, boolean>>(firstLineState.leadBreakCoverage ?? {});
  const [areaBreakCoverageEnabled, setAreaBreakCoverageEnabled] = useState<Record<string, boolean>>(firstLineState.areaBreakCoverageEnabled ?? {});
  const [savedDays, setSavedDays] = useState(() => loadSavedDays());
  const [rosterVisible, setRosterVisible] = useState(true);
  const [adminVisible, setAdminVisible] = useState(true);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareLinkCopied, setShareLinkCopied] = useState(false);
  const [shareName, setShareName] = useState('');
  const [directLinkPassword, setDirectLinkPassword] = useState('');
  const [directLinkError, setDirectLinkError] = useState<string | null>(null);
  const [directLinkLoading, setDirectLinkLoading] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importLineId, setImportLineId] = useState('');
  const [importPassword, setImportPassword] = useState('');
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importLines, setImportLines] = useState<{ id: string; name: string }[]>([]);

  const cloudLineFromUrl = useMemo(() => {
    if (typeof window === 'undefined') return null;
    const p = new URLSearchParams(window.location.search);
    return p.get('cloudLine');
  }, []);
  const [sharePassword, setSharePassword] = useState('');
  const [shareError, setShareError] = useState<string | null>(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [showAddStationForm, setShowAddStationForm] = useState(false);
  const [showFloatSupportModal, setShowFloatSupportModal] = useState(false);
  const [floatSupportDraft, setFloatSupportDraft] = useState<FloatSlotConfig[] | null>(null);
  const [addStationName, setAddStationName] = useState('');
  const [addStationMin, setAddStationMin] = useState(2);
  const [addStationMax, setAddStationMax] = useState(5);
  const [addStationHasLead, setAddStationHasLead] = useState(false);
  const [areaCapacityOverrides, setAreaCapacityOverrides] = useState(firstLineState.areaCapacityOverrides ?? {});
  const [areaNameOverrides, setAreaNameOverrides] = useState(firstLineState.areaNameOverrides ?? {});
  const [slotLabelsByArea, setSlotLabelsByArea] = useState(firstLineState.slotLabelsByArea ?? {});
  const [areaRequiresTrainedOrExpertOverrides, setAreaRequiresTrainedOrExpertOverrides] = useState(firstLineState.areaRequiresTrainedOrExpertOverrides ?? {});
  const [slotBreakCoverageEnabled, setSlotBreakCoverageEnabled] = useState(firstLineState.slotBreakCoverageEnabled ?? {});
  const [profilePersonId, setProfilePersonId] = useState<string | null>(null);
  const [showStaffTheLineWizard, setShowStaffTheLineWizard] = useState(false);
  const [undoSnapshot, setUndoSnapshot] = useState<{
    label: string;
    slots: SlotsByArea;
    leadSlots: Record<string, string | null>;
    breakSchedules: NonNullable<AppState['breakSchedules']>;
  } | null>(null);
  /** When false, area cards show only slot names + assignee (simple view). When true, full configure UI. */
  const [configureMode, setConfigureMode] = useState(false);

  const currentConfig = useMemo(
    () => rootState.lines.find((l) => l.id === rootState.currentLineId),
    [rootState.lines, rootState.currentLineId]
  );
  /** Effective config for the current line. IC/NIC are no longer special-cased — any line
   * (including the seeds) is fully editable: areas/floats/leads can be added, edited, or deleted. */
  const effectiveConfig = useMemo(() => currentConfig ?? null, [currentConfig]);
  const areaIds = useMemo(
    () => (effectiveConfig ? getAreaIds(effectiveConfig) : []),
    [effectiveConfig]
  );
  const rosterAreaIds = useMemo(
    () => (effectiveConfig ? getRosterAreaIds(effectiveConfig) : []),
    [effectiveConfig]
  );
  const lineSections = useMemo(
    () => (effectiveConfig ? getLineSections(effectiveConfig) : []),
    [effectiveConfig]
  );
  const leadSlotKeys = useMemo(
    () => (effectiveConfig ? getLeadSlotKeys(effectiveConfig) : []),
    [effectiveConfig]
  );
  const effectiveCapacity = useMemo(
    () =>
      effectiveConfig
        ? getEffectiveCapacityForLine(effectiveConfig, areaCapacityOverrides)
        : ({} as Record<string, { min: number; max: number }>),
    [effectiveConfig, areaCapacityOverrides]
  );
  // Full staff = user override, or leads + sum of all areas' min capacity
  const [fullStaffOverride, setFullStaffOverride] = useState<number | null>(null);
  const computedFullStaff = useMemo(() => {
    const minSlots = Object.values(effectiveCapacity).reduce((sum, cap) => sum + cap.min, 0);
    return leadSlotKeys.length + minSlots;
  }, [effectiveCapacity, leadSlotKeys]);
  const fullStaff = fullStaffOverride ?? computedFullStaff;
  const areaLabels = useMemo(
    () =>
      effectiveConfig
        ? getEffectiveAreaLabelsForLine(effectiveConfig, areaNameOverrides)
        : {},
    [effectiveConfig, areaNameOverrides]
  );
  const getSlotLabel = useCallback(
    (areaId: string, slotIndex: number) =>
      effectiveConfig
        ? getSlotLabelForLine(effectiveConfig, areaId, slotIndex, slotLabelsByArea)
        : getSlotLabelIC(areaId, slotIndex, slotLabelsByArea),
    [effectiveConfig, slotLabelsByArea]
  );
  const areaRequiresTrainedOrExpert = useCallback(
    (areaId: string) => {
      if (areaRequiresTrainedOrExpertOverrides[areaId] !== undefined) return areaRequiresTrainedOrExpertOverrides[areaId];
      return effectiveConfig ? areaRequiresTrainedOrExpertFromConfig(effectiveConfig, areaId) : true;
    },
    [effectiveConfig, areaRequiresTrainedOrExpertOverrides]
  );

  const roster = useMemo(
    () => sortByFirstName(getRosterForLine(rootState.currentLineId, rootState.lineStates)),
    [rootState.currentLineId, rootState.lineStates]
  );
  const flexedInPersonIds = useMemo(
    () => getFlexedInPersonIds(rootState.currentLineId, rootState.lineStates),
    [rootState.currentLineId, rootState.lineStates]
  );

  const stateRef = useRef(extractLineDraftState(firstLineState));
  stateRef.current = { slots, leadSlots, juicedAreas, deJuicedAreas, sectionTasks, schedule, dayNotes, documents, breakSchedules, leadBreakCoverage, areaBreakCoverageEnabled, areaCapacityOverrides, areaNameOverrides, slotLabelsByArea, areaRequiresTrainedOrExpertOverrides, slotBreakCoverageEnabled };
  const rootStateRef = useRef(rootState);
  rootStateRef.current = rootState;

  /** Counter incremented when the entire line state should be reloaded from rootState
   * (e.g. cloud poll received new data, or initial cloud load). Prevents roster-only
   * updates (like break preference) from clobbering local slot/lead state. */
  const [lineStateReloadKey, setLineStateReloadKey] = useState(0);
  const reloadLineState = useCallback(() => setLineStateReloadKey((k) => k + 1), []);

  const {
    cloudConflictBanner,
    markLocalChange,
    schedulePersistForRootEdit,
    setCloudUpdatedAt,
  } = useCloudLineSync({
    appMode,
    setAppMode,
    cloudLineId,
    setCloudLineId,
    cloudPasswordRef,
    rootStateRef,
    draftStateRef: stateRef,
    setRootState,
    reloadLineState,
    persistDebounceMs: PERSIST_DEBOUNCE_MS,
    persistDeps: [slots, leadSlots, juicedAreas, deJuicedAreas, sectionTasks, schedule, dayNotes, documents, breakSchedules, areaBreakCoverageEnabled, areaCapacityOverrides, areaNameOverrides, slotLabelsByArea, areaRequiresTrainedOrExpertOverrides, slotBreakCoverageEnabled],
  });

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
    setLeadBreakCoverage(lineState.leadBreakCoverage ?? {});
    setAreaBreakCoverageEnabled(lineState.areaBreakCoverageEnabled ?? {});
    setAreaCapacityOverrides(lineState.areaCapacityOverrides ?? {});
    setAreaNameOverrides(lineState.areaNameOverrides ?? {});
    setSlotLabelsByArea(lineState.slotLabelsByArea ?? {});
    setAreaRequiresTrainedOrExpertOverrides(lineState.areaRequiresTrainedOrExpertOverrides ?? {});
    setSlotBreakCoverageEnabled(lineState.slotBreakCoverageEnabled ?? {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootState.currentLineId, lineStateReloadKey]);

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
    () => (fullStaff > 0 ? Math.round((grandTotal / fullStaff) * 100) : 0),
    [grandTotal, fullStaff]
  );

  const lineHealthScore = useMemo(
    () => getLineHealthScore(slots, leadSlots, roster, areaIds, leadSlotKeys),
    [slots, leadSlots, roster, areaIds, leadSlotKeys]
  );
  const lineHealthSpectrumPosition =
    lineHealthScore != null ? (lineHealthScore / 3) * 100 : null;

  /** Break schedule data for presentation mode: full schedules, rotation count, scope. */
  const presentationBreakData = useMemo(() => {
    if (!effectiveConfig || !getBreaksEnabled(effectiveConfig) || !breakSchedules) return null;
    const rotationCount = getBreakRotations(effectiveConfig);
    const scope = getBreaksScope(effectiveConfig);
    return { breakSchedules, rotationCount, breaksScope: scope };
  }, [effectiveConfig, breakSchedules]);

  /** Float slots for presentation: real floats + synthetic lead floats (if coverage enabled). */
  const presentationFloatSlots = useMemo(() => {
    if (!effectiveConfig) return [];
    const real = getFloatSlots(effectiveConfig);
    const scope = getBreaksScope(effectiveConfig);
    if (scope !== 'station') return real;
    const synthetic: FloatSlotConfig[] = [];
    const stationAreaIds = effectiveConfig.areas.map((a) => a.id);
    for (const key of leadSlotKeys) {
      if (!leadBreakCoverage[key] || !leadSlots[key]) continue;
      const label = getLeadSlotLabel(effectiveConfig, key, areaLabels);
      synthetic.push({ id: `${LEAD_COVERAGE_PREFIX}${key}`, name: `Lead: ${label}`, supportedAreaIds: stationAreaIds });
    }
    return [...real, ...synthetic];
  }, [effectiveConfig, leadSlotKeys, leadBreakCoverage, leadSlots, areaLabels]);

  /** Slots for presentation: real slots + synthetic lead float slots. */
  const presentationSlots = useMemo(() => {
    if (!effectiveConfig) return slots;
    const scope = getBreaksScope(effectiveConfig);
    if (scope !== 'station') return slots;
    const augmented: SlotsByArea = { ...slots };
    for (const key of leadSlotKeys) {
      if (!leadBreakCoverage[key]) continue;
      const personId = leadSlots[key];
      if (!personId) continue;
      const syntheticId = `${LEAD_COVERAGE_PREFIX}${key}`;
      augmented[syntheticId] = [{ id: `${syntheticId}_s0`, personId }];
    }
    return augmented;
  }, [effectiveConfig, slots, leadSlotKeys, leadBreakCoverage, leadSlots]);

  /** Linked slot groups for presentation: per area, groups of slot indices sharing a label. */
  const presentationLinkedSlots = useMemo(() => {
    if (!effectiveConfig) return {};
    const result: Record<string, number[][]> = {};
    for (const area of effectiveConfig.areas) {
      const areaSlots = slots[area.id] ?? [];
      const groups = getLinkedSlotGroupsForArea(effectiveConfig, area.id, areaSlots.length, slotLabelsByArea);
      if (groups.length > 0) result[area.id] = groups;
    }
    return result;
  }, [effectiveConfig, slots, slotLabelsByArea]);

  const captureUndoSnapshot = useCallback((label: string) => {
    const state = stateRef.current;
    setUndoSnapshot({
      label,
      slots: JSON.parse(JSON.stringify(state.slots)) as SlotsByArea,
      leadSlots: JSON.parse(JSON.stringify(state.leadSlots)) as Record<string, string | null>,
      breakSchedules: JSON.parse(JSON.stringify(state.breakSchedules ?? {})) as NonNullable<AppState['breakSchedules']>,
    });
  }, []);

  const handleUndoLastAction = useCallback(() => {
    if (!undoSnapshot) return;
    markLocalChange();
    setSlots(undoSnapshot.slots);
    setLeadSlots(undoSnapshot.leadSlots);
    setBreakSchedules(undoSnapshot.breakSchedules);
    setUndoSnapshot(null);
  }, [markLocalChange, undoSnapshot]);

  const setSlotAssignment = useCallback((areaId: AreaId, slotId: string, personId: string | null) => {
    markLocalChange();
    setSlots((prev) => ({
      ...prev,
      [areaId]: prev[areaId].map((s) =>
        s.id === slotId ? { ...s, personId } : s
      ),
    }));
  }, [markLocalChange]);

  const setSlotsForArea = useCallback((areaId: AreaId, newSlots: SlotsByArea[AreaId]) => {
    markLocalChange();
    setSlots((prev) => ({ ...prev, [areaId]: newSlots }));
  }, [markLocalChange]);

  const setLeadSlot = useCallback((areaId: string, personId: string | null) => {
    markLocalChange();
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
  }, [areaIds, markLocalChange]);

  const handleToggleLeadBreakCoverage = useCallback((key: string, enabled: boolean) => {
    markLocalChange();
    setLeadBreakCoverage((prev) => ({ ...prev, [key]: enabled }));
  }, [markLocalChange]);

  const handleToggleSlotBreakCoverage = useCallback((areaId: string, slotId: string, enabled: boolean) => {
    markLocalChange();
    setSlotBreakCoverageEnabled((prev) => ({
      ...prev,
      [areaId]: { ...(prev[areaId] ?? {}), [slotId]: enabled },
    }));
  }, [markLocalChange]);

  const handleNameChange = useCallback((personId: string, name: string) => {
    setRootState((prev) => updatePersonInRoot(prev, personId, (p) => ({ ...p, name: name.trim() || p.name })));
    schedulePersistForRootEdit();
  }, [schedulePersistForRootEdit]);

  const handleAddPerson = useCallback((name: string) => {
    const person = createEmptyPerson(name, areaIds);
    setRootState((prev) => {
      const lineState = prev.lineStates[prev.currentLineId];
      const roster = [...(lineState?.roster ?? []), person];
      return { ...prev, lineStates: { ...prev.lineStates, [prev.currentLineId]: { ...lineState, roster } } };
    });
    schedulePersistForRootEdit();
  }, [areaIds, schedulePersistForRootEdit]);

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
      schedulePersistForRootEdit();
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
  }, [roster, rootState.lineStates, areaIds, leadSlotKeys, schedulePersistForRootEdit]);

  const handleToggleAbsent = useCallback((personId: string, absent: boolean) => {
    setRootState((prev) => updatePersonInRoot(prev, personId, (p) => ({ ...p, absent })));
    schedulePersistForRootEdit();
  }, [schedulePersistForRootEdit]);

  const handleToggleLead = useCallback((personId: string, lead: boolean) => {
    setRootState((prev) => updatePersonInRoot(prev, personId, (p) => ({ ...p, lead })));
    schedulePersistForRootEdit();
  }, [schedulePersistForRootEdit]);

  const handleToggleOT = useCallback((personId: string, ot: boolean) => {
    setRootState((prev) =>
      updatePersonInRoot(prev, personId, (p) => ({ ...p, ot, otHereToday: ot ? false : p.otHereToday }))
    );
    schedulePersistForRootEdit();
  }, [schedulePersistForRootEdit]);

  const handleToggleOTHereToday = useCallback((personId: string, otHereToday: boolean) => {
    setRootState((prev) => updatePersonInRoot(prev, personId, (p) => ({ ...p, otHereToday })));
    schedulePersistForRootEdit();
  }, [schedulePersistForRootEdit]);

  const handleAddOT = useCallback((name: string) => {
    const person = createEmptyOTPerson(name, areaIds);
    setRootState((prev) => {
      const lineState = prev.lineStates[prev.currentLineId];
      const roster = [...(lineState?.roster ?? []), person];
      return { ...prev, lineStates: { ...prev.lineStates, [prev.currentLineId]: { ...lineState, roster } } };
    });
    schedulePersistForRootEdit();
  }, [areaIds, schedulePersistForRootEdit]);

  const handleToggleLate = useCallback((personId: string, late: boolean) => {
    setRootState((prev) => updatePersonInRoot(prev, personId, (p) => ({ ...p, late })));
    schedulePersistForRootEdit();
  }, [schedulePersistForRootEdit]);

  const handleToggleLeavingEarly = useCallback((personId: string, leavingEarly: boolean) => {
    setRootState((prev) => updatePersonInRoot(prev, personId, (p) => ({ ...p, leavingEarly })));
    schedulePersistForRootEdit();
  }, [schedulePersistForRootEdit]);

  const handleFlexedToLineChange = useCallback((personId: string, lineId: string | null) => {
    setRootState((prev) =>
      updatePersonInRoot(prev, personId, (p) => ({ ...p, flexedToLineId: lineId || undefined }))
    );
    schedulePersistForRootEdit();
  }, [schedulePersistForRootEdit]);

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
    schedulePersistForRootEdit();
  }, [schedulePersistForRootEdit]);

  const handleSkillChange = useCallback((personId: string, areaId: AreaId, level: SkillLevel) => {
    setRootState((prev) =>
      updatePersonInRoot(prev, personId, (p) => ({ ...p, skills: { ...p.skills, [areaId]: level } }))
    );
    schedulePersistForRootEdit();
  }, [schedulePersistForRootEdit]);

  const handleAreasWantToLearnChange = useCallback((personId: string, areaId: AreaId, checked: boolean) => {
    setRootState((prev) =>
      updatePersonInRoot(prev, personId, (p) => {
        const list = p.areasWantToLearn ?? [];
        if (checked) return { ...p, areasWantToLearn: list.includes(areaId) ? list : [...list, areaId] };
        return { ...p, areasWantToLearn: list.filter((a) => a !== areaId) };
      })
    );
    schedulePersistForRootEdit();
  }, [schedulePersistForRootEdit]);

  const handleOpenProfile = useCallback((personId: string) => {
    setProfilePersonId(personId);
  }, []);

  const handleCloseProfile = useCallback(() => {
    setProfilePersonId(null);
  }, []);

  const handleDefaultPositionChange = useCallback(
    (personId: string, areaId: string | null, slotIndex: number | null) => {
      setRootState((prev) =>
        updatePersonInRoot(prev, personId, (p) => ({
          ...p,
          defaultAreaId: areaId ?? null,
          defaultSlotIndex: slotIndex ?? null,
        }))
      );
      schedulePersistForRootEdit();
    },
    [schedulePersistForRootEdit]
  );

  const handleAreaRequiresTrainedOrExpertChange = useCallback((areaId: string, value: boolean) => {
    setAreaRequiresTrainedOrExpertOverrides((prev) => ({ ...prev, [areaId]: value }));
    const line = rootState.lines.find((l) => l.id === rootState.currentLineId);
    const areaIndex = line?.areas?.findIndex((a) => a.id === areaId) ?? -1;
    if (areaIndex >= 0 && line) {
      setRootState((prev) => {
        const lineIndex = prev.lines.findIndex((l) => l.id === prev.currentLineId);
        if (lineIndex === -1) return prev;
        const ln = prev.lines[lineIndex];
        const areas = ln.areas.slice();
        areas[areaIndex] = { ...areas[areaIndex], requiresTrainedOrExpert: value };
        const lines = prev.lines.slice();
        lines[lineIndex] = { ...ln, areas };
        return { ...prev, lines };
      });
    }
    schedulePersistForRootEdit();
  }, [schedulePersistForRootEdit, rootState.lines, rootState.currentLineId]);

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
    schedulePersistForRootEdit();
    },
    [schedulePersistForRootEdit]
  );

  /** Delete an area (category) from the current line. Scrubs the area id from line config,
   * line state, all per-area override maps, break schedules, and any roster defaults. The
   * area's skill column on roster.skills[areaId] is intentionally left in place so re-adding
   * an area with the same id later preserves prior skill data. */
  const handleRemoveStation = useCallback((areaId: string) => {
    setRootState((prev) => {
      const lineIndex = prev.lines.findIndex((l) => l.id === prev.currentLineId);
      if (lineIndex === -1) return prev;
      const line = prev.lines[lineIndex];
      if (!line.areas.some((a) => a.id === areaId)) return prev;
      const areas = line.areas.filter((a) => a.id !== areaId);
      const combinedSections = (line.combinedSections ?? []).filter(
        ([a, b]) => a !== areaId && b !== areaId
      );
      const leadAreaIds = (line.leadAreaIds ?? []).filter((id) => id !== areaId);
      const floatSlots = line.floatSlots?.map((f) => ({
        ...f,
        supportedAreaIds: f.supportedAreaIds.filter((id) => id !== areaId),
      }));
      const lines = prev.lines.slice();
      lines[lineIndex] = {
        ...line,
        areas,
        combinedSections,
        leadAreaIds,
        floatSlots,
      };

      const lineState = prev.lineStates[prev.currentLineId];
      if (!lineState) return { ...prev, lines };

      const dropKey = <T extends Record<string, unknown>>(obj: T | undefined): T | undefined => {
        if (!obj || !(areaId in obj)) return obj;
        const next = { ...obj } as Record<string, unknown>;
        delete next[areaId];
        return next as T;
      };

      const nextSlots = { ...lineState.slots };
      delete nextSlots[areaId];
      const nextSectionTasks = { ...lineState.sectionTasks };
      delete (nextSectionTasks as Record<string, unknown>)[areaId];
      const nextLeadSlots = { ...lineState.leadSlots };
      delete nextLeadSlots[areaId];

      const roster = (lineState.roster ?? []).map((p) =>
        p.defaultAreaId === areaId ? { ...p, defaultAreaId: null, defaultSlotIndex: null } : p
      );

      const newLineState = {
        ...lineState,
        slots: nextSlots,
        sectionTasks: nextSectionTasks,
        leadSlots: nextLeadSlots,
        roster,
        juicedAreas: dropKey(lineState.juicedAreas) ?? {},
        deJuicedAreas: dropKey(lineState.deJuicedAreas) ?? {},
        breakSchedules: dropKey(lineState.breakSchedules) ?? {},
        areaBreakCoverageEnabled: dropKey(lineState.areaBreakCoverageEnabled),
        areaCapacityOverrides: dropKey(lineState.areaCapacityOverrides),
        areaNameOverrides: dropKey(lineState.areaNameOverrides),
        slotLabelsByArea: dropKey(lineState.slotLabelsByArea),
        areaRequiresTrainedOrExpertOverrides: dropKey(lineState.areaRequiresTrainedOrExpertOverrides),
        slotBreakCoverageEnabled: dropKey(lineState.slotBreakCoverageEnabled),
      };
      const lineStates = { ...prev.lineStates, [prev.currentLineId]: newLineState };
      return { ...prev, lines, lineStates };
    });
    schedulePersistForRootEdit();
  }, [schedulePersistForRootEdit]);

  /** Move the section containing areaId one step left (-1) or right (+1) in display order.
   * Operates on the section list (so a combined section moves as a unit) and rebuilds
   * line.areas so the underlying ordering matches. No-op at boundaries. */
  const handleMoveStation = useCallback((areaId: string, direction: -1 | 1) => {
    setRootState((prev) => {
      const lineIndex = prev.lines.findIndex((l) => l.id === prev.currentLineId);
      if (lineIndex === -1) return prev;
      const line = prev.lines[lineIndex];
      const sections = getLineSections(line);
      const sectionIndex = sections.findIndex((s) =>
        Array.isArray(s) ? s.includes(areaId) : s === areaId
      );
      if (sectionIndex === -1) return prev;
      const targetIndex = sectionIndex + direction;
      if (targetIndex < 0 || targetIndex >= sections.length) return prev;
      const newSections = sections.slice();
      [newSections[sectionIndex], newSections[targetIndex]] = [newSections[targetIndex], newSections[sectionIndex]];
      const orderedIds: string[] = [];
      for (const s of newSections) {
        if (Array.isArray(s)) orderedIds.push(s[0], s[1]);
        else orderedIds.push(s as string);
      }
      const byId = new Map(line.areas.map((a) => [a.id, a]));
      const reorderedAreas = orderedIds
        .map((id) => byId.get(id))
        .filter((a): a is NonNullable<typeof a> => a != null);
      // Defensive: append any areas missing from sections (shouldn't happen) so we never lose data.
      for (const a of line.areas) {
        if (!orderedIds.includes(a.id)) reorderedAreas.push(a);
      }
      const lines = prev.lines.slice();
      lines[lineIndex] = { ...line, areas: reorderedAreas };
      return { ...prev, lines };
    });
    schedulePersistForRootEdit();
  }, [schedulePersistForRootEdit]);

  const handleUpdateFloatSlots = useCallback((nextFloatSlots: FloatSlotConfig[]) => {
    setRootState((prev) => {
      const lineIndex = prev.lines.findIndex((l) => l.id === prev.currentLineId);
      if (lineIndex === -1) return prev;
      const line = prev.lines[lineIndex];
      const lines = prev.lines.slice();
      lines[lineIndex] = { ...line, floatSlots: nextFloatSlots.length > 0 ? nextFloatSlots : undefined };
      const lineState = prev.lineStates[prev.currentLineId];
      if (!lineState) return { ...prev, lines };
      // Ensure each float has a slot in line state (for newly added floats)
      const newSlots = { ...lineState.slots };
      let changed = false;
      for (const f of nextFloatSlots) {
        if (!newSlots[f.id] || newSlots[f.id].length === 0) {
          newSlots[f.id] = [createEmptySlot()];
          changed = true;
        }
      }
      if (!changed) return { ...prev, lines };
      const lineStates = { ...prev.lineStates, [prev.currentLineId]: { ...lineState, slots: newSlots } };
      return { ...prev, lines, lineStates };
    });
    setShowFloatSupportModal(false);
    schedulePersistForRootEdit();
  }, [schedulePersistForRootEdit]);

  const handleAreaCapacityChange = useCallback((areaId: AreaId, payload: { min?: number; max?: number }) => {
    const base = effectiveCapacity[areaId];
    if (!base) return;
    markLocalChange();
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
  }, [effectiveCapacity, markLocalChange]);

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
    captureUndoSnapshot('Clear line');
    setSlots((prev) => {
      let next = prev;
      for (const areaId of areaIds) {
        next = clearAreaAssignments(next, areaId);
      }
      return next;
    });
    setBreakSchedules({});
  }, [areaIds, captureUndoSnapshot]);

  const handleClearArea = useCallback((areaId: AreaId) => {
    markLocalChange();
    setSlots((prev) => clearAreaAssignments(prev, areaId));
  }, [markLocalChange]);

  const regenerateBreaksForSlots = useCallback((nextSlots: SlotsByArea) => {
    if (!effectiveConfig || !getBreaksEnabled(effectiveConfig)) {
      setBreakSchedules({});
      return;
    }

    // Always generate break schedules for ALL areas — everyone needs break rotations.
    // The areaBreakCoverageEnabled toggle only controls which areas get float/lead COVERAGE.
    const linkedSlotsByArea: Record<string, number[][]> = {};
    const floatSlotIndicesByArea: Record<string, number[]> = {};
    for (const areaId of areaIds) {
      const areaSlots = nextSlots[areaId] ?? [];
      linkedSlotsByArea[areaId] = getLinkedSlotGroupsForArea(effectiveConfig, areaId, areaSlots.length, slotLabelsByArea);
      floatSlotIndicesByArea[areaId] = getFloatSlotIndicesForArea(effectiveConfig, areaId, areaSlots.length, slotLabelsByArea);
    }
    const floatSlots = getFloatSlots(effectiveConfig);
    for (const f of floatSlots) {
      floatSlotIndicesByArea[f.id] = [0];
    }

    // Collect area IDs that have any slot with break coverage enabled — float/lead coverage applies only to these.
    const scope = getBreaksScope(effectiveConfig);
    const coverageEnabledAreaIds = areaIds.filter((id) => {
      const slotMap = slotBreakCoverageEnabled[id];
      return slotMap && Object.values(slotMap).some(Boolean);
    });
    const floatSupportedAreaIds = new Set<string>(coverageEnabledAreaIds);
    if (scope === 'station') {
      for (const key of leadSlotKeys) {
        if (leadBreakCoverage[key] && leadSlots[key]) {
          for (const areaId of coverageEnabledAreaIds) floatSupportedAreaIds.add(areaId);
          break; // all coverage-enabled areas added, no need to continue
        }
      }
    }

    // Include float slot IDs so floats themselves get break rotations assigned.
    // Leads acting as coverage do NOT get break rotations — they break outside the schedule.
    const areaIdsWithFloats = [...areaIds, ...floatSlots.map((f) => f.id)];

    const rotationCount = getBreakRotations(effectiveConfig);
    const rawSchedules = generateBreakSchedules(roster, nextSlots, areaIdsWithFloats, {
      rotationCount,
      scope,
      leadSlots,
      linkedSlotsByArea,
      floatSlotIndicesByArea,
      floatSupportedAreaIds,
    });
    setBreakSchedules(
      optimizeFloatBreakRotations(rawSchedules, floatSlots, nextSlots, rotationCount)
    );
  }, [effectiveConfig, areaIds, roster, leadSlots, leadBreakCoverage, slotBreakCoverageEnabled, slotLabelsByArea, leadSlotKeys]);

  // Recalc breaks whenever slot or lead assignments change (no manual "Regenerate breaks" needed).
  useEffect(() => {
    if (appMode !== 'app' || !effectiveConfig || !getBreaksEnabled(effectiveConfig)) return;
    regenerateBreaksForSlots(slots);
  }, [appMode, effectiveConfig, slots, leadSlots, regenerateBreaksForSlots]);

  const handleSaveDay = useCallback((date: string, name?: string) => {
    const state = stateRef.current;
    addSavedDay(
      date,
      { roster, slots: state.slots, leadSlots: state.leadSlots, juicedAreas: state.juicedAreas, deJuicedAreas: state.deJuicedAreas, sectionTasks: state.sectionTasks, schedule: state.schedule, dayNotes: state.dayNotes, documents: state.documents, breakSchedules: state.breakSchedules, leadBreakCoverage: state.leadBreakCoverage, areaBreakCoverageEnabled: state.areaBreakCoverageEnabled, areaRequiresTrainedOrExpertOverrides: state.areaRequiresTrainedOrExpertOverrides, slotBreakCoverageEnabled: state.slotBreakCoverageEnabled },
      name,
      rootState.currentLineId
    );
    setSavedDays(loadSavedDays());
  }, [roster, rootState.currentLineId]);

  const handleLoadDay = useCallback((day: SavedDay) => {
    const targetLineId = day.lineId ?? rootState.currentLineId;
    const targetConfig = rootState.lines.find((l) => l.id === targetLineId);
    const normalizedSlots = targetConfig
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
      leadBreakCoverage: day.leadBreakCoverage ?? {},
      areaBreakCoverageEnabled: day.areaBreakCoverageEnabled ?? {},
      areaRequiresTrainedOrExpertOverrides: day.areaRequiresTrainedOrExpertOverrides ?? {},
      slotBreakCoverageEnabled: day.slotBreakCoverageEnabled ?? {},
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
          // Preserve original flexedToLineId: null means "home" on this line,
          // a different lineId means flexed in from that line.
          flexedToLineId: p.flexedToLineId ?? null,
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
    setLeadBreakCoverage(lineStateForDay.leadBreakCoverage ?? {});
    setAreaBreakCoverageEnabled(lineStateForDay.areaBreakCoverageEnabled ?? {});
    setAreaRequiresTrainedOrExpertOverrides(lineStateForDay.areaRequiresTrainedOrExpertOverrides ?? {});
    setSlotBreakCoverageEnabled(lineStateForDay.slotBreakCoverageEnabled ?? {});
    // Force a reload so the useEffect at line 276 re-syncs all local state from rootState
    setLineStateReloadKey((k) => k + 1);
  }, [areaCapacityOverrides, areaNameOverrides, leadSlotKeys, rootState.currentLineId, rootState.lines, rootState.lineStates, slotLabelsByArea]);

  const handleRandomize = useCallback(() => {
    captureUndoSnapshot('Randomize');
    const nextSlots = randomizeAssignments(roster, slots, leadAssignedPersonIds, areaIds, areaRequiresTrainedOrExpert);
    setSlots(nextSlots);
    regenerateBreaksForSlots(nextSlots);
  }, [captureUndoSnapshot, roster, slots, leadAssignedPersonIds, areaIds, areaRequiresTrainedOrExpert, regenerateBreaksForSlots]);

  const handleDefaultPositions = useCallback(() => {
    captureUndoSnapshot('Default positions');
    // Fill empty lead slots with people configured as lead (by default leads go into lead slots)
    const newLeadSlots = { ...leadSlots };
    const usedLeadIds = new Set<string>();
    for (const key of leadSlotKeys) {
      if (newLeadSlots[key]) {
        usedLeadIds.add(newLeadSlots[key]!);
        continue;
      }
      const leadPerson = roster.find(
        (p) =>
          p.lead &&
          !p.absent &&
          (!p.ot || p.otHereToday) &&
          !usedLeadIds.has(p.id)
      );
      if (leadPerson) {
        newLeadSlots[key] = leadPerson.id;
        usedLeadIds.add(leadPerson.id);
      }
    }
    const newLeadAssignedPersonIds = new Set<string>(Object.values(newLeadSlots).filter(Boolean) as string[]);
    setLeadSlots(newLeadSlots);
    const nextSlots = applyDefaultPositionsThenSpread(roster, slots, juicedAreas, newLeadAssignedPersonIds, deJuicedAreas, effectiveCapacity, areaIds, areaRequiresTrainedOrExpert);
    setSlots(nextSlots);
    regenerateBreaksForSlots(nextSlots);
  }, [captureUndoSnapshot, roster, slots, juicedAreas, deJuicedAreas, leadSlots, leadSlotKeys, effectiveCapacity, areaIds, areaRequiresTrainedOrExpert, regenerateBreaksForSlots]);

  const handleFillRemaining = useCallback(() => {
    captureUndoSnapshot('Fill remaining');
    const nextSlots = fillRemainingAssignments(roster, slots, juicedAreas, leadAssignedPersonIds, deJuicedAreas, effectiveCapacity, areaIds, areaRequiresTrainedOrExpert);
    setSlots(nextSlots);
    regenerateBreaksForSlots(nextSlots);
  }, [captureUndoSnapshot, roster, slots, juicedAreas, deJuicedAreas, leadAssignedPersonIds, effectiveCapacity, areaIds, areaRequiresTrainedOrExpert, regenerateBreaksForSlots]);

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
    schedulePersistForRootEdit();
  }, [rootState.lines, rootState.currentLineId, schedulePersistForRootEdit]);

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
      effectiveConfig
        ? normalizeSlotsToLineCapacity(imported.slots, effectiveConfig, imported.areaCapacityOverrides)
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
    setLeadBreakCoverage(imported.leadBreakCoverage ?? {});
    setAreaBreakCoverageEnabled(imported.areaBreakCoverageEnabled ?? {});
    setAreaRequiresTrainedOrExpertOverrides(imported.areaRequiresTrainedOrExpertOverrides ?? {});
    setSlotBreakCoverageEnabled(imported.slotBreakCoverageEnabled ?? {});
    setAreaCapacityOverrides(imported.areaCapacityOverrides ?? {});
    setAreaNameOverrides(imported.areaNameOverrides ?? {});
    setSlotLabelsByArea(imported.slotLabelsByArea ?? {});
    setSavedDays(loadSavedDays());
  }, [effectiveConfig, leadSlotKeys]);

  const handleSaveToFile = useCallback(async () => {
    const root = buildPersistedRootState(rootStateRef.current, stateRef.current);
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
        schedulePersistForRootEdit();
      };
      reader.readAsText(file);
      e.target.value = '';
    },
    [areaIds, schedulePersistForRootEdit]
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
      .then(({ lineId: newCloudLineId, rootState: normalizedRootState, updatedAt, version }) => {
        setCloudSession(newCloudLineId, sharePassword);
        setCloudLineId(newCloudLineId);
        cloudPasswordRef.current = sharePassword;
        setCloudUpdatedAt(updatedAt ?? null, version);
        setRootState(normalizedRootState);
        reloadLineState();
        setShowShareModal(false);
        setShareName('');
        setSharePassword('');
      })
      .catch((e) => setShareError(e instanceof Error ? e.message : String(e)))
      .finally(() => setShareLoading(false));
  }, [reloadLineState, setCloudUpdatedAt, shareName, sharePassword]);

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

  const handleOpenImportModal = useCallback(() => {
    setImportLineId('');
    setImportPassword('');
    setImportError(null);
    setShowImportModal(true);
    listCloudLines()
      .then((lines) => setImportLines(lines.filter((l) => l.id !== cloudLineId)))
      .catch(() => setImportLines([]));
  }, [cloudLineId]);

  const handleImportFromCloudLine = useCallback(() => {
    if (!importLineId || !importPassword.trim()) {
      setImportError('Select a line and enter its password');
      return;
    }
    setImportError(null);
    setImportLoading(true);
    getLineState(importLineId, importPassword.trim())
      .then(({ rootState: importedRoot }) => {
        const importedLineState = importedRoot.lineStates[importedRoot.currentLineId];
        const importedRoster = importedLineState?.roster ?? [];
        const importedLineConfig = importedRoot.lines.find((l) => l.id === importedRoot.currentLineId);
        const importedAreaIds = importedLineConfig?.areas.map((a) => a.id) ?? [];
        
        setRootState((prev) => {
          const currentLineState = prev.lineStates[prev.currentLineId];
          const currentRoster = currentLineState?.roster ?? [];
          const currentNameMap = new Map(currentRoster.map((p) => [p.name.toLowerCase().trim(), p]));
          
          const updatedRoster = [...currentRoster];
          for (const importedPerson of importedRoster) {
            const nameKey = importedPerson.name.toLowerCase().trim();
            const existing = currentNameMap.get(nameKey);
            if (existing) {
              // Merge skills - add skills from imported areas
              const mergedSkills = { ...existing.skills };
              for (const areaId of importedAreaIds) {
                const importedSkill = importedPerson.skills[areaId];
                if (importedSkill && importedSkill !== 'no_experience') {
                  mergedSkills[areaId] = importedSkill;
                }
              }
              const idx = updatedRoster.findIndex((p) => p.id === existing.id);
              if (idx >= 0) {
                updatedRoster[idx] = { ...updatedRoster[idx], skills: mergedSkills };
              }
            } else {
              // Add new person with new ID
              const newId = Math.random().toString(36).slice(2, 11);
              updatedRoster.push({
                ...importedPerson,
                id: newId,
                flexedToLineId: undefined,
              });
            }
          }
          
          return {
            ...prev,
            lineStates: {
              ...prev.lineStates,
              [prev.currentLineId]: { ...currentLineState, roster: updatedRoster },
            },
          };
        });
        
        setShowImportModal(false);
        alert(`Imported ${importedRoster.length} people from the other line. People with matching names had their skills merged.`);
      })
      .catch((e) => setImportError(e instanceof Error ? e.message : String(e)))
      .finally(() => setImportLoading(false));
  }, [importLineId, importPassword]);

  const handleDirectLinkView = useCallback(() => {
    if (!cloudLineFromUrl || !directLinkPassword.trim()) {
      setDirectLinkError('Enter the line password');
      return;
    }
    setDirectLinkError(null);
    setDirectLinkLoading(true);
    getLineState(cloudLineFromUrl, directLinkPassword.trim())
      .then(({ rootState: root, updatedAt, version }) => {
        setCloudUpdatedAt(updatedAt || null, version);
        setRootState(root);
        setCloudLineId(cloudLineFromUrl);
        cloudPasswordRef.current = directLinkPassword.trim();
        setCloudSession(cloudLineFromUrl, directLinkPassword.trim());
        reloadLineState();
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
  }, [cloudLineFromUrl, directLinkPassword, reloadLineState, setCloudUpdatedAt]);

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
            className="btn-primary"
            onClick={handleDirectLinkView}
            disabled={directLinkLoading || !directLinkPassword.trim()}
            style={{ padding: '12px 24px', fontSize: '1rem' }}
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
      <Suspense fallback={<div style={{ padding: 48, textAlign: 'center' }}>Loading…</div>}>
        <EntryScreen
          existingAreaIds={entryExistingAreaIds}
          onSelectLocal={() => setAppMode('app')}
          onJoinGroup={(root, lineId, password, cursor) => {
            setRootState(root);
            setCloudLineId(lineId);
            cloudPasswordRef.current = password;
            setCloudUpdatedAt(cursor?.updatedAt ?? null, cursor?.version);
            reloadLineState();
            setAppMode('app');
          }}
          onJoinGroupPresentation={(root, lineId, password, cursor) => {
            setRootState(root);
            setCloudLineId(lineId);
            cloudPasswordRef.current = password;
            setCloudUpdatedAt(cursor?.updatedAt ?? null, cursor?.version);
            reloadLineState();
            setAdminVisible(false);
            setAppMode('app');
          }}
        />
      </Suspense>
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
        <header className="app-header">
          <span>Production Line Staffing</span>
          <button type="button" onClick={handleGoHome}>
            Home
          </button>
        </header>
        <Suspense fallback={<div style={{ padding: 24 }}>Loading lines…</div>}>
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
        </Suspense>
        {showShareModal && (
          <div
            className="modal-overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby="share-line-title"
            onClick={() => !shareLoading && setShowShareModal(false)}
          >
            <div
              className="modal-dialog"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 id="share-line-title" style={{ marginTop: 0, marginBottom: 16 }}>Share line to cloud</h2>
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
                <button type="button" className="btn-primary" onClick={handleShareSubmit} disabled={shareLoading}>
                  {shareLoading ? 'Sharing…' : 'Share'}
                </button>
                <button type="button" className="btn-ghost" onClick={() => setShowShareModal(false)} disabled={shareLoading}>
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
        <header className="app-header">
          <span>Production Line Staffing</span>
          <button type="button" onClick={handleGoHome}>
            Home
          </button>
        </header>
        <Suspense fallback={<div style={{ padding: 24 }}>Loading builder…</div>}>
          <BuildLineWizard
            existingAreaIds={existingAreaIds}
            onComplete={handleBuildLineComplete}
            onCancel={handleBuildLineCancel}
          />
        </Suspense>
      </>
    );
  }

  if (!currentConfig) {
    return (
      <>
        <header className="app-header">
          <span>Production Line Staffing</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={handleGoHome}>
              Home
            </button>
            <button type="button" onClick={() => setView('line-manager')}>
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
        <header className="app-header">
          <span>Production Line Staffing — {currentConfig.name}{cloudLineId ? ' (Group)' : ''}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button" onClick={handleGoHome}>
              Home
            </button>
          {cloudLineId && (
            <>
              <button type="button" onClick={handleCopyShareLink} style={shareLinkCopied ? { background: '#27ae60', color: '#fff' } : undefined}>
                {shareLinkCopied ? 'Link Copied!' : 'Share Link'}
              </button>
              <button type="button" onClick={handleLeaveLine}>
                Leave line
              </button>
              <button
                type="button"
                className="btn-danger"
                onClick={handleDeleteCloudLine}
                title="Delete this shared line after confirmation"
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
            className="btn-primary"
            onClick={() => setAdminVisible(true)}
            >
              Admin View
            </button>
          </div>
        </header>
        <Suspense fallback={<div style={{ padding: 24 }}>Loading staffing view…</div>}>
          <LineView
            slots={presentationSlots}
            roster={roster}
            leadSlots={leadSlots}
            areaLabels={areaLabels}
            slotLabelsByArea={slotLabelsByArea}
            effectiveCapacity={effectiveCapacity}
            totalOnLine={grandTotal}
            fullStaff={fullStaff}
            staffingPct={grandTotalPct}
            lineHealthScore={lineHealthScore}
            lineSections={[...lineSections]}
            leadSlotKeys={leadSlotKeys}
            getLeadSlotLabel={(key) => getLeadSlotLabel(effectiveConfig!, key, areaLabels)}
            getSlotLabel={getSlotLabel}
            areaRequiresTrainedOrExpert={areaRequiresTrainedOrExpert}
            breakSchedules={presentationBreakData?.breakSchedules}
            rotationCount={presentationBreakData?.rotationCount}
            breaksScope={presentationBreakData?.breaksScope}
            floatSlots={presentationFloatSlots}
            linkedSlotsByArea={presentationLinkedSlots}
            areaBreakCoverageEnabled={areaBreakCoverageEnabled}
            slotBreakCoverageEnabled={slotBreakCoverageEnabled}
          />
        </Suspense>
      </>
    );
  }

  return (
    <>
      <header className="app-header">
        <span>Production Line Staffing — {currentConfig.name}{cloudLineId ? ' (Group)' : ''}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button type="button" onClick={handleGoHome}>
            Home
          </button>
          {cloudLineId && (
            <>
              <button type="button" onClick={handleLeaveLine}>
                Leave line
              </button>
              <button
                type="button"
                className="btn-danger"
                onClick={handleDeleteCloudLine}
                title="Delete this shared line after confirmation"
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
            title="Presentation view for screenshot or phone"
          >
            Staffing View
          </button>
        </div>
      </header>

      {cloudConflictBanner && (
        <div
          role="alert"
          style={{
            background: 'var(--color-accent-primary-light)',
            color: 'var(--color-text-primary)',
            padding: '12px 16px',
            textAlign: 'center',
            borderBottom: '1px solid var(--color-border-default)',
          }}
        >
          Someone else saved changes to this line. Your view has been updated.
        </div>
      )}

      <RosterGrid
        roster={roster}
        flexedInPersonIds={flexedInPersonIds}
        visible={rosterVisible}
        areaLabels={areaLabels}
        areaIds={rosterAreaIds}
        floatSlots={effectiveConfig ? getFloatSlots(effectiveConfig) : []}
        lines={rootState.lines}
        currentLineId={rootState.currentLineId}
        onToggleVisible={() => setRosterVisible((v) => !v)}
        onNameChange={handleNameChange}
        onRemovePerson={handleRemovePerson}
        onAddPerson={handleAddPerson}
        onAddOT={handleAddOT}
        onToggleAbsent={handleToggleAbsent}
        onToggleOT={handleToggleOT}
        onToggleOTHereToday={handleToggleOTHereToday}
        onSkillChange={handleSkillChange}
        onFlexedToLineChange={handleFlexedToLineChange}
        saveMessage={saveMessage}
        onSaveToFile={handleSaveToFile}
        onOpenFromFile={handleOpenFromFile}
        onAddToRoster={handleAddToRoster}
        isSaveToFileSupported={isSaveToFileSupported}
        onImportFromCloudLine={handleOpenImportModal}
        isCloudMode={!!cloudLineId}
        onOpenProfile={handleOpenProfile}
      />

      <div className="totals-and-leads-row" style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', marginBottom: 12 }}>
        <div className="grand-total" style={{ marginBottom: 0, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span>Total people on line: {grandTotal} ({grandTotalPct}%) — Full staff:</span>
          <input
            type="number"
            min={1}
            value={fullStaff}
            onChange={(e) => {
              const v = e.target.valueAsNumber;
              if (!Number.isNaN(v) && v >= 1) {
                setFullStaffOverride(v);
              } else {
                setFullStaffOverride(null);
              }
            }}
            style={{ width: 52, padding: '2px 6px', fontSize: 'inherit', fontWeight: 700 }}
            title={`Computed: ${computedFullStaff}. Edit to override.`}
            aria-label="Full staff count"
          />
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
          getLeadSlotLabel={(key) => getLeadSlotLabel(effectiveConfig!, key, areaLabels)}
          areaIds={areaIds}
          onLeadSlotChange={setLeadSlot}
          leadBreakCoverage={leadBreakCoverage}
          onToggleLeadBreakCoverage={handleToggleLeadBreakCoverage}
          showBreakCoverageToggle={!!effectiveConfig && getBreaksEnabled(effectiveConfig)}
        />
      </div>

      <div className="action-toolbar">
        <button type="button" className="btn-primary" onClick={() => setShowStaffTheLineWizard(true)} title="Quick setup: mark absences and disable stations">
          Staff the line
        </button>
        <button type="button" className="btn-primary" onClick={handleDefaultPositions}>Default positions</button>
        <button type="button" className="btn-primary" onClick={handleFillRemaining}>Fill remaining</button>
        <button type="button" className="btn-primary" onClick={handleRandomize}>Randomize</button>
        <button type="button" className="btn-ghost" onClick={handleUndoLastAction} disabled={!undoSnapshot}>
          Undo{undoSnapshot ? ` ${undoSnapshot.label}` : ''}
        </button>
        {/* STRETCH temporarily disabled
        <button type="button" onClick={handleStretch} title="Push team outside comfort zone; prefer areas they want to learn">STRETCH</button>
        */}
        <button type="button" className="btn-danger" onClick={handleClearLine}>Clear line</button>
      </div>

      {currentConfig && (
        <div style={{ marginBottom: 16, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              setFloatSupportDraft(
                (currentConfig.floatSlots ?? []).map((f) => ({ ...f, supportedAreaIds: [...f.supportedAreaIds] }))
              );
              setShowFloatSupportModal(true);
            }}
          >
            {getFloatSlots(effectiveConfig ?? currentConfig).length === 0 ? 'Add float' : 'Float support'}
          </button>
          <button
            type="button"
            className={configureMode ? 'btn-primary' : 'btn-ghost'}
            onClick={() => setConfigureMode((c) => !c)}
            title={configureMode ? 'Switch to simple view (slot names + people only)' : 'Show On/Lock, needs, knowledge bar, etc.'}
          >
            {configureMode ? 'Simple view' : 'Configure mode'}
          </button>
          {!showAddStationForm ? (
            <button
              type="button"
              className="btn-primary"
              onClick={() => setShowAddStationForm(true)}
            >
              + Add station
            </button>
          ) : null}
          {showAddStationForm ? (
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
                  className="btn-primary"
                >
                  Add
                </button>
                <button type="button" className="btn-ghost" onClick={() => setShowAddStationForm(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {showFloatSupportModal && floatSupportDraft !== null && currentConfig && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="float-support-title"
          onClick={() => {
            setShowFloatSupportModal(false);
            setFloatSupportDraft(null);
          }}
        >
          <div
            className="modal-dialog"
            style={{ maxHeight: '85vh', overflow: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="float-support-title" style={{ margin: '0 0 16px 0', fontSize: '1.1rem' }}>Float support</h3>
            <p style={{ color: '#555', fontSize: '0.9rem', marginBottom: 16 }}>
              {floatSupportDraft.length === 0
                ? 'Add float positions so people can support multiple areas and cover breaks when needed.'
                : 'Choose which areas each float supports. They work across these areas and can cover breaks when an area can\'t cover its own.'}
            </p>
            {floatSupportDraft.map((f, i) => (
              <div
                key={f.id}
                style={{
                  border: '1px solid #e0e0e0',
                  borderRadius: 8,
                  padding: 12,
                  marginBottom: 12,
                }}
              >
                <input
                  type="text"
                  value={f.name}
                  onChange={(e) =>
                    setFloatSupportDraft((prev) =>
                      prev ? prev.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) : null
                    )
                  }
                  placeholder="Float name"
                  style={{ width: '100%', padding: '6px 10px', marginBottom: 8 }}
                />
                <div style={{ fontSize: '0.85rem', color: '#555', marginBottom: 6 }}>Supports:</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {(effectiveConfig ?? currentConfig).areas.map((a) => {
                    const checked = f.supportedAreaIds.includes(a.id);
                    return (
                      <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            setFloatSupportDraft((prev) =>
                              prev
                                ? prev.map((x, j) =>
                                    j !== i
                                      ? x
                                      : {
                                          ...x,
                                          supportedAreaIds: e.target.checked
                                            ? [...x.supportedAreaIds, a.id]
                                            : x.supportedAreaIds.filter((id) => id !== a.id),
                                        }
                                  )
                                : null
                            );
                          }}
                        />
                        <span>{a.name}</span>
                      </label>
                    );
                  })}
                </div>
                <button
                  type="button"
                  className="btn-danger"
                  onClick={() =>
                    setFloatSupportDraft((prev) =>
                      prev ? prev.filter((_, j) => j !== i) : null
                    )
                  }
                  style={{ marginTop: 8 }}
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => {
                const existingIds = new Set((floatSupportDraft ?? []).map((x) => x.id));
                let id = `float_${Math.random().toString(36).slice(2, 9)}`;
                while (existingIds.has(id)) id = `float_${Math.random().toString(36).slice(2, 9)}`;
                setFloatSupportDraft((prev) => [
                  ...(prev ?? []),
                  {
                    id,
                    name: `Float ${(prev?.length ?? 0) + 1}`,
                    supportedAreaIds: (effectiveConfig ?? currentConfig) ? (effectiveConfig ?? currentConfig)!.areas.map((a) => a.id) : [],
                  },
                ]);
              }}
              style={{ marginBottom: 16 }}
            >
              {floatSupportDraft.length === 0 ? '+ Add float' : '+ Add another float'}
            </button>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  handleUpdateFloatSlots(floatSupportDraft);
                  setFloatSupportDraft(null);
                }}
              >
                Save
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  setShowFloatSupportModal(false);
                  setFloatSupportDraft(null);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showStaffTheLineWizard && currentConfig && (
        <Suspense fallback={null}>
          <StaffTheLineWizard
            roster={roster}
            lineSections={[...lineSections]}
            slots={slots}
            areaLabels={areaLabels}
            getSlotLabel={getSlotLabel}
            onMarkAbsent={handleToggleAbsent}
            onToggleOTHereToday={handleToggleOTHereToday}
            onSetSlotsForArea={setSlotsForArea}
            onClose={() => setShowStaffTheLineWizard(false)}
            onStaffComplete={handleDefaultPositions}
          />
        </Suspense>
      )}

      {profilePersonId && (
        <PersonProfileModal
          personId={profilePersonId}
          lines={rootState.lines}
          lineStates={rootState.lineStates}
          currentLineId={rootState.currentLineId}
          onClose={handleCloseProfile}
          onToggleLead={handleToggleLead}
          onToggleLate={handleToggleLate}
          onToggleLeavingEarly={handleToggleLeavingEarly}
          onBreakPreferenceChange={handleBreakPreferenceChange}
          onSkillChange={handleSkillChange}
          onDefaultPositionChange={handleDefaultPositionChange}
          onAreasWantToLearnChange={handleAreasWantToLearnChange}
          onFlexedToLineChange={handleFlexedToLineChange}
        />
      )}

      <div className="areas-with-bank">
      <div className="areas-grid">
        {lineSections.map((section, sectionIdx) => {
          const isCombined = Array.isArray(section);
          const isFirst = sectionIdx === 0;
          const isLast = sectionIdx === lineSections.length - 1;
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
                onClearArea={handleClearArea}
                onDeleteArea={configureMode ? handleRemoveStation : undefined}
                onMoveLeft={configureMode && !isFirst ? () => handleMoveStation(idA, -1) : undefined}
                onMoveRight={configureMode && !isLast ? () => handleMoveStation(idA, 1) : undefined}
                moveLabel={`${areaLabels[idA] ?? idA} & ${areaLabels[idB] ?? idB}`}
                onSlotsChange={setSlotsForArea}
                onAssign={setSlotAssignment}
                requiresTrainedOrExpertA={areaRequiresTrainedOrExpert(idA)}
                requiresTrainedOrExpertB={areaRequiresTrainedOrExpert(idB)}
                onRequiresTrainedOrExpertChangeA={(value) => handleAreaRequiresTrainedOrExpertChange(idA, value)}
                onRequiresTrainedOrExpertChangeB={(value) => handleAreaRequiresTrainedOrExpertChange(idB, value)}
                showBreakCoverageToggle={!!effectiveConfig && getBreaksEnabled(effectiveConfig)}
                slotBreakCoverageEnabled={slotBreakCoverageEnabled}
                onToggleSlotBreakCoverage={handleToggleSlotBreakCoverage}
                compactView={!configureMode}
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
              onClearArea={handleClearArea}
              onDeleteArea={configureMode ? handleRemoveStation : undefined}
              onMoveLeft={configureMode && !isFirst ? (id) => handleMoveStation(id, -1) : undefined}
              onMoveRight={configureMode && !isLast ? (id) => handleMoveStation(id, 1) : undefined}
              sectionTasks={sectionTasks[areaId] ?? []}
              onSlotsChange={setSlotsForArea}
              onAssign={setSlotAssignment}
              requiresTrainedOrExpert={areaRequiresTrainedOrExpert(areaId)}
              onRequiresTrainedOrExpertChange={(value) => handleAreaRequiresTrainedOrExpertChange(areaId, value)}
              showBreakCoverageToggle={!!effectiveConfig && getBreaksEnabled(effectiveConfig)}
              slotBreakCoverageEnabled={slotBreakCoverageEnabled[areaId] ?? {}}
              onToggleSlotBreakCoverage={handleToggleSlotBreakCoverage}
              compactView={!configureMode}
            />
          );
        })}
        {effectiveConfig &&
          getFloatSlots(effectiveConfig).map((f) => {
            const supportsLabel =
              f.supportedAreaIds.length > 0
                ? f.supportedAreaIds.map((id) => areaLabels[id] ?? id).join(', ')
                : 'none';
            return (
              <AreaStaffing
                key={f.id}
                areaId={f.id}
                areaLabel={`${f.name} — supports: ${supportsLabel}`}
                minSlots={1}
                maxSlots={1}
                slotLabels={[f.name]}
                slots={slots[f.id] ?? []}
                roster={roster}
                allAssignedPersonIds={allAssignedPersonIds}
                leadAssignedPersonIds={leadAssignedPersonIds}
                juiced={false}
                deJuiced={false}
                onToggleJuice={() => {}}
                onToggleDeJuice={() => {}}
                onAreaNameChange={() => {}}
                onCapacityChange={() => {}}
                onSlotLabelChange={() => {}}
                onClearArea={handleClearArea}
                sectionTasks={[]}
                onSlotsChange={setSlotsForArea}
                onSectionTasksChange={() => {}}
                onAssign={setSlotAssignment}
                requiresTrainedOrExpert={false}
                supportedAreaIds={f.supportedAreaIds}
                breakSchedules={getBreaksEnabled(effectiveConfig) ? breakSchedules : undefined}
                rotationCount={getBreaksEnabled(effectiveConfig) ? getBreakRotations(effectiveConfig) : undefined}
                showBreakCoverageToggle={!!effectiveConfig && getBreaksEnabled(effectiveConfig)}
                slotBreakCoverageEnabled={slotBreakCoverageEnabled[f.id] ?? {}}
                onToggleSlotBreakCoverage={handleToggleSlotBreakCoverage}
                compactView={!configureMode}
              />
            );
          })}
      </div>
      <UnslottedBank
        roster={roster}
        leadAssignedPersonIds={leadAssignedPersonIds}
        allAssignedPersonIds={allAssignedPersonIds}
      />
      </div>

      <TrainingReport
        roster={roster}
        slots={slots}
        areaLabels={areaLabels}
        effectiveCapacity={effectiveCapacity}
        areaIds={areaIds}
      />

      {effectiveConfig && getBreaksEnabled(effectiveConfig) && (() => {
        const rotationCount = getBreakRotations(effectiveConfig);
        const scope = getBreaksScope(effectiveConfig);
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
        const floatSlots = getFloatSlots(effectiveConfig);
        return (
          <>
            {floatSlots.length > 0 && (
              <div className="section-card" style={{ marginBottom: 16 }}>
                <h3 style={{ margin: '0 0 8px 0', fontWeight: 700, fontSize: '1.05rem' }}>Float break schedule</h3>
                <p style={{ color: '#555', fontSize: '0.9rem', marginBottom: 12 }}>
                  Floats cover their areas when others are on break. Each float gets a break rotation; assignments update automatically when you change the line.
                </p>
                {floatSlots.map((f) => {
                  const assignments = breakSchedules?.[f.id];
                  const areaSlots = slots[f.id] ?? [];
                  const assignedPersonId = areaSlots[0]?.personId;
                  const hasAssignment = assignments && Object.keys(assignments).length > 0;
                  if (hasAssignment) {
                    const people = Object.keys(assignments!).map((id) => {
                      const p = roster.find((r) => r.id === id);
                      return { id, name: p?.name ?? id };
                    });
                    return (
                      <BreakTable
                        key={f.id}
                        people={people}
                        assignments={assignments!}
                        rotationCount={rotationCount}
                        title={`${f.name} (supports: ${f.supportedAreaIds.map((id) => areaLabels[id] ?? id).join(', ') || 'none'})`}
                      />
                    );
                  }
                  const assignedName = assignedPersonId ? roster.find((r) => r.id === assignedPersonId)?.name : null;
                  return (
                    <div
                      key={f.id}
                      style={{
                        padding: 12,
                        marginBottom: 8,
                        background: '#f8f9fa',
                        border: '1px solid #e9ecef',
                        borderRadius: 8,
                        fontSize: '0.9rem',
                      }}
                    >
                      <strong>{f.name}</strong>
                      <span style={{ color: '#555' }}>
                        {' '}
                        (supports: {f.supportedAreaIds.map((id) => areaLabels[id] ?? id).join(', ') || 'none'})
                      </span>
                      <div style={{ marginTop: 6 }}>
                        {assignedName
                          ? `Assigned: ${assignedName}. Break rotation updates when you change assignments.`
                          : `Assign someone to this float position above; their break rotation will update automatically.`}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {areaIds.map((areaId) => {
              const assignments = breakSchedules?.[areaId];
              if (!assignments || Object.keys(assignments).length === 0) return null;
              const people = Object.keys(assignments).map((id) => {
                const p = roster.find((r) => r.id === id);
                return { id, name: p?.name ?? id };
              });
              const floatSlot = floatSlots.find((f) => f.id === areaId);
              const title = floatSlot
                ? `Break schedule — ${floatSlot.name} (supports: ${floatSlot.supportedAreaIds.map((id) => areaLabels[id] ?? id).join(', ') || 'none'})`
                : `Break schedule — ${areaLabels[areaId] ?? areaId}`;
              return (
                <BreakTable
                  key={areaId}
                  people={people}
                  assignments={assignments}
                  rotationCount={rotationCount}
                  title={title}
                />
              );
            })}
            {/* Lead break coverage info */}
            {leadSlotKeys.some((key) => leadBreakCoverage[key] && leadSlots[key]) && (
              <div className="section-card" style={{ marginTop: 16 }}>
                <h3 style={{ margin: '0 0 8px 0', fontWeight: 700, fontSize: '1.05rem' }}>Lead break coverage</h3>
                <p style={{ color: '#555', fontSize: '0.9rem', marginBottom: 12 }}>
                  These leads cover stations during all break rotations and manage their own breaks outside the normal schedule. Coverage appears in the presentation view when assignments change.
                </p>
                {leadSlotKeys.map((key) => {
                  if (!leadBreakCoverage[key] || !leadSlots[key]) return null;
                  const leadPerson = roster.find((r) => r.id === leadSlots[key]);
                  const label = effectiveConfig ? getLeadSlotLabel(effectiveConfig, key, areaLabels) : key;
                  return (
                    <div
                      key={key}
                      style={{
                        padding: 12,
                        marginBottom: 8,
                        background: '#e8f5e9',
                        border: '1px solid #c8e6c9',
                        borderRadius: 8,
                        fontSize: '0.9rem',
                      }}
                    >
                      <strong>Lead: {label}</strong>
                      {leadPerson && <span style={{ color: '#555' }}> — {leadPerson.name}</span>}
                      <span style={{ color: '#2e7d32', marginLeft: 8 }}>Available all rotations</span>
                    </div>
                  );
                })}
              </div>
            )}
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

      {showImportModal && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="import-cloud-title"
          onClick={() => !importLoading && setShowImportModal(false)}
        >
          <div
            className="modal-dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="import-cloud-title" style={{ marginTop: 0, marginBottom: 16 }}>Import from another cloud line</h2>
            <p style={{ color: '#666', fontSize: '0.9rem', marginBottom: 16 }}>
              Import people from another cloud line. People with matching names will have their skills merged.
            </p>
            {importError && (
              <div style={{ background: '#fee', padding: 10, borderRadius: 8, marginBottom: 12 }}>{importError}</div>
            )}
            <label style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>Cloud line</label>
            <select
              value={importLineId}
              onChange={(e) => setImportLineId(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', marginBottom: 12, boxSizing: 'border-box' }}
            >
              <option value="">— Select a line —</option>
              {importLines.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>Password</label>
            <input
              type="password"
              value={importPassword}
              onChange={(e) => setImportPassword(e.target.value)}
              placeholder="Enter that line's password"
              style={{ width: '100%', padding: '10px 12px', marginBottom: 16, boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn-primary" onClick={handleImportFromCloudLine} disabled={importLoading || !importLineId}>
                {importLoading ? 'Importing…' : 'Import'}
              </button>
              <button type="button" className="btn-ghost" onClick={() => setShowImportModal(false)} disabled={importLoading}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

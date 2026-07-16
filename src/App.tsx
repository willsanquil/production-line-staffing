import { lazy, Suspense, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { AreaId, BreakPreference, FloatSlotConfig, RootState, RosterPerson, SlotsByArea } from './types';
import type { SkillLevel } from './types';
import { getLineHealthScore } from './lib/lineHealth';
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
  areaIdFromName,
  getLeadSlotKeys,
  getLeadSlotLabel,
  getLinkedSlotGroupsForArea,
  getFloatSlotIndicesForArea,
  getFloatSlots,
  LEAD_COVERAGE_PREFIX,
} from './lib/lineConfig';
import { createEmptyPerson, createEmptyOTPerson, createEmptySlot, getEmptyLineState } from './data/initialState';
import { RosterGrid } from './components/RosterGrid';
import { LeadSlotsSection } from './components/LeadSlotsSection';
import { AreaStaffing } from './components/AreaStaffing';
import { CombinedAreaStaffing } from './components/CombinedAreaStaffing';
import { UnslottedBank } from './components/UnslottedBank';
import { randomizeAssignments, fillRemainingAssignments } from './lib/automation';
import { generateBreakSchedules, optimizeFloatBreakRotations } from './lib/breakSchedules';
import { synthesizeCoverageFloats, mirrorVirtualFloatBreaksToStations } from './lib/coverageStations';
import { clearAreaAssignments } from './lib/slots';
import { getLineState, createCloudLine } from './lib/cloudLines';
import { getCloudSession, setCloudSession, clearCloudSession } from './lib/cloudSession';
import { clearCloudViewerSession } from './lib/cloudViewerSession';
import { PersonProfileModal } from './components/PersonProfileModal';
import { ThemeControls } from './components/ThemeControls';
import { useCloudLineSync } from './hooks/useCloudLineSync';
import { useTheme } from './hooks/useTheme';
import { extractLineDraftState } from './lib/lineDraftState';

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
  const [rosterVisible, setRosterVisible] = useState(true);
  const [adminVisible, setAdminVisible] = useState(true);
  const { mode, toggleMode } = useTheme();
  const [showShareModal, setShowShareModal] = useState(false);
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
  const [showFloatSupportModal, setShowFloatSupportModal] = useState(false);
  const [floatSupportDraft, setFloatSupportDraft] = useState<FloatSlotConfig[] | null>(null);
  /** Modal draft for "Convert station to floats": which station + which areas the new floats should cover. */
  const [convertStationDraft, setConvertStationDraft] = useState<{ areaId: string; supportedAreaIds: string[] } | null>(null);
  /** Modal draft for "Covers breaks for…": which station + which other areas its people cover.
   * Unlike Convert to Floats this is non-destructive — the station still runs as a station,
   * its people are just additionally scheduled to cover breaks at the listed areas. */
  const [coverageDraft, setCoverageDraft] = useState<{ areaId: string; supportedAreaIds: string[] } | null>(null);
  const [addStationName, setAddStationName] = useState('');
  const [addStationMin, setAddStationMin] = useState(2);
  const [addStationMax, setAddStationMax] = useState(5);
  const [addStationHasLead, setAddStationHasLead] = useState(false);
  const [areaCapacityOverrides, setAreaCapacityOverrides] = useState(firstLineState.areaCapacityOverrides ?? {});
  const [areaNameOverrides, setAreaNameOverrides] = useState(firstLineState.areaNameOverrides ?? {});
  const [slotLabelsByArea, setSlotLabelsByArea] = useState(firstLineState.slotLabelsByArea ?? {});
  const [areaRequiresTrainedOrExpertOverrides, setAreaRequiresTrainedOrExpertOverrides] = useState(firstLineState.areaRequiresTrainedOrExpertOverrides ?? {});
  const [slotBreakCoverageEnabled, setSlotBreakCoverageEnabled] = useState(firstLineState.slotBreakCoverageEnabled ?? {});
  /** Maps a station areaId -> array of supported area ids it covers breaks for.
   * The station still renders as a station; its people additionally get scheduled and
   * displayed as float coverage on the supported areas. */
  const [areaCoversBreaksFor, setAreaCoversBreaksFor] = useState<Record<string, string[]>>(firstLineState.areaCoversBreaksFor ?? {});
  const [profilePersonId, setProfilePersonId] = useState<string | null>(null);
  const [showStaffTheLineWizard, setShowStaffTheLineWizard] = useState(false);
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
  // Full staff = user override (persisted per-line), or leads + sum of all areas' min capacity.
  // Persisted in line state so the value sticks across reloads, line switches, and day loads.
  const [fullStaffOverride, setFullStaffOverride] = useState<number | null>(firstLineState.fullStaffOverride ?? null);
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
  stateRef.current = { slots, leadSlots, juicedAreas, deJuicedAreas, sectionTasks, schedule, dayNotes, documents, breakSchedules, leadBreakCoverage, areaBreakCoverageEnabled, areaCapacityOverrides, areaNameOverrides, slotLabelsByArea, areaRequiresTrainedOrExpertOverrides, slotBreakCoverageEnabled, areaCoversBreaksFor, fullStaffOverride };
  const rootStateRef = useRef(rootState);
  rootStateRef.current = rootState;

  /** Counter incremented when the entire line state should be reloaded from rootState
   * (e.g. cloud poll received new data, or initial cloud load). Prevents roster-only
   * updates (like break preference) from clobbering local slot/lead state. */
  const [lineStateReloadKey, setLineStateReloadKey] = useState(0);
  const reloadLineState = useCallback(() => setLineStateReloadKey((k) => k + 1), []);

  const handleGoHome = useCallback(() => {
    if (cloudLineId) clearCloudViewerSession(cloudLineId);
    clearCloudSession();
    setCloudLineId(null);
    cloudPasswordRef.current = null;
    setRootState(getHydratedRootState());
    setAppMode('entry');
  }, [cloudLineId]);

  const handleViewerKickedToHome = useCallback(() => {
    window.alert('Another person took over editing this line (YEET). Returning to the home screen.');
    handleGoHome();
  }, [handleGoHome]);

  const {
    cloudConflictBanner,
    cloudViewerRole,
    yeetBusy,
    yeetOtherViewer,
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
    persistDeps: [slots, leadSlots, juicedAreas, deJuicedAreas, sectionTasks, schedule, dayNotes, documents, breakSchedules, areaBreakCoverageEnabled, areaCapacityOverrides, areaNameOverrides, slotLabelsByArea, areaRequiresTrainedOrExpertOverrides, slotBreakCoverageEnabled, areaCoversBreaksFor, fullStaffOverride],
    onViewerKickedToHome: handleViewerKickedToHome,
    onIdleReturnToEntry: handleGoHome,
  });

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const on = appMode === 'app' && Boolean(cloudLineId) && cloudViewerRole === 'readonly';
    document.body.classList.toggle('cloud-readonly', on);
    return () => document.body.classList.remove('cloud-readonly');
  }, [appMode, cloudLineId, cloudViewerRole]);

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
    setAreaCoversBreaksFor(lineState.areaCoversBreaksFor ?? {});
    setFullStaffOverride(lineState.fullStaffOverride ?? null);
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

  /** Coverage-station virtual floats derived from areaCoversBreaksFor. Memoized separately
   * so the presentation float list and break scheduler stay in sync. */
  const coverageStationSynthesis = useMemo(
    () => synthesizeCoverageFloats(areaCoversBreaksFor, slots, areaLabels),
    [areaCoversBreaksFor, slots, areaLabels]
  );

  /** Float slots for presentation: real floats + synthetic lead floats (if coverage enabled)
   * + virtual floats synthesized from coverage stations. The latter is what makes
   * Break Coverage rows show up on stations supported by a coverage station like Flip. */
  const presentationFloatSlots = useMemo(() => {
    if (!effectiveConfig) return [];
    const real = getFloatSlots(effectiveConfig);
    const scope = getBreaksScope(effectiveConfig);
    const coverageVirtual = coverageStationSynthesis.virtualFloats;
    if (scope !== 'station') return [...real, ...coverageVirtual];
    const synthetic: FloatSlotConfig[] = [];
    const stationAreaIds = effectiveConfig.areas.map((a) => a.id);
    for (const key of leadSlotKeys) {
      if (!leadBreakCoverage[key] || !leadSlots[key]) continue;
      const label = getLeadSlotLabel(effectiveConfig, key, areaLabels);
      synthetic.push({ id: `${LEAD_COVERAGE_PREFIX}${key}`, name: `Lead: ${label}`, supportedAreaIds: stationAreaIds });
    }
    return [...real, ...synthetic, ...coverageVirtual];
  }, [effectiveConfig, leadSlotKeys, leadBreakCoverage, leadSlots, areaLabels, coverageStationSynthesis]);

  /** Slots for presentation: real slots + synthetic lead float slots + coverage-station virtual slots. */
  const presentationSlots = useMemo(() => {
    if (!effectiveConfig) return { ...slots, ...coverageStationSynthesis.virtualSlots };
    const scope = getBreaksScope(effectiveConfig);
    const augmented: SlotsByArea = { ...slots, ...coverageStationSynthesis.virtualSlots };
    if (scope !== 'station') return augmented;
    for (const key of leadSlotKeys) {
      if (!leadBreakCoverage[key]) continue;
      const personId = leadSlots[key];
      if (!personId) continue;
      const syntheticId = `${LEAD_COVERAGE_PREFIX}${key}`;
      augmented[syntheticId] = [{ id: `${syntheticId}_s0`, personId }];
    }
    return augmented;
  }, [effectiveConfig, slots, leadSlotKeys, leadBreakCoverage, leadSlots, coverageStationSynthesis]);

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

      // Scrub the deleted area from areaCoversBreaksFor (both as a key — the deleted
      // station can no longer cover anyone — and as a value in any other station's list).
      const prevAreaCovers = lineState.areaCoversBreaksFor ?? {};
      const nextAreaCovers: Record<string, string[]> = {};
      for (const [stationId, supportedIds] of Object.entries(prevAreaCovers)) {
        if (stationId === areaId) continue;
        const filtered = supportedIds.filter((id) => id !== areaId);
        if (filtered.length > 0) nextAreaCovers[stationId] = filtered;
      }

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
        areaCoversBreaksFor: nextAreaCovers,
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

  /** Convert a station into N float positions (one per enabled, non-disabled slot).
   * Each new float covers breaks for the user-selected `supportedAreaIds`. People are moved
   * from the station's slots into the new floats, and the original station is removed.
   * Pre-enables slot-level break coverage for every slot in supportedAreaIds so the floats
   * prioritize covering them. */
  const handleConvertStationToFloats = useCallback((areaId: string, supportedAreaIds: string[]) => {
    setRootState((prev) => {
      const lineIndex = prev.lines.findIndex((l) => l.id === prev.currentLineId);
      if (lineIndex === -1) return prev;
      const line = prev.lines[lineIndex];
      const sourceArea = line.areas.find((a) => a.id === areaId);
      if (!sourceArea) return prev;
      const lineState = prev.lineStates[prev.currentLineId];
      if (!lineState) return prev;

      const sourceSlots = lineState.slots[areaId] ?? [];
      const enabledSourceSlots = sourceSlots.filter((s) => !s.disabled);
      if (enabledSourceSlots.length === 0) return prev;

      const existingFloatIds = new Set((line.floatSlots ?? []).map((f) => f.id));
      const baseId = areaId.replace(/^area_/, '').replace(/[^a-z0-9_]/gi, '_').toLowerCase() || 'cov';
      const newFloats: FloatSlotConfig[] = [];
      const newFloatSlotEntries: Record<string, typeof sourceSlots> = {};
      enabledSourceSlots.forEach((src, i) => {
        let id = `${baseId}_${i + 1}`;
        let suffix = i + 1;
        while (existingFloatIds.has(id)) {
          suffix += 1;
          id = `${baseId}_${suffix}`;
        }
        existingFloatIds.add(id);
        newFloats.push({
          id,
          name: `${sourceArea.name} ${i + 1}`,
          supportedAreaIds: [...supportedAreaIds],
        });
        newFloatSlotEntries[id] = [{ id: src.id, personId: src.personId, disabled: false }];
      });

      const lines = prev.lines.slice();
      const remainingAreas = line.areas.filter((a) => a.id !== areaId);
      const remainingCombinedSections = (line.combinedSections ?? []).filter(
        ([a, b]) => a !== areaId && b !== areaId
      );
      const remainingLeadAreaIds = (line.leadAreaIds ?? []).filter((id) => id !== areaId);
      const remainingFloatSlots = (line.floatSlots ?? []).map((f) => ({
        ...f,
        supportedAreaIds: f.supportedAreaIds.filter((id) => id !== areaId),
      }));
      lines[lineIndex] = {
        ...line,
        areas: remainingAreas,
        combinedSections: remainingCombinedSections,
        leadAreaIds: remainingLeadAreaIds,
        floatSlots: [...remainingFloatSlots, ...newFloats],
      };

      const dropKey = <T extends Record<string, unknown>>(obj: T | undefined): T | undefined => {
        if (!obj || !(areaId in obj)) return obj;
        const next = { ...obj } as Record<string, unknown>;
        delete next[areaId];
        return next as T;
      };

      const nextSlots = { ...lineState.slots, ...newFloatSlotEntries };
      delete nextSlots[areaId];
      const nextSectionTasks = { ...lineState.sectionTasks };
      delete (nextSectionTasks as Record<string, unknown>)[areaId];
      const nextLeadSlots = { ...lineState.leadSlots };
      delete nextLeadSlots[areaId];

      // Coverage is determined by each float's supportedAreaIds, so no per-slot break
      // coverage flags need to be set here. We just scrub any flags belonging to the
      // dropped station so old data doesn't linger.
      const prevSlotBreakCoverageEnabled = lineState.slotBreakCoverageEnabled ?? {};
      const nextSlotBreakCoverageEnabled = { ...prevSlotBreakCoverageEnabled };
      delete nextSlotBreakCoverageEnabled[areaId];

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
        slotBreakCoverageEnabled: nextSlotBreakCoverageEnabled,
      };
      const lineStates = { ...prev.lineStates, [prev.currentLineId]: newLineState };
      return { ...prev, lines, lineStates };
    });
    schedulePersistForRootEdit();
  }, [schedulePersistForRootEdit]);

  /** Mark / unmark a station as covering breaks at other areas. Empty list clears it.
   * People stay at the station; they're additionally scheduled like floats so their break
   * rotations leave coverage in place at the supported areas. */
  const handleSetCoversBreaksFor = useCallback((areaId: string, supportedAreaIds: string[]) => {
    markLocalChange();
    setAreaCoversBreaksFor((prev) => {
      const next = { ...prev };
      const cleaned = supportedAreaIds.filter((id) => id && id !== areaId);
      if (cleaned.length === 0) {
        delete next[areaId];
      } else {
        next[areaId] = cleaned;
      }
      return next;
    });
  }, [markLocalChange]);

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
    setSlots((prev) => {
      let next = prev;
      for (const areaId of areaIds) {
        next = clearAreaAssignments(next, areaId);
      }
      return next;
    });
    setBreakSchedules({});
  }, [areaIds]);

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

    // Synthesize one virtual float per enabled, staffed slot in any "coverage station"
    // (a station whose areaCoversBreaksFor[id] lists supported areas). Each virtual float
    // mirrors a station slot's person so the existing float-break optimizer can pick a
    // break rotation that leaves the supported areas covered. We then mirror the picked
    // rotation back to the station's break schedule entry so the station table and the
    // virtual float stay in sync.
    const { virtualFloats, virtualSlots, links: coverageLinks } = synthesizeCoverageFloats(
      areaCoversBreaksFor,
      nextSlots,
      areaLabels,
    );
    const slotsForScheduler: SlotsByArea = { ...nextSlots, ...virtualSlots };
    for (const vf of virtualFloats) {
      floatSlotIndicesByArea[vf.id] = [0];
    }

    // Include float slot IDs so floats themselves get break rotations assigned.
    // Leads acting as coverage do NOT get break rotations — they break outside the schedule.
    const areaIdsWithFloats = [
      ...areaIds,
      ...floatSlots.map((f) => f.id),
      ...virtualFloats.map((f) => f.id),
    ];

    const rotationCount = getBreakRotations(effectiveConfig);
    const rawSchedules = generateBreakSchedules(roster, slotsForScheduler, areaIdsWithFloats, {
      rotationCount,
      scope,
      leadSlots,
      linkedSlotsByArea,
      floatSlotIndicesByArea,
      floatSupportedAreaIds,
    });
    const optimized = optimizeFloatBreakRotations(
      rawSchedules,
      [...floatSlots, ...virtualFloats],
      slotsForScheduler,
      rotationCount,
    );
    setBreakSchedules(mirrorVirtualFloatBreaksToStations(optimized, coverageLinks));
  }, [effectiveConfig, areaIds, roster, leadSlots, leadBreakCoverage, slotBreakCoverageEnabled, slotLabelsByArea, leadSlotKeys, areaCoversBreaksFor, areaLabels]);

  // Recalc breaks whenever slot or lead assignments change (no manual "Regenerate breaks" needed).
  useEffect(() => {
    if (appMode !== 'app' || !effectiveConfig || !getBreaksEnabled(effectiveConfig)) return;
    regenerateBreaksForSlots(slots);
  }, [appMode, effectiveConfig, slots, leadSlots, regenerateBreaksForSlots]);

  const handleRandomize = useCallback(() => {
    const nextSlots = randomizeAssignments(roster, slots, leadAssignedPersonIds, areaIds, areaRequiresTrainedOrExpert);
    setSlots(nextSlots);
    regenerateBreaksForSlots(nextSlots);
  }, [roster, slots, leadAssignedPersonIds, areaIds, areaRequiresTrainedOrExpert, regenerateBreaksForSlots]);

  const handleFillRemaining = useCallback(() => {
    const nextSlots = fillRemainingAssignments(roster, slots, juicedAreas, leadAssignedPersonIds, deJuicedAreas, effectiveCapacity, areaIds, areaRequiresTrainedOrExpert);
    setSlots(nextSlots);
    regenerateBreaksForSlots(nextSlots);
  }, [roster, slots, juicedAreas, deJuicedAreas, leadAssignedPersonIds, effectiveCapacity, areaIds, areaRequiresTrainedOrExpert, regenerateBreaksForSlots]);

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
      <>
        <header className="app-header">
          <span>Production Line Staffing</span>
          <ThemeControls mode={mode} toggleMode={toggleMode} />
        </header>
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
      </>
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
          <div>
            <ThemeControls mode={mode} toggleMode={toggleMode} />
            <button type="button" onClick={handleGoHome}>
              Home
            </button>
          </div>
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
          <div>
            <ThemeControls mode={mode} toggleMode={toggleMode} />
            <button type="button" onClick={handleGoHome}>
              Home
            </button>
          </div>
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
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <ThemeControls mode={mode} toggleMode={toggleMode} />
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
            <ThemeControls mode={mode} toggleMode={toggleMode} />
            <button type="button" className="cloud-readonly-exempt" onClick={handleGoHome}>
              Home
            </button>
            <button
              type="button"
              className="btn-primary cloud-readonly-exempt"
              onClick={() => setAdminVisible(true)}
            >
              Admin View
            </button>
          </div>
        </header>
        {appMode === 'app' && cloudLineId && cloudViewerRole === 'readonly' && (
          <div
            role="region"
            aria-label="Read-only viewer"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 12,
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 16px',
              marginBottom: 12,
              background: '#fff8e1',
              border: '1px solid #ffc107',
              borderRadius: 10,
            }}
          >
            <span style={{ fontSize: '0.95rem', maxWidth: 760 }}>
              Someone else is editing this line in another tab or device. You can review the sheet but not change it. YEET sends them to the home screen and gives you control.
            </span>
            <button
              type="button"
              className="btn-danger cloud-readonly-exempt"
              onClick={() => void yeetOtherViewer()}
              disabled={yeetBusy}
              style={{ fontWeight: 800, letterSpacing: '0.08em' }}
            >
              {yeetBusy ? '…' : 'YEET'}
            </button>
          </div>
        )}
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
          <ThemeControls mode={mode} toggleMode={toggleMode} />
          <button type="button" className="cloud-readonly-exempt" onClick={handleGoHome}>
            Home
          </button>
          <button
            type="button"
            className="cloud-readonly-exempt"
            onClick={() => setAdminVisible(false)}
            title="Presentation view for screenshot or phone"
          >
            Staffing View
          </button>
        </div>
      </header>

      {appMode === 'app' && cloudLineId && cloudViewerRole === 'readonly' && (
        <div
          role="region"
          aria-label="Read-only viewer"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 12,
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 16px',
            marginBottom: 12,
            background: '#fff8e1',
            border: '1px solid #ffc107',
            borderRadius: 10,
          }}
        >
          <span style={{ fontSize: '0.95rem', maxWidth: 760 }}>
            Someone else is editing this line in another tab or device. You can review the sheet but not change it. YEET sends them to the home screen and gives you control.
          </span>
          <button
            type="button"
            className="btn-danger cloud-readonly-exempt"
            onClick={() => void yeetOtherViewer()}
            disabled={yeetBusy}
            style={{ fontWeight: 800, letterSpacing: '0.08em' }}
          >
            {yeetBusy ? '…' : 'YEET'}
          </button>
        </div>
      )}

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
              markLocalChange();
              const v = e.target.valueAsNumber;
              if (!Number.isNaN(v) && v >= 1) {
                setFullStaffOverride(v);
              } else {
                setFullStaffOverride(null);
              }
            }}
            style={{ width: 52, padding: '2px 6px', fontSize: 'inherit', fontWeight: 700 }}
            title={`Computed: ${computedFullStaff}. Edit to override (saved per line).`}
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
        <button type="button" className="btn-primary" onClick={handleFillRemaining}>Fill remaining</button>
        <button type="button" className="btn-primary" onClick={handleRandomize}>Randomize</button>
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

      {convertStationDraft && currentConfig && (() => {
        const sourceArea = currentConfig.areas.find((a) => a.id === convertStationDraft.areaId);
        if (!sourceArea) return null;
        const sourceLabel = areaLabels[sourceArea.id] ?? sourceArea.name;
        const enabledCount = (slots[sourceArea.id] ?? []).filter((s) => !s.disabled).length;
        const otherAreas = currentConfig.areas.filter((a) => a.id !== sourceArea.id);
        const selected = convertStationDraft.supportedAreaIds;
        return (
          <div
            className="modal-overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby="convert-floats-title"
            onClick={() => setConvertStationDraft(null)}
          >
            <div
              className="modal-dialog"
              style={{ maxHeight: '85vh', overflow: 'auto' }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 id="convert-floats-title" style={{ margin: '0 0 8px 0', fontSize: '1.1rem' }}>
                Convert {sourceLabel} to floats
              </h3>
              <p style={{ color: '#555', fontSize: '0.9rem', marginBottom: 12 }}>
                Each of the {enabledCount} {enabledCount === 1 ? 'person' : 'people'} at {sourceLabel} becomes a float.
                Floats don't run a station — they cover breaks at the stations you pick below
                (and take their own breaks in a rotation that leaves coverage in place).
              </p>
              <div style={{ fontSize: '0.85rem', color: '#333', fontWeight: 600, marginBottom: 6 }}>
                Cover breaks for:
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
                {otherAreas.length === 0 && (
                  <span style={{ color: '#888', fontSize: '0.85rem' }}>No other stations to cover.</span>
                )}
                {otherAreas.map((a) => {
                  const checked = selected.includes(a.id);
                  return (
                    <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          setConvertStationDraft((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  supportedAreaIds: e.target.checked
                                    ? [...prev.supportedAreaIds, a.id]
                                    : prev.supportedAreaIds.filter((id) => id !== a.id),
                                }
                              : null
                          )
                        }
                      />
                      <span>{areaLabels[a.id] ?? a.name}</span>
                    </label>
                  );
                })}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={selected.length === 0 || enabledCount === 0}
                  onClick={() => {
                    handleConvertStationToFloats(sourceArea.id, selected);
                    setConvertStationDraft(null);
                  }}
                >
                  Convert
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => setConvertStationDraft(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {coverageDraft && currentConfig && (() => {
        const sourceArea = currentConfig.areas.find((a) => a.id === coverageDraft.areaId);
        if (!sourceArea) return null;
        const sourceLabel = areaLabels[sourceArea.id] ?? sourceArea.name;
        const otherAreas = currentConfig.areas.filter((a) => a.id !== sourceArea.id);
        const selected = coverageDraft.supportedAreaIds;
        const enabledStaffed = (slots[sourceArea.id] ?? []).filter((s) => !s.disabled && s.personId).length;
        return (
          <div
            className="modal-overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby="coverage-title"
            onClick={() => setCoverageDraft(null)}
          >
            <div
              className="modal-dialog"
              style={{ maxHeight: '85vh', overflow: 'auto' }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 id="coverage-title" style={{ margin: '0 0 8px 0', fontSize: '1.1rem' }}>
                {sourceLabel} covers breaks for…
              </h3>
              <p style={{ color: '#555', fontSize: '0.9rem', marginBottom: 12 }}>
                {sourceLabel} keeps running as a station. The {enabledStaffed}{' '}
                {enabledStaffed === 1 ? 'person' : 'people'} working there will additionally be
                scheduled to cover breaks at the stations you pick below — their own break
                rotations will be placed where coverage isn't needed. The Staffing view will
                show a "Break Coverage" row on the supported stations naming who is covering
                whom in each rotation. Leave everything unchecked to clear this setting.
              </p>
              <div style={{ fontSize: '0.85rem', color: '#333', fontWeight: 600, marginBottom: 6 }}>
                Cover breaks for:
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
                {otherAreas.length === 0 && (
                  <span style={{ color: '#888', fontSize: '0.85rem' }}>No other stations to cover.</span>
                )}
                {otherAreas.map((a) => {
                  const checked = selected.includes(a.id);
                  return (
                    <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          setCoverageDraft((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  supportedAreaIds: e.target.checked
                                    ? [...prev.supportedAreaIds, a.id]
                                    : prev.supportedAreaIds.filter((id) => id !== a.id),
                                }
                              : null
                          )
                        }
                      />
                      <span>{areaLabels[a.id] ?? a.name}</span>
                    </label>
                  );
                })}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    handleSetCoversBreaksFor(sourceArea.id, selected);
                    setCoverageDraft(null);
                  }}
                >
                  Save
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => setCoverageDraft(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        );
      })()}

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
            onStaffComplete={handleFillRemaining}
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
                onConvertToFloats={configureMode ? (id) => setConvertStationDraft({ areaId: id, supportedAreaIds: [] }) : undefined}
                onEditCoversBreaksFor={configureMode ? (id) => setCoverageDraft({ areaId: id, supportedAreaIds: areaCoversBreaksFor[id] ?? [] }) : undefined}
                coversBreaksForAreaIdsByArea={areaCoversBreaksFor}
                areaLabelsForCoverageSummary={areaLabels}
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
              onConvertToFloats={configureMode ? (id) => setConvertStationDraft({ areaId: id, supportedAreaIds: [] }) : undefined}
              onEditCoversBreaksFor={configureMode ? (id) => setCoverageDraft({ areaId: id, supportedAreaIds: areaCoversBreaksFor[id] ?? [] }) : undefined}
              coversBreaksForAreaIds={areaCoversBreaksFor[areaId] ?? []}
              areaLabelsForCoverageSummary={areaLabels}
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
        {effectiveConfig && getFloatSlots(effectiveConfig).length > 0 && (
          // Wrap all floats in a single grid cell so they stack vertically as one column
          // (like Bonding with many slots), instead of each float consuming its own column
          // and wrapping awkwardly to a new row. Inner flex column preserves card spacing.
          <div className="floats-column" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)', minWidth: 0 }}>
            {getFloatSlots(effectiveConfig).map((f) => {
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
        )}
      </div>
      <UnslottedBank
        roster={roster}
        leadAssignedPersonIds={leadAssignedPersonIds}
        allAssignedPersonIds={allAssignedPersonIds}
      />
      </div>
    </>
  );
}

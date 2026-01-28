import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { AppState, AreaId, BreakPreference, LeadSlotAreaId, RosterPerson, SavedDay, SlotsByArea, TaskItem } from './types';
import type { SkillLevel } from './types';
import { AREA_IDS, LEAD_SLOT_AREAS, LINE_SECTIONS, isCombinedSection, COMBINED_14_5_FLIP } from './types';

const SKILL_SCORE: Record<SkillLevel, number> = {
  no_experience: 0,
  training: 1,
  trained: 2,
  expert: 3,
};

/** Overall line health: average knowledge (0–3) of everyone on the line in their assigned role. */
function getLineHealthScore(
  slots: SlotsByArea,
  leadSlots: Record<LeadSlotAreaId, string | null>,
  roster: { id: string; skills: Record<AreaId, SkillLevel> }[]
): number | null {
  let sum = 0;
  let count = 0;
  for (const areaId of AREA_IDS) {
    for (const slot of slots[areaId]) {
      if (!slot.personId) continue;
      const p = roster.find((r) => r.id === slot.personId);
      if (p) {
        sum += SKILL_SCORE[p.skills[areaId] ?? 'no_experience'];
        count++;
      }
    }
  }
  for (const areaId of LEAD_SLOT_AREAS) {
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
import { getHydratedState } from './lib/initialState';
import { getEffectiveCapacity, getEffectiveAreaLabels } from './lib/areaConfig';
import { createEmptyPerson, createEmptyOTPerson, createEmptySlot, getInitialState, normalizeSlotsToCapacity } from './data/initialState';
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
import { saveState, loadSavedDays, addSavedDay, removeSavedDay, exportStateToJson, importStateFromJson } from './lib/persist';
import { saveToFile, overwriteFile, openFromFile, isSaveToFileSupported } from './lib/fileStorage';

const FULL_STAFF = 30;

const PERSIST_DEBOUNCE_MS = 400;

function getAssignedPersonIds(slots: SlotsByArea): Set<string> {
  const set = new Set<string>();
  for (const areaId of AREA_IDS) {
    for (const slot of slots[areaId]) {
      if (slot.personId) set.add(slot.personId);
    }
  }
  return set;
}

function getSafeInitialState() {
  try {
    return getHydratedState();
  } catch {
    return getInitialState();
  }
}

const initial = getSafeInitialState();

export default function App() {
  const [roster, setRoster] = useState(initial.roster);
  const [slots, setSlots] = useState(initial.slots);
  const [leadSlots, setLeadSlots] = useState(initial.leadSlots);
  const [juicedAreas, setJuicedAreas] = useState(initial.juicedAreas ?? {});
  const [deJuicedAreas, setDeJuicedAreas] = useState(initial.deJuicedAreas ?? {});
  const [sectionTasks, setSectionTasks] = useState(initial.sectionTasks);
  const [schedule, setSchedule] = useState(initial.schedule);
  const [dayNotes, setDayNotes] = useState(initial.dayNotes ?? '');
  const [documents, setDocuments] = useState<string[]>(initial.documents ?? []);
  const [breakSchedules, setBreakSchedules] = useState(initial.breakSchedules ?? {});
  const [savedDays, setSavedDays] = useState(() => loadSavedDays());
  const [rosterVisible, setRosterVisible] = useState(true);
  const [adminVisible, setAdminVisible] = useState(true);
  /** Per-area: when false, hide break schedule in that area card (default visible). */
  const [breakScheduleVisibleByArea, setBreakScheduleVisibleByArea] = useState<Partial<Record<AreaId, boolean>>>({});
  const [areaCapacityOverrides, setAreaCapacityOverrides] = useState(initial.areaCapacityOverrides ?? {});
  const [areaNameOverrides, setAreaNameOverrides] = useState(initial.areaNameOverrides ?? {});
  const [slotLabelsByArea, setSlotLabelsByArea] = useState(initial.slotLabelsByArea ?? {});

  const effectiveCapacity = useMemo(() => getEffectiveCapacity(areaCapacityOverrides), [areaCapacityOverrides]);
  const areaLabels = useMemo(() => getEffectiveAreaLabels(areaNameOverrides), [areaNameOverrides]);

  const persistTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef({ roster, slots, leadSlots, juicedAreas, deJuicedAreas, sectionTasks, schedule, dayNotes, documents, breakSchedules, areaCapacityOverrides, areaNameOverrides, slotLabelsByArea });
  stateRef.current = { roster, slots, leadSlots, juicedAreas, deJuicedAreas, sectionTasks, schedule, dayNotes, documents, breakSchedules, areaCapacityOverrides, areaNameOverrides, slotLabelsByArea };

  useEffect(() => {
    const id = setTimeout(() => {
      saveState(stateRef.current);
      persistTimeoutRef.current = null;
    }, PERSIST_DEBOUNCE_MS);
    persistTimeoutRef.current = id;
    return () => {
      if (persistTimeoutRef.current) {
        clearTimeout(persistTimeoutRef.current);
        persistTimeoutRef.current = null;
      }
      saveState(stateRef.current);
    };
  }, [roster, slots, leadSlots, juicedAreas, deJuicedAreas, sectionTasks, schedule, dayNotes, documents, breakSchedules, areaCapacityOverrides, areaNameOverrides, slotLabelsByArea]);

  const allAssignedPersonIds = useMemo(() => getAssignedPersonIds(slots), [slots]);
  const leadAssignedPersonIds = useMemo(() => {
    const set = new Set<string>();
    for (const areaId of LEAD_SLOT_AREAS) {
      if (leadSlots[areaId]) set.add(leadSlots[areaId]!);
    }
    return set;
  }, [leadSlots]);
  const grandTotal = useMemo(
    () => allAssignedPersonIds.size + leadAssignedPersonIds.size,
    [allAssignedPersonIds, leadAssignedPersonIds]
  );
  const grandTotalPct = useMemo(
    () => (FULL_STAFF > 0 ? Math.round((grandTotal / FULL_STAFF) * 100) : 0),
    [grandTotal]
  );

  const lineHealthScore = useMemo(
    () => getLineHealthScore(slots, leadSlots, roster),
    [slots, leadSlots, roster]
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

  const setLeadSlot = useCallback((areaId: LeadSlotAreaId, personId: string | null) => {
    setLeadSlots((prev) => ({ ...prev, [areaId]: personId }));
    if (personId) {
      setSlots((prev) => {
        const next = {} as SlotsByArea;
        for (const aid of AREA_IDS) {
          next[aid] = prev[aid].map((s) =>
            s.personId === personId ? { ...s, personId: null } : s
          );
        }
        return next;
      });
    }
  }, []);

  const handleNameChange = useCallback((personId: string, name: string) => {
    setRoster((prev) =>
      prev.map((p) => (p.id === personId ? { ...p, name: name.trim() || p.name } : p))
    );
  }, []);

  const handleAddPerson = useCallback((name: string) => {
    const person = createEmptyPerson(name);
    setRoster((prev) => [...prev, person]);
  }, []);

  const handleRemovePerson = useCallback((personId: string) => {
    setRoster((prev) => prev.filter((p) => p.id !== personId));
    setSlots((prev) => {
      const next = {} as SlotsByArea;
      for (const areaId of AREA_IDS) {
        next[areaId] = prev[areaId].map((s) =>
          s.personId === personId ? { ...s, personId: null } : s
        );
      }
      return next;
    });
    setLeadSlots((prev) => {
      const next = { ...prev };
      for (const areaId of LEAD_SLOT_AREAS) {
        if (next[areaId] === personId) next[areaId] = null;
      }
      return next;
    });
  }, []);

  const handleToggleAbsent = useCallback((personId: string, absent: boolean) => {
    setRoster((prev) =>
      prev.map((p) => (p.id === personId ? { ...p, absent } : p))
    );
  }, []);

  const handleToggleLead = useCallback((personId: string, lead: boolean) => {
    setRoster((prev) =>
      prev.map((p) => (p.id === personId ? { ...p, lead } : p))
    );
  }, []);

  const handleToggleOT = useCallback((personId: string, ot: boolean) => {
    setRoster((prev) =>
      prev.map((p) =>
        p.id === personId ? { ...p, ot, otHereToday: ot ? false : p.otHereToday } : p
      )
    );
  }, []);

  const handleToggleOTHereToday = useCallback((personId: string, otHereToday: boolean) => {
    setRoster((prev) =>
      prev.map((p) => (p.id === personId ? { ...p, otHereToday } : p))
    );
  }, []);

  const handleAddOT = useCallback((name: string) => {
    const person = createEmptyOTPerson(name);
    setRoster((prev) => [...prev, person]);
  }, []);

  const handleToggleLate = useCallback((personId: string, late: boolean) => {
    setRoster((prev) =>
      prev.map((p) => (p.id === personId ? { ...p, late } : p))
    );
  }, []);

  const handleToggleLeavingEarly = useCallback((personId: string, leavingEarly: boolean) => {
    setRoster((prev) =>
      prev.map((p) => (p.id === personId ? { ...p, leavingEarly } : p))
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
    setRoster((prev) =>
      prev.map((p) => (p.id === personId ? { ...p, breakPreference } : p))
    );
  }, []);

  const handleSkillChange = useCallback((personId: string, areaId: AreaId, level: SkillLevel) => {
    setRoster((prev) =>
      prev.map((p) =>
        p.id === personId
          ? { ...p, skills: { ...p.skills, [areaId]: level } }
          : p
      )
    );
  }, []);

  const handleAreasWantToLearnChange = useCallback((personId: string, areaId: AreaId, checked: boolean) => {
    setRoster((prev) =>
      prev.map((p) => {
        if (p.id !== personId) return p;
        const list = p.areasWantToLearn ?? [];
        if (checked) return { ...p, areasWantToLearn: list.includes(areaId) ? list : [...list, areaId] };
        return { ...p, areasWantToLearn: list.filter((a) => a !== areaId) };
      })
    );
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
      for (const areaId of AREA_IDS) {
        next[areaId] = prev[areaId].map((s) => ({ ...s, personId: null }));
      }
      return next;
    });
    setBreakSchedules({});
  }, []);

  const handleSaveDay = useCallback((date: string, name?: string) => {
    addSavedDay(
      date,
      { roster, slots, leadSlots, juicedAreas, deJuicedAreas, sectionTasks, schedule, dayNotes, documents, breakSchedules },
      name
    );
    setSavedDays(loadSavedDays());
  }, [roster, slots, leadSlots, juicedAreas, deJuicedAreas, sectionTasks, schedule, dayNotes, documents, breakSchedules]);

  const handleLoadDay = useCallback((day: SavedDay) => {
    setRoster(day.roster.map((p) => ({
      ...p,
      lead: p.lead ?? false,
      ot: p.ot ?? false,
      otHereToday: p.otHereToday ?? false,
      late: p.late ?? false,
      leavingEarly: p.leavingEarly ?? false,
      breakPreference: p.breakPreference ?? 'no_preference',
      areasWantToLearn: p.areasWantToLearn ?? [],
    })));
    setSlots(normalizeSlotsToCapacity(day.slots, areaCapacityOverrides));
    setLeadSlots(day.leadSlots ?? { area_end_of_line: null, area_courtyard: null, area_bonding: null });
    setJuicedAreas(day.juicedAreas ?? {});
    setDeJuicedAreas(day.deJuicedAreas ?? {});
    setSectionTasks(day.sectionTasks);
    setSchedule(day.schedule);
    setDayNotes(day.dayNotes);
    setDocuments(day.documents);
    setBreakSchedules(day.breakSchedules ?? {});
  }, [areaCapacityOverrides]);

  const handleRandomize = useCallback(() => {
    const nextSlots = randomizeAssignments(roster, slots, leadAssignedPersonIds);
    setSlots(nextSlots);
    setBreakSchedules(generateBreakSchedules(roster, nextSlots));
  }, [roster, slots, leadAssignedPersonIds]);

  const handleSpreadTalent = useCallback(() => {
    const nextSlots = spreadTalent(roster, slots, juicedAreas, leadAssignedPersonIds, deJuicedAreas, effectiveCapacity);
    setSlots(nextSlots);
    setBreakSchedules(generateBreakSchedules(roster, nextSlots));
  }, [roster, slots, juicedAreas, deJuicedAreas, leadAssignedPersonIds, effectiveCapacity]);

  const handleMaxSpeed = useCallback(() => {
    const nextSlots = maxSpeedAssignments(roster, slots, juicedAreas, leadAssignedPersonIds, deJuicedAreas, effectiveCapacity);
    setSlots(nextSlots);
    setBreakSchedules(generateBreakSchedules(roster, nextSlots));
  }, [roster, slots, juicedAreas, deJuicedAreas, leadAssignedPersonIds, effectiveCapacity]);

  const handleLightStretch = useCallback(() => {
    const nextSlots = lightStretchAssignments(roster, slots, juicedAreas, leadAssignedPersonIds, deJuicedAreas, effectiveCapacity);
    setSlots(nextSlots);
    setBreakSchedules(generateBreakSchedules(roster, nextSlots));
  }, [roster, slots, juicedAreas, deJuicedAreas, leadAssignedPersonIds, effectiveCapacity]);

  const handleRemoveDay = useCallback((id: string) => {
    removeSavedDay(id);
    setSavedDays(loadSavedDays());
  }, []);

  const importFileRef = useRef<HTMLInputElement>(null);
  const savedFileHandleRef = useRef<FileSystemFileHandle | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const applyImportedState = useCallback((imported: AppState) => {
    setRoster(imported.roster.map((p: RosterPerson) => ({
      ...p,
      lead: p.lead ?? false,
      ot: p.ot ?? false,
      otHereToday: p.otHereToday ?? false,
      late: p.late ?? false,
      leavingEarly: p.leavingEarly ?? false,
      breakPreference: p.breakPreference ?? 'no_preference',
      areasWantToLearn: p.areasWantToLearn ?? [],
    })));
    setSlots(normalizeSlotsToCapacity(imported.slots, imported.areaCapacityOverrides));
    setLeadSlots(imported.leadSlots ?? { area_end_of_line: null, area_courtyard: null, area_bonding: null });
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
  }, []);

  const handleSaveToFile = useCallback(async () => {
    const state = stateRef.current;
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
    const state = stateRef.current;
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

  if (!adminVisible) {
    return (
      <>
        <header className="app-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <span>Production Line Staffing</span>
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
        />
        <div style={{ maxWidth: 520, margin: '0 auto', padding: '0 12px 24px' }}>
          <TrainingReport roster={roster} slots={slots} areaLabels={areaLabels} effectiveCapacity={effectiveCapacity} />
        </div>
      </>
    );
  }

  return (
    <>
      <header className="app-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <span>Production Line Staffing</span>
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
        visible={rosterVisible}
        areaLabels={areaLabels}
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
        {LINE_SECTIONS.map((section) =>
          isCombinedSection(section) ? (
            <CombinedAreaStaffing
              key="14.5-flip"
              combinedLabel={`${areaLabels[COMBINED_14_5_FLIP[0]]} & ${areaLabels[COMBINED_14_5_FLIP[1]]}`}
              areaIdA={COMBINED_14_5_FLIP[0]}
              areaIdB={COMBINED_14_5_FLIP[1]}
              areaLabelA={areaLabels[COMBINED_14_5_FLIP[0]]}
              areaLabelB={areaLabels[COMBINED_14_5_FLIP[1]]}
              slotsA={slots[COMBINED_14_5_FLIP[0]]}
              slotsB={slots[COMBINED_14_5_FLIP[1]]}
              minA={effectiveCapacity[COMBINED_14_5_FLIP[0]].min}
              maxA={effectiveCapacity[COMBINED_14_5_FLIP[0]].max}
              minB={effectiveCapacity[COMBINED_14_5_FLIP[1]].min}
              maxB={effectiveCapacity[COMBINED_14_5_FLIP[1]].max}
              slotLabelsA={slotLabelsByArea[COMBINED_14_5_FLIP[0]]}
              slotLabelsB={slotLabelsByArea[COMBINED_14_5_FLIP[1]]}
              sectionTasksA={sectionTasks[COMBINED_14_5_FLIP[0]]}
              sectionTasksB={sectionTasks[COMBINED_14_5_FLIP[1]]}
              roster={roster}
              allAssignedPersonIds={allAssignedPersonIds}
              leadAssignedPersonIds={leadAssignedPersonIds}
              juicedA={!!juicedAreas[COMBINED_14_5_FLIP[0]]}
              juicedB={!!juicedAreas[COMBINED_14_5_FLIP[1]]}
              deJuicedA={!!deJuicedAreas[COMBINED_14_5_FLIP[0]]}
              deJuicedB={!!deJuicedAreas[COMBINED_14_5_FLIP[1]]}
              onToggleJuice={handleToggleJuice}
              onToggleDeJuice={handleToggleDeJuice}
              onCapacityChange={handleAreaCapacityChange}
              onSlotLabelChange={handleSlotLabelChange}
              onSlotsChange={setSlotsForArea}
              onSectionTasksChange={setSectionTasksForArea}
              onAssign={setSlotAssignment}
              breakScheduleA={breakSchedules?.[COMBINED_14_5_FLIP[0]]}
              breakScheduleB={breakSchedules?.[COMBINED_14_5_FLIP[1]]}
              showBreakSchedule={breakScheduleVisibleByArea[COMBINED_14_5_FLIP[0]] !== false}
              onToggleBreakSchedule={() =>
                setBreakScheduleVisibleByArea((prev) => ({
                  ...prev,
                  [COMBINED_14_5_FLIP[0]]: prev[COMBINED_14_5_FLIP[0]] === false,
                }))
              }
            />
          ) : (
            <AreaStaffing
              key={section}
              areaId={section}
              areaLabel={areaLabels[section]}
              minSlots={effectiveCapacity[section].min}
              maxSlots={effectiveCapacity[section].max}
              slotLabels={slotLabelsByArea[section]}
              slots={slots[section]}
              roster={roster}
              allAssignedPersonIds={allAssignedPersonIds}
              leadAssignedPersonIds={leadAssignedPersonIds}
              juiced={!!juicedAreas[section]}
              deJuiced={!!deJuicedAreas[section]}
              onToggleJuice={handleToggleJuice}
              onToggleDeJuice={handleToggleDeJuice}
              onAreaNameChange={handleAreaNameChange}
              onCapacityChange={handleAreaCapacityChange}
              onSlotLabelChange={handleSlotLabelChange}
              sectionTasks={sectionTasks[section]}
              onSlotsChange={setSlotsForArea}
              onSectionTasksChange={setSectionTasksForArea}
              onAssign={setSlotAssignment}
              breakSchedule={breakSchedules?.[section]}
              showBreakSchedule={breakScheduleVisibleByArea[section] !== false}
              onToggleBreakSchedule={() =>
                setBreakScheduleVisibleByArea((prev) => ({
                  ...prev,
                  [section]: prev[section] === false,
                }))
              }
            />
          )
        )}
      </div>

      <TrainingReport roster={roster} slots={slots} areaLabels={areaLabels} effectiveCapacity={effectiveCapacity} />

      <NotesAndDocuments
        dayNotes={dayNotes}
        documents={documents}
        onDayNotesChange={setDayNotes}
        onDocumentsChange={setDocuments}
      />

      <DayTimeline schedule={schedule} onScheduleChange={setSchedule} />

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

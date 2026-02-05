import { memo, useState, useEffect, type CSSProperties } from 'react';
import type { AreaId, BreakSchedulesByArea, FloatSlotConfig, RosterPerson, SlotsByArea } from '../types';
import type { SkillLevel } from '../types';
import { LINE_SECTIONS, LEAD_SLOT_AREAS, areaRequiresTrainedOrExpert as defaultRequiresTrainedOrExpert } from '../types';
import { BREAK_LINE_WIDE_KEY } from '../lib/lineConfig';
import { BreakTable } from './BreakTable';
import { getSlotLabel as getSlotLabelDefault, isGenericSlotLabel } from '../lib/areaConfig';
import type { SlotLabelsByArea } from '../types';
import { getAreaRisks } from '../lib/lineViewRisks';

const BAR_HEIGHT = 18;
const BAR_HEIGHT_COMPACT = 10;

const BREAK_SLOT_LABELS = ['First Slot', 'Second Slot', 'Third Slot', 'Fourth Slot', 'Fifth Slot', 'Sixth Slot'] as const;
const ROLE_PA = 'PA';

function useCompactPresentation() {
  const [compact, setCompact] = useState(typeof window !== 'undefined' && window.matchMedia('(max-width: 480px)').matches);
  useEffect(() => {
    const m = window.matchMedia('(max-width: 480px)');
    const fn = () => setCompact(m.matches);
    m.addEventListener('change', fn);
    return () => m.removeEventListener('change', fn);
  }, []);
  return compact;
}

function KnowledgeBar({ position, compact = false }: { position: number | null; compact?: boolean }) {
  const h = compact ? BAR_HEIGHT_COMPACT : BAR_HEIGHT;
  return (
    <div className="seniority-spectrum-wrap" style={{ marginBottom: 0 }}>
      <div className="seniority-spectrum" style={{ position: 'relative', height: h, borderRadius: 3, overflow: 'hidden', display: 'flex' }}>
        <div className="skill-no_experience" style={{ flex: 1, minWidth: 0 }} />
        <div className="skill-training" style={{ flex: 1, minWidth: 0 }} />
        <div className="skill-trained" style={{ flex: 1, minWidth: 0 }} />
        <div className="skill-expert" style={{ flex: 1, minWidth: 0 }} />
        {position != null && (
          <div
            className="seniority-spectrum-arrow"
            style={{
              position: 'absolute',
              left: `clamp(2px, ${position}%, calc(100% - 4px))`,
              top: '50%',
              transform: 'translate(-50%, -50%)',
              width: 0,
              height: 0,
              borderLeft: compact ? '3px solid transparent' : '5px solid transparent',
              borderRight: compact ? '3px solid transparent' : '5px solid transparent',
              borderTop: compact ? '4px solid #1a1a1a' : '7px solid #1a1a1a',
              filter: 'drop-shadow(0 0 1px #fff)',
              pointerEvents: 'none',
            }}
            title={`Avg: ${((position / 100) * 3).toFixed(1)} / 3`}
          />
        )}
      </div>
    </div>
  );
}

interface LineViewProps {
  slots: SlotsByArea;
  roster: RosterPerson[];
  leadSlots: Record<string, string | null>;
  areaLabels: Record<AreaId, string>;
  slotLabelsByArea: SlotLabelsByArea;
  effectiveCapacity: Record<AreaId, { min: number; max: number }>;
  totalOnLine: number;
  fullStaff: number;
  staffingPct: number;
  lineHealthScore: number | null;
  /** For custom lines: section order (single area id or [id, id] pair). Omit for IC. */
  lineSections?: (string | readonly [string, string])[];
  /** Lead slot keys (area IDs or "0","1",... for named positions). */
  leadSlotKeys?: string[];
  /** Display label for each lead slot key. */
  getLeadSlotLabel?: (key: string) => string;
  getSlotLabel?: (areaId: string, slotIndex: number) => string;
  areaRequiresTrainedOrExpert?: (areaId: string) => boolean;
  /** For presentation mode: break schedules per area (or __line__ for line-wide). */
  breakSchedules?: BreakSchedulesByArea;
  /** Number of rotations (1–6). */
  rotationCount?: number;
  /** 'line' = one set for whole line; 'station' = per area. */
  breaksScope?: 'line' | 'station';
  /** For presentation: float positions to show with assigned person and break rotation. */
  floatSlots?: FloatSlotConfig[];
}

/** Compact, screenshot- and phone-friendly view: line health, areas, who is running each, and risks. */
function LineViewInner({
  slots,
  roster,
  leadSlots,
  areaLabels,
  slotLabelsByArea,
  effectiveCapacity,
  totalOnLine,
  fullStaff,
  staffingPct,
  lineHealthScore,
  lineSections: lineSectionsProp,
  leadSlotKeys: leadSlotKeysProp,
  getLeadSlotLabel: getLeadSlotLabelProp,
  getSlotLabel: getSlotLabelProp,
  areaRequiresTrainedOrExpert: areaRequiresTrainedOrExpertProp,
  breakSchedules,
  rotationCount = 3,
  breaksScope = 'station',
  floatSlots = [],
}: LineViewProps) {
  const isCompact = useCompactPresentation();
  const sections = lineSectionsProp ?? LINE_SECTIONS;
  const leadSlotKeys = leadSlotKeysProp ?? [...LEAD_SLOT_AREAS];
  const getLeadSlotLabel = getLeadSlotLabelProp ?? ((key: string) => areaLabels[key] ?? key);
  const getLabel = getSlotLabelProp ?? ((areaId: string, idx: number) => getSlotLabelDefault(areaId, idx, slotLabelsByArea));
  const requiresTrainedOrExpert = areaRequiresTrainedOrExpertProp ?? defaultRequiresTrainedOrExpert;
  const getName = (personId: string | null) =>
    personId ? (roster.find((p) => p.id === personId)?.name ?? '—') : '—';
  const getSkillInArea = (areaId: AreaId, personId: string | null): SkillLevel => {
    if (!personId) return 'no_experience';
    const p = roster.find((r) => r.id === personId);
    return (p?.skills[areaId] ?? 'no_experience') as SkillLevel;
  };
  const knowledgePosition = lineHealthScore != null ? (lineHealthScore / 3) * 100 : null;
  const assignedLeadKeys = leadSlotKeys.filter((k: string) => leadSlots[k] != null && leadSlots[k] !== '');
  const firstAreaId = typeof sections[0] === 'string' ? sections[0] : sections[0]?.[0];

  const sectionStyle: CSSProperties = {
    background: '#fff',
    borderRadius: 8,
    border: '1px solid #e5e5e5',
    padding: '14px 16px',
    marginBottom: 12,
  };
  const sectionTitleStyle: CSSProperties = {
    margin: 0,
    fontSize: '1.1rem',
    fontWeight: 700,
    color: '#1a1a1a',
    marginBottom: 10,
  };
  const nameFontSize = 'clamp(1.1rem, 3vw, 1.28rem)';

  const presentationTableStyle: CSSProperties = {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '1.05rem',
    border: '1px solid #ccc',
    borderRadius: 4,
    overflow: 'hidden',
  };
  const presentationThStyle: CSSProperties = {
    border: '1px solid #ccc',
    padding: '10px 12px',
    textAlign: 'left',
    background: '#f8f8f8',
    fontWeight: 600,
  };
  const presentationTdStyle: CSSProperties = {
    border: '1px solid #ccc',
    padding: '10px 12px',
  };
  const COLUMNS_GRID = '1.5fr 0.5fr';
  const rotCount = Math.min(6, Math.max(1, rotationCount));
  const breakSlotLabels = Array.from({ length: rotCount }, (_, i) => BREAK_SLOT_LABELS[i] ?? `Slot ${i + 1}`);

  /** Section order as flat area IDs (for tie-breaking which area gets float coverage in a slot). */
  const areaIdsInSectionOrder = (() => {
    const out: string[] = [];
    for (const section of sections) {
      if (typeof section === 'string') out.push(section);
      else out.push(section[0], section[1]);
    }
    return out;
  })();

  /**
   * For each float, for each slot 1..rotCount: either 'break' or exactly one areaId they're covering.
   * Ensures the float is never shown in two places at once.
   */
  const floatSchedule = (() => {
    const schedule: Record<string, Record<number, 'break' | string>> = {};
    for (const f of floatSlots) {
      const personId = slots[f.id]?.[0]?.personId ?? null;
      const rawBreak = personId && breakSchedules?.[f.id]?.[personId]?.breakRotation;
      const floatBreakRot = typeof rawBreak === 'number' ? rawBreak : rawBreak != null ? Number(rawBreak) : null;
      schedule[f.id] = {};
      for (let slot = 1; slot <= rotCount; slot++) {
        if (floatBreakRot != null && slot === floatBreakRot) {
          schedule[f.id][slot] = 'break';
          continue;
        }
        const areasNeedingCoverageThisSlot = areaIdsInSectionOrder.filter((areaId) => {
          if (!f.supportedAreaIds.includes(areaId)) return false;
          const areaBreakAssignments = breakSchedules?.[areaId];
          if (!areaBreakAssignments) return false;
          const areaSlotsList = slots[areaId] ?? [];
          return areaSlotsList.some((s) => {
            const pid = s.personId;
            if (!pid) return false;
            const r = areaBreakAssignments[pid]?.breakRotation;
            const rot = typeof r === 'number' ? r : r != null ? Number(r) : null;
            return rot != null && !Number.isNaN(rot) && rot === slot;
          });
        });
        schedule[f.id][slot] = areasNeedingCoverageThisSlot[0] ?? ('' as 'break' | string);
      }
    }
    return schedule;
  })();

  /**
   * One combined table per area: Role (custom or "PA") | Name (skill-colored) | First Slot | Second Slot | ... with X for break assignment.
   * Float row only when a float is *assigned* to this area in that slot (from floatSchedule).
   */
  const renderCombinedAreaTable = (
    areaId: string,
    allSlots: { id: string; personId: string | null; disabled?: boolean }[],
    options?: { subLabel?: string; hideTitle?: boolean; compact?: boolean }
  ) => {
    const subLabel = options?.subLabel ?? areaLabels[areaId];
    const hideTitle = options?.hideTitle;
    const compact = options?.compact ?? false;
    const areaSlots = allSlots.filter((s) => !s.disabled);
    const filled = areaSlots.filter((s) => s.personId).length;
    const min = effectiveCapacity[areaId]?.min ?? 0;
    const areaRequiresTrained = requiresTrainedOrExpert(areaId);
    const hasTrainedOrExpert =
      filled > 0 &&
      areaSlots.some((s) => {
        if (!s.personId) return false;
        const p = roster.find((r) => r.id === s.personId);
        const sk = p?.skills[areaId] ?? 'no_experience';
        return sk === 'trained' || sk === 'expert';
      });
    const risks = getAreaRisks({
      filled,
      min,
      disabledCount: allSlots.length - areaSlots.length,
      needsTrainedOrExpert: areaRequiresTrained && filled >= 1 && !hasTrainedOrExpert,
    });
    const metricText = `${filled}/${min}`;
    const metricExtra = risks.length > 0 ? ` · ${risks.join(' · ')}` : '';
    const personIds = areaSlots.map((s) => s.personId).filter(Boolean) as string[];
    const areaKnowledgePosition =
      personIds.length > 0
        ? (personIds.reduce((sum, id) => {
            const p = roster.find((r) => r.id === id);
            const level = p?.skills[areaId] ?? 'no_experience';
            const score = level === 'expert' ? 3 : level === 'trained' ? 2 : level === 'training' ? 1 : 0;
            return sum + score;
          }, 0) /
            personIds.length /
            3) *
          100
        : null;
    const breakAssignments = breakSchedules?.[areaId];
    const supportingFloats = floatSlots.filter((f) => {
      if (!f.supportedAreaIds.includes(areaId)) return false;
      const fSchedule = floatSchedule[f.id];
      return fSchedule && Object.values(fSchedule).some((v) => v === areaId);
    });
    const showBreakCols = !!breakAssignments && Object.keys(breakAssignments).length > 0 && rotCount >= 1;
    const understaffed = filled < min;
    const uncoveredRotations: number[] = [];
    if (understaffed && showBreakCols && breakAssignments) {
      for (let r = 1; r <= rotCount; r++) {
        const hasSomeone = areaSlots.some((s) => s.personId && breakAssignments[s.personId]?.breakRotation === r);
        if (!hasSomeone) uncoveredRotations.push(r);
      }
    }

    const tableClassName = compact ? 'presentation-table-compact' : undefined;
    const thClassName = compact ? 'presentation-th-compact' : undefined;
    const tdClassName = compact ? 'presentation-td-compact' : undefined;
    const thStyle = compact ? undefined : presentationThStyle;
    const tdStyle = compact ? undefined : presentationTdStyle;
    const tableStyle = compact ? undefined : presentationTableStyle;
    const thCenterStyle = compact ? undefined : { ...presentationThStyle, textAlign: 'center' as const };
    const tdCenterStyle = compact ? undefined : { ...presentationTdStyle, textAlign: 'center' as const };

    return (
      <div
        key={areaId}
        className={`presentation-area-block${compact ? ' presentation-area-block-compact' : ''}`}
        style={{ marginBottom: compact ? 6 : 16 }}
      >
        {!hideTitle && (
          <div className={`presentation-area-header${compact ? ' presentation-area-header-compact' : ''}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: compact ? 8 : 12, flexWrap: 'wrap', marginBottom: compact ? 4 : 10 }}>
            <h3 style={{ margin: 0, fontWeight: 700, fontSize: compact ? '0.8rem' : 'clamp(1.05rem, 2.5vw, 1.2rem)' }}>
              {subLabel} — {metricText}{metricExtra}
            </h3>
            <div className={compact ? 'presentation-area-bar-compact' : ''} style={compact ? undefined : { width: 120, flexShrink: 0 }}>
              <KnowledgeBar position={areaKnowledgePosition} compact={compact} />
            </div>
          </div>
        )}
        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle} className={tableClassName}>
            <thead>
              <tr>
                <th style={thStyle} className={thClassName}>Role</th>
                <th style={thStyle} className={thClassName}>Name</th>
                {showBreakCols && breakSlotLabels.map((label, i) => {
                  const rot = i + 1;
                  const isUncovered = uncoveredRotations.includes(rot);
                  return (
                    <th
                      key={i}
                      style={{
                        ...thCenterStyle,
                        ...(isUncovered ? { color: '#c0392b', fontWeight: 700, background: 'rgba(192, 57, 43, 0.08)' } : {}),
                      }}
                      className={thClassName}
                      title={isUncovered ? 'Uncovered break — no one in this area is off during this slot' : undefined}
                    >
                      {label}
                      {isUncovered && <div style={{ fontSize: '0.7em', marginTop: 2 }}>Uncovered</div>}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {allSlots.map((slot, idx) => {
                if (slot.disabled) return null;
                const slotLabel = getLabel(areaId, idx);
                const roleDisplay = isGenericSlotLabel(slotLabel) ? ROLE_PA : slotLabel;
                const name = getName(slot.personId);
                const skill = getSkillInArea(areaId, slot.personId);
                const breakRot = slot.personId && breakAssignments?.[slot.personId]?.breakRotation;
                return (
                  <tr key={slot.id}>
                    <td style={tdStyle} className={tdClassName}>{roleDisplay}</td>
                    <td style={tdStyle} className={tdClassName}>
                      <span className={`skill-name-${skill}`} style={compact ? undefined : { fontSize: nameFontSize, fontWeight: 600 }}>
                        {name}
                      </span>
                    </td>
                    {showBreakCols && breakSlotLabels.map((_, i) => (
                      <td key={i} style={tdCenterStyle} className={compact ? `${tdClassName} presentation-td-break` : 'presentation-td-break'}>
                        {breakRot === i + 1 ? <span style={{ fontWeight: 700, fontSize: compact ? undefined : '1.1rem' }}>X</span> : ''}
                      </td>
                    ))}
                  </tr>
                );
              })}
              {supportingFloats.map((f) => {
                const personId = slots[f.id]?.[0]?.personId ?? null;
                const fSchedule = floatSchedule[f.id];
                return (
                  <tr key={f.id} style={{ background: 'rgba(33, 150, 243, 0.08)', borderTop: '1px solid rgba(33, 150, 243, 0.3)' }}>
                    <td style={tdStyle} className={tdClassName}>
                      <span style={{ fontWeight: 600, color: '#1976d2' }}>Float: {f.name}</span>
                    </td>
                    <td style={tdStyle} className={tdClassName}>
                      <span style={compact ? undefined : { fontSize: nameFontSize, fontWeight: 600 }}>
                        {personId ? getName(personId) : '—'}
                      </span>
                    </td>
                    {showBreakCols && breakSlotLabels.map((_, i) => {
                      const rot = i + 1;
                      const assignedHere = fSchedule && fSchedule[rot] === areaId;
                      return (
                        <td key={i} style={tdCenterStyle} className={compact ? `${tdClassName} presentation-td-break` : 'presentation-td-break'} title={assignedHere ? `Float covering this area` : fSchedule?.[rot] === 'break' ? `Float on break` : ''}>
                          {assignedHere ? <span style={{ fontWeight: 700, fontSize: compact ? undefined : '1.1rem', color: '#1976d2' }}>X</span> : ''}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div
      className={`line-view line-view-presentation${isCompact ? ' line-view-compact' : ''}`}
      style={{ maxWidth: 960, margin: '0 auto', padding: isCompact ? '6px 8px 60px' : '12px 16px 80px' }}
    >
      <header className="line-view-summary" style={{ marginBottom: isCompact ? 8 : 20 }}>
        {isCompact ? (
          <div className="line-view-summary-compact">
            <span className="line-view-headline-compact">{totalOnLine}/{fullStaff}</span>
            <span className="line-view-metric-compact">{staffingPct}%</span>
            <span className="line-view-metric-compact">Leads: {assignedLeadKeys.length}</span>
            <div className="line-view-bar-compact" style={{ width: 48, height: BAR_HEIGHT_COMPACT, position: 'relative', borderRadius: 3, overflow: 'hidden', background: '#eee' }}>
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: `${Math.min(100, staffingPct)}%`,
                  background: staffingPct >= 80 ? '#27ae60' : staffingPct >= 50 ? '#f1c40f' : '#e74c3c',
                  borderRadius: 0,
                }}
              />
            </div>
            <span className="line-view-metric-compact">
              {lineHealthScore != null ? `${(lineHealthScore).toFixed(1)}/3` : '—'}
            </span>
            <div className="line-view-bar-compact line-view-knowledge-bar-compact">
              <KnowledgeBar position={knowledgePosition} compact />
            </div>
          </div>
        ) : (
          <>
            <div className="line-view-headline" style={{ fontSize: 'clamp(1.75rem, 6vw, 2.25rem)', fontWeight: 700, color: '#1a1a1a', marginBottom: 12, letterSpacing: '-0.02em' }}>
              {totalOnLine}/{fullStaff}
            </div>
            <div className="line-view-metrics" style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <span style={{ fontSize: '0.8rem', color: '#555', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Staffing</span>
                <div style={{ height: BAR_HEIGHT, width: 100, borderRadius: 6, overflow: 'hidden', background: '#eee', position: 'relative', flexShrink: 0 }}>
                  <div
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      bottom: 0,
                      width: `${Math.min(100, staffingPct)}%`,
                      background: staffingPct >= 80 ? '#27ae60' : staffingPct >= 50 ? '#f1c40f' : '#e74c3c',
                      transition: 'width 0.2s ease',
                    }}
                  />
                </div>
                <span style={{ fontSize: '1rem', fontWeight: 600, color: '#1a1a1a' }}>{staffingPct}%</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <span style={{ fontSize: '0.8rem', color: '#555', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Leads</span>
                <span style={{ fontSize: '1rem', fontWeight: 600, color: '#1a1a1a' }}>{assignedLeadKeys.length}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <span style={{ fontSize: '0.8rem', color: '#555', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Experience</span>
                <div style={{ width: 100, flexShrink: 0 }}>
                  <KnowledgeBar position={knowledgePosition} />
                </div>
                <span style={{ fontSize: '1rem', fontWeight: 600, color: '#1a1a1a' }}>
                  {lineHealthScore != null ? `${(lineHealthScore).toFixed(1)}/3` : '—'}
                </span>
              </div>
            </div>
          </>
        )}
      </header>

      {!isCompact && breaksScope === 'line' && breakSchedules?.[BREAK_LINE_WIDE_KEY] && Object.keys(breakSchedules[BREAK_LINE_WIDE_KEY]).length > 0 && rotationCount >= 1 && (
        <div className="presentation-row" style={{ display: 'grid', gridTemplateColumns: COLUMNS_GRID, gap: 24, alignItems: 'start', marginBottom: 20 }}>
          <div />
          <BreakTable
            people={Object.keys(breakSchedules[BREAK_LINE_WIDE_KEY]).map((id) => {
              const p = roster.find((r) => r.id === id);
              return { id, name: p?.name ?? id };
            })}
            assignments={breakSchedules[BREAK_LINE_WIDE_KEY]}
            rotationCount={rotCount}
            title="Break Schedule"
            presentationMode
          />
        </div>
      )}

      {sections.map((section) => {
        const isCombined = Array.isArray(section);
        const rowKey = isCombined ? `row-${(section as [string, string]).join('-')}` : `row-${section as string}`;
        const sectionStyleWithCompact = isCompact ? { ...sectionStyle, padding: 6, marginBottom: 8 } : sectionStyle;
        if (isCombined) {
          const [idA, idB] = section as [string, string];
          const slotsA = slots[idA] ?? [];
          const slotsB = slots[idB] ?? [];
          return (
            <section key={rowKey} style={sectionStyleWithCompact} className={isCompact ? 'presentation-section-compact' : ''}>
              <h2 style={{ ...sectionTitleStyle, ...(isCompact ? { fontSize: '0.8rem', marginBottom: 4 } : {}) }}>{areaLabels[idA] ?? idA} & {areaLabels[idB] ?? idB}</h2>
              {renderCombinedAreaTable(idA, slotsA, { subLabel: areaLabels[idA] ?? idA, compact: isCompact })}
              {renderCombinedAreaTable(idB, slotsB, { subLabel: areaLabels[idB] ?? idB, compact: isCompact })}
            </section>
          );
        }
        const areaId = section as string;
        const allAreaSlots = slots[areaId] ?? [];
        const areaLabel = areaLabels[areaId] ?? areaId;
        return (
          <section key={rowKey} style={sectionStyleWithCompact} className={isCompact ? 'presentation-section-compact' : ''}>
            {renderCombinedAreaTable(areaId, allAreaSlots, { subLabel: areaLabel, compact: isCompact })}
          </section>
        );
      })}

      {assignedLeadKeys.length > 0 && (
        isCompact ? (
          <section className="presentation-section-compact" style={{ ...sectionStyle, padding: 6, marginBottom: 8 }}>
            <h2 style={{ ...sectionTitleStyle, fontSize: '0.8rem', marginBottom: 4 }}>Leads</h2>
            <div style={{ overflowX: 'auto' }}>
              <table className="presentation-table-compact">
                <thead>
                  <tr>
                    <th className="presentation-th-compact">Position</th>
                    <th className="presentation-th-compact">Name</th>
                  </tr>
                </thead>
                <tbody>
                  {assignedLeadKeys.map((key: string) => {
                    const personId = leadSlots[key]!;
                    const skillAreaId = /^\d+$/.test(key) ? (firstAreaId ?? '') : key;
                    const skill = getSkillInArea(skillAreaId as AreaId, personId);
                    return (
                      <tr key={key}>
                        <td className="presentation-td-compact">{getLeadSlotLabel(key)}</td>
                        <td className="presentation-td-compact">
                          <span className={`skill-name-${skill}`}>{getName(personId)}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ) : (
          <section style={{ ...sectionStyle, marginTop: 8 }}>
            <h2 style={sectionTitleStyle}>Leads</h2>
            <div style={{ overflowX: 'auto' }}>
              <table style={presentationTableStyle}>
                <thead>
                  <tr>
                    <th style={presentationThStyle}>Position</th>
                    <th style={presentationThStyle}>Name</th>
                  </tr>
                </thead>
                <tbody>
                  {assignedLeadKeys.map((key: string) => {
                    const personId = leadSlots[key]!;
                    const skillAreaId = /^\d+$/.test(key) ? (firstAreaId ?? '') : key;
                    const skill = getSkillInArea(skillAreaId as AreaId, personId);
                    return (
                      <tr key={key}>
                        <td style={presentationTdStyle}>{getLeadSlotLabel(key)}</td>
                        <td style={presentationTdStyle}>
                          <span className={`skill-name-${skill}`} style={{ fontSize: nameFontSize, fontWeight: 600 }}>{getName(personId)}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )
      )}

      {floatSlots.length > 0 && (
        isCompact ? (
          <section className="presentation-section-compact" style={{ ...sectionStyle, padding: 6, marginTop: 8, marginBottom: 8 }}>
            <h2 style={{ ...sectionTitleStyle, fontSize: '0.8rem', marginBottom: 4 }}>Float schedule</h2>
            <p style={{ fontSize: '0.8rem', color: '#555', margin: '0 0 8px 0' }}>One place per slot — float covers one area or is on break.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {floatSlots.map((f) => {
                const personId = slots[f.id]?.[0]?.personId ?? null;
                const fSchedule = floatSchedule[f.id] ?? {};
                const supportsLabel = f.supportedAreaIds.map((id) => areaLabels[id] ?? id).join(', ') || '—';
                return (
                  <div key={f.id} style={{ padding: 8, background: 'rgba(33, 150, 243, 0.06)', border: '1px solid rgba(33, 150, 243, 0.3)', borderRadius: 6, fontSize: '0.85rem' }}>
                    <strong style={{ color: '#1976d2' }}>{f.name}</strong>
                    <span style={{ color: '#555' }}> — {personId ? getName(personId) : '—'}</span>
                    <div style={{ marginTop: 4, color: '#555', fontSize: '0.8rem' }}>Supports: {supportsLabel}</div>
                    <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {breakSlotLabels.map((label, i) => {
                        const rot = i + 1;
                        const val = fSchedule[rot];
                        const isBreak = val === 'break';
                        const covering = typeof val === 'string' && val !== '' && !isBreak ? areaLabels[val] ?? val : null;
                        return (
                          <span key={i} style={{ fontWeight: isBreak ? 700 : undefined }}>
                            {label}: {isBreak ? 'On break' : covering ?? '—'}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ) : (
          <section style={{ ...sectionStyle, marginTop: 8 }}>
            <h2 style={sectionTitleStyle}>Float schedule</h2>
            <p style={{ fontSize: '0.9rem', color: '#555', margin: '0 0 12px 0' }}>Each float is in one place per slot — covering one area or on break.</p>
            <div style={{ overflowX: 'auto' }}>
              <table style={presentationTableStyle}>
                <thead>
                  <tr>
                    <th style={presentationThStyle}>Float</th>
                    <th style={presentationThStyle}>Assigned</th>
                    <th style={{ ...presentationThStyle, fontWeight: 700 }}>Break</th>
                    {breakSlotLabels.map((label, i) => (
                      <th key={i} style={presentationThStyle}>{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {floatSlots.map((f) => {
                    const personId = slots[f.id]?.[0]?.personId ?? null;
                    const rawBreak = personId && breakSchedules?.[f.id]?.[personId]?.breakRotation;
                    const breakRot = typeof rawBreak === 'number' ? rawBreak : rawBreak != null ? Number(rawBreak) : null;
                    const fSchedule = floatSchedule[f.id] ?? {};
                    return (
                      <tr key={f.id} style={{ background: 'rgba(33, 150, 243, 0.06)' }}>
                        <td style={{ ...presentationTdStyle, fontWeight: 600, color: '#1976d2' }}>{f.name}</td>
                        <td style={presentationTdStyle}>{personId ? getName(personId) : '—'}</td>
                        <td style={{ ...presentationTdStyle, fontWeight: 700 }}>{breakRot != null ? `Rot ${breakRot}` : '—'}</td>
                        {breakSlotLabels.map((_, i) => {
                          const rot = i + 1;
                          const val = fSchedule[rot];
                          const isBreak = val === 'break';
                          const covering = typeof val === 'string' && val !== '' && !isBreak ? areaLabels[val] ?? val : null;
                          return (
                            <td key={i} style={presentationTdStyle}>
                              {isBreak ? <span style={{ fontWeight: 700, color: '#1976d2' }}>On break</span> : (covering ?? '—')}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )
      )}
    </div>
  );
}

export const LineView = memo(LineViewInner);

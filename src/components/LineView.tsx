import { memo, useState, useEffect, useRef, useCallback } from 'react';
import type { AreaId, BreakSchedulesByArea, FloatSlotConfig, RosterPerson, SlotsByArea } from '../types';
import type { SkillLevel } from '../types';
import { LINE_SECTIONS, LEAD_SLOT_AREAS, areaRequiresTrainedOrExpert as defaultRequiresTrainedOrExpert } from '../types';
import { BREAK_LINE_WIDE_KEY } from '../lib/lineConfig';
import { BreakTable } from './BreakTable';
import { getSlotLabel as getSlotLabelDefault, isGenericSlotLabel } from '../lib/areaConfig';
import type { SlotLabelsByArea } from '../types';
import { getAreaRisks } from '../lib/lineViewRisks';
import { computeFloatCoverage } from '../lib/floatCoverage';
import type { FloatCoverageResult } from '../lib/floatCoverage';
import { copyTeamsPresentationToClipboard } from '../lib/copyHtmlForTeams';

const BAR_HEIGHT = 18;
const BAR_HEIGHT_COMPACT = 10;

const BREAK_SLOT_LABELS = ['First Break', 'Second Break', 'Third Break', 'Fourth Break', 'Fifth Break', 'Sixth Break'] as const;
const ROLE_PA = 'PA';

/** Teams / Outlook rich paste often drops class-based CSS but keeps `align` + inline `text-align`. */
const breakColPasteProps = { align: 'center' as const };
const breakColPasteStyle = { textAlign: 'center' as const };

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
  /** Per area: groups of slot indices sharing a label (linked slots self-cover each other). */
  linkedSlotsByArea?: Record<string, number[][]>;
  /** Legacy: ignored. Kept on the type so existing callers compile. Coverage is now
   * controlled by each float's supportedAreaIds only. */
  areaBreakCoverageEnabled?: Record<string, boolean>;
  /** Per-slot break coverage: areaId -> slotId -> true. Still consumed by computeFloatCoverage
   * to prioritize WHICH slot to cover when multiple breaks collide, but no longer required
   * for an area to receive coverage at all. */
  slotBreakCoverageEnabled?: Record<string, Record<string, boolean>>;
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
  lineSections: lineSectionsProp,
  leadSlotKeys: leadSlotKeysProp,
  getLeadSlotLabel: getLeadSlotLabelProp,
  getSlotLabel: getSlotLabelProp,
  areaRequiresTrainedOrExpert: areaRequiresTrainedOrExpertProp,
  breakSchedules,
  rotationCount = 3,
  breaksScope = 'station',
  floatSlots = [],
  linkedSlotsByArea = {},
  slotBreakCoverageEnabled = {},
}: LineViewProps) {
  const isCompact = useCompactPresentation();
  const teamsCopyRootRef = useRef<HTMLDivElement>(null);
  const [teamsCopyState, setTeamsCopyState] = useState<'idle' | 'ok' | 'err'>('idle');
  const onCopyForTeams = useCallback(async () => {
    const root = teamsCopyRootRef.current;
    if (!root) return;
    setTeamsCopyState('idle');
    const result = await copyTeamsPresentationToClipboard(root);
    if (result.ok) {
      setTeamsCopyState('ok');
      window.setTimeout(() => setTeamsCopyState('idle'), 2200);
    } else {
      setTeamsCopyState('err');
      if ('message' in result) window.alert(result.message);
      window.setTimeout(() => setTeamsCopyState('idle'), 4000);
    }
  }, []);
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
  const assignedLeadKeys = leadSlotKeys.filter((k: string) => leadSlots[k] != null && leadSlots[k] !== '');
  const firstAreaId = typeof sections[0] === 'string' ? sections[0] : sections[0]?.[0];

  const nameFontSize = 'clamp(1.1rem, 3vw, 1.28rem)';
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

  // Coverage is now controlled solely by each float's supportedAreaIds. The legacy
  // per-area / per-slot "Break cov." checkboxes have been removed from the UI: a float
  // declaring an area in supportedAreaIds is sufficient signal that the area should be
  // covered. Old data with explicit flags set is intentionally ignored so behavior is
  // predictable across configurations.
  const floatSlotsForCoverage: FloatSlotConfig[] = floatSlots;

  const floatCoverage: FloatCoverageResult = computeFloatCoverage({
    floatSlots: floatSlotsForCoverage,
    slots,
    breakSchedules: breakSchedules ?? {},
    rotationCount: rotCount,
    areaIdsInSectionOrder,
    areaLabels,
    linkedSlotsByArea,
    slotBreakCoverageEnabled,
  });

  const { floatSchedule, coverageSummary } = floatCoverage;
  const coverageSummaryFiltered = coverageSummary;

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
    const supportingFloatsRaw = floatSlotsForCoverage.filter((f) => {
      if (!f.supportedAreaIds.includes(areaId)) return false;
      const fSchedule = floatSchedule[f.id];
      return fSchedule && Object.values(fSchedule).some((v) => v.type === 'covering' && v.areaId === areaId);
    });
    const supportingFloats = supportingFloatsRaw;
    const showBreakCols = !!breakAssignments && Object.keys(breakAssignments).length > 0 && rotCount >= 1;
    const understaffed = filled < min;
    const uncoveredRotations: number[] = [];
    if (understaffed && showBreakCols && breakAssignments) {
      for (let r = 1; r <= rotCount; r++) {
        const hasSomeone = areaSlots.some((s) => s.personId && breakAssignments[s.personId]?.breakRotation === r);
        if (!hasSomeone) uncoveredRotations.push(r);
      }
    }

    const tableClassName = compact ? 'presentation-table-compact' : 'presentation-table';
    const thClassName = compact ? 'presentation-th-compact' : undefined;
    const tdClassName = compact ? 'presentation-td-compact' : undefined;
    const breakThClass = [thClassName, 'presentation-col-break'].filter(Boolean).join(' ');
    const breakTdClass = compact
      ? `${tdClassName} presentation-td-break presentation-col-break`
      : 'presentation-td-break presentation-col-break';

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
          <table className={tableClassName}>
            <thead>
              <tr>
                <th className={thClassName}>Role</th>
                <th className={thClassName}>Name</th>
                {showBreakCols && breakSlotLabels.map((label, i) => {
                  const rot = i + 1;
                  const isUncovered = uncoveredRotations.includes(rot);
                  return (
                    <th
                      key={i}
                      {...breakColPasteProps}
                      style={{
                        ...breakColPasteStyle,
                        ...(isUncovered ? { color: '#c0392b', fontWeight: 700, background: 'rgba(192, 57, 43, 0.08)' } : {}),
                      }}
                      className={breakThClass}
                      title={isUncovered ? 'Uncovered break — no one in this area is off during this slot' : undefined}
                    >
                      {label}
                      {isUncovered && <div style={{ fontSize: '0.7em', marginTop: 2, textAlign: 'center' }}>Uncovered</div>}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {(() => {
                let prevRole = '';
                return allSlots.map((slot, idx) => {
                if (slot.disabled) return null;
                if (!slot.personId) return null;
                const slotLabel = getLabel(areaId, idx);
                const roleDisplay = isGenericSlotLabel(slotLabel) ? ROLE_PA : slotLabel;
                const showRole = roleDisplay !== prevRole;
                prevRole = roleDisplay;
                const name = getName(slot.personId);
                const skill = getSkillInArea(areaId, slot.personId);
                const breakRot = slot.personId && breakAssignments?.[slot.personId]?.breakRotation;
                return (
                  <tr key={slot.id}>
                    <td className={tdClassName}>{showRole ? roleDisplay : ''}</td>
                    <td className={tdClassName}>
                      <span className={`skill-name-${skill}`} style={compact ? undefined : { fontSize: nameFontSize, fontWeight: 600 }}>
                        {name}
                      </span>
                    </td>
                    {showBreakCols && breakSlotLabels.map((_, i) => {
                      const rot = i + 1;
                      const isOnBreak = breakRot === rot;
                      return (
                        <td
                          key={i}
                          {...breakColPasteProps}
                          style={breakColPasteStyle}
                          className={breakTdClass}
                        >
                          {isOnBreak ? (
                            <span style={{ fontWeight: 700, fontSize: compact ? undefined : '0.95rem' }}>{name}</span>
                          ) : (
                            ''
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              });
              })()}
              {supportingFloats.map((f) => {
                const personId = slots[f.id]?.[0]?.personId ?? null;
                const fSchedule = floatSchedule[f.id];
                return (
                  <tr key={f.id} style={{ background: 'rgba(33, 150, 243, 0.08)', borderTop: '1px solid rgba(33, 150, 243, 0.3)' }}>
                    <td className={tdClassName}>
                      <span style={{ fontWeight: 600, color: '#1976d2' }}>Break Coverage</span>
                    </td>
                    <td className={tdClassName}>
                      <span style={compact ? undefined : { fontSize: nameFontSize, fontWeight: 600 }}>
                        {personId ? getName(personId) : '—'}
                      </span>
                    </td>
                    {showBreakCols && breakSlotLabels.map((_, i) => {
                      const rot = i + 1;
                      const activity = fSchedule?.[rot];
                      const coveringHere = activity?.type === 'covering' && activity.areaId === areaId;
                      const onBreak = activity?.type === 'on_break';
                      const coveringElsewhere = activity?.type === 'covering' && activity.areaId !== areaId;
                      const coveredPersonId = activity?.type === 'covering' && 'slotIndex' in activity && activity.slotIndex !== undefined
                        ? slots[activity.areaId]?.[activity.slotIndex]?.personId ?? null
                        : null;
                      const coveredName = coveredPersonId ? getName(coveredPersonId) : null;
                      const coveringLabel = coveredName ? `Covering ${coveredName}` : (activity?.type === 'covering' ? `At ${areaLabels[activity.areaId] ?? activity.areaId}` : null);
                      return (
                        <td key={i} {...breakColPasteProps} style={breakColPasteStyle} className={breakTdClass}>
                          {coveringHere
                            ? <span style={{ fontWeight: 700, fontSize: compact ? undefined : '0.85rem', color: '#1976d2' }}>{coveringLabel ?? 'Covering'}</span>
                            : onBreak
                              ? <span style={{ color: '#888', fontSize: compact ? undefined : '0.85rem' }}>On break</span>
                              : coveringElsewhere
                                ? <span style={{ color: '#bbb', fontSize: compact ? undefined : '0.85rem' }}>{coveringLabel ?? '—'}</span>
                                : <span style={{ color: '#ccc' }}>&mdash;</span>}
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
      <div ref={teamsCopyRootRef}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto',
            gap: isCompact ? 8 : 14,
            alignItems: 'center',
            marginBottom: isCompact ? 8 : 20,
          }}
        >
          <header className="line-view-summary" style={{ marginBottom: 0, paddingBottom: isCompact ? 0 : 12, borderBottom: '1px solid var(--color-border-light, #e8e8e8)' }}>
            {isCompact ? (
              <div className="line-view-summary-compact">
                <span className="line-view-headline-compact">{totalOnLine}/{fullStaff}</span>
              </div>
            ) : (
              <div className="line-view-headline" style={{ fontSize: 'clamp(1.75rem, 6vw, 2.25rem)', fontWeight: 700, color: '#1a1a1a', letterSpacing: '-0.02em' }}>
                {totalOnLine}/{fullStaff}
              </div>
            )}
          </header>
          <button
            type="button"
            className="btn-primary"
            data-teams-copy-exclude
            onClick={onCopyForTeams}
            style={{ whiteSpace: 'nowrap', fontSize: isCompact ? '0.75rem' : undefined, padding: isCompact ? '6px 10px' : undefined }}
            aria-label="Copy staffing view as HTML for Microsoft Teams"
          >
            {teamsCopyState === 'ok' ? 'Copied!' : teamsCopyState === 'err' ? 'Copy failed' : 'Copy for Teams'}
          </button>
        </div>

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
        if (isCombined) {
          const [idA, idB] = section as [string, string];
          const slotsA = slots[idA] ?? [];
          const slotsB = slots[idB] ?? [];
          return (
            <section key={rowKey} className={isCompact ? 'presentation-section-compact' : 'section-card'} style={isCompact ? { padding: 6, marginBottom: 8 } : undefined}>
              <h2 style={isCompact ? { fontSize: '0.8rem', marginBottom: 4 } : undefined}>{areaLabels[idA] ?? idA} & {areaLabels[idB] ?? idB}</h2>
              {renderCombinedAreaTable(idA, slotsA, { subLabel: areaLabels[idA] ?? idA, compact: isCompact })}
              {renderCombinedAreaTable(idB, slotsB, { subLabel: areaLabels[idB] ?? idB, compact: isCompact })}
            </section>
          );
        }
        const areaId = section as string;
        const allAreaSlots = slots[areaId] ?? [];
        const areaLabel = areaLabels[areaId] ?? areaId;
        return (
          <section key={rowKey} className={isCompact ? 'presentation-section-compact' : 'section-card'} style={isCompact ? { padding: 6, marginBottom: 8 } : undefined}>
            {renderCombinedAreaTable(areaId, allAreaSlots, { subLabel: areaLabel, compact: isCompact })}
          </section>
        );
      })}

      {floatSlots.length > 0 && (
        isCompact ? (
          <section className="presentation-section-compact" style={{ padding: 6, marginTop: 8, marginBottom: 8 }}>
            <h2 style={{ fontSize: '0.8rem', marginBottom: 4 }}>Float schedule</h2>
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
                        const activity = fSchedule[rot];
                        const isBreak = activity?.type === 'on_break';
                        const covering = activity?.type === 'covering'
                          ? ('slotIndex' in activity && activity.slotIndex !== undefined
                              ? (() => {
                                  const pid = slots[activity.areaId]?.[activity.slotIndex]?.personId;
                                  return pid ? `Covering ${getName(pid)}` : (areaLabels[activity.areaId] ?? activity.areaId);
                                })()
                              : (areaLabels[activity.areaId] ?? activity.areaId))
                          : null;
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
          <section className="section-card" style={{ marginTop: 8 }}>
            <h2>Float schedule</h2>
            <p style={{ fontSize: '0.9rem', color: '#555', margin: '0 0 12px 0' }}>Each float is in one place per slot — covering one area or on break.</p>
            <div style={{ overflowX: 'auto' }}>
              <table className="presentation-table">
                <thead>
                  <tr>
                    <th>Float</th>
                    <th>Assigned</th>
                    {breakSlotLabels.map((label, i) => (
                      <th key={i} className="presentation-col-break" {...breakColPasteProps} style={breakColPasteStyle}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {floatSlots.map((f) => {
                    const personId = slots[f.id]?.[0]?.personId ?? null;
                    const fSchedule = floatSchedule[f.id] ?? {};
                    return (
                      <tr key={f.id} style={{ background: 'rgba(33, 150, 243, 0.06)' }}>
                        <td style={{ fontWeight: 600, color: '#1976d2' }}>{f.name}</td>
                        <td>{personId ? getName(personId) : '—'}</td>
                        {breakSlotLabels.map((_, i) => {
                          const rot = i + 1;
                          const activity = fSchedule[rot];
                          const coveringDisplay = activity?.type === 'covering'
                            ? ('slotIndex' in activity && activity.slotIndex !== undefined
                                ? (() => {
                                    const pid = slots[activity.areaId]?.[activity.slotIndex]?.personId;
                                    return pid ? `Covering ${getName(pid)}` : (areaLabels[activity.areaId] ?? activity.areaId);
                                  })()
                                : (areaLabels[activity.areaId] ?? activity.areaId))
                            : null;
                          return (
                            <td key={i} className="presentation-col-break" {...breakColPasteProps} style={breakColPasteStyle}>
                              {activity?.type === 'on_break'
                                ? <span style={{ fontWeight: 700, color: '#1976d2' }}>On break</span>
                                : activity?.type === 'covering'
                                  ? <span style={{ fontWeight: 700 }}>{coveringDisplay}</span>
                                  : '—'}
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

      {assignedLeadKeys.length > 0 && (
        isCompact ? (
          <section className="presentation-section-compact" style={{ padding: 6, marginBottom: 8 }} data-teams-copy-exclude="">
            <h2 style={{ fontSize: '0.8rem', marginBottom: 4 }}>Leads</h2>
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
          <section className="section-card" style={{ marginTop: 8 }} data-teams-copy-exclude="">
            <h2>Leads</h2>
            <div style={{ overflowX: 'auto' }}>
              <table className="presentation-table">
                <thead>
                  <tr>
                    <th>Position</th>
                    <th>Name</th>
                  </tr>
                </thead>
                <tbody>
                  {assignedLeadKeys.map((key: string) => {
                    const personId = leadSlots[key]!;
                    const skillAreaId = /^\d+$/.test(key) ? (firstAreaId ?? '') : key;
                    const skill = getSkillInArea(skillAreaId as AreaId, personId);
                    return (
                      <tr key={key}>
                        <td>{getLeadSlotLabel(key)}</td>
                        <td>
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

      {((floatSlots.length > 0) || (coverageSummaryFiltered.length > 0 && coverageSummaryFiltered.some((row) => row.slots.some((s) => s.peopleOnBreak > 0)))) && (
        isCompact ? (
          <section className="presentation-section-compact" style={{ padding: 6, marginTop: 8, marginBottom: 8 }} data-teams-copy-exclude="">
            <h2 style={{ fontSize: '0.8rem', marginBottom: 4 }}>Break coverage</h2>
            <p style={{ fontSize: '0.75rem', color: '#555', margin: '0 0 6px 0' }}>Float-supported areas only. Areas at full staff without a float manage breaks internally.</p>
            {floatSlots.length > 0 && (
              <>
                <h3 style={{ fontSize: '0.75rem', margin: '8px 0 4px 0', color: '#1976d2' }}>Floats (covering / on break)</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                  {floatSlots.map((f) => {
                    const personId = slots[f.id]?.[0]?.personId ?? null;
                    const fSchedule = floatSchedule[f.id] ?? {};
                    return (
                      <div key={f.id} style={{ padding: 8, background: 'rgba(33, 150, 243, 0.06)', border: '1px solid rgba(33, 150, 243, 0.3)', borderRadius: 6, fontSize: '0.85rem' }}>
                        <strong style={{ color: '#1976d2' }}>{f.name}</strong>
                        <span style={{ color: '#555' }}> — {personId ? getName(personId) : '—'}</span>
                        <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                          {breakSlotLabels.map((label, i) => {
                            const rot = i + 1;
                            const activity = fSchedule[rot];
                            const isBreak = activity?.type === 'on_break';
                            const covering = activity?.type === 'covering'
                              ? ('slotIndex' in activity && activity.slotIndex !== undefined
                                  ? (() => {
                                      const pid = slots[activity.areaId]?.[activity.slotIndex]?.personId;
                                      return pid ? `Covering ${getName(pid)}` : (areaLabels[activity.areaId] ?? activity.areaId);
                                    })()
                                  : (areaLabels[activity.areaId] ?? activity.areaId))
                              : null;
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
              </>
            )}
            {coverageSummaryFiltered.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table className="presentation-table-compact">
                <thead>
                  <tr>
                    <th className="presentation-th-compact">Area</th>
                    {breakSlotLabels.map((label, i) => (
                      <th key={i} className="presentation-th-compact presentation-col-break" {...breakColPasteProps} style={breakColPasteStyle}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {coverageSummaryFiltered.map((row) => (
                    <tr key={row.areaId}>
                      <td className="presentation-td-compact" style={{ fontWeight: 600 }}>{row.areaLabel}</td>
                      {row.slots.map((s, i) => {
                        if (s.peopleOnBreak === 0) {
                          return <td key={i} className="presentation-td-compact presentation-col-break" {...breakColPasteProps} style={{ ...breakColPasteStyle, color: '#bbb' }}>&mdash;</td>;
                        }
                        const floatPersonId = s.coveredByFloatId ? (slots[s.coveredByFloatId]?.[0]?.personId ?? null) : null;
                        return (
                          <td
                            key={i}
                            className="presentation-td-compact presentation-col-break"
                            {...breakColPasteProps}
                            style={{
                              ...breakColPasteStyle,
                              background: s.uncovered ? 'rgba(192, 57, 43, 0.10)' : 'rgba(39, 174, 96, 0.10)',
                              color: s.uncovered ? '#c0392b' : '#27ae60',
                              fontWeight: 600,
                            }}
                          >
                            {s.uncovered ? 'Uncovered' : getName(floatPersonId)}
                            {s.peopleOnBreak > 1 && <div style={{ fontSize: '0.7em', opacity: 0.7 }}>{s.peopleOnBreak} on break</div>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            )}
          </section>
        ) : (
          <section className="section-card" style={{ marginTop: 8 }} data-teams-copy-exclude="">
            <h2>Break coverage</h2>
            <p style={{ fontSize: '0.9rem', color: '#555', margin: '0 0 12px 0' }}>Float-supported areas only. Areas at full staff without a float manage breaks internally.</p>
            {floatSlots.length > 0 && (
              <>
                <h3 style={{ fontSize: '0.9rem', margin: '0 0 8px 0', color: '#1976d2' }}>Floats (covering / on break)</h3>
                <div style={{ overflowX: 'auto', marginBottom: 16 }}>
                  <table className="presentation-table">
                    <thead>
                      <tr>
                        <th>Float</th>
                        <th>Assigned</th>
                        {breakSlotLabels.map((label, i) => (
                          <th key={i} className="presentation-col-break" {...breakColPasteProps} style={breakColPasteStyle}>
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {floatSlots.map((f) => {
                        const personId = slots[f.id]?.[0]?.personId ?? null;
                        const fSchedule = floatSchedule[f.id] ?? {};
                        return (
                          <tr key={f.id} style={{ background: 'rgba(33, 150, 243, 0.06)' }}>
                            <td style={{ fontWeight: 600, color: '#1976d2' }}>{f.name}</td>
                            <td>{personId ? getName(personId) : '—'}</td>
                            {breakSlotLabels.map((_, i) => {
                              const rot = i + 1;
                              const activity = fSchedule[rot];
                              const coveringDisplay = activity?.type === 'covering'
                                ? ('slotIndex' in activity && activity.slotIndex !== undefined
                                    ? (() => {
                                        const pid = slots[activity.areaId]?.[activity.slotIndex]?.personId;
                                        return pid ? `Covering ${getName(pid)}` : (areaLabels[activity.areaId] ?? activity.areaId);
                                      })()
                                    : (areaLabels[activity.areaId] ?? activity.areaId))
                                : null;
                              return (
                                <td key={i} className="presentation-col-break" {...breakColPasteProps} style={breakColPasteStyle}>
                                  {activity?.type === 'on_break'
                                    ? <span style={{ fontWeight: 700, color: '#1976d2' }}>On break</span>
                                    : activity?.type === 'covering'
                                      ? <span style={{ fontWeight: 700 }}>{coveringDisplay}</span>
                                      : '—'}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {coverageSummaryFiltered.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table className="presentation-table">
                <thead>
                  <tr>
                    <th>Area</th>
                    {breakSlotLabels.map((label, i) => (
                      <th key={i} className="presentation-col-break" {...breakColPasteProps} style={breakColPasteStyle}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {coverageSummaryFiltered.map((row) => (
                    <tr key={row.areaId}>
                      <td style={{ fontWeight: 600 }}>{row.areaLabel}</td>
                      {row.slots.map((s, i) => {
                        if (s.peopleOnBreak === 0) {
                          return <td key={i} className="presentation-col-break" {...breakColPasteProps} style={{ ...breakColPasteStyle, color: '#bbb' }}>&mdash;</td>;
                        }
                        const floatPersonId = s.coveredByFloatId ? (slots[s.coveredByFloatId]?.[0]?.personId ?? null) : null;
                        return (
                          <td
                            key={i}
                            className="presentation-col-break"
                            {...breakColPasteProps}
                            style={{
                              ...breakColPasteStyle,
                              background: s.uncovered ? 'rgba(192, 57, 43, 0.10)' : 'rgba(39, 174, 96, 0.10)',
                              color: s.uncovered ? '#c0392b' : '#27ae60',
                              fontWeight: 600,
                            }}
                          >
                            {s.uncovered ? 'Uncovered' : getName(floatPersonId)}
                            {s.peopleOnBreak > 1 && <div style={{ fontSize: '0.8em', opacity: 0.7 }}>{s.peopleOnBreak} on break</div>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            )}
          </section>
        )
      )}
      </div>
    </div>
  );
}

export const LineView = memo(LineViewInner);

import { memo, type CSSProperties } from 'react';
import type { AreaId, BreakSchedulesByArea, RosterPerson, SlotsByArea } from '../types';
import type { SkillLevel } from '../types';
import { LINE_SECTIONS, LEAD_SLOT_AREAS, areaRequiresTrainedOrExpert as defaultRequiresTrainedOrExpert } from '../types';
import { BREAK_LINE_WIDE_KEY } from '../lib/lineConfig';
import { BreakTable } from './BreakTable';
import { getSlotLabel as getSlotLabelDefault, isGenericSlotLabel } from '../lib/areaConfig';
import type { SlotLabelsByArea } from '../types';
import { getAreaRisks } from '../lib/lineViewRisks';

const SKILL_SCORE: Record<SkillLevel, number> = {
  no_experience: 0,
  training: 1,
  trained: 2,
  expert: 3,
};

function averageKnowledge(areaId: AreaId, slots: { personId: string | null }[], roster: RosterPerson[]): number | null {
  const personIds = slots.map((s) => s.personId).filter(Boolean) as string[];
  if (personIds.length === 0) return null;
  let sum = 0;
  for (const id of personIds) {
    const p = roster.find((r) => r.id === id);
    if (p) sum += SKILL_SCORE[p.skills[areaId] ?? 'no_experience'];
  }
  return sum / personIds.length;
}

const BAR_HEIGHT = 18;

function KnowledgeBar({ position }: { position: number | null }) {
  return (
    <div className="seniority-spectrum-wrap" style={{ marginBottom: 0 }}>
      <div className="seniority-spectrum" style={{ position: 'relative', height: BAR_HEIGHT, borderRadius: 4, overflow: 'hidden', display: 'flex' }}>
        <div className="skill-no_experience" style={{ flex: 1, minWidth: 0 }} />
        <div className="skill-training" style={{ flex: 1, minWidth: 0 }} />
        <div className="skill-trained" style={{ flex: 1, minWidth: 0 }} />
        <div className="skill-expert" style={{ flex: 1, minWidth: 0 }} />
        {position != null && (
          <div
            className="seniority-spectrum-arrow"
            style={{
              position: 'absolute',
              left: `clamp(4px, ${position}%, calc(100% - 8px))`,
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
  /** For custom lines: area IDs that have a lead slot. Omit for IC. */
  leadAreaIds?: string[];
  getSlotLabel?: (areaId: string, slotIndex: number) => string;
  areaRequiresTrainedOrExpert?: (areaId: string) => boolean;
  /** For presentation mode: break schedules per area (or __line__ for line-wide). */
  breakSchedules?: BreakSchedulesByArea;
  /** Number of rotations (1–6). */
  rotationCount?: number;
  /** 'line' = one set for whole line; 'station' = per area. */
  breaksScope?: 'line' | 'station';
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
  leadAreaIds: leadAreaIdsProp,
  getSlotLabel: getSlotLabelProp,
  areaRequiresTrainedOrExpert: areaRequiresTrainedOrExpertProp,
  breakSchedules,
  rotationCount = 3,
  breaksScope = 'station',
}: LineViewProps) {
  const sections = lineSectionsProp ?? LINE_SECTIONS;
  const leadAreaIds = leadAreaIdsProp ?? [...LEAD_SLOT_AREAS];
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
  const assignedLeadAreas = leadAreaIds.filter((areaId) => leadSlots[areaId] != null && leadSlots[areaId] !== '');

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
  const titleRowStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
    flexWrap: 'wrap',
  };
  const alertStyle: CSSProperties = {
    fontSize: '0.95rem',
    fontWeight: 600,
    color: '#c0392b',
    marginBottom: 8,
    lineHeight: 1.4,
  };
  const staffRowStyle: CSSProperties = {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '10px 16px',
    fontSize: '1rem',
    lineHeight: 1.5,
  };
  const nameFontSize = '1.28rem';

  const presentationTableStyle: CSSProperties = {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '1.05rem',
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

  /** Renders one area's staffing as a table (Role | Name) with optional metric title. */
  const renderStaffingTable = (
    areaId: string,
    allSlots: { id: string; personId: string | null; disabled?: boolean }[],
    options?: { subLabel?: string; hideTitle?: boolean }
  ) => {
    const subLabel = options?.subLabel ?? areaLabels[areaId];
    const hideTitle = options?.hideTitle;
    const areaSlots = allSlots.filter((s) => !s.disabled);
    const disabledLabels = allSlots
      .map((s, idx) => (s.disabled ? getLabel(areaId, idx) : null))
      .filter((l): l is string => l != null);
    const filled = areaSlots.filter((s) => s.personId).length;
    const min = effectiveCapacity[areaId]?.min ?? 0;
    const max = effectiveCapacity[areaId]?.max ?? min;
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
    const hasRoleLabels = areaSlots.some((s, idx) => !isGenericSlotLabel(getLabel(areaId, idx)));

    return (
      <div key={areaId} style={{ marginBottom: 12 }}>
        {!hideTitle && (
          <h3 style={{ margin: '0 0 8px 0', fontWeight: 700, fontSize: '1.15rem' }}>
            {subLabel} — {metricText}{metricExtra}
          </h3>
        )}
        <div style={{ overflowX: 'auto' }}>
          <table style={presentationTableStyle}>
            <thead>
              <tr>
                {hasRoleLabels && <th style={presentationThStyle}>Role</th>}
                <th style={presentationThStyle}>Name</th>
              </tr>
            </thead>
            <tbody>
              {areaSlots.map((slot, idx) => {
                const slotLabel = getLabel(areaId, idx);
                const name = getName(slot.personId);
                const skill = getSkillInArea(areaId, slot.personId);
                const showLabel = !isGenericSlotLabel(slotLabel);
                return (
                  <tr key={slot.id}>
                    {hasRoleLabels && (
                      <td style={presentationTdStyle}>
                        {showLabel ? slotLabel : '—'}
                      </td>
                    )}
                    <td style={presentationTdStyle}>
                      <span className={`skill-name-${skill}`} style={{ fontSize: nameFontSize, fontWeight: 600 }}>
                        {name}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderAreaBlock = (
    areaId: string,
    allSlots: { id: string; personId: string | null; disabled?: boolean }[],
    options?: { subLabel?: string; hideTitleRow?: boolean }
  ) => {
    const subLabel = options?.subLabel;
    const hideTitleRow = options?.hideTitleRow;
    const areaSlots = allSlots.filter((s) => !s.disabled);
    const disabledLabels = allSlots
      .map((s, idx) => (s.disabled ? getLabel(areaId, idx) : null))
      .filter((l): l is string => l != null);
    const filled = areaSlots.filter((s) => s.personId).length;
    const min = effectiveCapacity[areaId]?.min ?? 0;
    const disabledCount = allSlots.length - areaSlots.length;
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
      disabledCount,
      needsTrainedOrExpert: areaRequiresTrained && filled >= 1 && !hasTrainedOrExpert,
    });
    const avgKnowledge = averageKnowledge(areaId, areaSlots, roster);
    const spectrumPos = avgKnowledge != null ? (avgKnowledge / 3) * 100 : null;
    const alerts = [
      ...disabledLabels.map((l) => `${l} disabled`),
      ...risks,
    ].filter(Boolean);

    return (
      <div key={areaId} style={{ marginBottom: subLabel ? 14 : 0 }}>
        {hideTitleRow ? (
          <div style={{ ...titleRowStyle, marginBottom: 6 }}>
            <div style={{ width: 72, flexShrink: 0 }}>
              <KnowledgeBar position={spectrumPos} />
            </div>
          </div>
        ) : (
          <div style={titleRowStyle}>
            <span style={{ fontSize: '1rem', fontWeight: 600, color: '#333' }}>
              {subLabel ?? areaLabels[areaId]}
            </span>
            <div style={{ width: 72, flexShrink: 0 }}>
              <KnowledgeBar position={spectrumPos} />
            </div>
          </div>
        )}
        {alerts.length > 0 && (
          <div style={alertStyle}>{alerts.join(' · ')}</div>
        )}
        <div style={staffRowStyle}>
          {allSlots.map((slot, idx) => {
            if (slot.disabled) return null;
            const slotLabel = getLabel(areaId, idx);
            const name = getName(slot.personId);
            const skill = getSkillInArea(areaId, slot.personId);
            const showLabel = !isGenericSlotLabel(slotLabel);
            return (
              <span key={slot.id}>
                {showLabel ? (
                  <>
                    <span style={{ color: '#666', marginRight: 6, fontSize: '0.95rem' }}>{slotLabel}:</span>
                    <span className={`skill-name-${skill}`} style={{ fontSize: nameFontSize, fontWeight: 600 }}>{name}</span>
                  </>
                ) : (
                  <span className={`skill-name-${skill}`} style={{ fontSize: nameFontSize, fontWeight: 600 }}>{name}</span>
                )}
              </span>
            );
          })}
        </div>
      </div>
    );
  };

  const rotCount = Math.min(6, Math.max(1, rotationCount));
  const renderBreakMatrix = (areaId: string, areaLabel: string) => {
    const assignments = breakSchedules?.[areaId];
    if (!assignments || Object.keys(assignments).length === 0 || rotationCount < 1) return null;
    return (
      <BreakTable
        key={`break-${areaId}`}
        people={Object.keys(assignments).map((id) => {
          const p = roster.find((r) => r.id === id);
          return { id, name: p?.name ?? id };
        })}
        assignments={assignments}
        rotationCount={rotCount}
        title={`${areaLabel} — Rotations`}
        presentationMode
      />
    );
  };

  return (
    <div className="line-view" style={{ maxWidth: 960, margin: '0 auto', padding: '0 16px 80px' }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#1a1a1a', marginBottom: 12 }}>
          {totalOnLine}/{fullStaff}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
          <div style={{ minWidth: 160 }}>
            <div style={{ fontSize: '0.85rem', marginBottom: 4, color: '#555', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em' }}>Staffing</div>
            <div style={{ height: BAR_HEIGHT, borderRadius: 6, overflow: 'hidden', background: '#eee', position: 'relative' }}>
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
            <div style={{ fontSize: '0.9rem', marginTop: 4, color: '#333' }}>{staffingPct}%</div>
          </div>
          <div style={{ minWidth: 160 }}>
            <div style={{ fontSize: '0.85rem', marginBottom: 4, color: '#555', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em' }}>Knowledge</div>
            <KnowledgeBar position={knowledgePosition} />
            <div style={{ fontSize: '0.9rem', marginTop: 4, color: '#333' }}>
              {lineHealthScore != null ? `${(lineHealthScore).toFixed(1)} / 3` : '—'}
            </div>
          </div>
        </div>
      </div>

      {assignedLeadAreas.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'start', marginBottom: 20 }}>
          <section style={sectionStyle}>
            <h2 style={sectionTitleStyle}>Leads</h2>
            <div style={{ overflowX: 'auto' }}>
              <table style={presentationTableStyle}>
                <thead>
                  <tr>
                    <th style={presentationThStyle}>Area</th>
                    <th style={presentationThStyle}>Name</th>
                  </tr>
                </thead>
                <tbody>
                  {assignedLeadAreas.map((areaId) => {
                    const personId = leadSlots[areaId]!;
                    const skill = getSkillInArea(areaId, personId);
                    return (
                      <tr key={areaId}>
                        <td style={presentationTdStyle}>{areaLabels[areaId]}</td>
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
          <div>
            {breaksScope === 'line' && breakSchedules?.[BREAK_LINE_WIDE_KEY] && Object.keys(breakSchedules[BREAK_LINE_WIDE_KEY]).length > 0 && rotationCount >= 1 && (
              <BreakTable
                people={Object.keys(breakSchedules[BREAK_LINE_WIDE_KEY]).map((id) => {
                  const p = roster.find((r) => r.id === id);
                  return { id, name: p?.name ?? id };
                })}
                assignments={breakSchedules[BREAK_LINE_WIDE_KEY]}
                rotationCount={rotCount}
                title="Rotations"
                presentationMode
              />
            )}
          </div>
        </div>
      )}

      {breaksScope === 'line' && breakSchedules?.[BREAK_LINE_WIDE_KEY] && Object.keys(breakSchedules[BREAK_LINE_WIDE_KEY]).length > 0 && rotationCount >= 1 && assignedLeadAreas.length === 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'start', marginBottom: 20 }}>
          <div />
          <BreakTable
            people={Object.keys(breakSchedules[BREAK_LINE_WIDE_KEY]).map((id) => {
              const p = roster.find((r) => r.id === id);
              return { id, name: p?.name ?? id };
            })}
            assignments={breakSchedules[BREAK_LINE_WIDE_KEY]}
            rotationCount={rotCount}
            title="Rotations"
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
            <div key={rowKey} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'start', marginBottom: 20 }}>
              <section style={sectionStyle}>
                <h2 style={sectionTitleStyle}>{areaLabels[idA] ?? idA} & {areaLabels[idB] ?? idB}</h2>
                {renderStaffingTable(idA, slotsA, { subLabel: areaLabels[idA] ?? idA })}
                {renderStaffingTable(idB, slotsB, { subLabel: areaLabels[idB] ?? idB })}
              </section>
              <div>
                {renderBreakMatrix(idA, areaLabels[idA] ?? idA)}
                {renderBreakMatrix(idB, areaLabels[idB] ?? idB)}
              </div>
            </div>
          );
        }
        const areaId = section as string;
        const allAreaSlots = slots[areaId] ?? [];
        const areaLabel = areaLabels[areaId] ?? areaId;
        const areaSlots = allAreaSlots.filter((s) => !s.disabled);
        const filled = areaSlots.filter((s) => s.personId).length;
        const min = effectiveCapacity[areaId]?.min ?? 0;
        const risks = getAreaRisks({
          filled,
          min,
          disabledCount: allAreaSlots.length - areaSlots.length,
          needsTrainedOrExpert: requiresTrainedOrExpert(areaId) && filled >= 1 && !areaSlots.some((s) => {
            if (!s.personId) return false;
            const p = roster.find((r) => r.id === s.personId);
            const sk = p?.skills[areaId] ?? 'no_experience';
            return sk === 'trained' || sk === 'expert';
          }),
        });
        const metricExtra = risks.length > 0 ? ` · ${risks.join(' · ')}` : '';
        return (
          <div key={rowKey} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'start', marginBottom: 20 }}>
            <section style={sectionStyle}>
              <h2 style={sectionTitleStyle}>{areaLabel} — {filled}/{min}{metricExtra}</h2>
              {renderStaffingTable(areaId, allAreaSlots, { hideTitle: true })}
            </section>
            <div>
              {renderBreakMatrix(areaId, areaLabel)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export const LineView = memo(LineViewInner);

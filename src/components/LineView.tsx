import { memo, type CSSProperties } from 'react';
import type { AreaId, BreakSchedulesByArea, RosterPerson, SlotsByArea } from '../types';
import type { SkillLevel } from '../types';
import { LINE_SECTIONS, LEAD_SLOT_AREAS, areaRequiresTrainedOrExpert as defaultRequiresTrainedOrExpert } from '../types';
import { BREAK_LINE_WIDE_KEY } from '../lib/lineConfig';
import { BreakTable } from './BreakTable';
import { getSlotLabel as getSlotLabelDefault, isGenericSlotLabel } from '../lib/areaConfig';
import type { SlotLabelsByArea } from '../types';
import { getAreaRisks } from '../lib/lineViewRisks';

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
}: LineViewProps) {
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

  /** Renders one area's staffing as a table (Role | Name) with optional metric title. */
  const renderStaffingTable = (
    areaId: string,
    allSlots: { id: string; personId: string | null; disabled?: boolean }[],
    options?: { subLabel?: string; hideTitle?: boolean }
  ) => {
    const subLabel = options?.subLabel ?? areaLabels[areaId];
    const hideTitle = options?.hideTitle;
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
    const hasRoleLabels = areaSlots.some((_, idx) => !isGenericSlotLabel(getLabel(areaId, idx)));
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

    return (
      <div key={areaId} className="presentation-area-block" style={{ marginBottom: 16 }}>
        {!hideTitle && (
          <div className="presentation-area-header" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
            <h3 style={{ margin: 0, fontWeight: 700, fontSize: 'clamp(1.05rem, 2.5vw, 1.2rem)' }}>
              {subLabel} — {metricText}{metricExtra}
            </h3>
            <div className="presentation-area-bar" style={{ flex: '1 1 100px', minWidth: 100, maxWidth: 180 }}>
              <KnowledgeBar position={areaKnowledgePosition} />
            </div>
          </div>
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
              {allSlots.map((slot, idx) => {
                if (slot.disabled) return null;
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
        title={`${areaLabel} — Break Schedule`}
        presentationMode
      />
    );
  };

  return (
    <div className="line-view line-view-presentation" style={{ maxWidth: 960, margin: '0 auto', padding: '12px 16px 80px' }}>
      <header className="line-view-summary" style={{ marginBottom: 20 }}>
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
            <span style={{ fontSize: '0.8rem', color: '#555', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Knowledge</span>
            <div style={{ width: 100, flexShrink: 0 }}>
              <KnowledgeBar position={knowledgePosition} />
            </div>
            <span style={{ fontSize: '1rem', fontWeight: 600, color: '#1a1a1a' }}>
              {lineHealthScore != null ? `${(lineHealthScore).toFixed(1)}/3` : '—'}
            </span>
          </div>
        </div>
      </header>

      {assignedLeadKeys.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: COLUMNS_GRID, gap: 24, alignItems: 'start', marginBottom: 20 }}>
          <section style={sectionStyle}>
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
          <div>
            {breaksScope === 'line' && breakSchedules?.[BREAK_LINE_WIDE_KEY] && Object.keys(breakSchedules[BREAK_LINE_WIDE_KEY]).length > 0 && rotationCount >= 1 && (
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
            )}
          </div>
        </div>
      )}

      {breaksScope === 'line' && breakSchedules?.[BREAK_LINE_WIDE_KEY] && Object.keys(breakSchedules[BREAK_LINE_WIDE_KEY]).length > 0 && rotationCount >= 1 && assignedLeadKeys.length === 0 && (
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
            <div key={rowKey} className="presentation-row" style={{ display: 'grid', gridTemplateColumns: COLUMNS_GRID, gap: 24, alignItems: 'start', marginBottom: 20 }}>
              <section style={sectionStyle}>
                <h2 style={sectionTitleStyle}>{areaLabels[idA] ?? idA} & {areaLabels[idB] ?? idB}</h2>
                {renderStaffingTable(idA, slotsA, { subLabel: areaLabels[idA] ?? idA })}
                {renderStaffingTable(idB, slotsB, { subLabel: areaLabels[idB] ?? idB })}
              </section>
              <div className="presentation-breaks">
                {renderBreakMatrix(idA, areaLabels[idA] ?? idA)}
                {renderBreakMatrix(idB, areaLabels[idB] ?? idB)}
              </div>
            </div>
          );
        }
        const areaId = section as string;
        const allAreaSlots = slots[areaId] ?? [];
        const areaLabel = areaLabels[areaId] ?? areaId;
        return (
          <div key={rowKey} className="presentation-row" style={{ display: 'grid', gridTemplateColumns: COLUMNS_GRID, gap: 24, alignItems: 'start', marginBottom: 20 }}>
            <section style={sectionStyle}>
              {renderStaffingTable(areaId, allAreaSlots)}
            </section>
            <div className="presentation-breaks">
              {renderBreakMatrix(areaId, areaLabel)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export const LineView = memo(LineViewInner);

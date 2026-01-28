import { memo } from 'react';
import type { AreaId, LeadSlotAreaId, RosterPerson, SlotsByArea } from '../types';
import type { SkillLevel } from '../types';
import { LINE_SECTIONS, isCombinedSection, COMBINED_14_5_FLIP, LEAD_SLOT_AREAS, areaRequiresTrainedOrExpert } from '../types';
import { getSlotLabel } from '../lib/areaConfig';
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

function KnowledgeBar({ position }: { position: number | null }) {
  return (
    <div className="seniority-spectrum-wrap" style={{ marginBottom: 0 }}>
      <div className="seniority-spectrum" style={{ position: 'relative', height: 14, borderRadius: 4, overflow: 'hidden', display: 'flex' }}>
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
  leadSlots: Record<LeadSlotAreaId, string | null>;
  areaLabels: Record<AreaId, string>;
  slotLabelsByArea: SlotLabelsByArea;
  effectiveCapacity: Record<AreaId, { min: number; max: number }>;
  totalOnLine: number;
  fullStaff: number;
  /** 0–100 */
  staffingPct: number;
  /** 0–3 average knowledge, or null if no one on line */
  lineHealthScore: number | null;
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
}: LineViewProps) {
  const getName = (personId: string | null) =>
    personId ? (roster.find((p) => p.id === personId)?.name ?? '—') : '—';
  const knowledgePosition = lineHealthScore != null ? (lineHealthScore / 3) * 100 : null;

  return (
    <div className="line-view" style={{ maxWidth: 520, margin: '0 auto', padding: '0 12px 80px' }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: '1rem', color: '#555', marginBottom: 8 }}>
          {totalOnLine} on line — full staff {fullStaff}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
          <div style={{ minWidth: 140 }}>
            <div style={{ fontSize: '0.75rem', marginBottom: 4, color: '#666' }}>Staffing</div>
            <div style={{ height: 14, borderRadius: 4, overflow: 'hidden', background: '#eee', position: 'relative' }}>
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
            <div style={{ fontSize: '0.8rem', marginTop: 2 }}>{staffingPct}%</div>
          </div>
          <div style={{ minWidth: 140 }}>
            <div style={{ fontSize: '0.75rem', marginBottom: 4, color: '#666' }}>Knowledge</div>
            <KnowledgeBar position={knowledgePosition} />
            <div style={{ fontSize: '0.8rem', marginTop: 2 }}>
              {lineHealthScore != null ? `${(lineHealthScore).toFixed(1)} / 3` : '—'}
            </div>
          </div>
        </div>
      </div>

      {LEAD_SLOT_AREAS.length > 0 && (
        <div style={{ marginBottom: 20, paddingBottom: 16, borderBottom: '2px solid #eee' }}>
          <div style={{ fontSize: '0.85rem', color: '#666', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Leads
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 20px' }}>
            {LEAD_SLOT_AREAS.map((areaId) => (
              <span key={areaId} style={{ fontSize: '1.05rem' }}>
                <strong>{areaLabels[areaId]}:</strong> {getName(leadSlots[areaId])}
              </span>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {LINE_SECTIONS.map((section) => {
          if (isCombinedSection(section)) {
            const label = `${areaLabels[COMBINED_14_5_FLIP[0]]} & ${areaLabels[COMBINED_14_5_FLIP[1]]}`;
            const slotsA = slots[COMBINED_14_5_FLIP[0]] ?? [];
            const slotsB = slots[COMBINED_14_5_FLIP[1]] ?? [];
            return (
              <section key="14.5-flip" className="line-view-area" style={{ borderBottom: '1px solid #eee', paddingBottom: 16 }}>
                <h2 style={{ margin: '0 0 12px 0', fontSize: '1.35rem', fontWeight: 700 }}>
                  {label}
                </h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {[COMBINED_14_5_FLIP[0], COMBINED_14_5_FLIP[1]].map((areaId) => {
                    const areaSlots = (areaId === COMBINED_14_5_FLIP[0] ? slotsA : slotsB).filter((s) => !s.disabled);
                    const filled = areaSlots.filter((s) => s.personId).length;
                    const min = effectiveCapacity[areaId]?.min ?? 0;
                    const disabledCount = (areaId === COMBINED_14_5_FLIP[0] ? slotsA : slotsB).length - areaSlots.length;
                    const requiresTrainedOrExpert = areaRequiresTrainedOrExpert(areaId);
                    const hasTrainedOrExpert =
                      filled > 0 &&
                      areaSlots.some((s) => {
                        if (!s.personId) return false;
                        const p = roster.find((r) => r.id === s.personId);
                        const skill = p?.skills[areaId] ?? 'no_experience';
                        return skill === 'trained' || skill === 'expert';
                      });
                    const risks = getAreaRisks({
                      filled,
                      min,
                      disabledCount,
                      needsTrainedOrExpert: requiresTrainedOrExpert && filled >= 1 && !hasTrainedOrExpert,
                    });
                    const avgKnowledge = averageKnowledge(areaId, areaSlots, roster);
                    const spectrumPos = avgKnowledge != null ? (avgKnowledge / 3) * 100 : null;
                    return (
                      <div key={areaId}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '0.9rem', color: '#666' }}>{areaLabels[areaId]}</span>
                          <div style={{ width: 80, flexShrink: 0 }}>
                            <KnowledgeBar position={spectrumPos} />
                          </div>
                        </div>
                        {risks.length > 0 && (
                          <div style={{ fontSize: '0.85rem', color: '#c0392b', marginBottom: 6 }}>
                            {risks.join(' ')}
                          </div>
                        )}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 16px' }}>
                          {areaSlots.map((slot, idx) => {
                            const slotLabel = getSlotLabel(areaId, idx, slotLabelsByArea);
                            const name = getName(slot.personId);
                            return (
                              <div key={slot.id} style={{ fontSize: '1.05rem' }}>
                                {slotLabel}: <strong>{name}</strong>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          }
          const areaId = section;
          const allAreaSlots = slots[areaId] ?? [];
          const areaSlots = allAreaSlots.filter((s) => !s.disabled);
          const filled = areaSlots.filter((s) => s.personId).length;
          const min = effectiveCapacity[areaId]?.min ?? 0;
          const disabledCount = allAreaSlots.length - areaSlots.length;
          const requiresTrainedOrExpert = areaRequiresTrainedOrExpert(areaId);
          const hasTrainedOrExpert =
            filled > 0 &&
            areaSlots.some((s) => {
              if (!s.personId) return false;
              const p = roster.find((r) => r.id === s.personId);
              const skill = p?.skills[areaId] ?? 'no_experience';
              return skill === 'trained' || skill === 'expert';
            });
          const risks = getAreaRisks({
            filled,
            min,
            disabledCount,
            needsTrainedOrExpert: requiresTrainedOrExpert && filled >= 1 && !hasTrainedOrExpert,
          });
          const avgKnowledge = averageKnowledge(areaId, areaSlots, roster);
          const spectrumPos = avgKnowledge != null ? (avgKnowledge / 3) * 100 : null;
          return (
            <section key={areaId} className="line-view-area" style={{ borderBottom: '1px solid #eee', paddingBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
                <h2 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 700 }}>
                  {areaLabels[areaId]}
                </h2>
                <div style={{ width: 80, flexShrink: 0 }}>
                  <KnowledgeBar position={spectrumPos} />
                </div>
              </div>
              {risks.length > 0 && (
                <div style={{ fontSize: '0.85rem', color: '#c0392b', marginBottom: 8 }}>
                  {risks.join(' ')}
                </div>
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 16px' }}>
                {areaSlots.map((slot, idx) => {
                  const slotLabel = getSlotLabel(areaId, idx, slotLabelsByArea);
                  const name = getName(slot.personId);
                  return (
                    <div key={slot.id} style={{ fontSize: '1.05rem' }}>
                      {slotLabel}: <strong>{name}</strong>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

export const LineView = memo(LineViewInner);

import { useMemo, useState } from 'react';
import type { AreaId, BreakPreference, LineConfig, LineState, RosterPerson, SkillLevel } from '../types';
import { AREA_IDS, AREA_LABELS } from '../types';
import { getAreaIds, getBaseAreaLabels } from '../lib/lineConfig';

interface PersonProfileModalProps {
  personId: string;
  /** All line configs (IC + any custom/group lines). */
  lines: LineConfig[];
  /** Per-line state (for finding the person object). */
  lineStates: Record<string, LineState>;
  /** Currently active line (used as default selection). */
  currentLineId: string;
  onClose: () => void;
  onToggleLead: (personId: string, lead: boolean) => void;
  onToggleLate: (personId: string, late: boolean) => void;
  onToggleLeavingEarly: (personId: string, leavingEarly: boolean) => void;
  onBreakPreferenceChange: (personId: string, preference: BreakPreference) => void;
  onSkillChange: (personId: string, areaId: AreaId, level: SkillLevel) => void;
  onDefaultPositionChange: (personId: string, areaId: string | null, slotIndex: number | null) => void;
  onAreasWantToLearnChange: (personId: string, areaId: AreaId, checked: boolean) => void;
}

function findPerson(lineStates: Record<string, LineState>, personId: string): RosterPerson | null {
  for (const state of Object.values(lineStates)) {
    const roster = state?.roster ?? [];
    const found = roster.find((p) => p.id === personId);
    if (found) return found;
  }
  return null;
}

export function PersonProfileModal({
  personId,
  lines,
  lineStates,
  currentLineId,
  onClose,
  onToggleLead,
  onToggleLate,
  onToggleLeavingEarly,
  onBreakPreferenceChange,
  onSkillChange,
  onDefaultPositionChange,
  onAreasWantToLearnChange,
}: PersonProfileModalProps) {
  const person = findPerson(lineStates, personId);
  const [selectedLineId, setSelectedLineId] = useState(() => {
    if (lines.some((l) => l.id === currentLineId)) return currentLineId;
    return lines[0]?.id ?? '';
  });

  const selectedLine = useMemo(
    () => lines.find((l) => l.id === selectedLineId) ?? lines[0] ?? null,
    [lines, selectedLineId]
  );

  const { areaLabels, stationAreaIds } = useMemo(() => {
    if (!selectedLine) {
      return { areaLabels: {} as Record<AreaId, string>, stationAreaIds: [] as AreaId[] };
    }
    if (selectedLine.id === 'ic') {
      const ids = [...AREA_IDS] as AreaId[];
      return { areaLabels: AREA_LABELS, stationAreaIds: ids };
    }
    const ids = getAreaIds(selectedLine) as AreaId[];
    const labels = getBaseAreaLabels(selectedLine);
    const floatIds = new Set((selectedLine.floatSlots ?? []).map((f) => f.id));
    const station = ids.filter((id) => !floatIds.has(id));
    return { areaLabels: labels, stationAreaIds: station };
  }, [selectedLine]);

  if (!person) {
    return null;
  }

  const breakPref = person.breakPreference ?? 'no_preference';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-dialog"
        style={{ maxWidth: 840, width: '100%', maxHeight: '90vh', overflow: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <h2 style={{ margin: 0 }}>{person.name}</h2>
            <div style={{ fontSize: '0.9rem', color: '#555' }}>Profile & preferences</div>
          </div>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </header>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 1.2fr)', gap: 24, alignItems: 'flex-start' }}>
          {/* Left: day status & break preference */}
          <section>
            <h3 style={{ margin: '0 0 8px 0', fontSize: '1rem' }}>Day status</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: '0.9rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={person.lead ?? false}
                  onChange={(e) => onToggleLead(person.id, e.target.checked)}
                />
                <span>Lead</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={person.late ?? false}
                  onChange={(e) => onToggleLate(person.id, e.target.checked)}
                />
                <span>Late arrival today</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={person.leavingEarly ?? false}
                  onChange={(e) => onToggleLeavingEarly(person.id, e.target.checked)}
                />
                <span>Leaving early</span>
              </label>
            </div>

            <h3 style={{ margin: '16px 0 8px 0', fontSize: '1rem' }}>Break preference</h3>
            <p style={{ fontSize: '0.85rem', color: '#555', marginTop: 0 }}>
              Used when generating break schedules for best overlap.
            </p>
            <select
              value={breakPref}
              onChange={(e) => onBreakPreferenceChange(person.id, e.target.value as BreakPreference)}
              style={{ padding: '6px 10px', fontSize: '0.9rem', minWidth: 180 }}
            >
              <option value="no_preference">Prefer middle</option>
              <option value="prefer_early">Prefer early</option>
              <option value="prefer_late">Prefer late</option>
            </select>
          </section>

          {/* Right: skills per line */}
          <section>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h3 style={{ margin: 0, fontSize: '1rem' }}>Experience by line</h3>
              {lines.length > 1 && (
                <select
                  value={selectedLine?.id ?? ''}
                  onChange={(e) => setSelectedLineId(e.target.value)}
                  style={{ padding: '4px 8px', fontSize: '0.85rem' }}
                >
                  {lines.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {selectedLine ? (
              <>
                <p style={{ fontSize: '0.85rem', color: '#555', marginTop: 0 }}>
                  Adjust skill levels for each station on this line. Float positions use combined skill from supported areas.
                </p>
                <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid #eee', borderRadius: 6 }}>
                  <table className="data-table" style={{ fontSize: '0.9rem' }}>
                    <thead>
                      <tr>
                        <th>Area</th>
                        <th style={{ textAlign: 'center' }}>Skill</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stationAreaIds.map((areaId) => {
                        const level = person.skills[areaId] ?? 'no_experience';
                        return (
                          <tr key={areaId}>
                            <td>{areaLabels[areaId] ?? areaId}</td>
                            <td style={{ textAlign: 'center' }}>
                              <select
                                value={level}
                                onChange={(e) => onSkillChange(person.id, areaId, e.target.value as SkillLevel)}
                                style={{ padding: '4px 8px', fontSize: '0.85rem', minWidth: 140 }}
                              >
                                <option value="no_experience">No experience</option>
                                <option value="training">Training</option>
                                <option value="trained">Trained</option>
                                <option value="expert">Expert</option>
                              </select>
                            </td>
                          </tr>
                        );
                      })}
                      {stationAreaIds.length === 0 && (
                        <tr>
                          <td colSpan={2} style={{ textAlign: 'center', padding: 12, color: '#777' }}>
                            No areas defined for this line.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <h3 style={{ margin: '16px 0 8px 0', fontSize: '1rem' }}>Default position (this line)</h3>
                <p style={{ fontSize: '0.85rem', color: '#555', marginTop: 0 }}>
                  Preferred area when auto-filling or suggesting slots.
                </p>
                <select
                  value={
                    person.defaultAreaId != null && person.defaultSlotIndex != null
                      ? `${person.defaultAreaId}:${person.defaultSlotIndex}`
                      : ''
                  }
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) {
                      onDefaultPositionChange(person.id, null, null);
                      return;
                    }
                    const [areaId, slotIndexStr] = v.split(':');
                    const slotIndex = parseInt(slotIndexStr, 10);
                    if (!Number.isNaN(slotIndex)) onDefaultPositionChange(person.id, areaId, slotIndex);
                  }}
                  style={{ padding: '6px 10px', fontSize: '0.9rem', minWidth: 200 }}
                >
                  <option value="">—</option>
                  {stationAreaIds.map((aid) => (
                    <option key={aid} value={`${aid}:0`}>
                      {areaLabels[aid] ?? aid}
                    </option>
                  ))}
                </select>

                <h3 style={{ margin: '16px 0 8px 0', fontSize: '1rem' }}>Want to learn</h3>
                <p style={{ fontSize: '0.85rem', color: '#555', marginTop: 0 }}>
                  Areas this person wants to train in (used in training report).
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {stationAreaIds.map((areaId) => {
                    const checked = (person.areasWantToLearn ?? []).includes(areaId);
                    return (
                      <label key={areaId} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '0.9rem' }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => onAreasWantToLearnChange(person.id, areaId, e.target.checked)}
                        />
                        <span>{areaLabels[areaId] ?? areaId}</span>
                      </label>
                    );
                  })}
                  {stationAreaIds.length === 0 && <span style={{ color: '#777', fontSize: '0.9rem' }}>No station areas on this line.</span>}
                </div>
              </>
            ) : (
              <p style={{ fontSize: '0.9rem', color: '#777' }}>No line selected.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}


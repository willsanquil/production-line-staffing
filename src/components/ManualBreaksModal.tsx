import { useCallback, useMemo, useState } from 'react';
import type { BreakRotation, BreakSchedulesByArea, LunchRotation, RosterPerson, SlotsByArea } from '../types';
import { BREAK_LINE_WIDE_KEY } from '../lib/lineConfig';

const SLOT_LABELS = ['First Break', 'Second Break', 'Third Break', 'Fourth Break', 'Fifth Break', 'Sixth Break'] as const;

interface ManualBreaksModalProps {
  areaIds: string[];
  areaLabels: Record<string, string>;
  roster: RosterPerson[];
  slots: SlotsByArea;
  breakSchedules: BreakSchedulesByArea;
  rotationCount: number;
  breaksScope: 'line' | 'station';
  onClose: () => void;
  onChange: (next: BreakSchedulesByArea) => void;
  onRegenerateAuto: () => void;
}

function personName(roster: RosterPerson[], personId: string): string {
  return roster.find((p) => p.id === personId)?.name ?? personId;
}

export function ManualBreaksModal({
  areaIds,
  areaLabels,
  roster,
  slots,
  breakSchedules,
  rotationCount,
  breaksScope,
  onClose,
  onChange,
  onRegenerateAuto,
}: ManualBreaksModalProps) {
  const n = Math.min(6, Math.max(1, rotationCount));
  const rotations = useMemo(() => Array.from({ length: n }, (_, i) => (i + 1) as BreakRotation), [n]);

  const [dragPerson, setDragPerson] = useState<{ areaId: string; personId: string } | null>(null);

  const scheduleAreas = useMemo(() => {
    if (breaksScope === 'line') return [BREAK_LINE_WIDE_KEY];
    return areaIds.filter((areaId) => {
      const areaSlots = slots[areaId] ?? [];
      return areaSlots.some((s) => s.personId && !s.disabled);
    });
  }, [breaksScope, areaIds, slots]);

  const setPersonRotation = useCallback(
    (areaId: string, personId: string, rot: BreakRotation) => {
      const areaBreaks = { ...(breakSchedules[areaId] ?? {}) };
      const existing = areaBreaks[personId];
      areaBreaks[personId] = {
        breakRotation: rot,
        lunchRotation: (existing?.lunchRotation ?? rot) as LunchRotation,
      };
      onChange({ ...breakSchedules, [areaId]: areaBreaks });
    },
    [breakSchedules, onChange]
  );

  const handleDropOnRotation = useCallback(
    (areaId: string, rot: BreakRotation) => {
      if (!dragPerson || dragPerson.areaId !== areaId) return;
      setPersonRotation(areaId, dragPerson.personId, rot);
      setDragPerson(null);
    },
    [dragPerson, setPersonRotation]
  );

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="manual-breaks-title" onClick={onClose}>
      <div
        className="modal-dialog"
        style={{ maxWidth: 960, width: '100%', maxHeight: '90vh', overflow: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
          <div>
            <h2 id="manual-breaks-title" style={{ margin: 0 }}>
              Manual breaks
            </h2>
            <p style={{ margin: '6px 0 0', fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>
              Drag people between break columns or use the dropdown. Auto-regeneration is paused until you regenerate.
            </p>
          </div>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </header>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          <button type="button" className="btn-primary" onClick={onRegenerateAuto}>
            Regenerate automatically
          </button>
        </div>

        {scheduleAreas.length === 0 ? (
          <p style={{ color: 'var(--color-text-muted)' }}>No staffed areas to show break assignments.</p>
        ) : (
          scheduleAreas.map((areaId) => {
            const title =
              areaId === BREAK_LINE_WIDE_KEY ? 'Line-wide breaks' : (areaLabels[areaId] ?? areaId);
            const areaBreaks = breakSchedules[areaId] ?? {};
            const peopleInArea =
              areaId === BREAK_LINE_WIDE_KEY
                ? Object.keys(areaBreaks)
                : (slots[areaId] ?? [])
                    .filter((s) => s.personId && !s.disabled)
                    .map((s) => s.personId as string);

            if (peopleInArea.length === 0) return null;

            return (
              <section key={areaId} className="section-card" style={{ marginBottom: 16 }}>
                <h3 style={{ margin: '0 0 10px 0', fontSize: '1.05rem' }}>{title}</h3>
                <div style={{ overflowX: 'auto' }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left', minWidth: 140 }}>Name</th>
                        {rotations.map((r) => (
                          <th key={r} style={{ textAlign: 'center', minWidth: 88 }}>
                            {SLOT_LABELS[r - 1] ?? `Break ${r}`}
                          </th>
                        ))}
                        <th style={{ minWidth: 120 }}>Set break</th>
                      </tr>
                    </thead>
                    <tbody>
                      {peopleInArea.map((personId) => {
                        const rot = areaBreaks[personId]?.breakRotation ?? 1;
                        const isDragging = dragPerson?.areaId === areaId && dragPerson.personId === personId;
                        return (
                          <tr key={personId} style={{ opacity: isDragging ? 0.5 : 1 }}>
                            <td>
                              <span
                                draggable
                                onDragStart={() => setDragPerson({ areaId, personId })}
                                onDragEnd={() => setDragPerson(null)}
                                style={{ cursor: 'grab', userSelect: 'none' }}
                                title="Drag to a break column"
                              >
                                {personName(roster, personId)}
                              </span>
                            </td>
                            {rotations.map((r) => (
                              <td
                                key={r}
                                style={{
                                  textAlign: 'center',
                                  background: rot === r ? 'var(--color-accent-primary-light, #e8f0fe)' : undefined,
                                }}
                                onDragOver={(e) => e.preventDefault()}
                                onDrop={() => handleDropOnRotation(areaId, r)}
                              >
                                {rot === r ? (
                                  <span style={{ fontWeight: 700 }} aria-label={`On ${SLOT_LABELS[r - 1]}`}>
                                    X
                                  </span>
                                ) : (
                                  <span style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>—</span>
                                )}
                              </td>
                            ))}
                            <td>
                              <select
                                value={rot}
                                onChange={(e) =>
                                  setPersonRotation(areaId, personId, parseInt(e.target.value, 10) as BreakRotation)
                                }
                                aria-label={`Break for ${personName(roster, personId)}`}
                                style={{ padding: '4px 8px', fontSize: '0.9rem', maxWidth: '100%' }}
                              >
                                {rotations.map((r) => (
                                  <option key={r} value={r}>
                                    {SLOT_LABELS[r - 1] ?? `Break ${r}`}
                                  </option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}

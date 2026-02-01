import { memo, useMemo, useState, useEffect } from 'react';
import type { AreaId, BreakPreference, LineConfig, RosterPerson, SkillLevel } from '../types';
import { AREA_IDS } from '../types';
import { sortByFirstName } from '../lib/rosterSort';

interface RosterGridProps {
  roster: RosterPerson[];
  /** Person IDs who are flexed in to this line (show in a separate Flex pool section). */
  flexedInPersonIds?: Set<string>;
  visible: boolean;
  areaLabels: Record<AreaId, string>;
  /** When building custom lines, pass area IDs in display order. Omit for default IC areas. */
  areaIds?: string[];
  /** When multiple lines exist, show Flexed dropdown (other lines only). */
  lines?: LineConfig[];
  currentLineId?: string;
  onFlexedToLineChange?: (personId: string, lineId: string | null) => void;
  onToggleVisible: () => void;
  onNameChange: (personId: string, name: string) => void;
  onRemovePerson: (personId: string) => void;
  onAddPerson: (name: string) => void;
  onAddOT: (name: string) => void;
  onToggleAbsent: (personId: string, absent: boolean) => void;
  onToggleLead: (personId: string, lead: boolean) => void;
  onToggleOT: (personId: string, ot: boolean) => void;
  onToggleOTHereToday: (personId: string, otHereToday: boolean) => void;
  onToggleLate: (personId: string, late: boolean) => void;
  onToggleLeavingEarly: (personId: string, leavingEarly: boolean) => void;
  onBreakPreferenceChange: (personId: string, preference: BreakPreference) => void;
  onSkillChange: (personId: string, areaId: AreaId, level: SkillLevel) => void;
  onAreasWantToLearnChange: (personId: string, areaId: AreaId, checked: boolean) => void;
  /** Roster file actions (optional; when provided, shown in header next to Hide roster) */
  saveMessage?: string | null;
  onSaveToFile?: () => void;
  onOpenFromFile?: () => void;
  onAddToRoster?: () => void;
  isSaveToFileSupported?: () => boolean;
  /** Import roster from another cloud line (for merging lines). */
  onImportFromCloudLine?: () => void;
  isCloudMode?: boolean;
}

const SKILL_LEVELS: SkillLevel[] = ['no_experience', 'training', 'trained', 'expert'];
const SKILL_LABELS: Record<SkillLevel, string> = {
  no_experience: 'No experience',
  training: 'Training',
  trained: 'Trained',
  expert: 'Expert',
};

const SKILL_SCORE: Record<SkillLevel, number> = {
  no_experience: 0,
  training: 1,
  trained: 2,
  expert: 3,
};

const PAGE_SIZE = 10;

/** Average knowledge (0–3) across all areas for one person. */
function personHealthScore(person: RosterPerson, areaIds: string[]): number {
  if (areaIds.length === 0) return 0;
  let sum = 0;
  for (const areaId of areaIds) {
    sum += SKILL_SCORE[person.skills[areaId] ?? 'no_experience'];
  }
  return sum / areaIds.length;
}

function PersonHealthBar({ person, areaIds }: { person: RosterPerson; areaIds: string[] }) {
  const score = personHealthScore(person, areaIds);
  const position = (score / 3) * 100;
  return (
    <div
      className="seniority-spectrum person-health-bar"
      style={{
        position: 'relative',
        height: 8,
        borderRadius: 3,
        overflow: 'hidden',
        display: 'flex',
        marginBottom: 4,
        minWidth: 80,
      }}
      title={`Talent depth: ${score.toFixed(1)} / 3`}
    >
      <div className="skill-no_experience" style={{ flex: 1, minWidth: 0 }} />
      <div className="skill-training" style={{ flex: 1, minWidth: 0 }} />
      <div className="skill-trained" style={{ flex: 1, minWidth: 0 }} />
      <div className="skill-expert" style={{ flex: 1, minWidth: 0 }} />
      <div
        className="seniority-spectrum-arrow"
        style={{
          position: 'absolute',
          left: `clamp(2px, ${position}%, calc(100% - 4px))`,
          top: '50%',
          transform: 'translate(-50%, -50%)',
          width: 0,
          height: 0,
          borderLeft: '4px solid transparent',
          borderRight: '4px solid transparent',
          borderTop: '5px solid #1a1a1a',
          filter: 'drop-shadow(0 0 1px #fff)',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}

function RosterGridInner({
  roster,
  flexedInPersonIds = new Set(),
  visible,
  areaLabels,
  areaIds: areaIdsProp,
  lines = [],
  currentLineId = '',
  onFlexedToLineChange,
  onToggleVisible,
  onNameChange,
  onRemovePerson,
  onAddPerson,
  onAddOT,
  onToggleAbsent,
  onToggleLead,
  onToggleOT,
  onToggleOTHereToday,
  onToggleLate,
  onToggleLeavingEarly,
  onBreakPreferenceChange,
  onSkillChange,
  onAreasWantToLearnChange,
  saveMessage,
  onSaveToFile,
  onOpenFromFile,
  onAddToRoster,
  isSaveToFileSupported,
  onImportFromCloudLine,
  isCloudMode,
}: RosterGridProps) {
  const areaIds = areaIdsProp ?? [...AREA_IDS];
  const otherLines = useMemo(() => lines.filter((l) => l.id !== currentLineId), [lines, currentLineId]);
  const showFlexedColumn = otherLines.length > 0 && currentLineId && onFlexedToLineChange;
  const { staffRoster, flexedInRoster, otRoster } = useMemo(() => {
    const sorted = sortByFirstName(roster);
    const flexedIn = sorted.filter((p) => flexedInPersonIds.has(p.id));
    const own = sorted.filter((p) => !flexedInPersonIds.has(p.id));
    return {
      staffRoster: own.filter((p) => !p.ot),
      flexedInRoster: sortByFirstName(flexedIn),
      otRoster: own.filter((p) => p.ot),
    };
  }, [roster, flexedInPersonIds]);
  const [newName, setNewName] = useState('');
  const [newOTName, setNewOTName] = useState('');
  const [staffPage, setStaffPage] = useState(0);
  const [otPage, setOtPage] = useState(0);

  const staffTotalPages = Math.max(1, Math.ceil(staffRoster.length / PAGE_SIZE));
  const flexedInTotalPages = Math.max(1, Math.ceil(flexedInRoster.length / PAGE_SIZE));
  const otTotalPages = Math.max(1, Math.ceil(otRoster.length / PAGE_SIZE));
  const staffPageIndex = Math.min(staffPage, staffTotalPages - 1);
  const [flexedInPage, setFlexedInPage] = useState(0);
  const flexedInPageIndex = Math.min(flexedInPage, flexedInTotalPages - 1);
  const otPageIndex = Math.min(otPage, otTotalPages - 1);
  const staffRosterPage = useMemo(
    () =>
      staffRoster.slice(
        staffPageIndex * PAGE_SIZE,
        (staffPageIndex + 1) * PAGE_SIZE
      ),
    [staffRoster, staffPageIndex]
  );
  const flexedInRosterPage = useMemo(
    () =>
      flexedInRoster.slice(
        flexedInPageIndex * PAGE_SIZE,
        (flexedInPageIndex + 1) * PAGE_SIZE
      ),
    [flexedInRoster, flexedInPageIndex]
  );
  const otRosterPage = useMemo(
    () =>
      otRoster.slice(otPageIndex * PAGE_SIZE, (otPageIndex + 1) * PAGE_SIZE),
    [otRoster, otPageIndex]
  );

  useEffect(() => {
    if (staffPageIndex !== staffPage) setStaffPage(staffPageIndex);
  }, [staffPageIndex, staffPage]);
  useEffect(() => {
    if (flexedInPageIndex !== flexedInPage) setFlexedInPage(flexedInPageIndex);
  }, [flexedInPageIndex, flexedInPage]);
  useEffect(() => {
    if (otPageIndex !== otPage) setOtPage(otPageIndex);
  }, [otPageIndex, otPage]);

  function handleAdd() {
    const name = newName.trim();
    if (name) {
      onAddPerson(name);
      setNewName('');
    } else {
      onAddPerson('New Person');
    }
  }

  function handleAddOT() {
    const name = newOTName.trim();
    if (name) {
      onAddOT(name);
      setNewOTName('');
    } else {
      onAddOT('New OT');
    }
  }

  return (
    <section className="section-card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0 }}>Roster – talent depth</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={onToggleVisible}>
            {visible ? 'Hide roster' : 'Show roster'}
          </button>
          {onSaveToFile && onOpenFromFile && (isSaveToFileSupported?.() ?? true) && (
            <>
              <button type="button" onClick={onSaveToFile}>Save to file</button>
              {saveMessage != null && saveMessage !== '' && <span style={{ color: '#27ae60', fontWeight: 500 }}>✓ {saveMessage}</span>}
              <button type="button" onClick={onOpenFromFile}>Open from file</button>
            </>
          )}
          {onAddToRoster && (
            <button type="button" onClick={onAddToRoster}>Add to roster</button>
          )}
          {isCloudMode && onImportFromCloudLine && (
            <button type="button" onClick={onImportFromCloudLine}>Import from cloud line</button>
          )}
        </div>
      </div>
      {visible && (
        <>
          {/* Staff */}
          <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1rem' }}>Staff</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              placeholder="New person name..."
              style={{ minWidth: 160, padding: '6px 8px' }}
              aria-label="New person name"
            />
            <button type="button" onClick={handleAdd}>Add person</button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', minWidth: '100%' }}>
              <thead>
                <tr>
                  <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '2px solid #ddd' }}>Name</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '2px solid #ddd', width: 44 }}></th>
                  {showFlexedColumn && (
                    <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '2px solid #ddd', minWidth: 100 }} title="Temporarily assign this person to another line">Flexed</th>
                  )}
                  <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '2px solid #ddd', width: 70 }}>Absent</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '2px solid #ddd', width: 60 }}>Lead</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '2px solid #ddd', width: 55 }}>Late</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '2px solid #ddd', width: 90 }}>Leave early</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '2px solid #ddd', width: 100 }}>Break</th>
                  {areaIds.map((areaId) => (
                    <th key={areaId} style={{ padding: '6px 8px', textAlign: 'center', borderBottom: '2px solid #ddd', minWidth: 90 }}>
                      {areaLabels[areaId]}
                    </th>
                  ))}
                  <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '2px solid #ddd', fontSize: '0.8rem' }} colSpan={areaIds.length}>
                    Want to learn (profile)
                  </th>
                </tr>
                <tr>
                  <th colSpan={7 + (showFlexedColumn ? 1 : 0)} style={{ padding: 0, border: 'none' }} />
                  {areaIds.map((areaId) => (
                    <th key={areaId} style={{ padding: '2px 4px', textAlign: 'center', borderBottom: '2px solid #ddd', fontSize: '0.75rem' }}>
                      {areaLabels[areaId]}
                    </th>
                  ))}
                  {areaIds.map((areaId) => (
                    <th key={`learn-${areaId}`} style={{ padding: '2px 4px', textAlign: 'center', borderBottom: '2px solid #ddd', fontSize: '0.75rem' }}>
                      {areaLabels[areaId]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {staffRosterPage.map((person) => (
                  <tr key={person.id} className={person.absent ? 'person-absent' : ''}>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee', verticalAlign: 'top' }}>
                      <PersonHealthBar person={person} areaIds={areaIds} />
                      <input
                        type="text"
                        value={person.name}
                        onChange={(e) => onNameChange(person.id, e.target.value)}
                        style={{ width: '100%', minWidth: 100, padding: '4px 6px', fontSize: 'inherit' }}
                        aria-label={`Edit ${person.name}`}
                      />
                    </td>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee' }}>
                      <button
                        type="button"
                        onClick={() => onRemovePerson(person.id)}
                        aria-label={`Remove ${person.name}`}
                        title="Remove from roster"
                        style={{ padding: '2px 6px', fontSize: '0.8rem' }}
                      >
                        −
                      </button>
                    </td>
                    {showFlexedColumn && (
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee' }}>
                        <select
                          value={person.flexedToLineId ?? ''}
                          onChange={(e) => onFlexedToLineChange?.(person.id, e.target.value || null)}
                          style={{ padding: '4px 6px', fontSize: '0.8rem', minWidth: 88 }}
                          title="Temporarily assign to another line"
                          aria-label={`${person.name} flexed to`}
                        >
                          <option value="">—</option>
                          {otherLines.map((l) => (
                            <option key={l.id} value={l.id}>{l.name}</option>
                          ))}
                        </select>
                      </td>
                    )}
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee' }}>
                      <input
                        type="checkbox"
                        checked={person.absent}
                        onChange={(e) => onToggleAbsent(person.id, e.target.checked)}
                        aria-label={`Mark ${person.name} absent`}
                      />
                    </td>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee' }}>
                      <input
                        type="checkbox"
                        checked={person.lead ?? false}
                        onChange={(e) => onToggleLead(person.id, e.target.checked)}
                        aria-label={`Mark ${person.name} as lead`}
                      />
                    </td>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee' }}>
                      <input
                        type="checkbox"
                        checked={person.late ?? false}
                        onChange={(e) => onToggleLate(person.id, e.target.checked)}
                        aria-label={`Mark ${person.name} late`}
                      />
                    </td>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee' }}>
                      <input
                        type="checkbox"
                        checked={person.leavingEarly ?? false}
                        onChange={(e) => onToggleLeavingEarly(person.id, e.target.checked)}
                        aria-label={`Mark ${person.name} leaving early`}
                      />
                    </td>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee' }}>
                      <select
                        value={person.breakPreference ?? 'no_preference'}
                        onChange={(e) => onBreakPreferenceChange(person.id, e.target.value as BreakPreference)}
                        style={{ padding: '4px 6px', fontSize: '0.8rem', minWidth: 100 }}
                        title="Break schedule preference"
                        aria-label={`${person.name} break preference`}
                      >
                        <option value="no_preference">Prefer middle</option>
                        <option value="prefer_early">Prefer early</option>
                        <option value="prefer_late">Prefer late</option>
                      </select>
                    </td>
                    {areaIds.map((areaId) => {
                      const level = person.skills[areaId] ?? 'no_experience';
                      return (
                        <td
                          key={areaId}
                          style={{
                            padding: '2px 4px',
                            borderBottom: '1px solid #eee',
                            textAlign: 'center',
                          }}
                        >
                          <select
                            value={level}
                            onChange={(e) => onSkillChange(person.id, areaId, e.target.value as SkillLevel)}
                            className={`skill-${level}`}
                            style={{
                              width: '100%',
                              maxWidth: 120,
                              padding: '4px 6px',
                              border: '1px solid rgba(0,0,0,0.2)',
                              borderRadius: 4,
                              fontSize: '0.8rem',
                              cursor: 'pointer',
                            }}
                            title={SKILL_LABELS[level]}
                          >
                            {SKILL_LEVELS.map((l) => (
                              <option key={l} value={l}>
                                {SKILL_LABELS[l]}
                              </option>
                            ))}
                          </select>
                        </td>
                      );
                    })}
                    {areaIds.map((areaId) => {
                      const want = (person.areasWantToLearn ?? []).includes(areaId);
                      return (
                        <td
                          key={areaId}
                          style={{ padding: '2px 4px', borderBottom: '1px solid #eee', textAlign: 'center' }}
                        >
                          <input
                            type="checkbox"
                            checked={want}
                            onChange={(e) => onAreasWantToLearnChange(person.id, areaId, e.target.checked)}
                            aria-label={`${person.name} want to learn ${areaLabels[areaId]}`}
                            title={`Want to learn ${areaLabels[areaId]}`}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {staffRoster.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setStaffPage((p) => Math.max(0, p - 1))}
                disabled={staffPageIndex <= 0}
                aria-label="Previous page"
              >
                ← Prev
              </button>
              <span style={{ fontSize: '0.9rem' }}>
                Page {staffPageIndex + 1} of {staffTotalPages}
                <span style={{ color: '#666', marginLeft: 4 }}>
                  ({staffRoster.length} staff)
                </span>
              </span>
              <button
                type="button"
                onClick={() => setStaffPage((p) => Math.min(staffTotalPages - 1, p + 1))}
                disabled={staffPageIndex >= staffTotalPages - 1}
                aria-label="Next page"
              >
                Next →
              </button>
            </div>
          )}

          {/* Flexed to this line – people from other lines; can be assigned to slots here */}
          {flexedInRoster.length > 0 && (
            <>
              <h3 style={{ margin: '1.25rem 0 0.5rem 0', fontSize: '1rem' }}>Flexed to this line</h3>
              <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.85rem', color: '#666' }}>
                People temporarily assigned from other lines. They can be slotted here; skills are unchanged.
              </p>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', minWidth: '100%' }}>
                  <thead>
                    <tr>
                      <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '2px solid #ddd' }}>Name</th>
                      <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '2px solid #ddd', width: 90 }}>Send back</th>
                      {showFlexedColumn && (
                        <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '2px solid #ddd', minWidth: 100 }}>Flexed</th>
                      )}
                      <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '2px solid #ddd', width: 70 }}>Absent</th>
                      <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '2px solid #ddd', width: 100 }}>Break</th>
                      {areaIds.map((areaId) => (
                        <th key={areaId} style={{ padding: '6px 8px', textAlign: 'center', borderBottom: '2px solid #ddd', minWidth: 90 }}>
                          {areaLabels[areaId]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {flexedInRosterPage.map((person) => (
                      <tr key={person.id} style={{ backgroundColor: 'rgba(33, 150, 243, 0.06)' }}>
                        <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee', verticalAlign: 'top' }}>
                          <PersonHealthBar person={person} areaIds={areaIds} />
                          <span style={{ fontWeight: 500 }}>{person.name}</span>
                        </td>
                        <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee' }}>
                          <button
                            type="button"
                            onClick={() => onFlexedToLineChange?.(person.id, null)}
                            style={{ padding: '4px 8px', fontSize: '0.8rem' }}
                            title="Send back to their home line"
                          >
                            Send back
                          </button>
                        </td>
                        {showFlexedColumn && (
                          <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee' }}>
                            <select
                              value={person.flexedToLineId ?? ''}
                              onChange={(e) => onFlexedToLineChange?.(person.id, e.target.value || null)}
                              style={{ padding: '4px 6px', fontSize: '0.8rem', minWidth: 88 }}
                              aria-label={`${person.name} flexed to`}
                            >
                              <option value="">—</option>
                              {otherLines.map((l) => (
                                <option key={l.id} value={l.id}>{l.name}</option>
                              ))}
                            </select>
                          </td>
                        )}
                        <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee' }}>
                          <input
                            type="checkbox"
                            checked={person.absent}
                            onChange={(e) => onToggleAbsent(person.id, e.target.checked)}
                            aria-label={`Mark ${person.name} absent`}
                          />
                        </td>
                        <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee' }}>
                          <select
                            value={person.breakPreference ?? 'no_preference'}
                            onChange={(e) => onBreakPreferenceChange(person.id, e.target.value as BreakPreference)}
                            style={{ padding: '4px 6px', fontSize: '0.8rem', minWidth: 100 }}
                            title="Break preference"
                          >
                            <option value="no_preference">Prefer middle</option>
                            <option value="prefer_early">Prefer early</option>
                            <option value="prefer_late">Prefer late</option>
                          </select>
                        </td>
                        {areaIds.map((areaId) => {
                          const level = person.skills[areaId] ?? 'no_experience';
                          return (
                            <td
                              key={areaId}
                              style={{ padding: '2px 4px', borderBottom: '1px solid #eee', textAlign: 'center' }}
                            >
                              <select
                                value={level}
                                onChange={(e) => onSkillChange(person.id, areaId, e.target.value as SkillLevel)}
                                className={`skill-${level}`}
                                style={{
                                  width: '100%',
                                  maxWidth: 120,
                                  padding: '4px 6px',
                                  border: '1px solid rgba(0,0,0,0.2)',
                                  borderRadius: 4,
                                  fontSize: '0.8rem',
                                }}
                              >
                                {SKILL_LEVELS.map((l) => (
                                  <option key={l} value={l}>{SKILL_LABELS[l]}</option>
                                ))}
                              </select>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {flexedInRoster.length > PAGE_SIZE && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => setFlexedInPage((p) => Math.max(0, p - 1))}
                    disabled={flexedInPageIndex <= 0}
                  >
                    ← Prev
                  </button>
                  <span style={{ fontSize: '0.9rem' }}>
                    Page {flexedInPageIndex + 1} of {flexedInTotalPages}
                    <span style={{ color: '#666', marginLeft: 4 }}>({flexedInRoster.length} flexed in)</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setFlexedInPage((p) => Math.min(flexedInTotalPages - 1, p + 1))}
                    disabled={flexedInPageIndex >= flexedInTotalPages - 1}
                  >
                    Next →
                  </button>
                </div>
              )}
            </>
          )}

          {/* OT pool – separate list; "Here today" controls slotting eligibility */}
          <h3 style={{ margin: '1.25rem 0 0.5rem 0', fontSize: '1rem' }}>OT pool</h3>
          <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.85rem', color: '#666' }}>
            OT are not available for the line until you mark them &quot;Here today&quot;.
          </p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
            <input
              type="text"
              value={newOTName}
              onChange={(e) => setNewOTName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddOT()}
              placeholder="New OT name..."
              style={{ minWidth: 140, padding: '6px 8px' }}
              aria-label="New OT person name"
            />
            <button type="button" onClick={handleAddOT}>Add OT</button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', minWidth: '100%' }}>
              <thead>
                <tr>
                  <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '2px solid #ddd' }}>Name</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '2px solid #ddd', width: 44 }}></th>
                  {showFlexedColumn && (
                    <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '2px solid #ddd', minWidth: 100 }}>Flexed</th>
                  )}
                  <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '2px solid #ddd', width: 50 }}>OT</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '2px solid #ddd', width: 90 }}>Here today</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '2px solid #ddd', width: 100 }}>Break</th>
                  {areaIds.map((areaId) => (
                    <th key={areaId} style={{ padding: '6px 8px', textAlign: 'center', borderBottom: '2px solid #ddd', minWidth: 90 }}>
                      {areaLabels[areaId]}
                    </th>
                  ))}
                  <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '2px solid #ddd', fontSize: '0.8rem' }} colSpan={areaIds.length}>
                    Want to learn
                  </th>
                </tr>
                <tr>
                  <th colSpan={5 + (showFlexedColumn ? 1 : 0)} style={{ padding: 0, border: 'none' }} />
                  {areaIds.map((areaId) => (
                    <th key={areaId} style={{ padding: '2px 4px', textAlign: 'center', borderBottom: '2px solid #ddd', fontSize: '0.75rem' }}>
                      {areaLabels[areaId]}
                    </th>
                  ))}
                  {areaIds.map((areaId) => (
                    <th key={`learn-${areaId}`} style={{ padding: '2px 4px', textAlign: 'center', borderBottom: '2px solid #ddd', fontSize: '0.75rem' }}>
                      {areaLabels[areaId]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {otRosterPage.map((person) => (
                  <tr key={person.id} style={{ backgroundColor: (person.otHereToday ?? false) ? 'transparent' : 'rgba(0,0,0,0.04)' }}>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee', verticalAlign: 'top' }}>
                      <PersonHealthBar person={person} areaIds={areaIds} />
                      <input
                        type="text"
                        value={person.name}
                        onChange={(e) => onNameChange(person.id, e.target.value)}
                        style={{ width: '100%', minWidth: 100, padding: '4px 6px', fontSize: 'inherit' }}
                        aria-label={`Edit ${person.name}`}
                      />
                    </td>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee' }}>
                      <button
                        type="button"
                        onClick={() => onRemovePerson(person.id)}
                        aria-label={`Remove ${person.name}`}
                        title="Remove from roster"
                        style={{ padding: '2px 6px', fontSize: '0.8rem' }}
                      >
                        −
                      </button>
                    </td>
                    {showFlexedColumn && (
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee' }}>
                        <select
                          value={person.flexedToLineId ?? ''}
                          onChange={(e) => onFlexedToLineChange?.(person.id, e.target.value || null)}
                          style={{ padding: '4px 6px', fontSize: '0.8rem', minWidth: 88 }}
                          aria-label={`${person.name} flexed to`}
                        >
                          <option value="">—</option>
                          {otherLines.map((l) => (
                            <option key={l.id} value={l.id}>{l.name}</option>
                          ))}
                        </select>
                      </td>
                    )}
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee' }}>
                      <input
                        type="checkbox"
                        checked
                        onChange={(e) => onToggleOT(person.id, !e.target.checked)}
                        aria-label={`Move ${person.name} back to Staff`}
                        title="Uncheck to move back to Staff"
                      />
                    </td>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontWeight: (person.otHereToday ?? false) ? 600 : 400 }}>
                        <input
                          type="checkbox"
                          checked={person.otHereToday ?? false}
                          onChange={(e) => onToggleOTHereToday(person.id, e.target.checked)}
                          aria-label={`${person.name} is here today`}
                          title="Check when this OT is on site and available to slot"
                        />
                        {(person.otHereToday ?? false) ? 'Yes — can slot' : 'No'}
                      </label>
                    </td>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid #eee' }}>
                      <select
                        value={person.breakPreference ?? 'no_preference'}
                        onChange={(e) => onBreakPreferenceChange(person.id, e.target.value as BreakPreference)}
                        style={{ padding: '4px 6px', fontSize: '0.8rem', minWidth: 100 }}
                        title="Break schedule preference"
                        aria-label={`${person.name} break preference`}
                      >
                        <option value="no_preference">Prefer middle</option>
                        <option value="prefer_early">Prefer early</option>
                        <option value="prefer_late">Prefer late</option>
                      </select>
                    </td>
                    {areaIds.map((areaId) => {
                      const level = person.skills[areaId] ?? 'no_experience';
                      return (
                        <td
                          key={areaId}
                          style={{
                            padding: '2px 4px',
                            borderBottom: '1px solid #eee',
                            textAlign: 'center',
                          }}
                        >
                          <select
                            value={level}
                            onChange={(e) => onSkillChange(person.id, areaId, e.target.value as SkillLevel)}
                            className={`skill-${level}`}
                            style={{
                              width: '100%',
                              maxWidth: 120,
                              padding: '4px 6px',
                              border: '1px solid rgba(0,0,0,0.2)',
                              borderRadius: 4,
                              fontSize: '0.8rem',
                              cursor: 'pointer',
                            }}
                            title={SKILL_LABELS[level]}
                          >
                            {SKILL_LEVELS.map((l) => (
                              <option key={l} value={l}>
                                {SKILL_LABELS[l]}
                              </option>
                            ))}
                          </select>
                        </td>
                      );
                    })}
                    {areaIds.map((areaId) => {
                      const want = (person.areasWantToLearn ?? []).includes(areaId);
                      return (
                        <td
                          key={areaId}
                          style={{ padding: '2px 4px', borderBottom: '1px solid #eee', textAlign: 'center' }}
                        >
                          <input
                            type="checkbox"
                            checked={want}
                            onChange={(e) => onAreasWantToLearnChange(person.id, areaId, e.target.checked)}
                            aria-label={`${person.name} want to learn ${areaLabels[areaId]}`}
                            title={`Want to learn ${areaLabels[areaId]}`}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {otRoster.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setOtPage((p) => Math.max(0, p - 1))}
                disabled={otPageIndex <= 0}
                aria-label="Previous page"
              >
                ← Prev
              </button>
              <span style={{ fontSize: '0.9rem' }}>
                Page {otPageIndex + 1} of {otTotalPages}
                <span style={{ color: '#666', marginLeft: 4 }}>
                  ({otRoster.length} OT)
                </span>
              </span>
              <button
                type="button"
                onClick={() => setOtPage((p) => Math.min(otTotalPages - 1, p + 1))}
                disabled={otPageIndex >= otTotalPages - 1}
                aria-label="Next page"
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export const RosterGrid = memo(RosterGridInner);

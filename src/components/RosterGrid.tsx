import { memo, useMemo, useState, useEffect } from 'react';
import type { AreaId, BreakPreference, RosterPerson, SkillLevel } from '../types';
import { AREA_IDS } from '../types';
import { sortByFirstName } from '../lib/rosterSort';

interface RosterGridProps {
  roster: RosterPerson[];
  visible: boolean;
  areaLabels: Record<AreaId, string>;
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
function personHealthScore(person: RosterPerson): number {
  let sum = 0;
  for (const areaId of AREA_IDS) {
    sum += SKILL_SCORE[person.skills[areaId] ?? 'no_experience'];
  }
  return sum / AREA_IDS.length;
}

function PersonHealthBar({ person }: { person: RosterPerson }) {
  const score = personHealthScore(person);
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
  visible,
  areaLabels,
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
}: RosterGridProps) {
  const { staffRoster, otRoster } = useMemo(() => {
    const sorted = sortByFirstName(roster);
    return {
      staffRoster: sorted.filter((p) => !p.ot),
      otRoster: sorted.filter((p) => p.ot),
    };
  }, [roster]);
  const [newName, setNewName] = useState('');
  const [newOTName, setNewOTName] = useState('');
  const [staffPage, setStaffPage] = useState(0);
  const [otPage, setOtPage] = useState(0);

  const staffTotalPages = Math.max(1, Math.ceil(staffRoster.length / PAGE_SIZE));
  const otTotalPages = Math.max(1, Math.ceil(otRoster.length / PAGE_SIZE));
  const staffPageIndex = Math.min(staffPage, staffTotalPages - 1);
  const otPageIndex = Math.min(otPage, otTotalPages - 1);
  const staffRosterPage = useMemo(
    () =>
      staffRoster.slice(
        staffPageIndex * PAGE_SIZE,
        (staffPageIndex + 1) * PAGE_SIZE
      ),
    [staffRoster, staffPageIndex]
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
        <h2 style={{ margin: 0 }}>Roster – talent depth</h2>
        <button type="button" onClick={onToggleVisible}>
          {visible ? 'Hide roster' : 'Show roster'}
        </button>
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
                  <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '2px solid #ddd', width: 70 }}>Absent</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '2px solid #ddd', width: 60 }}>Lead</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '2px solid #ddd', width: 50 }}>OT</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '2px solid #ddd', width: 55 }}>Late</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '2px solid #ddd', width: 90 }}>Leave early</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '2px solid #ddd', width: 100 }}>Break</th>
                  {AREA_IDS.map((areaId) => (
                    <th key={areaId} style={{ padding: '6px 8px', textAlign: 'center', borderBottom: '2px solid #ddd', minWidth: 90 }}>
                      {areaLabels[areaId]}
                    </th>
                  ))}
                  <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '2px solid #ddd', fontSize: '0.8rem' }} colSpan={AREA_IDS.length}>
                    Want to learn (profile)
                  </th>
                </tr>
                <tr>
                  <th colSpan={8} style={{ padding: 0, border: 'none' }} />
                  {AREA_IDS.map((areaId) => (
                    <th key={areaId} style={{ padding: '2px 4px', textAlign: 'center', borderBottom: '2px solid #ddd', fontSize: '0.75rem' }}>
                      {areaLabels[areaId]}
                    </th>
                  ))}
                  {AREA_IDS.map((areaId) => (
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
                      <PersonHealthBar person={person} />
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
                        checked={person.ot ?? false}
                        onChange={(e) => onToggleOT(person.id, e.target.checked)}
                        aria-label={`Move ${person.name} to OT pool`}
                        title="Move to OT pool"
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
                        <option value="prefer_early">Prefer early</option>
                        <option value="no_preference">No preference</option>
                        <option value="prefer_late">Prefer late</option>
                      </select>
                    </td>
                    {AREA_IDS.map((areaId) => {
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
                    {AREA_IDS.map((areaId) => {
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
                  <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '2px solid #ddd', width: 50 }}>OT</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '2px solid #ddd', width: 90 }}>Here today</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '2px solid #ddd', width: 100 }}>Break</th>
                  {AREA_IDS.map((areaId) => (
                    <th key={areaId} style={{ padding: '6px 8px', textAlign: 'center', borderBottom: '2px solid #ddd', minWidth: 90 }}>
                      {areaLabels[areaId]}
                    </th>
                  ))}
                  <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '2px solid #ddd', fontSize: '0.8rem' }} colSpan={AREA_IDS.length}>
                    Want to learn
                  </th>
                </tr>
                <tr>
                  <th colSpan={5} style={{ padding: 0, border: 'none' }} />
                  {AREA_IDS.map((areaId) => (
                    <th key={areaId} style={{ padding: '2px 4px', textAlign: 'center', borderBottom: '2px solid #ddd', fontSize: '0.75rem' }}>
                      {areaLabels[areaId]}
                    </th>
                  ))}
                  {AREA_IDS.map((areaId) => (
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
                      <PersonHealthBar person={person} />
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
                        <option value="prefer_early">Prefer early</option>
                        <option value="no_preference">No preference</option>
                        <option value="prefer_late">Prefer late</option>
                      </select>
                    </td>
                    {AREA_IDS.map((areaId) => {
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
                    {AREA_IDS.map((areaId) => {
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

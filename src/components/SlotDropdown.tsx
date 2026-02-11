import { useState, useRef, useEffect, useMemo } from 'react';
import type { AreaId, RosterPerson, SkillLevel, Slot } from '../types';
import { SkillPill } from './SkillPill';
import { sortByFirstName } from '../lib/rosterSort';
import { formatPersonStatusLabel } from '../lib/personLabel';

const SKILL_SCORE: Record<SkillLevel, number> = {
  no_experience: 0,
  training: 1,
  trained: 2,
  expert: 3,
};

/** For float slots: combined skill across supported areas. */
function combinedSkillForAreas(person: RosterPerson, areaIds: string[]): SkillLevel {
  if (areaIds.length === 0) return 'no_experience';
  let sum = 0;
  for (const aid of areaIds) {
    sum += SKILL_SCORE[person.skills[aid as AreaId] ?? 'no_experience'];
  }
  const avg = sum / areaIds.length;
  if (avg >= 2.5) return 'expert';
  if (avg >= 1.5) return 'trained';
  if (avg >= 0.5) return 'training';
  return 'no_experience';
}

interface SlotDropdownProps {
  slot: Slot;
  areaId: AreaId;
  roster: RosterPerson[];
  assignedPersonIds: Set<string>;
  /** People assigned as leads (excluded from area slots). */
  leadAssignedPersonIds?: Set<string>;
  /** For float slots: area IDs this float supports; skill pill uses combined skill across these. */
  supportedAreaIds?: string[];
  onAssign: (slotId: string, personId: string | null) => void;
  slotLabel?: string;
}

export function SlotDropdown({
  slot,
  areaId,
  roster,
  assignedPersonIds,
  leadAssignedPersonIds,
  supportedAreaIds,
  onAssign,
  slotLabel,
}: SlotDropdownProps) {
  const getDisplayLevel = (p: RosterPerson): SkillLevel =>
    supportedAreaIds?.length
      ? combinedSkillForAreas(p, supportedAreaIds)
      : (p.skills[areaId] ?? 'no_experience');

  const available = useMemo(() => {
    const filtered = roster.filter(
      (p) =>
        !p.absent &&
        (!p.ot || p.otHereToday) &&
        !(leadAssignedPersonIds?.has(p.id)) &&
        (p.id === slot.personId || !assignedPersonIds.has(p.id)) &&
        (areaId !== 'area_bonding' || (p.skills.area_bonding ?? 'no_experience') !== 'no_experience')
    );
    return sortByFirstName(filtered);
  }, [roster, slot.personId, assignedPersonIds, leadAssignedPersonIds, areaId]);
  const currentPerson = slot.personId ? roster.find((p) => p.id === slot.personId) : null;
  const showCurrent = slot.personId && currentPerson && !available.some((p) => p.id === slot.personId);

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const options = [
    ...(showCurrent && currentPerson ? [{ person: currentPerson, isCurrent: true }] : []),
    ...available.map((p) => ({ person: p, isCurrent: false })),
  ];

  function select(personId: string | null) {
    onAssign(slot.id, personId);
    setOpen(false);
  }

  return (
    <div className="slot-wrap slot-dropdown-wrap" ref={containerRef} style={{ position: 'relative', display: 'inline-flex' }}>
      {slotLabel && <span className="slot-dropdown-label">{slotLabel}</span>}
      <button
        type="button"
        className="slot-dropdown-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {currentPerson ? (
          <SkillPill
            level={getDisplayLevel(currentPerson)}
            label={formatPersonStatusLabel(currentPerson)}
            small
          />
        ) : (
          <>
            <span className="slot-dropdown-unassigned">Assign…</span>
            <span className="slot-dropdown-chevron" aria-hidden>▾</span>
          </>
        )}
      </button>
      {open && (
        <ul
          role="listbox"
          className="slot-dropdown-list"
        >
          <li style={{ marginBottom: 2 }}>
            <button
              type="button"
              onClick={() => select(null)}
              style={{ color: '#888' }}
            >
              {slot.personId ? 'Clear slot' : '— Unassigned —'}
            </button>
          </li>
          {options.map(({ person }) => (
            <li key={person.id} style={{ marginBottom: 2 }}>
              <button
                type="button"
                onClick={() => select(person.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  background: slot.personId === person.id ? '#e8f4fd' : undefined,
                }}
              >
                <span
                  className={`skill-${getDisplayLevel(person)}`}
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 2,
                    flexShrink: 0,
                  }}
                  title={getDisplayLevel(person)}
                />
                <span>{formatPersonStatusLabel(person)}{slot.personId === person.id ? ' ✓' : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

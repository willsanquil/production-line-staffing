import { useState, useRef, useEffect, useMemo } from 'react';
import type { AreaId, RosterPerson, Slot } from '../types';
import { SkillPill } from './SkillPill';
import { sortByFirstName } from '../lib/rosterSort';
import { formatPersonStatusLabel } from '../lib/personLabel';

interface SlotDropdownProps {
  slot: Slot;
  areaId: AreaId;
  roster: RosterPerson[];
  assignedPersonIds: Set<string>;
  /** People assigned as leads (excluded from area slots). */
  leadAssignedPersonIds?: Set<string>;
  onAssign: (slotId: string, personId: string | null) => void;
  slotLabel?: string;
}

export function SlotDropdown({
  slot,
  areaId,
  roster,
  assignedPersonIds,
  leadAssignedPersonIds,
  onAssign,
  slotLabel,
}: SlotDropdownProps) {
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
            level={currentPerson.skills[areaId]}
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
                  className={`skill-${person.skills[areaId] ?? 'no_experience'}`}
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 2,
                    flexShrink: 0,
                  }}
                  title={person.skills[areaId]}
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

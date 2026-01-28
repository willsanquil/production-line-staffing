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
    <div className="slot-wrap" ref={containerRef} style={{ position: 'relative' }}>
      {slotLabel && <span style={{ fontSize: '0.9rem' }}>{slotLabel}</span>}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          minWidth: 140,
          padding: '6px 8px',
          border: '1px solid #ccc',
          borderRadius: 6,
          background: '#fff',
          cursor: 'pointer',
          textAlign: 'left',
          fontSize: '0.9rem',
        }}
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
          <span style={{ color: '#888' }}>— Unassigned —</span>
        )}
      </button>
      {open && (
        <ul
          role="listbox"
          className="slot-dropdown-list"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 4,
            padding: 4,
            listStyle: 'none',
            background: '#fff',
            border: '1px solid #ccc',
            borderRadius: 8,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            zIndex: 100,
            maxHeight: 240,
            overflowY: 'auto',
          }}
        >
          <li style={{ marginBottom: 2 }}>
            <button
              type="button"
              onClick={() => select(null)}
              style={{
                width: '100%',
                padding: '6px 8px',
                textAlign: 'left',
                border: 'none',
                borderRadius: 4,
                background: 'transparent',
                cursor: 'pointer',
                fontSize: '0.9rem',
                color: '#888',
              }}
            >
              — Unassigned —
            </button>
          </li>
          {options.map(({ person }) => (
            <li key={person.id} style={{ marginBottom: 2 }}>
              <button
                type="button"
                onClick={() => select(person.id)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 8px',
                  textAlign: 'left',
                  border: 'none',
                  borderRadius: 4,
                  background: slot.personId === person.id ? '#e8f4fd' : 'transparent',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
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

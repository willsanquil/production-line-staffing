import { useState, useRef, useEffect, useMemo, type DragEvent, type KeyboardEvent } from 'react';
import type { AreaId, RosterPerson, SkillLevel, Slot } from '../types';
import { SkillPill } from './SkillPill';
import { sortByFirstName } from '../lib/rosterSort';
import { formatPersonStatusLabel } from '../lib/personLabel';
import { SKILL_SCORE, skillFromAverage } from '../lib/skill';
import type { SlotRef } from '../lib/slots';

export const SLOT_DRAG_MIME = 'application/x-pls-slot';

/** For float slots: combined skill across supported areas. */
function combinedSkillForAreas(person: RosterPerson, areaIds: string[]): SkillLevel {
  if (areaIds.length === 0) return 'no_experience';
  let sum = 0;
  for (const aid of areaIds) {
    sum += SKILL_SCORE[person.skills[aid as AreaId] ?? 'no_experience'];
  }
  const avg = sum / areaIds.length;
  return skillFromAverage(avg);
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
  /** Admin drag-and-drop: move/swap from another slot onto this one. */
  onTransfer?: (from: SlotRef, to: SlotRef) => void;
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
  onTransfer,
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
  const [activeIndex, setActiveIndex] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const didDragRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxId = `${slot.id}-options`;

  const canDrag = !!onTransfer && !!slot.personId && !slot.locked && !slot.disabled;
  const canDrop = !!onTransfer && !slot.locked && !slot.disabled;

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

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex(0);
    }
    if (event.key === 'Escape') setOpen(false);
  }

  function handleListKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    const optionCount = options.length + 1;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((idx) => (idx + 1) % optionCount);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((idx) => (idx - 1 + optionCount) % optionCount);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (activeIndex === 0) select(null);
      else select(options[activeIndex - 1]?.person.id ?? null);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    }
  }

  function handleDragStart(event: DragEvent<HTMLButtonElement>) {
    if (!canDrag) return;
    didDragRef.current = true;
    setOpen(false);
    const payload: SlotRef = { areaId, slotId: slot.id };
    event.dataTransfer.setData(SLOT_DRAG_MIME, JSON.stringify(payload));
    event.dataTransfer.setData('text/plain', `${areaId}:${slot.id}`);
    event.dataTransfer.effectAllowed = 'move';
    event.currentTarget.classList.add('is-dragging');
  }

  function handleDragEnd(event: DragEvent<HTMLButtonElement>) {
    event.currentTarget.classList.remove('is-dragging');
    setDragOver(false);
    window.setTimeout(() => {
      didDragRef.current = false;
    }, 0);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    if (!canDrop) return;
    // Custom MIME types are often omitted from `types` during dragover in Chromium;
    // allow drop and validate payload on drop instead.
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDragOver(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    if (!containerRef.current?.contains(event.relatedTarget as Node)) {
      setDragOver(false);
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    if (!canDrop || !onTransfer) return;
    event.preventDefault();
    setDragOver(false);
    const raw = event.dataTransfer.getData(SLOT_DRAG_MIME) || event.dataTransfer.getData('text/plain');
    if (!raw) return;
    let from: SlotRef | null = null;
    try {
      if (raw.includes('{')) {
        from = JSON.parse(raw) as SlotRef;
      } else {
        const [fromAreaId, fromSlotId] = raw.split(':');
        if (fromAreaId && fromSlotId) from = { areaId: fromAreaId, slotId: fromSlotId };
      }
    } catch {
      return;
    }
    if (!from?.areaId || !from.slotId) return;
    onTransfer(from, { areaId, slotId: slot.id });
  }

  const wrapClass = [
    'slot-wrap',
    'slot-dropdown-wrap',
    dragOver ? 'slot-dropdown-wrap--drag-over' : '',
    canDrop ? 'slot-dropdown-wrap--droppable' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={wrapClass}
      ref={containerRef}
      style={{ position: 'relative', display: 'inline-flex' }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {slotLabel && <span className="slot-dropdown-label">{slotLabel}</span>}
      <button
        type="button"
        className={`slot-dropdown-trigger${canDrag ? ' slot-dropdown-trigger--draggable' : ''}`}
        draggable={canDrag}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onClick={() => {
          if (didDragRef.current) return;
          setOpen((o) => !o);
        }}
        onKeyDown={handleTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        title={canDrag ? 'Drag to another slot to move or swap' : undefined}
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
          id={listboxId}
          role="listbox"
          className="slot-dropdown-list"
          tabIndex={-1}
          aria-activedescendant={`${listboxId}-${activeIndex}`}
          onKeyDown={handleListKeyDown}
        >
          <li id={`${listboxId}-0`} role="option" aria-selected={!slot.personId} style={{ marginBottom: 2 }}>
            <button
              type="button"
              className="slot-dropdown-clear"
              onClick={() => select(null)}
            >
              {slot.personId ? 'Clear slot' : '— Unassigned —'}
            </button>
          </li>
          {options.map(({ person }, index) => (
            <li
              id={`${listboxId}-${index + 1}`}
              key={person.id}
              role="option"
              aria-selected={slot.personId === person.id}
              style={{ marginBottom: 2 }}
            >
              <button
                type="button"
                className={slot.personId === person.id ? 'slot-dropdown-option-selected' : undefined}
                onClick={() => select(person.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
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

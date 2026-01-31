import { memo, useMemo, useState, useRef, useEffect } from 'react';
import type { RosterPerson } from '../types';
import { sortByFirstName } from '../lib/rosterSort';
import { SkillPill } from './SkillPill';

interface LeadSlotsSectionProps {
  roster: RosterPerson[];
  leadSlots: Record<string, string | null>;
  leadSlotKeys: string[];
  getLeadSlotLabel: (key: string) => string;
  /** When lead slot is a named position (key "0","1",...), use first area for skill color. */
  areaIds?: string[];
  onLeadSlotChange: (key: string, personId: string | null) => void;
}

/** One dropdown: only leads not assigned to any other lead slot (or current for this slot). Colored by skill. */
function LeadSlotDropdown({
  slotKey,
  slotLabel,
  skillAreaId,
  leadSlotKeys,
  roster,
  leadSlots,
  onLeadSlotChange,
}: {
  slotKey: string;
  slotLabel: string;
  /** Area ID used for skill coloring (e.g. first area when slot is named position). */
  skillAreaId: string;
  leadSlotKeys: string[];
  roster: RosterPerson[];
  leadSlots: Record<string, string | null>;
  onLeadSlotChange: (key: string, personId: string | null) => void;
}) {
  const leadsOnly = useMemo(
    () =>
      sortByFirstName(
        roster.filter(
          (p) => !p.absent && (p.lead || (p.ot && p.otHereToday))
        )
      ),
    [roster]
  );
  const assignedToOther = useMemo(() => {
    const set = new Set<string>();
    for (const other of leadSlotKeys) {
      if (other !== slotKey && leadSlots[other]) set.add(leadSlots[other]!);
    }
    return set;
  }, [slotKey, leadSlots, leadSlotKeys]);
  const available = useMemo(
    () => leadsOnly.filter((p) => leadSlots[slotKey] === p.id || !assignedToOther.has(p.id)),
    [leadsOnly, leadSlots, slotKey, assignedToOther]
  );

  const currentPerson = leadSlots[slotKey] ? roster.find((p) => p.id === leadSlots[slotKey]) : null;
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  function select(personId: string | null) {
    onLeadSlotChange(slotKey, personId);
    setOpen(false);
  }

  return (
    <div className="lead-slot-wrap" ref={containerRef} style={{ display: 'flex', alignItems: 'center', gap: 6, position: 'relative' }}>
      <label style={{ fontSize: '0.9rem', fontWeight: 500 }}>
        {slotLabel}:
      </label>
      <div style={{ position: 'relative' }}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          style={{
            display: 'flex',
            alignItems: 'center',
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
              level={currentPerson.skills[skillAreaId] ?? 'no_experience'}
              label={currentPerson.name}
              small
            />
          ) : (
            <span style={{ color: '#888' }}>— Unassigned —</span>
          )}
        </button>
        {open && (
          <ul
            role="listbox"
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
              maxHeight: 220,
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
            {available.map((p) => (
              <li key={p.id} style={{ marginBottom: 2 }}>
                <button
                  type="button"
                  onClick={() => select(p.id)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    padding: '6px 8px',
                    textAlign: 'left',
                    border: 'none',
                    borderRadius: 4,
                    background: leadSlots[slotKey] === p.id ? '#e8f4fd' : 'transparent',
                    cursor: 'pointer',
                    fontSize: '0.9rem',
                  }}
                >
                  <SkillPill
                    level={p.skills[skillAreaId] ?? 'no_experience'}
                    label={p.name}
                    small
                  />
                  {leadSlots[slotKey] === p.id && <span style={{ marginLeft: 4 }}>✓</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function LeadSlotsSectionInner({
  roster,
  leadSlots,
  leadSlotKeys,
  getLeadSlotLabel,
  areaIds = [],
  onLeadSlotChange,
}: LeadSlotsSectionProps) {
  return (
    <div className="lead-slots-section" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
      {leadSlotKeys.map((key) => (
        <LeadSlotDropdown
          key={key}
          slotKey={key}
          slotLabel={getLeadSlotLabel(key)}
          skillAreaId={/^\d+$/.test(key) ? (areaIds[0] ?? '') : key}
          leadSlotKeys={leadSlotKeys}
          roster={roster}
          leadSlots={leadSlots}
          onLeadSlotChange={onLeadSlotChange}
        />
      ))}
    </div>
  );
}

export const LeadSlotsSection = memo(LeadSlotsSectionInner);

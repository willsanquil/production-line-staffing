import { memo } from 'react';
import type { RosterPerson } from '../types';
import { formatPersonStatusLabel } from '../lib/personLabel';

interface UnslottedBankProps {
  roster: RosterPerson[];
  leadAssignedPersonIds: Set<string>;
  allAssignedPersonIds: Set<string>;
}

function UnslottedBankInner({
  roster,
  leadAssignedPersonIds,
  allAssignedPersonIds,
}: UnslottedBankProps) {
  const unslotted = roster.filter(
    (p) =>
      !p.absent &&
      (!p.ot || p.otHereToday) &&
      !leadAssignedPersonIds.has(p.id) &&
      !allAssignedPersonIds.has(p.id)
  );

  return (
    <section className="section-card area-card unslotted-bank" aria-label="Unslotted people">
      <h2 style={{ margin: '0 0 0.5rem 0', fontSize: '1.05rem', fontWeight: 600 }}>
        Unslotted
      </h2>
      <p style={{ margin: '0 0 8px 0', fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
        Available and not yet in a lead or area slot. Updates as you assign.
      </p>
      <ul className="unslotted-bank-list">
        {unslotted.length === 0 ? (
          <li className="unslotted-bank-item unslotted-bank-item--empty">Everyone is slotted</li>
        ) : (
          unslotted.map((p) => (
            <li key={p.id} className="unslotted-bank-item" title={formatPersonStatusLabel(p)}>
              {p.name}
            </li>
          ))
        )}
      </ul>
    </section>
  );
}

export const UnslottedBank = memo(UnslottedBankInner);

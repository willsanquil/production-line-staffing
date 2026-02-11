import { useState, useMemo } from 'react';
import type { RosterPerson, SlotsByArea } from '../types';
import type { Slot } from '../types';
import { isCombinedSection } from '../lib/lineConfig';

interface StaffTheLineWizardProps {
  roster: RosterPerson[];
  lineSections: (string | readonly [string, string])[];
  slots: SlotsByArea;
  areaLabels: Record<string, string>;
  getSlotLabel: (areaId: string, slotIndex: number) => string;
  onMarkAbsent: (personId: string, absent: boolean) => void;
  onToggleOTHereToday: (personId: string, hereToday: boolean) => void;
  onSetSlotsForArea: (areaId: string, newSlots: Slot[]) => void;
  onClose: () => void;
  /** Called when user clicks Done on the final step to auto-staff the line (default positions + fill). */
  onStaffComplete?: () => void;
}

type Step = 1 | 2 | 3 | 4;

export function StaffTheLineWizard({
  roster,
  lineSections,
  slots,
  areaLabels,
  getSlotLabel,
  onMarkAbsent,
  onToggleOTHereToday,
  onSetSlotsForArea,
  onClose,
  onStaffComplete,
}: StaffTheLineWizardProps) {
  const [step, setStep] = useState<Step>(1);
  const [absentChoice, setAbsentChoice] = useState<'yes' | 'no' | null>(null);
  const [absentSelected, setAbsentSelected] = useState<Set<string>>(() => new Set(roster.filter((p) => p.absent).map((p) => p.id)));
  const [otChoice, setOtChoice] = useState<'yes' | 'no' | null>(null);
  const [otHereSelected, setOtHereSelected] = useState<Set<string>>(() => new Set(roster.filter((p) => p.ot && p.otHereToday).map((p) => p.id)));
  const [stationsChoice, setStationsChoice] = useState<'yes' | 'no' | null>(null);
  const [disabledSlotIds, setDisabledSlotIds] = useState<Set<string>>(() => {
    const set = new Set<string>();
    for (const areaId of Object.keys(slots)) {
      const list = slots[areaId] ?? [];
      list.forEach((s) => {
        if (s.disabled) set.add(s.id);
      });
    }
    return set;
  });

  const staffForAbsent = useMemo(
    () => roster.filter((p) => !p.ot).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    [roster]
  );

  const otRoster = useMemo(
    () => roster.filter((p) => p.ot).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    [roster]
  );

  const sectionsWithSlots = useMemo(() => {
    const out: { label: string; areaId: string; slotIndex: number; slotId: string; slotLabel: string }[] = [];
    for (const section of lineSections) {
      if (isCombinedSection(section)) {
        const [idA, idB] = section;
        const labelA = areaLabels[idA] ?? idA;
        const labelB = areaLabels[idB] ?? idB;
        const listA = slots[idA] ?? [];
        listA.forEach((s, i) => out.push({ label: `${labelA} / ${labelB}`, areaId: idA, slotIndex: i, slotId: s.id, slotLabel: getSlotLabel(idA, i) }));
        const listB = slots[idB] ?? [];
        listB.forEach((s, i) => out.push({ label: `${labelA} / ${labelB}`, areaId: idB, slotIndex: i, slotId: s.id, slotLabel: getSlotLabel(idB, i) }));
      } else {
        const areaId = section as string;
        const label = areaLabels[areaId] ?? areaId;
        const list = slots[areaId] ?? [];
        list.forEach((s, i) => out.push({ label, areaId, slotIndex: i, slotId: s.id, slotLabel: getSlotLabel(areaId, i) }));
      }
    }
    return out;
  }, [lineSections, slots, areaLabels, getSlotLabel]);

  const applyAbsent = () => {
    staffForAbsent.forEach((p) => onMarkAbsent(p.id, absentSelected.has(p.id)));
  };

  const applyDisabledSlots = () => {
    const byArea: Record<string, Slot[]> = {};
    for (const areaId of Object.keys(slots)) {
      const list = (slots[areaId] ?? []).map((s) => ({ ...s, disabled: disabledSlotIds.has(s.id) }));
      byArea[areaId] = list;
    }
    Object.entries(byArea).forEach(([areaId, newSlots]) => onSetSlotsForArea(areaId, newSlots));
  };

  const applyOTHereToday = () => {
    otRoster.forEach((p) => onToggleOTHereToday(p.id, otHereSelected.has(p.id)));
  };

  const handleNextStep1 = () => {
    if (absentChoice === 'yes') {
      applyAbsent();
    } else if (absentChoice === 'no') {
      staffForAbsent.forEach((p) => onMarkAbsent(p.id, false));
    }
    setStep(2);
  };

  const handleNextStep2 = () => {
    if (otChoice === 'yes') {
      applyOTHereToday();
    } else if (otChoice === 'no') {
      otRoster.forEach((p) => onToggleOTHereToday(p.id, false));
    }
    setStep(3);
  };

  const handleNextStep3 = () => {
    if (stationsChoice === 'yes') applyDisabledSlots();
    setStep(4);
  };

  const handleDone = () => {
    onStaffComplete?.();
    onClose();
  };

  const toggleAbsent = (personId: string) => {
    setAbsentSelected((prev) => {
      const next = new Set(prev);
      if (next.has(personId)) next.delete(personId);
      else next.add(personId);
      return next;
    });
  };

  const toggleOTHere = (personId: string) => {
    setOtHereSelected((prev) => {
      const next = new Set(prev);
      if (next.has(personId)) next.delete(personId);
      else next.add(personId);
      return next;
    });
  };

  const toggleSlotDisabled = (slotId: string) => {
    setDisabledSlotIds((prev) => {
      const next = new Set(prev);
      if (next.has(slotId)) next.delete(slotId);
      else next.add(slotId);
      return next;
    });
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="staff-the-line-title">
      <div className="modal-dialog staff-the-line-wizard" style={{ maxWidth: 520 }}>
        <h2 id="staff-the-line-title" style={{ margin: '0 0 8px 0', fontSize: '1.25rem' }}>
          Staff the line
        </h2>
        <p style={{ color: 'var(--color-text-secondary)', marginBottom: 24, fontSize: '0.9rem' }}>
          Quick setup: mark absences, who’s OT today, and any stations that are down.
        </p>

        {step === 1 && (
          <>
            <p style={{ fontWeight: 600, marginBottom: 12 }}>Is anyone absent today?</p>
            <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="absent"
                  checked={absentChoice === 'yes'}
                  onChange={() => setAbsentChoice('yes')}
                />
                Yes
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="absent"
                  checked={absentChoice === 'no'}
                  onChange={() => setAbsentChoice('no')}
                />
                No
              </label>
            </div>
            {absentChoice === 'yes' && (
              <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid var(--color-border-light)', borderRadius: 8, padding: 12, marginBottom: 20, background: 'var(--color-bg-subtle)' }}>
                <p style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', margin: '0 0 10px 0' }}>
                  Select who is absent:
                </p>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {staffForAbsent.map((p) => (
                    <li key={p.id}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', cursor: 'pointer', fontSize: '0.9rem' }}>
                        <input
                          type="checkbox"
                          checked={absentSelected.has(p.id)}
                          onChange={() => toggleAbsent(p.id)}
                        />
                        <span>{p.name}</span>
                      </label>
                    </li>
                  ))}
                </ul>
                {staffForAbsent.length === 0 && <p style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>No staff on roster.</p>}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" onClick={onClose}>
                Cancel
              </button>
              <button type="button" className="btn-primary" onClick={handleNextStep1} disabled={absentChoice === null}>
                Next
              </button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <p style={{ fontWeight: 600, marginBottom: 12 }}>Is there any OT today?</p>
            <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="ot"
                  checked={otChoice === 'yes'}
                  onChange={() => setOtChoice('yes')}
                />
                Yes
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="ot"
                  checked={otChoice === 'no'}
                  onChange={() => setOtChoice('no')}
                />
                No
              </label>
            </div>
            {otChoice === 'yes' && (
              <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid var(--color-border-light)', borderRadius: 8, padding: 12, marginBottom: 20, background: 'var(--color-bg-subtle)' }}>
                <p style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', margin: '0 0 10px 0' }}>
                  Select who is here today (they can be slotted):
                </p>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {otRoster.map((p) => (
                    <li key={p.id}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', cursor: 'pointer', fontSize: '0.9rem' }}>
                        <input
                          type="checkbox"
                          checked={otHereSelected.has(p.id)}
                          onChange={() => toggleOTHere(p.id)}
                        />
                        <span>{p.name}</span>
                      </label>
                    </li>
                  ))}
                </ul>
                {otRoster.length === 0 && <p style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>No one on the OT list.</p>}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <button type="button" onClick={() => setStep(1)}>
                Back
              </button>
              <button type="button" className="btn-primary" onClick={handleNextStep2} disabled={otChoice === null}>
                Next
              </button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <p style={{ fontWeight: 600, marginBottom: 12 }}>Are any stations disabled today?</p>
            <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="stations"
                  checked={stationsChoice === 'yes'}
                  onChange={() => setStationsChoice('yes')}
                />
                Yes
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="stations"
                  checked={stationsChoice === 'no'}
                  onChange={() => setStationsChoice('no')}
                />
                No
              </label>
            </div>
            {stationsChoice === 'yes' && (
              <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid var(--color-border-light)', borderRadius: 8, padding: 12, marginBottom: 20, background: 'var(--color-bg-subtle)' }}>
                <p style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', margin: '0 0 10px 0' }}>
                  Select slots to disable (they won’t be staffed or counted in minimums):
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {sectionsWithSlots.length === 0 ? (
                    <p style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>No slots on this line.</p>
                  ) : (
                    sectionsWithSlots.map(({ label, slotId, slotLabel }) => (
                      <label key={slotId} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: '0.9rem' }}>
                        <input
                          type="checkbox"
                          checked={disabledSlotIds.has(slotId)}
                          onChange={() => toggleSlotDisabled(slotId)}
                        />
                        <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>{label}</span>
                        <span>{slotLabel}</span>
                      </label>
                    ))
                  )}
                </div>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <button type="button" onClick={() => setStep(2)}>
                Back
              </button>
              <button type="button" className="btn-primary" onClick={handleNextStep3} disabled={stationsChoice === null}>
                Next
              </button>
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <p style={{ marginBottom: 24, fontSize: '1rem' }}>You’re all set. The line is ready to staff.</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" className="btn-primary" onClick={handleDone}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

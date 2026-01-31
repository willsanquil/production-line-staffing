import { memo } from 'react';
import type { AreaId, RosterPerson, Slot, TaskItem } from '../types';
import type { SkillLevel } from '../types';
import { createEmptySlot } from '../data/initialState';
import { getSlotLabel } from '../lib/areaConfig';
import { SlotDropdown } from './SlotDropdown';
import { TaskList } from './TaskList';

const SKILL_SCORE: Record<SkillLevel, number> = {
  no_experience: 0,
  training: 1,
  trained: 2,
  expert: 3,
};

function averageSeniority(areaId: AreaId, slots: Slot[], roster: RosterPerson[]): number | null {
  const personIds = slots.map((s) => s.personId).filter(Boolean) as string[];
  if (personIds.length === 0) return null;
  let sum = 0;
  for (const id of personIds) {
    const p = roster.find((r) => r.id === id);
    if (p) sum += SKILL_SCORE[p.skills[areaId] ?? 'no_experience'];
  }
  return sum / personIds.length;
}

interface AreaStaffingProps {
  areaId: AreaId;
  areaLabel: string;
  minSlots: number;
  maxSlots: number;
  /** Custom slot names for this area (by index). */
  slotLabels?: string[];
  slots: Slot[];
  roster: RosterPerson[];
  allAssignedPersonIds: Set<string>;
  leadAssignedPersonIds: Set<string>;
  juiced: boolean;
  deJuiced: boolean;
  onToggleJuice: (areaId: AreaId, juiced: boolean) => void;
  onToggleDeJuice: (areaId: AreaId, deJuiced: boolean) => void;
  onAreaNameChange: (areaId: AreaId, name: string) => void;
  onCapacityChange: (areaId: AreaId, payload: { min?: number; max?: number }) => void;
  onSlotLabelChange: (areaId: AreaId, slotIndex: number, value: string) => void;
  sectionTasks: TaskItem[];
  onSlotsChange: (areaId: AreaId, slots: Slot[]) => void;
  onSectionTasksChange: (areaId: AreaId, tasks: TaskItem[]) => void;
  onAssign: (areaId: AreaId, slotId: string, personId: string | null) => void;
  /** When true, area needs at least one Trained or Expert to run. */
  requiresTrainedOrExpert?: boolean;
  /** Called when user toggles "Needs experience" for this area. */
  onRequiresTrainedOrExpertChange?: (value: boolean) => void;
}

function AreaStaffingInner({
  areaId,
  areaLabel,
  minSlots: min,
  maxSlots: max,
  slotLabels = [],
  slots,
  roster,
  allAssignedPersonIds,
  leadAssignedPersonIds,
  juiced,
  deJuiced,
  onToggleJuice,
  onToggleDeJuice,
  onAreaNameChange,
  onCapacityChange,
  onSlotLabelChange,
  sectionTasks,
  onSlotsChange,
  onSectionTasksChange,
  onAssign,
  requiresTrainedOrExpert = false,
  onRequiresTrainedOrExpertChange,
}: AreaStaffingProps) {
  const enabledSlots = slots.filter((s) => !s.disabled);
  const filled = enabledSlots.filter((s) => s.personId).length;
  const totalEnabled = enabledSlots.length;
  const disabledCount = slots.length - totalEnabled;
  const pct = totalEnabled > 0 ? Math.round((filled / totalEnabled) * 100) : 0;
  const belowMin = filled < min;
  const atMax = slots.length >= max;
  const hasTrainedOrExpert =
    filled > 0 &&
    enabledSlots.some((s) => {
      if (!s.personId) return false;
      const p = roster.find((r) => r.id === s.personId);
      const skill = p?.skills[areaId] ?? 'no_experience';
      return skill === 'trained' || skill === 'expert';
    });
  const needsTrainedOrExpert = requiresTrainedOrExpert && filled >= 1 && !hasTrainedOrExpert;

  function toggleSlotDisabled(slotId: string) {
    onSlotsChange(
      areaId,
      slots.map((s) => (s.id === slotId ? { ...s, disabled: !s.disabled } : s))
    );
  }
  function toggleSlotLocked(slotId: string) {
    onSlotsChange(
      areaId,
      slots.map((s) => (s.id === slotId ? { ...s, locked: !s.locked } : s))
    );
  }
  const avgSeniority = averageSeniority(areaId, enabledSlots, roster);
  const spectrumPosition = avgSeniority != null ? (avgSeniority / 3) * 100 : null;

  function addSlot() {
    if (atMax) return;
    onSlotsChange(areaId, [...slots, createEmptySlot()]);
  }

  function removeSlot() {
    if (slots.length <= min) return;
    onSlotsChange(areaId, slots.slice(0, -1));
  }

  function handleAssign(slotId: string, personId: string | null) {
    onAssign(areaId, slotId, personId);
  }

  return (
    <section className="section-card area-card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 4 }}>
        <input
          type="text"
          value={areaLabel}
          onChange={(e) => onAreaNameChange(areaId, e.target.value)}
          style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0, padding: '2px 6px', border: '1px solid transparent', borderRadius: 4, background: 'transparent', minWidth: 80 }}
          onFocus={(e) => (e.target.style.borderColor = '#999')}
          onBlur={(e) => (e.target.style.borderColor = 'transparent')}
          aria-label="Area name"
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.9rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={juiced}
              onChange={(e) => onToggleJuice(areaId, e.target.checked)}
              aria-label={`Prioritize ${areaLabel} in Spread talent`}
            />
            Prioritize
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.9rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={deJuiced}
              onChange={(e) => onToggleDeJuice(areaId, e.target.checked)}
              aria-label={`De-prioritize ${areaLabel} (fill last in Spread talent)`}
            />
            De-Prioritize
          </label>
          {onRequiresTrainedOrExpertChange != null && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.9rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={requiresTrainedOrExpert}
                onChange={(e) => onRequiresTrainedOrExpertChange(e.target.checked)}
                aria-label={`${areaLabel} needs experience (at least one Trained or Expert)`}
              />
              Needs experience
            </label>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginBottom: 8 }}>
        <p style={{ margin: 0, fontSize: '0.95rem' }}>
          Staffing: {filled}/{totalEnabled} slots ({pct}%)
          {disabledCount > 0 && ` (${disabledCount} disabled)`}
          {slots.length < max && ` — max ${max}`}
        </p>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}>
          Needs
          <input
            type="number"
            min={1}
            max={max}
            value={min}
            onChange={(e) => onCapacityChange(areaId, { min: e.target.valueAsNumber })}
            style={{ width: 44, padding: '2px 6px' }}
            aria-label="Slots needed to run"
          />
          to run
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}>
          Max slots
          <input
            type="number"
            min={min}
            value={max}
            onChange={(e) => onCapacityChange(areaId, { max: e.target.valueAsNumber })}
            style={{ width: 44, padding: '2px 6px' }}
            aria-label="Max slots"
          />
        </label>
      </div>
      <p style={{ margin: '0 0 8px 0', fontSize: '0.85rem', color: belowMin ? '#c0392b' : '#666' }}>
        {belowMin && '— Below minimum —'}
        {needsTrainedOrExpert && (
          <span style={{ display: 'block', color: '#c0392b', marginTop: belowMin ? 4 : 0 }}>
            — Needs at least one Trained or Expert to run —
          </span>
        )}
      </p>
      <div className="seniority-spectrum-wrap" style={{ marginBottom: 10 }}>
        <div className="seniority-spectrum-label" style={{ fontSize: '0.75rem', marginBottom: 4 }}>
          Knowledge level
        </div>
        <div className="seniority-spectrum" style={{ position: 'relative', height: 14, borderRadius: 4, overflow: 'hidden', display: 'flex' }}>
          <div className="skill-no_experience" style={{ flex: 1, minWidth: 0 }} />
          <div className="skill-training" style={{ flex: 1, minWidth: 0 }} />
          <div className="skill-trained" style={{ flex: 1, minWidth: 0 }} />
          <div className="skill-expert" style={{ flex: 1, minWidth: 0 }} />
          {spectrumPosition != null && (
            <div
              className="seniority-spectrum-arrow"
              style={{
                position: 'absolute',
                left: `clamp(4px, ${spectrumPosition}%, calc(100% - 8px))`,
                top: '50%',
                transform: 'translate(-50%, -50%)',
                width: 0,
                height: 0,
                borderLeft: '5px solid transparent',
                borderRight: '5px solid transparent',
                borderTop: '7px solid #1a1a1a',
                filter: 'drop-shadow(0 0 1px #fff)',
                pointerEvents: 'none',
              }}
              title={`Avg: ${((spectrumPosition / 100) * 3).toFixed(1)} / 3`}
            />
          )}
        </div>
      </div>
      <div className="slots-row" style={{ flexWrap: 'wrap' }}>
        {slots.map((slot, idx) => {
          const label = getSlotLabel(areaId, idx, { [areaId]: slotLabels });
          const isDisabled = !!slot.disabled;
          const isLocked = !!slot.locked;
          const assignedName = slot.personId ? roster.find((p) => p.id === slot.personId)?.name : null;
          return (
            <div
              key={slot.id}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                alignItems: 'flex-start',
                opacity: isDisabled ? 0.65 : 1,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  <input
                    type="checkbox"
                    checked={isDisabled}
                    onChange={() => toggleSlotDisabled(slot.id)}
                    title={isDisabled ? 'Enable slot' : 'Disable slot'}
                    aria-label={isDisabled ? 'Enable slot' : 'Disable slot'}
                  />
                  {isDisabled ? 'Off' : 'On'}
                </label>
                {!isDisabled && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    <input
                      type="checkbox"
                      checked={isLocked}
                      onChange={() => toggleSlotLocked(slot.id)}
                      title={isLocked ? 'Unlock (Spread/Randomize can change)' : 'Lock (Spread/Randomize will leave this slot unchanged)'}
                      aria-label={isLocked ? 'Unlock slot' : 'Lock slot'}
                    />
                    Lock
                  </label>
                )}
                <input
                  type="text"
                  value={slotLabels[idx] ?? ''}
                  onChange={(e) => onSlotLabelChange(areaId, idx, e.target.value)}
                  placeholder={label}
                  style={{ fontSize: '0.8rem', padding: '2px 6px', width: 100, maxWidth: '100%', border: '1px solid #ddd', borderRadius: 4 }}
                  aria-label={`Slot ${idx + 1} name`}
                />
              </div>
              {isDisabled ? (
                <span style={{ fontSize: '0.8rem', color: '#888' }}>— Disabled —</span>
              ) : isLocked ? (
                <span style={{ fontSize: '0.9rem' }} title="Locked — unlock to change">{assignedName ?? '— Unassigned —'}</span>
              ) : (
                <SlotDropdown
                  slot={slot}
                  areaId={areaId}
                  roster={roster}
                  assignedPersonIds={allAssignedPersonIds}
                  leadAssignedPersonIds={leadAssignedPersonIds}
                  onAssign={handleAssign}
                  slotLabel={label}
                />
              )}
            </div>
          );
        })}
        {!atMax && <button type="button" onClick={addSlot}>+ Slot</button>}
        {slots.length > min && (
          <button type="button" onClick={removeSlot}>− Slot</button>
        )}
      </div>
      <div style={{ marginTop: '0.75rem' }}>
        <strong>Tasks</strong>
        <TaskList
          tasks={sectionTasks}
          onChange={(tasks) => onSectionTasksChange(areaId, tasks)}
          placeholder="Task..."
        />
      </div>
    </section>
  );
}

export const AreaStaffing = memo(AreaStaffingInner);

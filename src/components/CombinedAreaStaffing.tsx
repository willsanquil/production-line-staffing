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

interface CombinedAreaStaffingProps {
  /** Combined section title (e.g. "14.5 & Flip"). */
  combinedLabel: string;
  /** First area (e.g. 14.5). */
  areaIdA: AreaId;
  /** Second area (e.g. Flip). */
  areaIdB: AreaId;
  areaLabelA: string;
  areaLabelB: string;
  slotsA: Slot[];
  slotsB: Slot[];
  minA: number;
  maxA: number;
  minB: number;
  maxB: number;
  slotLabelsA?: string[];
  slotLabelsB?: string[];
  sectionTasksA: TaskItem[];
  sectionTasksB: TaskItem[];
  roster: RosterPerson[];
  allAssignedPersonIds: Set<string>;
  leadAssignedPersonIds: Set<string>;
  juicedA: boolean;
  juicedB: boolean;
  deJuicedA: boolean;
  deJuicedB: boolean;
  onToggleJuice: (areaId: AreaId, juiced: boolean) => void;
  onToggleDeJuice: (areaId: AreaId, deJuiced: boolean) => void;
  onCapacityChange: (areaId: AreaId, payload: { min?: number; max?: number }) => void;
  onSlotLabelChange: (areaId: AreaId, slotIndex: number, value: string) => void;
  onSlotsChange: (areaId: AreaId, slots: Slot[]) => void;
  onSectionTasksChange: (areaId: AreaId, tasks: TaskItem[]) => void;
  onAssign: (areaId: AreaId, slotId: string, personId: string | null) => void;
  requiresTrainedOrExpertA?: boolean;
  requiresTrainedOrExpertB?: boolean;
  onRequiresTrainedOrExpertChangeA?: (value: boolean) => void;
  onRequiresTrainedOrExpertChangeB?: (value: boolean) => void;
}

function CombinedAreaStaffingInner({
  combinedLabel,
  areaIdA,
  areaIdB,
  areaLabelA,
  areaLabelB,
  slotsA,
  slotsB,
  minA,
  maxA,
  minB,
  maxB,
  slotLabelsA = [],
  slotLabelsB = [],
  sectionTasksA,
  sectionTasksB,
  roster,
  allAssignedPersonIds,
  leadAssignedPersonIds,
  juicedA,
  juicedB,
  deJuicedA,
  deJuicedB,
  onToggleJuice,
  onToggleDeJuice,
  onCapacityChange,
  onSlotLabelChange,
  onSlotsChange,
  onSectionTasksChange,
  onAssign,
  requiresTrainedOrExpertA = false,
  requiresTrainedOrExpertB = false,
  onRequiresTrainedOrExpertChangeA,
  onRequiresTrainedOrExpertChangeB,
}: CombinedAreaStaffingProps) {
  const juiced = juicedA || juicedB;
  const deJuiced = deJuicedA || deJuicedB;
  const setJuiced = (v: boolean) => {
    onToggleJuice(areaIdA, v);
    onToggleJuice(areaIdB, v);
  };
  const setDeJuiced = (v: boolean) => {
    onToggleDeJuice(areaIdA, v);
    onToggleDeJuice(areaIdB, v);
  };

  function renderSubArea(
    areaId: AreaId,
    areaLabel: string,
    slots: Slot[],
    min: number,
    max: number,
    slotLabels: string[],
    sectionTasks: TaskItem[],
    requiresTrainedOrExpert: boolean,
    onRequiresTrainedOrExpertChange?: (value: boolean) => void
  ) {
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
    const avgSeniorityVal = averageSeniority(areaId, enabledSlots, roster);

    function toggleSlotDisabled(slotId: string) {
      onSlotsChange(areaId, slots.map((s) => (s.id === slotId ? { ...s, disabled: !s.disabled } : s)));
    }
    function toggleSlotLocked(slotId: string) {
      onSlotsChange(areaId, slots.map((s) => (s.id === slotId ? { ...s, locked: !s.locked } : s)));
    }
    const spectrumPosition = avgSeniorityVal != null ? (avgSeniorityVal / 3) * 100 : null;

    return (
      <div key={areaId} style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid #eee' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
          <div style={{ fontSize: '1rem', fontWeight: 600 }}>{areaLabel}</div>
          {onRequiresTrainedOrExpertChange != null && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={requiresTrainedOrExpert}
                onChange={(e) => onRequiresTrainedOrExpertChange(e.target.checked)}
                aria-label={`${areaLabel} needs experience`}
              />
              Needs experience
            </label>
          )}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: '0.95rem' }}>
            Staffing: {filled}/{totalEnabled} ({pct}%)
            {disabledCount > 0 && ` (${disabledCount} disabled)`}
            {slots.length < max && ` — max ${max}`}
          </span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}>
            Needs
            <input
              type="number"
              min={1}
              max={max}
              value={min}
              onChange={(e) => onCapacityChange(areaId, { min: e.target.valueAsNumber })}
              style={{ width: 44, padding: '2px 6px' }}
              aria-label={`${areaLabel} slots needed`}
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
              aria-label={`${areaLabel} max slots`}
            />
          </label>
        </div>
        {(belowMin || needsTrainedOrExpert) && (
          <p style={{ margin: '0 0 8px 0', fontSize: '0.85rem', color: '#c0392b' }}>
            {belowMin && '— Below minimum —'}
            {needsTrainedOrExpert && (
              <span style={{ display: 'block', marginTop: belowMin ? 4 : 0 }}>
                — Needs at least one Trained or Expert to run —
              </span>
            )}
          </p>
        )}
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
        <div className="slots-row" style={{ flexWrap: 'wrap', display: 'flex', gap: 8, marginBottom: 8 }}>
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
                    onAssign={(slotId, personId) => onAssign(areaId, slotId, personId)}
                    slotLabel={label}
                  />
                )}
              </div>
            );
          })}
          {!atMax && (
            <button type="button" onClick={() => onSlotsChange(areaId, [...slots, createEmptySlot()])}>
              + Slot
            </button>
          )}
          {slots.length > min && (
            <button type="button" onClick={() => onSlotsChange(areaId, slots.slice(0, -1))}>
              − Slot
            </button>
          )}
        </div>
        <div style={{ marginTop: '0.5rem' }}>
          <strong>Tasks</strong>
          <TaskList
            tasks={sectionTasks}
            onChange={(tasks) => onSectionTasksChange(areaId, tasks)}
            placeholder="Task..."
          />
        </div>
      </div>
    );
  }

  return (
    <section className="section-card area-card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: '1.25rem', fontWeight: 700 }}>{combinedLabel}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.9rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={juiced}
              onChange={(e) => setJuiced(e.target.checked)}
              aria-label={`Juice ${combinedLabel}`}
            />
            Prioritize
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.9rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={deJuiced}
              onChange={(e) => setDeJuiced(e.target.checked)}
              aria-label={`De-prioritize ${combinedLabel}`}
            />
            De-Prioritize
          </label>
        </div>
      </div>

      {renderSubArea(areaIdA, areaLabelA, slotsA, minA, maxA, slotLabelsA, sectionTasksA, requiresTrainedOrExpertA, onRequiresTrainedOrExpertChangeA)}
      {renderSubArea(areaIdB, areaLabelB, slotsB, minB, maxB, slotLabelsB, sectionTasksB, requiresTrainedOrExpertB, onRequiresTrainedOrExpertChangeB)}
    </section>
  );
}

export const CombinedAreaStaffing = memo(CombinedAreaStaffingInner);

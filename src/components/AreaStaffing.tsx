import { memo } from 'react';
import type { AreaId, BreakSchedulesByArea, RosterPerson, Slot } from '../types';
import type { SkillLevel } from '../types';
import { createEmptySlot } from '../data/initialState';
import { getSlotLabel } from '../lib/areaConfig';
import { SlotDropdown } from './SlotDropdown';

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
  onClearArea?: (areaId: AreaId) => void;
  /** Optional: when provided, render a "Delete area" button (configure mode only). */
  onDeleteArea?: (areaId: AreaId) => void;
  /** Optional: when provided, render a "Convert to floats" button (configure mode only).
   * Clicking lets the user pick which areas the new floats should cover; on confirm the
   * station is replaced with one float per enabled slot. */
  onConvertToFloats?: (areaId: AreaId) => void;
  /** Optional: when provided, render a "Covers breaks for…" button (configure mode only).
   * Non-destructive alternative to Convert to Floats — the station keeps running but its
   * people additionally cover breaks at the chosen supported areas. */
  onEditCoversBreaksFor?: (areaId: AreaId) => void;
  /** Areas this station currently covers breaks for. Shown as a small label so the user
   * can see the current setting at a glance in Configure mode. */
  coversBreaksForAreaIds?: string[];
  /** Map of area id -> display label, used to render the coversBreaksForAreaIds summary. */
  areaLabelsForCoverageSummary?: Record<string, string>;
  /** Optional: move this section one step earlier in the line. When undefined, button is hidden / disabled. */
  onMoveLeft?: (areaId: AreaId) => void;
  /** Optional: move this section one step later in the line. */
  onMoveRight?: (areaId: AreaId) => void;
  sectionTasks?: unknown[];
  onSlotsChange: (areaId: AreaId, slots: Slot[]) => void;
  onSectionTasksChange?: (areaId: AreaId, tasks: unknown[]) => void;
  onAssign: (areaId: AreaId, slotId: string, personId: string | null) => void;
  /** Drag-and-drop transfer between slots (Admin). */
  onTransfer?: (from: { areaId: string; slotId: string }, to: { areaId: string; slotId: string }) => void;
  /** When true, area needs at least one Trained or Expert to run. */
  requiresTrainedOrExpert?: boolean;
  /** Called when user toggles "Needs experience" for this area. */
  onRequiresTrainedOrExpertChange?: (value: boolean) => void;
  /** When provided (e.g. for float positions), show break rotation under the slot. */
  breakSchedules?: BreakSchedulesByArea;
  rotationCount?: number;
  /** Whether to show the per-slot break coverage toggle (only when breaks are enabled for the line). */
  showBreakCoverageToggle?: boolean;
  /** Per-slot break coverage for this area: slotId -> true if that slot needs break coverage. */
  slotBreakCoverageEnabled?: Record<string, boolean>;
  /** Toggle break coverage for a specific slot (configure view). */
  onToggleSlotBreakCoverage?: (areaId: AreaId, slotId: string, enabled: boolean) => void;
  /** For float slots: area IDs this float supports (skill pill shows combined skill). */
  supportedAreaIds?: string[];
  /** When true, show only area title + slot name + assignee (no On/Lock, staffing stats, knowledge bar). */
  compactView?: boolean;
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
  onAreaNameChange,
  onCapacityChange,
  onSlotLabelChange,
  onClearArea,
  onDeleteArea,
  onConvertToFloats,
  onEditCoversBreaksFor,
  coversBreaksForAreaIds,
  areaLabelsForCoverageSummary,
  onMoveLeft,
  onMoveRight,
  onSlotsChange,
  onAssign,
  onTransfer,
  requiresTrainedOrExpert = false,
  onRequiresTrainedOrExpertChange,
  breakSchedules,
  rotationCount,
  supportedAreaIds,
  compactView = false,
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

  if (compactView) {
    return (
      <section className="section-card area-card area-card--compact">
        <h2 style={{ margin: '0 0 10px 0', fontSize: '1.1rem', fontWeight: 700 }}>{areaLabel}</h2>
        <div className="slots-row">
          {slots.map((slot, idx) => {
            const label = getSlotLabel(areaId, idx, { [areaId]: slotLabels });
            const displayLabel = slotLabels[idx] ?? label;
            const isDisabled = !!slot.disabled;
            return (
              <div key={slot.id} className="slot-block slot-block--compact" style={{ opacity: isDisabled ? 0.65 : 1 }}>
                <span className="slot-block-name slot-block-name--readonly" style={{ marginBottom: 6 }}>{displayLabel || `Slot ${idx + 1}`}</span>
                {isDisabled ? (
                  <span className="slot-block-status slot-block-status--muted">— Off —</span>
                ) : (
                  <SlotDropdown
                    slot={slot}
                    areaId={areaId}
                    roster={roster}
                    assignedPersonIds={allAssignedPersonIds}
                    leadAssignedPersonIds={leadAssignedPersonIds}
                    supportedAreaIds={supportedAreaIds}
                    onAssign={handleAssign}
                    onTransfer={onTransfer}
                  />
                )}
              </div>
            );
          })}
        </div>
      </section>
    );
  }

  return (
    <section className="section-card area-card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
          {(onMoveLeft || onMoveRight) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => onMoveLeft?.(areaId)}
                disabled={!onMoveLeft}
                title={onMoveLeft ? `Move ${areaLabel} left` : `${areaLabel} is already first`}
                aria-label={`Move ${areaLabel} left`}
                style={{ padding: '2px 8px', fontSize: '1rem', lineHeight: 1, opacity: onMoveLeft ? 1 : 0.4, cursor: onMoveLeft ? 'pointer' : 'not-allowed' }}
              >
                ◀
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => onMoveRight?.(areaId)}
                disabled={!onMoveRight}
                title={onMoveRight ? `Move ${areaLabel} right` : `${areaLabel} is already last`}
                aria-label={`Move ${areaLabel} right`}
                style={{ padding: '2px 8px', fontSize: '1rem', lineHeight: 1, opacity: onMoveRight ? 1 : 0.4, cursor: onMoveRight ? 'pointer' : 'not-allowed' }}
              >
                ▶
              </button>
            </div>
          )}
          <input
            type="text"
            value={areaLabel}
            onChange={(e) => onAreaNameChange(areaId, e.target.value)}
            style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0, padding: '2px 6px', border: '1px solid transparent', borderRadius: 4, background: 'transparent', minWidth: 80 }}
            onFocus={(e) => (e.target.style.borderColor = '#999')}
            onBlur={(e) => (e.target.style.borderColor = 'transparent')}
            aria-label="Area name"
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
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
        {onClearArea && (
          <button
            type="button"
            className="btn-ghost"
            onClick={() => onClearArea(areaId)}
            title={`Clear assigned people from ${areaLabel}`}
          >
            Clear area
          </button>
        )}
        {onConvertToFloats && (
          <button
            type="button"
            className="btn-ghost"
            onClick={() => onConvertToFloats(areaId)}
            title={`Convert ${areaLabel} into float positions that cover breaks elsewhere`}
          >
            Convert to floats
          </button>
        )}
        {onEditCoversBreaksFor && (
          <button
            type="button"
            className="btn-ghost"
            onClick={() => onEditCoversBreaksFor(areaId)}
            title={`Pick which stations ${areaLabel}'s people cover breaks at — they keep running ${areaLabel} but their break rotations are scheduled to leave coverage in place at the chosen stations`}
          >
            Covers breaks for…
            {coversBreaksForAreaIds && coversBreaksForAreaIds.length > 0 && (
              <span style={{ marginLeft: 6, fontWeight: 600, color: '#1976d2' }}>
                {coversBreaksForAreaIds
                  .map((id) => areaLabelsForCoverageSummary?.[id] ?? id)
                  .join(', ')}
              </span>
            )}
          </button>
        )}
        {onDeleteArea && (
          <button
            type="button"
            className="btn-danger"
            onClick={() => {
              const ok = window.confirm(
                `Delete "${areaLabel}"?\n\nSlot assignments, tasks, capacity overrides, and break-coverage settings for this area will be removed. People in the line roster keep their skill data so re-adding the same area later restores it.`
              );
              if (ok) onDeleteArea(areaId);
            }}
            title={`Delete the ${areaLabel} category from this line`}
          >
            Delete area
          </button>
        )}
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
      <div className="slots-row">
        {slots.map((slot, idx) => {
          const label = getSlotLabel(areaId, idx, { [areaId]: slotLabels });
          const isDisabled = !!slot.disabled;
          const isLocked = !!slot.locked;
          const assignedName = slot.personId ? roster.find((p) => p.id === slot.personId)?.name : null;
          return (
            <div key={slot.id} className="slot-block" style={{ opacity: isDisabled ? 0.65 : 1 }}>
              <div className="slot-block-header">
                <label className="slot-block-check" aria-label={isDisabled ? 'Enable slot' : 'Disable slot'}>
                  <input
                    type="checkbox"
                    checked={isDisabled}
                    onChange={() => toggleSlotDisabled(slot.id)}
                    title={isDisabled ? 'Enable slot' : 'Disable slot'}
                  />
                  {isDisabled ? 'Off' : 'On'}
                </label>
                {!isDisabled && (
                  <label className="slot-block-check" aria-label={isLocked ? 'Unlock slot' : 'Lock slot'}>
                    <input
                      type="checkbox"
                      checked={isLocked}
                      onChange={() => toggleSlotLocked(slot.id)}
                      title={isLocked ? 'Unlock (Spread/Randomize can change)' : 'Lock (Spread/Randomize will leave this slot unchanged)'}
                    />
                    Lock
                  </label>
                )}
                <input
                  type="text"
                  value={slotLabels[idx] ?? ''}
                  onChange={(e) => onSlotLabelChange(areaId, idx, e.target.value)}
                  placeholder={label}
                  className="slot-block-name"
                  aria-label={`Slot ${idx + 1} name`}
                />
              </div>
              {isDisabled ? (
                <span className="slot-block-status slot-block-status--muted">— Disabled —</span>
              ) : isLocked ? (
                <span className="slot-block-status" title="Locked — unlock to change">{assignedName ?? '— Unassigned —'}</span>
              ) : (
                <>
                  <SlotDropdown
                    slot={slot}
                    areaId={areaId}
                    roster={roster}
                    assignedPersonIds={allAssignedPersonIds}
                    leadAssignedPersonIds={leadAssignedPersonIds}
                    supportedAreaIds={supportedAreaIds}
                    onAssign={handleAssign}
                    onTransfer={onTransfer}
                  />
                  {breakSchedules && rotationCount != null && slot.personId && (() => {
                    const areaBreaks = breakSchedules[areaId];
                    const rot = areaBreaks?.[slot.personId]?.breakRotation;
                    if (rot == null) return null;
                    return (
                      <div style={{ fontSize: '0.8rem', color: '#555', marginTop: 4 }} title="When this person is on break">
                        Break: Rot {rot}
                      </div>
                    );
                  })()}
                </>
              )}
            </div>
          );
        })}
        {!atMax && <button type="button" className="btn-ghost" onClick={addSlot}>+ Slot</button>}
        {slots.length > min && (
          <button type="button" className="btn-ghost" onClick={removeSlot}>− Slot</button>
        )}
      </div>
    </section>
  );
}

export const AreaStaffing = memo(AreaStaffingInner);

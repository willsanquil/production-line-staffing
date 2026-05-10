import { memo } from 'react';
import type { AreaId, RosterPerson, Slot } from '../types';
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
  sectionTasksA?: unknown[];
  sectionTasksB?: unknown[];
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
  onClearArea?: (areaId: AreaId) => void;
  /** Optional: when provided, render a "Delete area" button per sub-area (configure mode only). */
  onDeleteArea?: (areaId: AreaId) => void;
  /** Move the whole combined section one step earlier in the line. */
  onMoveLeft?: () => void;
  /** Move the whole combined section one step later in the line. */
  onMoveRight?: () => void;
  /** Label used for tooltips on the section move buttons (e.g. "14.5 & Flip"). */
  moveLabel?: string;
  onSlotsChange: (areaId: AreaId, slots: Slot[]) => void;
  onSectionTasksChange?: (areaId: AreaId, tasks: unknown[]) => void;
  onAssign: (areaId: AreaId, slotId: string, personId: string | null) => void;
  requiresTrainedOrExpertA?: boolean;
  requiresTrainedOrExpertB?: boolean;
  onRequiresTrainedOrExpertChangeA?: (value: boolean) => void;
  onRequiresTrainedOrExpertChangeB?: (value: boolean) => void;
  showBreakCoverageToggle?: boolean;
  /** Per-area per-slot break coverage: areaId -> slotId -> boolean. */
  slotBreakCoverageEnabled?: Record<string, Record<string, boolean>>;
  onToggleSlotBreakCoverage?: (areaId: AreaId, slotId: string, enabled: boolean) => void;
  compactView?: boolean;
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
  roster,
  allAssignedPersonIds,
  leadAssignedPersonIds,
  onCapacityChange,
  onSlotLabelChange,
  onClearArea,
  onDeleteArea,
  onMoveLeft,
  onMoveRight,
  moveLabel,
  onSlotsChange,
  onAssign,
  requiresTrainedOrExpertA = false,
  requiresTrainedOrExpertB = false,
  onRequiresTrainedOrExpertChangeA,
  onRequiresTrainedOrExpertChangeB,
  showBreakCoverageToggle = false,
  slotBreakCoverageEnabled = {},
  onToggleSlotBreakCoverage,
  compactView = false,
}: CombinedAreaStaffingProps) {
  function renderSubArea(
    areaId: AreaId,
    areaLabel: string,
    slots: Slot[],
    min: number,
    max: number,
    slotLabels: string[],
    requiresTrainedOrExpert: boolean,
    onRequiresTrainedOrExpertChange?: (value: boolean) => void,
    slotBreakCoverageForArea: Record<string, boolean> = {},
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

    if (compactView) {
      return (
        <div key={areaId} style={{ marginBottom: 12 }}>
          <div style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 8 }}>{areaLabel}</div>
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
                      onAssign={(slotId, personId) => onAssign(areaId, slotId, personId)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    return (
      <div key={areaId} style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid #eee' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
          <div style={{ fontSize: '1rem', fontWeight: 600 }}>{areaLabel}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
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
          {onDeleteArea && (
            <button
              type="button"
              className="btn-danger"
              onClick={() => {
                const ok = window.confirm(
                  `Delete "${areaLabel}"?\n\nSlot assignments, tasks, capacity overrides, and break-coverage settings for this area will be removed.`
                );
                if (ok) onDeleteArea(areaId);
              }}
              title={`Delete the ${areaLabel} category from this line`}
            >
              Delete area
            </button>
          )}
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
        <div className="slots-row">
          {slots.map((slot, idx) => {
            const label = getSlotLabel(areaId, idx, { [areaId]: slotLabels });
            const isDisabled = !!slot.disabled;
            const isLocked = !!slot.locked;
            const assignedName = slot.personId ? roster.find((p) => p.id === slot.personId)?.name : null;
            return (
              <div
                key={slot.id}
                className="slot-block"
                style={{ opacity: isDisabled ? 0.65 : 1 }}
              >
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
                  {showBreakCoverageToggle && onToggleSlotBreakCoverage && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', cursor: 'pointer', marginLeft: 'auto' }}>
                      <input
                        type="checkbox"
                        checked={!!slotBreakCoverageForArea[slot.id]}
                        onChange={(e) => onToggleSlotBreakCoverage(areaId, slot.id, e.target.checked)}
                        aria-label="Slot needs break coverage"
                      />
                      Break cov.
                    </label>
                  )}
                </div>
                {isDisabled ? (
                  <span className="slot-block-status slot-block-status--muted">— Disabled —</span>
                ) : isLocked ? (
                  <span className="slot-block-status" title="Locked — unlock to change">{assignedName ?? '— Unassigned —'}</span>
                ) : (
                  <SlotDropdown
                    slot={slot}
                    areaId={areaId}
                    roster={roster}
                    assignedPersonIds={allAssignedPersonIds}
                    leadAssignedPersonIds={leadAssignedPersonIds}
                    onAssign={(slotId, personId) => onAssign(areaId, slotId, personId)}
                  />
                )}
              </div>
            );
          })}
          {!atMax && (
            <button type="button" className="btn-ghost" onClick={() => onSlotsChange(areaId, [...slots, createEmptySlot()])}>
              + Slot
            </button>
          )}
          {slots.length > min && (
            <button type="button" className="btn-ghost" onClick={() => onSlotsChange(areaId, slots.slice(0, -1))}>
              − Slot
            </button>
          )}
        </div>
      </div>
    );
  }

  const sectionLabel = moveLabel ?? combinedLabel;
  return (
    <section className={`section-card area-card${compactView ? ' area-card--compact' : ''}`}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
          {(onMoveLeft || onMoveRight) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => onMoveLeft?.()}
                disabled={!onMoveLeft}
                title={onMoveLeft ? `Move ${sectionLabel} left` : `${sectionLabel} is already first`}
                aria-label={`Move ${sectionLabel} left`}
                style={{ padding: '2px 8px', fontSize: '1rem', lineHeight: 1, opacity: onMoveLeft ? 1 : 0.4, cursor: onMoveLeft ? 'pointer' : 'not-allowed' }}
              >
                ◀
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => onMoveRight?.()}
                disabled={!onMoveRight}
                title={onMoveRight ? `Move ${sectionLabel} right` : `${sectionLabel} is already last`}
                aria-label={`Move ${sectionLabel} right`}
                style={{ padding: '2px 8px', fontSize: '1rem', lineHeight: 1, opacity: onMoveRight ? 1 : 0.4, cursor: onMoveRight ? 'pointer' : 'not-allowed' }}
              >
                ▶
              </button>
            </div>
          )}
          <span style={{ fontSize: compactView ? '1.1rem' : '1.25rem', fontWeight: 700 }}>{combinedLabel}</span>
        </div>
      </div>

      {renderSubArea(areaIdA, areaLabelA, slotsA, minA, maxA, slotLabelsA, requiresTrainedOrExpertA, onRequiresTrainedOrExpertChangeA, slotBreakCoverageEnabled[areaIdA] ?? {})}
      {renderSubArea(areaIdB, areaLabelB, slotsB, minB, maxB, slotLabelsB, requiresTrainedOrExpertB, onRequiresTrainedOrExpertChangeB, slotBreakCoverageEnabled[areaIdB] ?? {})}
    </section>
  );
}

export const CombinedAreaStaffing = memo(CombinedAreaStaffingInner);

import { useState, useCallback } from 'react';
import type { LineConfig, AreaConfigInLine, BreakScope } from '../types';
import { areaIdFromName } from '../lib/lineConfig';

interface BuildLineWizardProps {
  /** Existing area IDs across all lines (to avoid id collisions). */
  existingAreaIds: Set<string>;
  /** When provided (e.g. cloud create flow), use this id instead of generating one. */
  existingLineId?: string;
  /** Pre-fill the line name (e.g. from cloud create). */
  initialLineName?: string;
  onComplete: (config: LineConfig) => void;
  onCancel: () => void;
}

type Step = 'name' | 'sections' | 'leads' | 'breaks' | 'done';

interface SectionDraft {
  id: string;
  name: string;
  minSlots: number;
  maxSlots: number;
}

export function BuildLineWizard({ existingAreaIds, existingLineId, initialLineName, onComplete, onCancel }: BuildLineWizardProps) {
  const [step, setStep] = useState<Step>('name');
  const [lineName, setLineName] = useState(initialLineName ?? '');
  const [sections, setSections] = useState<SectionDraft[]>([]);
  const [leadCount, setLeadCount] = useState(0);
  const [leadNames, setLeadNames] = useState<string[]>([]);
  const [breaksEnabled, setBreaksEnabled] = useState(true);
  const [breaksScope, setBreaksScope] = useState<BreakScope>('station');
  const [breakRotations, setBreakRotations] = useState(3);

  const addSection = useCallback(() => {
    const existingIds = new Set([...existingAreaIds, ...sections.map((s) => s.id)]);
    const name = `Section ${sections.length + 1}`;
    const id = areaIdFromName(name, existingIds);
    setSections((prev) => [...prev, { id, name, minSlots: 2, maxSlots: 5 }]);
  }, [sections.length, existingAreaIds]);

  const updateSection = useCallback((index: number, updates: Partial<SectionDraft>) => {
    setSections((prev) => prev.map((s, i) => (i === index ? { ...s, ...updates } : s)));
  }, []);

  const removeSection = useCallback((index: number) => {
    setSections((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const setLeadName = useCallback((index: number, value: string) => {
    setLeadNames((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }, []);

  const handleCreate = useCallback(() => {
    const lineId = existingLineId ?? 'line_' + Math.random().toString(36).slice(2, 10);
    const areas: AreaConfigInLine[] = sections.map((s) => ({
      id: s.id,
      name: s.name,
      minSlots: Math.max(1, s.minSlots),
      maxSlots: Math.max(1, s.maxSlots),
      requiresTrainedOrExpert: false,
    }));
    const leadSlotNames = Array.from({ length: leadCount }, (_, i) => {
      const name = leadNames[i]?.trim();
      return name || `Lead ${i + 1}`;
    });
    const config: LineConfig = {
      id: lineId,
      name: lineName.trim() || 'New Line',
      areas,
      leadAreaIds: [],
      leadSlotNames: leadCount > 0 ? leadSlotNames : undefined,
      combinedSections: [],
      breaksEnabled,
      breaksScope,
      breakRotations: Math.min(6, Math.max(1, breakRotations)),
    };
    onComplete(config);
  }, [existingLineId, lineName, sections, leadCount, leadNames, breaksEnabled, breaksScope, breakRotations, onComplete]);

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '24px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <button type="button" onClick={onCancel} style={{ padding: '8px 12px' }}>
          ← Cancel
        </button>
        <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700 }}>Build your own line</h1>
      </div>

      {step === 'name' && (
        <>
          <p style={{ marginBottom: 12, color: '#555' }}>Give your line a name (e.g. IC, NIC, Assembly).</p>
          <input
            type="text"
            value={lineName}
            onChange={(e) => setLineName(e.target.value)}
            placeholder="Line name"
            style={{ width: '100%', padding: '10px 12px', fontSize: '1rem', marginBottom: 20 }}
            autoFocus
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={onCancel} style={{ padding: '10px 20px' }}>
              Cancel
            </button>
            <button
              type="button"
              onClick={() => setStep('sections')}
              style={{ padding: '10px 20px', fontWeight: 600 }}
            >
              Next: Add sections
            </button>
          </div>
        </>
      )}

      {step === 'sections' && (
        <>
          <p style={{ marginBottom: 12, color: '#555' }}>
            Add the major sections (areas) of your line. For each section set min and max slots.
          </p>
          {sections.length === 0 && (
            <button type="button" onClick={addSection} style={{ marginBottom: 16, padding: '10px 16px' }}>
              + Add first section
            </button>
          )}
          {sections.map((s, i) => (
            <div
              key={s.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 72px 72px auto',
                gap: 8,
                alignItems: 'center',
                marginBottom: 10,
              }}
            >
              <input
                type="text"
                value={s.name}
                onChange={(e) => updateSection(i, { name: e.target.value })}
                placeholder="Section name"
                style={{ padding: '8px 10px' }}
              />
              <input
                type="number"
                min={1}
                value={s.minSlots}
                onChange={(e) => updateSection(i, { minSlots: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                placeholder="Min"
                style={{ padding: '8px' }}
              />
              <input
                type="number"
                min={1}
                value={s.maxSlots}
                onChange={(e) => updateSection(i, { maxSlots: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                placeholder="Max"
                style={{ padding: '8px' }}
              />
              <button type="button" onClick={() => removeSection(i)} style={{ padding: '8px' }}>
                Remove
              </button>
            </div>
          ))}
          {sections.length > 0 && (
            <button type="button" onClick={addSection} style={{ marginBottom: 16, padding: '8px 12px' }}>
              + Add section
            </button>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
            <button type="button" onClick={() => setStep('name')} style={{ padding: '10px 20px' }}>
              Back
            </button>
            <button
              type="button"
              onClick={() => setStep('leads')}
              disabled={sections.length === 0}
              style={{ padding: '10px 20px', fontWeight: 600 }}
            >
              Next: Lead roles
            </button>
          </div>
        </>
      )}

      {step === 'leads' && (
        <>
          <p style={{ marginBottom: 12, color: '#555' }}>
            How many lead positions do you want? Give each a name (e.g. Floor Lead, Quality).
          </p>
          <label style={{ display: 'block', marginBottom: 12, fontSize: '0.95rem' }}>
            Number of leads
            <input
              type="number"
              min={0}
              max={10}
              value={leadCount}
              onChange={(e) => {
                const n = Math.max(0, Math.min(10, e.target.valueAsNumber || 0));
                setLeadCount(n);
                setLeadNames((prev) => {
                  if (prev.length >= n) return prev.slice(0, n);
                  return [...prev, ...Array(n - prev.length).fill('')];
                });
              }}
              style={{ marginLeft: 8, width: 56, padding: '4px 8px' }}
            />
          </label>
          {leadCount > 0 && (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, marginBottom: 20 }}>
              {Array.from({ length: leadCount }, (_, i) => (
                <li key={i} style={{ marginBottom: 10 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.95rem' }}>
                    <span style={{ minWidth: 100 }}>Position {i + 1}</span>
                    <input
                      type="text"
                      value={leadNames[i] ?? ''}
                      onChange={(e) => setLeadName(i, e.target.value)}
                      placeholder={`Lead ${i + 1}`}
                      style={{ flex: 1, maxWidth: 240, padding: '6px 10px', border: '1px solid #ccc', borderRadius: 4 }}
                    />
                  </label>
                </li>
              ))}
            </ul>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => setStep('sections')} style={{ padding: '10px 20px' }}>
              Back
            </button>
            <button
              type="button"
              onClick={() => setStep('breaks')}
              style={{ padding: '10px 20px', fontWeight: 600 }}
            >
              Next: Breaks
            </button>
          </div>
        </>
      )}

      {step === 'breaks' && (
        <>
          <p style={{ marginBottom: 12, color: '#555' }}>
            Do you want break/lunch scheduling for this line?
          </p>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={breaksEnabled}
              onChange={(e) => setBreaksEnabled(e.target.checked)}
            />
            <span>Enable break & lunch rotations</span>
          </label>
          {breaksEnabled && (
            <>
              <p style={{ marginBottom: 8, color: '#555' }}>Line-wide (one set of rotations) or per station?</p>
              <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="breaksScope"
                    checked={breaksScope === 'line'}
                    onChange={() => setBreaksScope('line')}
                  />
                  <span>Line-wide</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="breaksScope"
                    checked={breaksScope === 'station'}
                    onChange={() => setBreaksScope('station')}
                  />
                  <span>Station-specific</span>
                </label>
              </div>
              <p style={{ marginBottom: 8, color: '#555' }}>Number of rotations (default 3):</p>
              <input
                type="number"
                min={1}
                max={6}
                value={breakRotations}
                onChange={(e) => setBreakRotations(Math.min(6, Math.max(1, parseInt(e.target.value, 10) || 3)))}
                style={{ width: 72, padding: '8px 10px', marginBottom: 20 }}
              />
            </>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => setStep('leads')} style={{ padding: '10px 20px' }}>
              Back
            </button>
            <button
              type="button"
              onClick={handleCreate}
              style={{ padding: '10px 20px', fontWeight: 600, background: '#27ae60', color: '#fff', border: 'none' }}
            >
              Create line
            </button>
          </div>
        </>
      )}
    </div>
  );
}

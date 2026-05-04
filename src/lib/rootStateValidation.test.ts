import { describe, expect, it } from 'vitest';
import { normalizeRootStateForCloudLine, validateRootStatePayload } from '../../supabase/functions/_shared/rootStateValidation';

describe('rootStateValidation', () => {
  it('rejects invalid cloud root payloads', () => {
    expect(validateRootStatePayload(null).ok).toBe(false);
    expect(validateRootStatePayload({ currentLineId: 'x', lines: [], lineStates: {} }).ok).toBe(false);
  });

  it('accepts a minimal valid cloud root payload', () => {
    const result = validateRootStatePayload({
      currentLineId: 'local-line',
      lines: [{ id: 'local-line', name: 'Local Line', areas: [], combinedSections: [] }],
      lineStates: { 'local-line': { roster: [], slots: {}, leadSlots: {}, sectionTasks: {}, schedule: [] } },
    });

    expect(result.ok).toBe(true);
  });

  it('normalizes a shared local line to the cloud line id', () => {
    const root = normalizeRootStateForCloudLine(
      {
        currentLineId: 'local-line',
        lines: [{ id: 'local-line', name: 'Local Line', areas: [], combinedSections: [] }],
        lineStates: { 'local-line': { roster: [], slots: {}, leadSlots: {}, sectionTasks: {}, schedule: [] } },
      },
      'cloud-line',
      'Cloud Line'
    );

    expect(root.currentLineId).toBe('cloud-line');
    expect(root.lines[0].id).toBe('cloud-line');
    expect(root.lines[0].name).toBe('Cloud Line');
    expect(root.lineStates['cloud-line']).toBeDefined();
    expect(root.lineStates['local-line']).toBeUndefined();
  });
});

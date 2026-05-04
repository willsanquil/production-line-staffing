import { describe, expect, it } from 'vitest';
import type { AppState, RootState } from '../types';
import { buildPersistedRootState, extractLineDraftState } from './lineDraftState';

describe('lineDraftState', () => {
  it('extracts defaulted draft fields from a partial line state', () => {
    const draft = extractLineDraftState({
      slots: { area_a: [{ id: 'slot-1', personId: 'person-1' }] },
      leadSlots: { lead: 'person-2' },
      sectionTasks: {},
      schedule: [],
      roster: [],
    } as AppState);

    expect(draft.slots.area_a[0].personId).toBe('person-1');
    expect(draft.leadSlots.lead).toBe('person-2');
    expect(draft.dayNotes).toBe('');
    expect(draft.documents).toEqual([]);
    expect(draft.areaCapacityOverrides).toEqual({});
    expect(draft.slotBreakCoverageEnabled).toEqual({});
  });

  it('merges a draft into only the current line state', () => {
    const root: RootState = {
      currentLineId: 'line-a',
      lines: [
        { id: 'line-a', name: 'A', areas: [], combinedSections: [] },
        { id: 'line-b', name: 'B', areas: [], combinedSections: [] },
      ],
      lineStates: {
        'line-a': { roster: [], slots: {}, leadSlots: {}, juicedAreas: {}, deJuicedAreas: {}, sectionTasks: {}, schedule: [], dayNotes: 'old', documents: [] },
        'line-b': { roster: [], slots: {}, leadSlots: {}, juicedAreas: {}, deJuicedAreas: {}, sectionTasks: {}, schedule: [], dayNotes: 'other', documents: [] },
      },
    };

    const next = buildPersistedRootState(root, {
      ...extractLineDraftState(root.lineStates['line-a']),
      dayNotes: 'new',
    });

    expect(next.lineStates['line-a'].dayNotes).toBe('new');
    expect(next.lineStates['line-b'].dayNotes).toBe('other');
    expect(root.lineStates['line-a'].dayNotes).toBe('old');
  });
});

import { describe, expect, it } from 'vitest';
import type { RootState } from '../types';
import { exportRootStateToJson, importBackupFromJson, exportStateToJson } from './persist';

const minimalRoot = (): RootState => ({
  currentLineId: 'line-a',
  lines: [
    {
      id: 'line-a',
      name: 'Line A',
      areas: [{ id: 'area_1', name: 'Station 1', minCapacity: 1, maxCapacity: 2 }],
      combinedSections: [],
    },
  ],
  lineStates: {
    'line-a': {
      roster: [
        {
          id: 'p1',
          name: 'Ada',
          absent: false,
          lead: false,
          ot: false,
          late: false,
          leavingEarly: false,
          skills: {},
        },
      ],
      slots: { area_1: [{ id: 's1', personId: 'p1' }] },
      leadSlots: {},
      sectionTasks: {},
      schedule: [],
      dayNotes: '',
      documents: [],
    },
  },
});

describe('persist backup', () => {
  it('round-trips RootState envelope', () => {
    const root = minimalRoot();
    const json = exportRootStateToJson(root);
    const imported = importBackupFromJson(json);
    expect(imported?.kind).toBe('root');
    if (imported?.kind === 'root') {
      expect(imported.root.currentLineId).toBe('line-a');
      expect(imported.root.lines).toHaveLength(1);
      expect(imported.root.lineStates['line-a'].roster[0].name).toBe('Ada');
    }
  });

  it('accepts bare RootState JSON', () => {
    const imported = importBackupFromJson(JSON.stringify(minimalRoot()));
    expect(imported?.kind).toBe('root');
  });

  it('accepts legacy single-line AppState', () => {
    const json = exportStateToJson(minimalRoot().lineStates['line-a']);
    const imported = importBackupFromJson(json);
    expect(imported?.kind).toBe('line');
    if (imported?.kind === 'line') {
      expect(imported.state.roster[0].name).toBe('Ada');
    }
  });
});

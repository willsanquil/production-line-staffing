import { memo } from 'react';
import type { BreakRotation, LunchRotation } from '../types';

const ROTATION_LABELS = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth'] as const;

interface Person {
  id: string;
  name: string;
}

interface BreakTableProps {
  /** People on the line (assigned to slots or leads). */
  people: Person[];
  /** Per-person break/lunch rotation assignments (from breakSchedules area or __line__). */
  assignments: Record<string, { breakRotation: BreakRotation; lunchRotation: LunchRotation }>;
  /** Number of rotations (1–6). */
  rotationCount: number;
  /** Optional title (default "BREAKS" for single table). */
  title?: string;
}

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '0.95rem',
};
const thStyle: React.CSSProperties = {
  border: '1px solid #ccc',
  padding: '10px 12px',
  textAlign: 'center',
  background: '#f8f8f8',
  fontWeight: 600,
};
const tdStyle: React.CSSProperties = {
  border: '1px solid #ccc',
  padding: '10px 12px',
};
const tdCenter: React.CSSProperties = { ...tdStyle, textAlign: 'center' as const };
const xStyle: React.CSSProperties = { fontWeight: 700, fontSize: '1.1rem' };

function BreakTableInner({ people, assignments, rotationCount, title }: BreakTableProps) {
  const n = Math.min(6, Math.max(1, rotationCount));
  const rotations = Array.from({ length: n }, (_, i) => i + 1);

  if (people.length === 0 || Object.keys(assignments).length === 0) return null;

  const displayTitle = title ?? 'BREAKS';

  return (
    <div className="section-card" style={{ marginTop: 16 }}>
      <h2 style={{ marginTop: 0, marginBottom: 12, textAlign: 'center', fontWeight: 700, fontSize: '1.25rem' }}>
        {displayTitle}
      </h2>
      <div style={{ overflowX: 'auto' }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={{ ...thStyle, textAlign: 'left', minWidth: 140 }}>Name</th>
              {rotations.map((r) => (
                <th key={`b${r}`} style={thStyle}>
                  {ROTATION_LABELS[r - 1] ?? `Break ${r}`}
                </th>
              ))}
              {rotations.map((r) => (
                <th key={`l${r}`} style={thStyle}>
                  {ROTATION_LABELS[r - 1] ?? `Lunch ${r}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {people.map((p) => {
              const a = assignments[p.id];
              if (!a) return null;
              return (
                <tr key={p.id}>
                  <td style={tdStyle}>{p.name}</td>
                  {rotations.map((r) => (
                    <td key={`b${r}`} style={tdCenter}>
                      {a.breakRotation === r ? <span style={xStyle}>X</span> : ''}
                    </td>
                  ))}
                  {rotations.map((r) => (
                    <td key={`l${r}`} style={tdCenter}>
                      {a.lunchRotation === r ? <span style={xStyle}>X</span> : ''}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export const BreakTable = memo(BreakTableInner);

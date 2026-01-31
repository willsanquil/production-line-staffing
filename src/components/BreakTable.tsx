import { memo } from 'react';
import type { BreakRotation, LunchRotation } from '../types';

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
  /** Optional title. */
  title?: string;
}

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '0.9rem',
};
const thStyle: React.CSSProperties = {
  border: '1px solid #ddd',
  padding: '8px 10px',
  textAlign: 'center',
  background: '#f5f5f5',
  fontWeight: 600,
};
const tdStyle: React.CSSProperties = {
  border: '1px solid #ddd',
  padding: '8px 10px',
};
const tdCenter: React.CSSProperties = { ...tdStyle, textAlign: 'center' };
const xStyle: React.CSSProperties = { color: '#27ae60', fontWeight: 700 };

function BreakTableInner({ people, assignments, rotationCount, title }: BreakTableProps) {
  const n = Math.min(6, Math.max(1, rotationCount));
  const rotations = Array.from({ length: n }, (_, i) => i + 1);

  if (people.length === 0 || Object.keys(assignments).length === 0) return null;

  return (
    <div className="section-card" style={{ marginTop: 16 }}>
      {title && <h2 style={{ marginTop: 0, marginBottom: 12 }}>{title}</h2>}
      <p style={{ fontSize: '0.85rem', color: '#666', marginBottom: 12 }}>
        Rows = people. Columns = break/lunch slots. X = person is on that slot.
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={{ ...thStyle, textAlign: 'left', minWidth: 120 }}>Name</th>
              {rotations.map((r) => (
                <th key={`b${r}`} style={thStyle}>
                  Break {r}
                </th>
              ))}
              {rotations.map((r) => (
                <th key={`l${r}`} style={thStyle}>
                  Lunch {r}
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
                      {a.breakRotation === r ? <span style={xStyle}>X</span> : '—'}
                    </td>
                  ))}
                  {rotations.map((r) => (
                    <td key={`l${r}`} style={tdCenter}>
                      {a.lunchRotation === r ? <span style={xStyle}>X</span> : '—'}
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

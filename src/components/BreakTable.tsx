import { memo } from 'react';
import type { BreakRotation, LunchRotation } from '../types';

const SLOT_LABELS = ['First Slot', 'Second Slot', 'Third Slot', 'Fourth Slot', 'Fifth Slot', 'Sixth Slot'] as const;

interface Person {
  id: string;
  name: string;
}

interface BreakTableProps {
  /** People in this area (or line). */
  people: Person[];
  /** Per-person rotation assignment (we use breakRotation; rotation count is per area). */
  assignments: Record<string, { breakRotation: BreakRotation; lunchRotation: LunchRotation }>;
  /** Number of rotations (1–6), user-defined per area. */
  rotationCount: number;
  /** Optional title (e.g. "Rotations" or area name). */
  title?: string;
  /** When true, use larger text for presentation mode. */
  presentationMode?: boolean;
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
const xStylePresentation: React.CSSProperties = { fontWeight: 700, fontSize: '1.35rem' };

function BreakTableInner({ people, assignments, rotationCount, title, presentationMode = false }: BreakTableProps) {
  if (people.length === 0 || Object.keys(assignments).length === 0) return null;

  const n = Math.min(6, Math.max(1, rotationCount));
  const rotations = Array.from({ length: n }, (_, i) => i + 1);
  const fontSize = presentationMode ? '1.1rem' : undefined;
  const cellPad = presentationMode ? '12px 14px' : '10px 12px';

  return (
    <div className="section-card" style={{ marginTop: title ? 12 : 0 }}>
      {title && (
        <h3
          style={{
            margin: '0 0 8px 0',
            fontWeight: 700,
            fontSize: presentationMode ? '1.2rem' : '1.05rem',
          }}
        >
          {title}
        </h3>
      )}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ ...tableStyle, fontSize }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, textAlign: 'left', minWidth: 120, padding: cellPad }}>Name</th>
              {rotations.map((r) => (
                <th key={r} style={{ ...thStyle, padding: cellPad }}>
                  {SLOT_LABELS[r - 1] ?? `Slot ${r}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {people.map((p) => {
              const a = assignments[p.id];
              if (!a) return null;
              const rot = a.breakRotation;
              return (
                <tr key={p.id}>
                  <td style={{ ...tdStyle, padding: cellPad }}>{p.name}</td>
                  {rotations.map((r) => (
                    <td key={r} style={{ ...tdCenter, padding: cellPad }}>
                      {rot === r ? <span style={presentationMode ? xStylePresentation : xStyle}>X</span> : ''}
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

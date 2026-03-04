import { memo } from 'react';
import type { BreakRotation, LunchRotation } from '../types';

const SLOT_LABELS = ['First Break', 'Second Break', 'Third Break', 'Fourth Break', 'Fifth Break', 'Sixth Break'] as const;

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

const thCenterStyle: React.CSSProperties = { textAlign: 'center' };
const tdCenterStyle: React.CSSProperties = { textAlign: 'center' };
const xStyle: React.CSSProperties = { fontWeight: 700, fontSize: '1.1rem' };
const xStylePresentation: React.CSSProperties = { fontWeight: 700, fontSize: '1.35rem' };

function BreakTableInner({ people, assignments, rotationCount, title, presentationMode = false }: BreakTableProps) {
  if (people.length === 0 || Object.keys(assignments).length === 0) return null;

  const n = Math.min(6, Math.max(1, rotationCount));
  const rotations = Array.from({ length: n }, (_, i) => i + 1);
  const fontSize = presentationMode ? '1.1rem' : undefined;

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
        <table className="data-table" style={fontSize ? { fontSize } : undefined}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', minWidth: 120 }}>Name</th>
              {rotations.map((r) => (
                <th key={r} style={thCenterStyle}>
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
                  <td>{p.name}</td>
                  {rotations.map((r) => (
                    <td key={r} style={tdCenterStyle}>
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

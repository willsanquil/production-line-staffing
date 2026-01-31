import { memo } from 'react';
import type { BreakRotation, LunchRotation } from '../types';

const SLOT_LABELS = ['First Slot', 'Second Slot', 'Third Slot', 'Fourth Slot', 'Fifth Slot', 'Sixth Slot'] as const;

interface Person {
  id: string;
  name: string;
}

interface BreakTableProps {
  /** People on the line (assigned to slots or leads). */
  people: Person[];
  /** Per-person break/lunch rotation assignments (from breakSchedules area or __line__). */
  assignments: Record<string, { breakRotation: BreakRotation; lunchRotation: LunchRotation }>;
  /** Number of rotations (1–6), user-defined. */
  rotationCount: number;
  /** Optional title for the section (e.g. "Break schedule (line-wide)"). */
  title?: string;
  /** When true, use larger text and clearer styling for presentation mode. */
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

function SingleBreakMatrix({
  people,
  assignments,
  rotationCount,
  label,
  getRotation,
  presentationMode,
}: {
  people: Person[];
  assignments: Record<string, { breakRotation: BreakRotation; lunchRotation: LunchRotation }>;
  rotationCount: number;
  label: string;
  getRotation: (a: { breakRotation: BreakRotation; lunchRotation: LunchRotation }) => number;
  presentationMode?: boolean;
}) {
  const n = Math.min(6, Math.max(1, rotationCount));
  const rotations = Array.from({ length: n }, (_, i) => i + 1);
  const fontSize = presentationMode ? '1.1rem' : undefined;
  const cellPad = presentationMode ? '12px 14px' : '10px 12px';

  return (
    <div style={{ marginBottom: presentationMode ? 20 : 16 }}>
      <h3
        style={{
          margin: '0 0 10px 0',
          textAlign: 'center',
          fontWeight: 700,
          fontSize: presentationMode ? '1.35rem' : '1.2rem',
        }}
      >
        {label}
      </h3>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ ...tableStyle, fontSize }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, textAlign: 'left', minWidth: 140, padding: cellPad }}>Name</th>
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
              const rot = getRotation(a);
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

function BreakTableInner({ people, assignments, rotationCount, title, presentationMode = false }: BreakTableProps) {
  if (people.length === 0 || Object.keys(assignments).length === 0) return null;

  const sectionTitle = title ?? 'Break schedule';

  return (
    <div className="section-card" style={{ marginTop: 16 }}>
      {sectionTitle && (
        <h2
          style={{
            marginTop: 0,
            marginBottom: 14,
            textAlign: 'center',
            fontWeight: 700,
            fontSize: presentationMode ? '1.4rem' : '1.25rem',
          }}
        >
          {sectionTitle}
        </h2>
      )}
      <SingleBreakMatrix
        people={people}
        assignments={assignments}
        rotationCount={rotationCount}
        label="BREAKS"
        getRotation={(a) => a.breakRotation}
        presentationMode={presentationMode}
      />
      <SingleBreakMatrix
        people={people}
        assignments={assignments}
        rotationCount={rotationCount}
        label="LUNCH"
        getRotation={(a) => a.lunchRotation}
        presentationMode={presentationMode}
      />
    </div>
  );
}

export const BreakTable = memo(BreakTableInner);

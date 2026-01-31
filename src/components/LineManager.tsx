import type { RootState } from '../types';

interface LineManagerProps {
  rootState: RootState;
  canShare?: boolean;
  onShareClick?: () => void;
  onOpenLine: (lineId: string) => void;
  onBuildNew: () => void;
  onDeleteLine: (lineId: string) => void;
  onBack: () => void;
}

export function LineManager({ rootState, canShare, onShareClick, onOpenLine, onBuildNew, onDeleteLine, onBack }: LineManagerProps) {
  const { lines, currentLineId } = rootState;
  const canDelete = lines.length > 1;

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '24px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <button type="button" onClick={onBack} style={{ padding: '8px 12px' }}>
          ← Back
        </button>
        <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700 }}>My lines</h1>
      </div>
      <p style={{ color: '#555', marginBottom: 20, fontSize: '0.95rem' }}>
        Each line has its own roster. Use the Flexed dropdown to temporarily assign a person to another line; they then appear on that line's roster and can be slotted there (skills retained). Open a line to work on it, or build a new one. When in local mode, you can share a line to the cloud so others can join it from the Group list.
      </p>
      {canShare && onShareClick && (
        <div style={{ marginBottom: 16 }}>
          <button
            type="button"
            onClick={onShareClick}
            style={{
              padding: '10px 18px',
              fontSize: '1rem',
              fontWeight: 600,
              background: '#1a73e8',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
            }}
          >
            Share this line to cloud
          </button>
          <p style={{ fontSize: '0.85rem', color: '#666', marginTop: 6 }}>
            Publish the current line with a name and password so others can select it from Group and join.
          </p>
        </div>
      )}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {lines.map((line) => (
          <li
            key={line.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 16px',
              marginBottom: 8,
              background: line.id === currentLineId ? '#e8f4fd' : '#fff',
              border: `1px solid ${line.id === currentLineId ? '#2196f3' : '#e0e0e0'}`,
              borderRadius: 8,
            }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>{line.name}</div>
              <div style={{ fontSize: '0.85rem', color: '#666', marginTop: 2 }}>
                {line.areas.length} section{line.areas.length !== 1 ? 's' : ''}
                {line.leadAreaIds.length > 0 && ` · ${line.leadAreaIds.length} lead role${line.leadAreaIds.length !== 1 ? 's' : ''}`}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                type="button"
                onClick={() => onOpenLine(line.id)}
                style={{ padding: '8px 16px', fontWeight: 600 }}
              >
                {line.id === currentLineId ? 'Current' : 'Open'}
              </button>
              <button
                type="button"
                onClick={() => canDelete && onDeleteLine(line.id)}
                disabled={!canDelete}
                title={canDelete ? `Delete ${line.name}` : 'You need at least one line'}
                style={{
                  padding: '8px 12px',
                  color: canDelete ? '#c0392b' : '#999',
                  background: 'transparent',
                  border: `1px solid ${canDelete ? '#c0392b' : '#ddd'}`,
                  borderRadius: 6,
                  cursor: canDelete ? 'pointer' : 'not-allowed',
                  fontSize: '0.9rem',
                }}
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onBuildNew}
        style={{
          marginTop: 16,
          padding: '14px 20px',
          width: '100%',
          fontSize: '1rem',
          fontWeight: 600,
          background: '#27ae60',
          color: '#fff',
          border: 'none',
          borderRadius: 8,
          cursor: 'pointer',
        }}
      >
        + Build your own line
      </button>
    </div>
  );
}

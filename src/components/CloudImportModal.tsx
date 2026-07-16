interface CloudImportModalProps {
  open: boolean;
  loading: boolean;
  error: string | null;
  lines: { id: string; name: string }[];
  lineId: string;
  password: string;
  onLineIdChange: (id: string) => void;
  onPasswordChange: (password: string) => void;
  onImport: () => void;
  onClose: () => void;
}

export function CloudImportModal({
  open,
  loading,
  error,
  lines,
  lineId,
  password,
  onLineIdChange,
  onPasswordChange,
  onImport,
  onClose,
}: CloudImportModalProps) {
  if (!open) return null;

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-cloud-title"
      onClick={() => !loading && onClose()}
    >
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <h2 id="import-cloud-title" style={{ marginTop: 0, marginBottom: 16 }}>
          Import from another cloud line
        </h2>
        <p style={{ color: '#666', fontSize: '0.9rem', marginBottom: 16 }}>
          Import people from another cloud line. People with matching names will have their skills merged.
        </p>
        {error && (
          <div style={{ background: '#fee', padding: 10, borderRadius: 8, marginBottom: 12 }}>{error}</div>
        )}
        <label style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>Cloud line</label>
        <select
          value={lineId}
          onChange={(e) => onLineIdChange(e.target.value)}
          style={{ width: '100%', padding: '10px 12px', marginBottom: 12, boxSizing: 'border-box' }}
        >
          <option value="">— Select a line —</option>
          {lines.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <label style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => onPasswordChange(e.target.value)}
          placeholder="Enter that line's password"
          style={{ width: '100%', padding: '10px 12px', marginBottom: 16, boxSizing: 'border-box' }}
        />
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn-primary" onClick={onImport} disabled={loading || !lineId}>
            {loading ? 'Importing…' : 'Import'}
          </button>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={loading}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

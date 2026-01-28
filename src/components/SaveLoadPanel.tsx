import { useState } from 'react';
import type { SavedConfig } from '../types';

interface SaveLoadPanelProps {
  savedConfigs: SavedConfig[];
  onSaveConfig: (name: string, note?: string) => void;
  onLoadConfig: (config: SavedConfig) => void;
  onExportConfig: () => void;
  onImportConfig: (json: string) => void;
}

export function SaveLoadPanel({
  savedConfigs,
  onSaveConfig,
  onLoadConfig,
  onExportConfig,
  onImportConfig,
}: SaveLoadPanelProps) {
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [importText, setImportText] = useState('');

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    onSaveConfig(n, note.trim() || undefined);
    setName('');
    setNote('');
  }

  function handleImport() {
    try {
      onImportConfig(importText);
      setImportText('');
    } catch (err) {
      alert('Invalid JSON. Could not import.');
    }
  }

  return (
    <div className="save-load-section">
      <h3 style={{ marginTop: 0 }}>Configurations</h3>
      <form onSubmit={handleSave} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Config name"
          style={{ width: 140 }}
        />
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (optional)"
          style={{ width: 160 }}
        />
        <button type="submit">Save current</button>
      </form>
      <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 12px 0' }}>
        {savedConfigs.map((c) => (
          <li key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <button type="button" onClick={() => onLoadConfig(c)}>Load</button>
            <span><strong>{c.name}</strong></span>
            {c.note && <span style={{ color: '#666', fontSize: '0.9rem' }}>{c.note}</span>}
            <span style={{ color: '#999', fontSize: '0.8rem' }}>{new Date(c.savedAt).toLocaleString()}</span>
          </li>
        ))}
      </ul>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={onExportConfig}>Export config JSON</button>
        <div style={{ display: 'flex', gap: 4 }}>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder="Paste JSON..."
            style={{ minWidth: 120, minHeight: 36 }}
          />
          <button type="button" onClick={handleImport}>Import</button>
        </div>
      </div>
    </div>
  );
}

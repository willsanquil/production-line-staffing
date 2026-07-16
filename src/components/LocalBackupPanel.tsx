import type { RefObject } from 'react';
import type { SavedDay } from '../types';
import { DayBank } from './DayBank';

interface LocalBackupPanelProps {
  canSaveToFile: boolean;
  saveMessage: string | null;
  onSaveToFile: () => void;
  onOpenFromFile: () => void;
  onExportBackup: () => void;
  onImportBackupClick: () => void;
  importFileRef: RefObject<HTMLInputElement | null>;
  onImportBackupChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  addToRosterFileRef: RefObject<HTMLInputElement | null>;
  onAddToRosterFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  savedDays: SavedDay[];
  onLoadDay: (day: SavedDay) => void;
  onSaveCurrentDay: (date: string, name?: string) => void;
  onRemoveDay: (id: string) => void;
}

/** Download/import backup + day bank — extracted from App to shrink the main shell. */
export function LocalBackupPanel({
  canSaveToFile,
  saveMessage,
  onSaveToFile,
  onOpenFromFile,
  onExportBackup,
  onImportBackupClick,
  importFileRef,
  onImportBackupChange,
  addToRosterFileRef,
  onAddToRosterFileChange,
  savedDays,
  onLoadDay,
  onSaveCurrentDay,
  onRemoveDay,
}: LocalBackupPanelProps) {
  return (
    <>
      <div className="save-load-section" style={{ marginBottom: 12 }}>
        <input
          ref={addToRosterFileRef as RefObject<HTMLInputElement>}
          type="file"
          accept=".json,application/json"
          onChange={onAddToRosterFileChange}
          style={{ display: 'none' }}
          aria-hidden
        />
        {canSaveToFile && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <button type="button" onClick={onSaveToFile}>
              Save to file
            </button>
            <button type="button" onClick={onOpenFromFile}>
              Open from file
            </button>
            {saveMessage && <span style={{ color: '#2e7d32', fontSize: '0.9rem' }}>{saveMessage}</span>}
          </div>
        )}
        <p style={{ fontSize: '0.85rem', color: '#666', margin: '0 0 8px 0' }}>
          Download or import a full multi-line backup (works in any browser). Older single-line backups still import.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <button type="button" onClick={onExportBackup}>
            Download backup
          </button>
          <input
            ref={importFileRef as RefObject<HTMLInputElement>}
            type="file"
            accept=".json,application/json"
            onChange={onImportBackupChange}
            style={{ display: 'none' }}
            aria-hidden
          />
          <button type="button" onClick={onImportBackupClick}>
            Import backup
          </button>
        </div>
      </div>

      <DayBank
        savedDays={savedDays}
        onLoadDay={onLoadDay}
        onSaveCurrentDay={onSaveCurrentDay}
        onRemoveDay={onRemoveDay}
      />
    </>
  );
}

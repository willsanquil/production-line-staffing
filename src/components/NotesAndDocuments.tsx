import { memo } from 'react';

interface NotesAndDocumentsProps {
  dayNotes: string;
  documents: string[];
  onDayNotesChange: (value: string) => void;
  onDocumentsChange: (documents: string[]) => void;
}

function NotesAndDocumentsInner({
  dayNotes,
  documents,
  onDayNotesChange,
  onDocumentsChange,
}: NotesAndDocumentsProps) {
  function addDocument() {
    onDocumentsChange([...documents, '']);
  }

  function updateDocument(index: number, value: string) {
    const next = [...documents];
    next[index] = value;
    onDocumentsChange(next);
  }

  function removeDocument(index: number) {
    onDocumentsChange(documents.filter((_, i) => i !== index));
  }

  return (
    <section className="section-card">
      <h2>Notes & documents</h2>
      <div style={{ marginBottom: '1rem' }}>
        <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Day notes</label>
        <textarea
          value={dayNotes}
          onChange={(e) => onDayNotesChange(e.target.value)}
          placeholder="Daily notes..."
        />
      </div>
      <div>
        <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Documents (links or text)</label>
        {documents.map((doc, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
            <input
              type="text"
              value={doc}
              onChange={(e) => updateDocument(i, e.target.value)}
              placeholder="Paste link or note..."
              style={{ flex: 1 }}
            />
            <button type="button" onClick={() => removeDocument(i)} aria-label="Remove">×</button>
          </div>
        ))}
        <button type="button" onClick={addDocument}>+ Add document</button>
      </div>
    </section>
  );
}

export const NotesAndDocuments = memo(NotesAndDocumentsInner);

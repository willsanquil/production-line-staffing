import { useState } from 'react';
import type { SavedDay } from '../types';

interface DayBankProps {
  savedDays: SavedDay[];
  onLoadDay: (day: SavedDay) => void;
  onSaveCurrentDay: (date: string, name?: string) => void;
  onRemoveDay?: (id: string) => void;
}

export function DayBank({
  savedDays,
  onLoadDay,
  onSaveCurrentDay,
  onRemoveDay,
}: DayBankProps) {
  const [date, setDate] = useState('');
  const [dayName, setDayName] = useState('');

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!date.trim()) return;
    onSaveCurrentDay(date.trim(), dayName.trim() || undefined);
    setDate('');
    setDayName('');
  }

  const sorted = [...savedDays].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  return (
    <div className="save-load-section">
      <h3 style={{ marginTop: 0 }}>Bank of days</h3>
      <form onSubmit={handleSave} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <input
          type="text"
          value={dayName}
          onChange={(e) => setDayName(e.target.value)}
          placeholder="Name (optional)"
          style={{ width: 140 }}
        />
        <button type="submit">Save today&apos;s state</button>
      </form>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {sorted.map((d) => (
          <li key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <button type="button" onClick={() => onLoadDay(d)}>Load</button>
            <span><strong>{d.date}</strong></span>
            {d.name && <span style={{ color: '#666' }}>{d.name}</span>}
            <span style={{ color: '#999', fontSize: '0.8rem' }}>{new Date(d.savedAt).toLocaleString()}</span>
            {onRemoveDay && (
              <button type="button" onClick={() => onRemoveDay(d.id)} aria-label="Remove">×</button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

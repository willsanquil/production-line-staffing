import { useState } from 'react';

interface LogDayModalProps {
  lineName: string;
  open: boolean;
  loading: boolean;
  error: string | null;
  loggedDates: string[];
  onClose: () => void;
  onConfirm: (workDate: string) => void;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function LogDayModal({
  lineName,
  open,
  loading,
  error,
  loggedDates,
  onClose,
  onConfirm,
}: LogDayModalProps) {
  const [workDate, setWorkDate] = useState(todayIso);
  const [confirmReplace, setConfirmReplace] = useState(false);

  if (!open) return null;

  const existingLogForDate = loggedDates.includes(workDate);
  const needsReplaceConfirm = existingLogForDate && !confirmReplace;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.35)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 16,
      }}
    >
      <div
        role="dialog"
        aria-labelledby="log-day-title"
        className="section-card"
        style={{ maxWidth: 420, width: '100%', padding: 20 }}
      >
        <h2 id="log-day-title" style={{ marginTop: 0 }}>
          Log the day
        </h2>
        <p style={{ color: '#555', marginBottom: 16 }}>
          Save staffing placements for <strong>{lineName}</strong> to the cloud for history and reports.
        </p>
        {error && (
          <div style={{ background: '#fde8e8', padding: 10, borderRadius: 6, marginBottom: 12, color: '#a00' }}>
            {error}
          </div>
        )}
        <label style={{ display: 'block', marginBottom: 12 }}>
          <span style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Work date</span>
          <input
            type="date"
            value={workDate}
            onChange={(e) => {
              setWorkDate(e.target.value);
              setConfirmReplace(false);
            }}
            style={{ width: '100%' }}
          />
        </label>
        {existingLogForDate && (
          <p style={{ background: '#fff8e1', padding: 10, borderRadius: 6, fontSize: '0.9rem' }}>
            A log already exists for this date. Logging again will replace it.
          </p>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={loading || !workDate.trim()}
            onClick={() => {
              if (needsReplaceConfirm) {
                setConfirmReplace(true);
                return;
              }
              onConfirm(workDate.trim());
            }}
          >
            {loading ? 'Saving…' : needsReplaceConfirm ? 'Replace existing log' : 'Log the day'}
          </button>
        </div>
      </div>
    </div>
  );
}

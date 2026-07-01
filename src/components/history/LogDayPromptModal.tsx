interface LogDayPromptModalProps {
  open: boolean;
  lineName: string;
  onYes: () => void;
  onNo: () => void;
}

export function LogDayPromptModal({ open, lineName, onYes, onNo }: LogDayPromptModalProps) {
  if (!open) return null;

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
        aria-labelledby="log-day-prompt-title"
        className="section-card"
        style={{ maxWidth: 420, width: '100%', padding: 20 }}
      >
        <h2 id="log-day-prompt-title" style={{ marginTop: 0 }}>
          Log the day?
        </h2>
        <p style={{ color: '#555', marginBottom: 16 }}>
          Copied to clipboard. Save today&apos;s staffing for <strong>{lineName}</strong> to the cloud for history and
          reports?
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onNo}>
            Not now
          </button>
          <button type="button" className="btn-primary" onClick={onYes}>
            Log the day
          </button>
        </div>
      </div>
    </div>
  );
}

import { useState, useEffect } from 'react';
import type { RootState } from '../types';
import type { LineConfig } from '../types';
import type { CloudLineSummary } from '../lib/cloudLines';
import {
  isCloudConfigured,
  listCloudLines,
  createCloudLine,
  getLineState,
  setLineState,
} from '../lib/cloudLines';
import { getEmptyLineState } from '../data/initialState';
import { BuildLineWizard } from './BuildLineWizard';

const CLOUD_LINE_ID = 'staffing-cloud-line-id';
const CLOUD_PASSWORD = 'staffing-cloud-password';

export function getCloudSession(): { lineId: string; password: string } | null {
  try {
    const lineId = sessionStorage.getItem(CLOUD_LINE_ID);
    const password = sessionStorage.getItem(CLOUD_PASSWORD);
    if (lineId && password) return { lineId, password };
  } catch {
    // ignore
  }
  return null;
}

export function setCloudSession(lineId: string, password: string): void {
  try {
    sessionStorage.setItem(CLOUD_LINE_ID, lineId);
    sessionStorage.setItem(CLOUD_PASSWORD, password);
  } catch {
    // ignore
  }
}

export function clearCloudSession(): void {
  try {
    sessionStorage.removeItem(CLOUD_LINE_ID);
    sessionStorage.removeItem(CLOUD_PASSWORD);
  } catch {
    // ignore
  }
}

interface EntryScreenProps {
  onSelectLocal: () => void;
  onJoinGroup: (rootState: RootState, lineId: string, password: string) => void;
  onJoinGroupPresentation?: (rootState: RootState, lineId: string, password: string) => void;
  /** Existing area IDs from app (for wizard when configuring new cloud line). */
  existingAreaIds?: Set<string>;
}

export function EntryScreen({ onSelectLocal, onJoinGroup, onJoinGroupPresentation, existingAreaIds = new Set() }: EntryScreenProps) {
  const cloudAvailable = isCloudConfigured();
  
  // Check for share link on mount and start at 'list' step if present
  const initialStep = (() => {
    if (!cloudAvailable) return 'choose';
    try {
      const params = new URLSearchParams(window.location.search);
      return params.has('cloudLine') ? 'list' : 'choose';
    } catch {
      return 'choose';
    }
  })();
  
  const [step, setStep] = useState<'choose' | 'list' | 'create' | 'join' | 'configure' | 'clone'>(initialStep);
  const [lines, setLines] = useState<CloudLineSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [createName, setCreateName] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [joinLineId, setJoinLineId] = useState('');
  const [joinPassword, setJoinPassword] = useState('');

  /** After create we have lineId + password; wizard completes with config → we save and join. */
  const [configureLineId, setConfigureLineId] = useState<string | null>(null);
  const [configurePassword, setConfigurePassword] = useState('');
  const [configureName, setConfigureName] = useState('');

  /** Clone line state */
  const [cloneSourceLineId, setCloneSourceLineId] = useState('');
  const [cloneSourcePassword, setCloneSourcePassword] = useState('');
  const [cloneNewName, setCloneNewName] = useState('');
  const [cloneNewPassword, setCloneNewPassword] = useState('');

  useEffect(() => {
    if (step !== 'list' || !cloudAvailable) return;
    setLoading(true);
    setError(null);
    listCloudLines()
      .then((fetchedLines) => {
        setLines(fetchedLines);
        // Check for cloudLine URL param to pre-select and go to join step
        const params = new URLSearchParams(window.location.search);
        const cloudLineParam = params.get('cloudLine');
        if (cloudLineParam && fetchedLines.some((l) => l.id === cloudLineParam)) {
          setJoinLineId(cloudLineParam);
          setStep('join');
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [step, cloudAvailable]);

  const handleCreate = () => {
    if (!createName.trim() || !createPassword) {
      setError('Name and password required');
      return;
    }
    setLoading(true);
    setError(null);
    createCloudLine(createName.trim(), createPassword)
      .then(({ lineId }) => {
        setConfigureLineId(lineId);
        setConfigurePassword(createPassword);
        setConfigureName(createName.trim());
        setStep('configure');
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  };

  const handleConfigureComplete = (config: LineConfig) => {
    if (!configureLineId || !configurePassword) return;
    const lineId = configureLineId;
    const configWithCloudId: LineConfig = { ...config, id: lineId, name: config.name || configureName };
    const emptyState = getEmptyLineState(configWithCloudId);
    const newRootState: RootState = {
      currentLineId: lineId,
      lines: [configWithCloudId],
      lineStates: { [lineId]: emptyState },
    };
    setLoading(true);
    setError(null);
    setLineState(lineId, configurePassword, newRootState)
      .then(() => {
        setCloudSession(lineId, configurePassword);
        onJoinGroup(newRootState, lineId, configurePassword);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  };

  const handleJoin = () => {
    if (!joinLineId || !joinPassword) {
      setError('Select a line and enter password');
      return;
    }
    setLoading(true);
    setError(null);
    getLineState(joinLineId, joinPassword)
      .then((rootState) => {
        setCloudSession(joinLineId, joinPassword);
        onJoinGroup(rootState, joinLineId, joinPassword);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  };

  const handleJoinPresentation = () => {
    if (!joinLineId || !joinPassword) {
      setError('Select a line and enter password');
      return;
    }
    if (!onJoinGroupPresentation) {
      handleJoin();
      return;
    }
    setLoading(true);
    setError(null);
    getLineState(joinLineId, joinPassword)
      .then((rootState) => {
        setCloudSession(joinLineId, joinPassword);
        onJoinGroupPresentation(rootState, joinLineId, joinPassword);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  };

  const handleClone = async () => {
    if (!cloneSourceLineId || !cloneSourcePassword) {
      setError('Select a source line and enter its password');
      return;
    }
    if (!cloneNewName.trim() || !cloneNewPassword) {
      setError('Enter a name and password for the new line');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // 1. Fetch source line state to get its config
      const sourceState = await getLineState(cloneSourceLineId, cloneSourcePassword);
      const sourceConfig = sourceState.lines?.[0];
      if (!sourceConfig) {
        throw new Error('Could not read source line configuration');
      }
      // 2. Create new cloud line
      const { lineId: newLineId } = await createCloudLine(cloneNewName.trim(), cloneNewPassword);
      // 3. Create new config with new ID and name
      const newConfig: LineConfig = { ...sourceConfig, id: newLineId, name: cloneNewName.trim() };
      // 4. Create empty state with cloned config
      const emptyState = getEmptyLineState(newConfig);
      const newRootState: RootState = {
        currentLineId: newLineId,
        lines: [newConfig],
        lineStates: { [newLineId]: emptyState },
      };
      // 5. Save and join new line
      await setLineState(newLineId, cloneNewPassword, newRootState);
      setCloudSession(newLineId, cloneNewPassword);
      onJoinGroup(newRootState, newLineId, cloneNewPassword);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const cardStyle: React.CSSProperties = {
    background: '#fff',
    borderRadius: 12,
    padding: 24,
    maxWidth: 420,
    margin: '0 auto 16px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
  };
  const btnStyle: React.CSSProperties = {
    padding: '10px 20px',
    fontSize: '1rem',
    borderRadius: 8,
    border: '1px solid #ccc',
    background: '#f5f5f5',
    cursor: 'pointer',
    marginRight: 8,
    marginTop: 8,
  };
  const btnPrimary: React.CSSProperties = { ...btnStyle, background: '#1a73e8', color: '#fff', borderColor: '#1a73e8' };
  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    fontSize: '1rem',
    borderRadius: 8,
    border: '1px solid #ccc',
    marginTop: 6,
    marginBottom: 12,
    boxSizing: 'border-box',
  };

  if (step === 'choose') {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.75rem', marginBottom: 8 }}>Production Line Staffing</h1>
        <p style={{ color: '#666', marginBottom: 24 }}>Choose how you want to use the app</p>
        <div style={cardStyle}>
          <button
            type="button"
            onClick={onSelectLocal}
            style={{ ...btnPrimary, width: '100%', padding: 14, marginRight: 0 }}
          >
            Local / Demo
          </button>
          <p style={{ fontSize: '0.9rem', color: '#666', marginTop: 12, marginBottom: 16 }}>
            Use the app on this device. Data stays in your browser.
          </p>
          {cloudAvailable ? (
            <>
              <button
                type="button"
                onClick={() => setStep('list')}
                style={{ ...btnStyle, width: '100%', marginRight: 0 }}
              >
                Group
              </button>
              <p style={{ fontSize: '0.9rem', color: '#666', marginTop: 12 }}>
                Create or join a shared line. Data is saved to the cloud; others can join with the password.
              </p>
            </>
          ) : (
            <p style={{ fontSize: '0.9rem', color: '#999' }}>
              Group mode is not configured (missing Supabase env).
            </p>
          )}
        </div>
      </div>
    );
  }

  if (step === 'list') {
    return (
      <div style={{ padding: 24, maxWidth: 480, margin: '0 auto' }}>
        <h1 style={{ fontSize: '1.5rem', marginBottom: 8 }}>Group lines</h1>
        <p style={{ color: '#666', marginBottom: 16 }}>
          Create a new shared line or join one with its password.
        </p>
        {error && (
          <div style={{ background: '#fee', padding: 12, borderRadius: 8, marginBottom: 16 }}>
            {error}
          </div>
        )}
        {loading && step === 'list' && !lines.length ? (
          <p>Loading lines…</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <button type="button" onClick={() => setStep('create')} style={btnPrimary}>
              Create a new line
            </button>
            <button type="button" onClick={() => setStep('join')} style={btnStyle}>
              Join an existing line
            </button>
            <button type="button" onClick={() => setStep('clone')} style={btnStyle}>
              Clone an existing line
            </button>
          </div>
        )}
        {lines.length > 0 && (
          <p style={{ fontSize: '0.9rem', color: '#666', marginTop: 16 }}>
            {lines.length} line(s) available. Join one and enter its password.
          </p>
        )}
        <button type="button" onClick={() => setStep('choose')} style={{ ...btnStyle, marginTop: 16 }}>
          Back
        </button>
      </div>
    );
  }

  if (step === 'configure' && configureLineId) {
    return (
      <div style={{ padding: 24, maxWidth: 560, margin: '0 auto' }}>
        <h1 style={{ fontSize: '1.5rem', marginBottom: 8 }}>Set up your line</h1>
        <p style={{ color: '#666', marginBottom: 16 }}>
          Add sections, lead roles, and break options. This line will then be saved to the cloud.
        </p>
        {error && (
          <div style={{ background: '#fee', padding: 12, borderRadius: 8, marginBottom: 16 }}>
            {error}
          </div>
        )}
        {loading ? (
          <p>Saving…</p>
        ) : (
          <BuildLineWizard
            existingAreaIds={existingAreaIds}
            existingLineId={configureLineId}
            initialLineName={configureName}
            onComplete={handleConfigureComplete}
            onCancel={() => {
              setStep('list');
              setConfigureLineId(null);
              setConfigurePassword('');
              setConfigureName('');
              setError(null);
            }}
          />
        )}
      </div>
    );
  }

  if (step === 'create') {
    return (
      <div style={{ padding: 24, maxWidth: 420, margin: '0 auto' }}>
        <h1 style={{ fontSize: '1.5rem', marginBottom: 16 }}>Create a group line</h1>
        {error && (
          <div style={{ background: '#fee', padding: 12, borderRadius: 8, marginBottom: 16 }}>
            {error}
          </div>
        )}
        <div style={cardStyle}>
          <label style={{ display: 'block', fontWeight: 600 }}>Line name</label>
          <input
            type="text"
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            placeholder="e.g. IC Line"
            style={inputStyle}
            autoComplete="off"
          />
          <label style={{ display: 'block', fontWeight: 600 }}>Password</label>
          <input
            type="password"
            value={createPassword}
            onChange={(e) => setCreatePassword(e.target.value)}
            placeholder="Share this with others to join"
            style={inputStyle}
            autoComplete="new-password"
          />
          <button type="button" onClick={handleCreate} disabled={loading} style={btnPrimary}>
            {loading ? 'Creating…' : 'Create line'}
          </button>
        </div>
        <button type="button" onClick={() => setStep('list')} style={btnStyle}>
          Back
        </button>
      </div>
    );
  }

  if (step === 'clone') {
    return (
      <div style={{ padding: 24, maxWidth: 420, margin: '0 auto' }}>
        <h1 style={{ fontSize: '1.5rem', marginBottom: 16 }}>Clone a line</h1>
        <p style={{ color: '#666', marginBottom: 16 }}>
          Copy all settings from an existing line but start with an empty roster.
        </p>
        {error && (
          <div style={{ background: '#fee', padding: 12, borderRadius: 8, marginBottom: 16 }}>
            {error}
          </div>
        )}
        <div style={cardStyle}>
          <label style={{ display: 'block', fontWeight: 600 }}>Source line</label>
          <select
            value={cloneSourceLineId}
            onChange={(e) => setCloneSourceLineId(e.target.value)}
            style={inputStyle}
          >
            <option value="">— Select a line to clone —</option>
            {lines.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <label style={{ display: 'block', fontWeight: 600 }}>Source line password</label>
          <input
            type="password"
            value={cloneSourcePassword}
            onChange={(e) => setCloneSourcePassword(e.target.value)}
            placeholder="Password of the line to clone"
            style={inputStyle}
            autoComplete="current-password"
          />
          <hr style={{ margin: '16px 0', border: 'none', borderTop: '1px solid #eee' }} />
          <label style={{ display: 'block', fontWeight: 600 }}>New line name</label>
          <input
            type="text"
            value={cloneNewName}
            onChange={(e) => setCloneNewName(e.target.value)}
            placeholder="e.g. NIC Line"
            style={inputStyle}
            autoComplete="off"
          />
          <label style={{ display: 'block', fontWeight: 600 }}>New line password</label>
          <input
            type="password"
            value={cloneNewPassword}
            onChange={(e) => setCloneNewPassword(e.target.value)}
            placeholder="Password for the new line"
            style={inputStyle}
            autoComplete="new-password"
          />
          <button type="button" onClick={handleClone} disabled={loading} style={btnPrimary}>
            {loading ? 'Cloning…' : 'Clone line'}
          </button>
        </div>
        <button type="button" onClick={() => setStep('list')} style={btnStyle}>
          Back
        </button>
      </div>
    );
  }

  // step === 'join'
  return (
    <div style={{ padding: 24, maxWidth: 420, margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: 16 }}>Join a group line</h1>
      {error && (
        <div style={{ background: '#fee', padding: 12, borderRadius: 8, marginBottom: 16 }}>
          {error}
        </div>
      )}
      <div style={cardStyle}>
        <label style={{ display: 'block', fontWeight: 600 }}>Line</label>
        <select
          value={joinLineId}
          onChange={(e) => setJoinLineId(e.target.value)}
          style={inputStyle}
        >
          <option value="">— Select a line —</option>
          {lines.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <label style={{ display: 'block', fontWeight: 600 }}>Password</label>
        <input
          type="password"
          value={joinPassword}
          onChange={(e) => setJoinPassword(e.target.value)}
          placeholder="Enter the line password"
          style={inputStyle}
          autoComplete="current-password"
        />
        <button type="button" onClick={handleJoin} disabled={loading || !joinLineId} style={btnPrimary}>
          {loading ? 'Joining…' : 'Join'}
        </button>
        {onJoinGroupPresentation && (
          <button
            type="button"
            onClick={handleJoinPresentation}
            disabled={loading || !joinLineId}
            style={{ ...btnStyle, marginLeft: 0, marginTop: 12 }}
          >
            {loading ? 'Joining…' : 'Join Staffing View'}
          </button>
        )}
      </div>
      <button type="button" onClick={() => setStep('list')} style={btnStyle}>
        Back
      </button>
    </div>
  );
}

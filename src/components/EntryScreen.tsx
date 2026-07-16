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
import { setCloudSession } from '../lib/cloudSession';
import { getEmptyLineState } from '../data/initialState';
import { BuildLineWizard } from './BuildLineWizard';

interface CloudLineCursor {
  updatedAt?: string;
  version?: number;
}

interface EntryScreenProps {
  onSelectLocal: () => void;
  onJoinGroup: (rootState: RootState, lineId: string, password: string, cursor?: CloudLineCursor) => void;
  onJoinGroupPresentation?: (rootState: RootState, lineId: string, password: string, cursor?: CloudLineCursor) => void;
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
  
  const [step, setStep] = useState<'choose' | 'list' | 'create' | 'join' | 'configure' | 'clone' | 'quickJoin'>(initialStep);
  const [lines, setLines] = useState<CloudLineSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [createName, setCreateName] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [joinLineId, setJoinLineId] = useState('');
  const [joinPassword, setJoinPassword] = useState('');
  /** When set from a front-page quick-join button, auto-select a cloud line by name. */
  const [quickJoinName, setQuickJoinName] = useState<string | null>(null);

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
        // 1) Check for cloudLine URL param to pre-select and go to join step
        const params = new URLSearchParams(window.location.search);
        const cloudLineParam = params.get('cloudLine');
        if (cloudLineParam && fetchedLines.some((l) => l.id === cloudLineParam)) {
          setJoinLineId(cloudLineParam);
          setStep('join');
          return;
        }

        // 2) If user clicked a quick-join button (IC/NIC), go straight to password prompt for that line
        if (quickJoinName) {
          const targetName = quickJoinName.toLowerCase().trim();
          /** Prefer exact name match so "IC" does not grab "IC 2" when the list is newest-first. */
          const exact = fetchedLines.find((l) => l.name.toLowerCase().trim() === targetName);
          const match =
            exact ??
            fetchedLines.find((l) => {
              const n = l.name.toLowerCase().trim();
              return (
                n.startsWith(targetName) &&
                (n.length === targetName.length || n[targetName.length] === ' ')
              );
            });
          if (match) {
            setJoinLineId(match.id);
            setJoinPassword('');
            setError(null);
            setStep('quickJoin');
          } else {
            setError(`No line found matching "${quickJoinName}"`);
            setStep('join');
          }
          setQuickJoinName(null);
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [step, cloudAvailable, quickJoinName]);

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
      .then((res) => {
        setCloudSession(lineId, configurePassword);
        onJoinGroup(newRootState, lineId, configurePassword, res ?? undefined);
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
      .then(({ rootState, updatedAt, version }) => {
        setCloudSession(joinLineId, joinPassword);
        onJoinGroup(rootState, joinLineId, joinPassword, { updatedAt, version });
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
      .then(({ rootState, updatedAt, version }) => {
        setCloudSession(joinLineId, joinPassword);
        onJoinGroupPresentation(rootState, joinLineId, joinPassword, { updatedAt, version });
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  };

  /** Quick join: password-only prompt then join and go to staffing view. */
  const handleQuickJoin = () => {
    if (!joinLineId || !joinPassword.trim()) {
      setError('Enter the line password');
      return;
    }
    const password = joinPassword.trim();
    setLoading(true);
    setError(null);
    getLineState(joinLineId, password)
      .then(({ rootState, updatedAt, version }) => {
        setCloudSession(joinLineId, password);
        if (onJoinGroupPresentation) {
          onJoinGroupPresentation(rootState, joinLineId, password, { updatedAt, version });
        } else {
          onJoinGroup(rootState, joinLineId, password, { updatedAt, version });
        }
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
      const { rootState: sourceState } = await getLineState(cloneSourceLineId, cloneSourcePassword);
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
      const res = await setLineState(newLineId, cloneNewPassword, newRootState);
      setCloudSession(newLineId, cloneNewPassword);
      onJoinGroup(newRootState, newLineId, cloneNewPassword, res ?? undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  if (step === 'choose') {
    return (
      <div className="entry-screen">
        <div className="entry-brand">
          <span className="entry-brand-mark" aria-hidden />
          <h1>Production Line Staffing</h1>
          <p>Staff the line, cover breaks, and share the day&apos;s plan.</p>
        </div>
        <div className="entry-panel">
          <button type="button" onClick={onSelectLocal} className="btn-primary" style={{ padding: '14px 16px' }}>
            Local / Demo
          </button>
          <p className="entry-panel-desc">Use the app on this device. Data stays in your browser.</p>
          {cloudAvailable ? (
            <>
              <hr className="entry-divider" />
              <button type="button" onClick={() => setStep('list')} style={{ padding: '12px 16px' }}>
                Group
              </button>
              <p className="entry-panel-desc">
                Create or join a shared line. Data is saved to the cloud; others join with the password.
              </p>
              <div style={{ marginTop: 16 }}>
                <div className="entry-quick-label">Quick join</div>
                <div className="entry-actions">
                  <button
                    type="button"
                    onClick={() => {
                      setQuickJoinName('IC');
                      setStep('list');
                    }}
                  >
                    IC line
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setQuickJoinName('NIC');
                      setStep('list');
                    }}
                  >
                    NIC line
                  </button>
                </div>
              </div>
            </>
          ) : (
            <p className="entry-panel-desc" style={{ color: 'var(--color-text-muted)' }}>
              Group mode is not configured (missing Supabase env).
            </p>
          )}
        </div>
      </div>
    );
  }

  if (step === 'list') {
    return (
      <div className="entry-screen entry-screen--narrow">
        <h1 style={{ fontSize: '1.5rem', marginBottom: 8 }}>Group lines</h1>
        <p className="entry-muted" style={{ marginBottom: 16 }}>
          Create a new shared line or join one with its password.
        </p>
        {error && <div className="alert alert-error">{error}</div>}
        {loading && step === 'list' && !lines.length ? (
          <p className="entry-muted">Loading lines…</p>
        ) : (
          <div className="entry-actions">
            <button type="button" onClick={() => setStep('create')} className="btn-primary">
              Create a new line
            </button>
            <button type="button" onClick={() => setStep('join')}>
              Join an existing line
            </button>
            <button type="button" onClick={() => setStep('clone')}>
              Clone an existing line
            </button>
          </div>
        )}
        {lines.length > 0 && (
          <p className="entry-muted" style={{ fontSize: '0.9rem', marginTop: 16 }}>
            {lines.length} line(s) available. Join one and enter its password.
          </p>
        )}
        <button type="button" className="btn-ghost" onClick={() => setStep('choose')} style={{ marginTop: 16 }}>
          Back
        </button>
      </div>
    );
  }

  if (step === 'quickJoin' && joinLineId) {
    const quickJoinLine = lines.find((l) => l.id === joinLineId);
    const lineDisplayName = quickJoinLine?.name ?? joinLineId;
    return (
      <div className="entry-screen entry-screen--narrow">
        <h1 style={{ fontSize: '1.5rem', marginBottom: 8 }}>Quick join</h1>
        <p className="entry-muted" style={{ marginBottom: 16 }}>
          Enter the password for <strong>{lineDisplayName}</strong> to open the staffing view.
        </p>
        {error && <div className="alert alert-error">{error}</div>}
        <div className="entry-panel" style={{ maxWidth: '100%', marginBottom: 16 }}>
          <label style={{ display: 'block', fontWeight: 600, marginBottom: 6 }}>Password</label>
          <input
            type="password"
            value={joinPassword}
            onChange={(e) => {
              setJoinPassword(e.target.value);
              setError(null);
            }}
            placeholder="Line password"
            style={{ width: '100%', marginBottom: 12 }}
            autoComplete="current-password"
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && handleQuickJoin()}
          />
          <button type="button" onClick={handleQuickJoin} disabled={loading} className="btn-primary">
            {loading ? 'Opening…' : 'Open staffing view'}
          </button>
        </div>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => {
            setStep('choose');
            setJoinLineId('');
            setJoinPassword('');
            setError(null);
          }}
        >
          Back
        </button>
      </div>
    );
  }

  if (step === 'configure' && configureLineId) {
    return (
      <div className="entry-screen entry-screen--narrow" style={{ maxWidth: 560 }}>
        <h1 style={{ fontSize: '1.5rem', marginBottom: 8 }}>Set up your line</h1>
        <p className="entry-muted" style={{ marginBottom: 16 }}>
          Add sections, lead roles, and break options. This line will then be saved to the cloud.
        </p>
        {error && (
          <div className="alert alert-error">{error}</div>
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
      <div className="entry-screen entry-screen--narrow">
        <h1 style={{ fontSize: '1.5rem', marginBottom: 16 }}>Create a group line</h1>
        {error && (
          <div className="alert alert-error">{error}</div>
        )}
        <div className="entry-panel" style={{ maxWidth: '100%' }}>
          <label style={{ display: 'block', fontWeight: 600 }}>Line name</label>
          <input
            type="text"
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            placeholder="e.g. IC Line"
            style={{ width: '100%', marginTop: 6, marginBottom: 12 }}
            autoComplete="off"
          />
          <label style={{ display: 'block', fontWeight: 600 }}>Password</label>
          <input
            type="password"
            value={createPassword}
            onChange={(e) => setCreatePassword(e.target.value)}
            placeholder="Share this with others to join"
            style={{ width: '100%', marginTop: 6, marginBottom: 12 }}
            autoComplete="new-password"
          />
          <button type="button" onClick={handleCreate} disabled={loading} className="btn-primary">
            {loading ? 'Creating…' : 'Create line'}
          </button>
        </div>
        <button type="button" className="btn-ghost" onClick={() => setStep('list')} style={{ marginTop: 12 }}>
          Back
        </button>
      </div>
    );
  }

  if (step === 'clone') {
    return (
      <div className="entry-screen entry-screen--narrow">
        <h1 style={{ fontSize: '1.5rem', marginBottom: 16 }}>Clone a line</h1>
        <p className="entry-muted" style={{ marginBottom: 16 }}>
          Copy all settings from an existing line but start with an empty roster.
        </p>
        {error && (
          <div className="alert alert-error">{error}</div>
        )}
        <div className="entry-panel" style={{ maxWidth: '100%' }}>
          <label style={{ display: 'block', fontWeight: 600 }}>Source line</label>
          <select
            value={cloneSourceLineId}
            onChange={(e) => setCloneSourceLineId(e.target.value)}
            style={{ width: '100%', marginTop: 6, marginBottom: 12 }}
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
            style={{ width: '100%', marginTop: 6, marginBottom: 12 }}
            autoComplete="current-password"
          />
          <hr className="entry-divider" />
          <label style={{ display: 'block', fontWeight: 600 }}>New line name</label>
          <input
            type="text"
            value={cloneNewName}
            onChange={(e) => setCloneNewName(e.target.value)}
            placeholder="e.g. NIC Line"
            style={{ width: '100%', marginTop: 6, marginBottom: 12 }}
            autoComplete="off"
          />
          <label style={{ display: 'block', fontWeight: 600 }}>New line password</label>
          <input
            type="password"
            value={cloneNewPassword}
            onChange={(e) => setCloneNewPassword(e.target.value)}
            placeholder="Password for the new line"
            style={{ width: '100%', marginTop: 6, marginBottom: 12 }}
            autoComplete="new-password"
          />
          <button type="button" onClick={handleClone} disabled={loading} className="btn-primary">
            {loading ? 'Cloning…' : 'Clone line'}
          </button>
        </div>
        <button type="button" className="btn-ghost" onClick={() => setStep('list')} style={{ marginTop: 12 }}>
          Back
        </button>
      </div>
    );
  }

  // step === 'join'
  return (
    <div className="entry-screen entry-screen--narrow">
      <h1 style={{ fontSize: '1.5rem', marginBottom: 16 }}>Join a group line</h1>
      {error && (
      <div className="alert alert-error">{error}</div>
      )}
      <div className="entry-panel" style={{ maxWidth: '100%' }}>
        <label style={{ display: 'block', fontWeight: 600 }}>Line</label>
        <select
          value={joinLineId}
          onChange={(e) => setJoinLineId(e.target.value)}
          style={{ width: '100%', marginTop: 6, marginBottom: 12 }}
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
          style={{ width: '100%', marginTop: 6, marginBottom: 12 }}
          autoComplete="current-password"
        />
        <button type="button" onClick={handleJoin} disabled={loading || !joinLineId} className="btn-primary">
          {loading ? 'Joining…' : 'Join'}
        </button>
        {onJoinGroupPresentation && (
          <button
            type="button"
            onClick={handleJoinPresentation}
            disabled={loading || !joinLineId}
            style={{ marginTop: 12 }}
          >
            {loading ? 'Joining…' : 'Join Staffing View'}
          </button>
        )}
      </div>
      <button type="button" className="btn-ghost" onClick={() => setStep('list')} style={{ marginTop: 12 }}>
        Back
      </button>
    </div>
  );
}

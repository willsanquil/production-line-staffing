/**
 * Import roster + slot assignments from IC/NIC cloud lines into IC 2.0 / NIC 2.0.
 *
 * Usage:
 *   npx tsx scripts/import-roster-to-2-lines.ts
 *   npx tsx scripts/import-roster-to-2-lines.ts --source-ic-password SECRET --source-nic-password SECRET
 */
import { loadEnv } from 'vite';
import { createClient } from '@supabase/supabase-js';
import type { LineState, RootState } from '../src/types';
import { applyRosterImportToRoot } from '../src/lib/migrateLineRoster';

function parseArg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i === -1 || i + 1 >= process.argv.length) return undefined;
  return process.argv[i + 1];
}

async function getSupabase() {
  const env = loadEnv('production', process.cwd(), '');
  let url = env.VITE_SUPABASE_URL;
  let key = env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    const { execSync } = await import('node:child_process');
    const keysJson = execSync(
      'npx supabase projects api-keys --project-ref ecnjhxngexogrggtwhlh -o json',
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const keys = JSON.parse(keysJson) as { name: string; api_key: string }[];
    const anon = keys.find((k) => k.name === 'anon' || k.name === 'anon public')?.api_key ?? keys[0]?.api_key;
    url = 'https://ecnjhxngexogrggtwhlh.supabase.co';
    key = anon;
  }
  if (!url || !key) throw new Error('Missing Supabase credentials');
  return createClient(url, key);
}

async function listLines(supabase: ReturnType<typeof createClient>) {
  const { data, error } = await supabase.from('cloud_lines_public').select('id, name').order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as { id: string; name: string }[];
}

async function getLineState(supabase: ReturnType<typeof createClient>, lineId: string, password: string) {
  const { data, error } = await supabase.functions.invoke<{
    rootState?: RootState;
    updatedAt?: string;
    version?: number;
    error?: string;
  }>('get-line-state', { body: { lineId, password } });
  if (error) {
    const ctx = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context;
    const body = ctx?.json ? await ctx.json().catch(() => ({})) : {};
    throw new Error(body.error ?? error.message);
  }
  if (data?.error) throw new Error(data.error);
  if (!data?.rootState) throw new Error('Invalid get-line-state response');
  return { rootState: data.rootState, updatedAt: data.updatedAt ?? '', version: data.version };
}

async function yeetAndSave(
  supabase: ReturnType<typeof createClient>,
  lineId: string,
  password: string,
  rootState: RootState,
  expected: { updatedAt?: string; version?: number }
) {
  const sessionId = crypto.randomUUID();
  const { data: yeetData, error: yeetErr } = await supabase.functions.invoke<{ ok?: boolean; error?: string }>(
    'viewer-presence',
    { body: { lineId, password, sessionId, action: 'yeet' } }
  );
  if (yeetErr) throw new Error(yeetErr.message);
  if (yeetData?.error) throw new Error(yeetData.error);

  const { data, error } = await supabase.functions.invoke<{ ok?: boolean; updatedAt?: string; version?: number; error?: string; code?: string }>(
    'set-line-state',
    {
      body: {
        lineId,
        password,
        rootState,
        expectedUpdatedAt: expected.updatedAt,
        expectedVersion: expected.version,
        editorSessionId: sessionId,
      },
    }
  );
  if (error) {
    const ctx = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context;
    const body = ctx?.json ? await ctx.json().catch(() => ({})) : {};
    throw new Error(body.error ?? error.message);
  }
  if (data?.error) throw new Error(data.error);

  await supabase.functions.invoke('viewer-presence', {
    body: { lineId, password, sessionId, action: 'release' },
  });
  return data;
}

function findLineByExactName(lines: { id: string; name: string }[], name: string) {
  const target = name.toLowerCase().trim();
  return lines.find((l) => l.name.toLowerCase().trim() === target);
}

async function tryPasswords(
  supabase: ReturnType<typeof createClient>,
  lineId: string,
  passwords: string[]
): Promise<{ rootState: RootState; password: string; updatedAt: string; version?: number }> {
  let lastErr = '';
  for (const password of passwords) {
    try {
      const res = await getLineState(supabase, lineId, password);
      return { ...res, password };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      if (!lastErr.toLowerCase().includes('password')) throw e;
    }
  }
  throw new Error(`Could not authenticate line ${lineId}. Last error: ${lastErr}`);
}

const PAIRS = [
  { sourceName: 'IC', targetName: 'IC 2.0', targetPassword: 'IC', defaultSourcePasswords: ['IC', 'ic'] },
  { sourceName: 'NIC', targetName: 'NIC 2.0', targetPassword: 'NIC', defaultSourcePasswords: ['NIC', 'nic'] },
] as const;

async function main() {
  const supabase = await getSupabase();
  const lines = await listLines(supabase);

  for (const pair of PAIRS) {
    const sourceLine = findLineByExactName(lines, pair.sourceName);
    const targetLine = findLineByExactName(lines, pair.targetName);
    if (!sourceLine) {
      console.error(`SKIP: source line "${pair.sourceName}" not found`);
      continue;
    }
    if (!targetLine) {
      console.error(`SKIP: target line "${pair.targetName}" not found`);
      continue;
    }

    const sourcePasswordArg =
      pair.sourceName === 'IC' ? parseArg('--source-ic-password') : parseArg('--source-nic-password');
    const sourcePasswords = sourcePasswordArg ? [sourcePasswordArg] : [...pair.defaultSourcePasswords];

    console.log(`Importing ${pair.sourceName} → ${pair.targetName}…`);
    const source = await tryPasswords(supabase, sourceLine.id, sourcePasswords);
    const sourceState = source.rootState.lineStates[source.rootState.currentLineId] as LineState | undefined;
    if (!sourceState?.roster?.length) {
      console.warn(`  WARN: source "${pair.sourceName}" roster is empty`);
    } else {
      console.log(`  Source roster: ${sourceState.roster.length} people`);
    }

    const target = await getLineState(supabase, targetLine.id, pair.targetPassword);
    const imported = applyRosterImportToRoot(target.rootState, targetLine.id, sourceState ?? { roster: [], slots: {} });
    const importedState = imported.lineStates[targetLine.id];
    console.log(`  Imported roster: ${importedState?.roster?.length ?? 0} people`);

    let saved = false;
    for (let attempt = 0; attempt < 3 && !saved; attempt++) {
      try {
        const fresh =
          attempt === 0
            ? target
            : await getLineState(supabase, targetLine.id, pair.targetPassword);
        const freshImported = applyRosterImportToRoot(fresh.rootState, targetLine.id, sourceState ?? { roster: [], slots: {} });
        await yeetAndSave(supabase, targetLine.id, pair.targetPassword, freshImported, {
          updatedAt: fresh.updatedAt,
          version: fresh.version,
        });
        saved = true;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (attempt < 2 && msg.includes('Someone else saved')) {
          console.log(`  Retry ${attempt + 2}/3 after conflict…`);
          continue;
        }
        throw e;
      }
    }
    console.log(`  OK: saved "${pair.targetName}" (${targetLine.id})`);
  }
}

main().catch((e) => {
  console.error('Failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});

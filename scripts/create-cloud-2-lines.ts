/**
 * One-off: create IC 2.0 and NIC 2.0 cloud lines with preset configs.
 * Usage: npx tsx scripts/create-cloud-2-lines.ts
 */
import { loadEnv } from 'vite';
import { createClient } from '@supabase/supabase-js';
import { buildPresetCloudRootState } from '../src/lib/cloudLinePresets';
import { getDefaultIC2LineConfig, getDefaultNIC2LineConfig } from '../src/lib/lineConfig';

const env = loadEnv('production', process.cwd(), '');
const url = env.VITE_SUPABASE_URL;
const key = env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env / .env.local');
  process.exit(1);
}

const supabase = createClient(url, key);

const LINES_TO_CREATE = [
  { config: getDefaultIC2LineConfig(), password: 'IC' },
  { config: getDefaultNIC2LineConfig(), password: 'NIC' },
] as const;

async function listLines(): Promise<{ id: string; name: string }[]> {
  const { data, error } = await supabase.from('cloud_lines_public').select('id, name').order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as { id: string; name: string }[];
}

async function createLine(name: string, password: string, rootState: unknown) {
  const { data, error } = await supabase.functions.invoke<{
    lineId?: string;
    name?: string;
    error?: string;
  }>('create-line', { body: { name, password, rootState } });
  if (error) {
    const ctx = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context;
    const body = ctx?.json ? await ctx.json().catch(() => ({})) : {};
    throw new Error(body.error ?? error.message);
  }
  if (data?.error) throw new Error(data.error);
  if (!data?.lineId) throw new Error('Invalid response from create-line');
  return data;
}

async function main() {
  const existing = await listLines();
  for (const { config, password } of LINES_TO_CREATE) {
    const name = config.name;
    const match = existing.find((l) => l.name.toLowerCase().trim() === name.toLowerCase().trim());
    if (match) {
      console.log(`SKIP: "${name}" already exists (id ${match.id})`);
      continue;
    }
    const presetRoot = buildPresetCloudRootState(config);
    const result = await createLine(name, password, presetRoot);
    console.log(`OK: Created "${name}" — lineId ${result.lineId}, password "${password}"`);
  }
}

main().catch((e) => {
  console.error('Failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});

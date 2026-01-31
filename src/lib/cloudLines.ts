import { createClient, type SupabaseClient, FunctionsHttpError } from '@supabase/supabase-js';
import type { RootState } from '../types';

/** Get a user-friendly error message from an Edge Function non-2xx response. */
async function getFunctionErrorMessage(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError && error.context && typeof error.context.json === 'function') {
    try {
      const body = (await error.context.json()) as { error?: string };
      if (body?.error && typeof body.error === 'string') return body.error;
    } catch {
      // ignore parse errors
    }
  }
  return error instanceof Error ? error.message : String(error);
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
  }
  if (!client) {
    client = createClient(supabaseUrl, supabaseAnonKey);
  }
  return client;
}

export function isCloudConfigured(): boolean {
  return Boolean(supabaseUrl && supabaseAnonKey);
}

export interface CloudLineSummary {
  id: string;
  name: string;
  created_at: string;
}

/** List public cloud lines (id, name, created_at). Requires Supabase env vars. */
export async function listCloudLines(): Promise<CloudLineSummary[]> {
  const supabase = getClient();
  const { data, error } = await supabase.from('cloud_lines_public').select('id, name, created_at').order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as CloudLineSummary[];
}

/** Create a new cloud line. Returns lineId, name, and initial rootState. */
export async function createCloudLine(
  name: string,
  password: string
): Promise<{ lineId: string; name: string; rootState: RootState }> {
  const supabase = getClient();
  const { data, error } = await supabase.functions.invoke<{
    lineId: string;
    name: string;
    rootState: RootState;
    error?: string;
  }>('create-line', {
    body: { name: name.trim(), password },
  });
  if (error) {
    const message = await getFunctionErrorMessage(error);
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  if (!data?.lineId || !data?.rootState) throw new Error('Invalid response from create-line');
  return {
    lineId: data.lineId,
    name: data.name ?? name.trim(),
    rootState: data.rootState as RootState,
  };
}

/** Get a cloud line's full state (password-protected). */
export async function getLineState(
  lineId: string,
  password: string
): Promise<RootState> {
  const supabase = getClient();
  const { data, error } = await supabase.functions.invoke<{
    rootState?: RootState;
    error?: string;
  }>('get-line-state', {
    body: { lineId, password },
  });
  if (error) {
    const message = await getFunctionErrorMessage(error);
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  if (!data?.rootState) throw new Error('Invalid response from get-line-state');
  return data.rootState as RootState;
}

/** Save a cloud line's state (password-protected). */
export async function setLineState(
  lineId: string,
  password: string,
  rootState: RootState
): Promise<void> {
  const supabase = getClient();
  const { data, error } = await supabase.functions.invoke<{ ok?: boolean; error?: string }>(
    'set-line-state',
    { body: { lineId, password, rootState } }
  );
  if (error) {
    const message = await getFunctionErrorMessage(error);
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
}

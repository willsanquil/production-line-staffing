import { createClient, type SupabaseClient, FunctionsHttpError } from '@supabase/supabase-js';
import type { DayLogAssignment, DayLogDetail, DayLogSummary, LineConfig, LineState, RootState } from '../types';
import { buildDayLogExtractInput } from './dayLogExtract';
import { SHIFT_HOURS } from './dayLogConstants';

/** Normalize API work_date values to YYYY-MM-DD (handles legacy "Wed May 20" strings). */
function normalizeWorkDate(value: string): string {
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  if (iso) return iso[1];
  const d = new Date(value);
  if (!Number.isNaN(d.getTime())) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  return value;
}

/** Get a user-friendly error message from an Edge Function non-2xx response. */
async function getFunctionErrorMessage(error: unknown, functionName: string): Promise<string> {
  const response = error instanceof FunctionsHttpError ? error.context : null;
  if (response && typeof response.json === 'function') {
    try {
      const body = (await response.json()) as { error?: string; details?: string; hint?: string };
      if (body?.error && typeof body.error === 'string') {
        const parts = [body.error];
        if (body.details) parts.push(body.details);
        if (body.hint) parts.push(body.hint);
        return parts.join(' ');
      }
    } catch {
      // body wasn't JSON (e.g. HTML 404 page)
    }
  }
  const status = response?.status;
  if (status === 404) {
    return `(404) Edge Function '${functionName}' not found. Deploy it: npx supabase functions deploy ${functionName} (after supabase link).`;
  }
  if (status === 500) {
    return `(500) Server error. Check Supabase Dashboard → Edge Functions → ${functionName} → Logs.`;
  }
  if (typeof status === 'number') {
    return `(${status}) Check Supabase Dashboard → Edge Functions → ${functionName} → Logs.`;
  }
  const raw = error instanceof Error ? error.message : String(error);
  if (raw.includes('Failed to send a request')) {
    const ref = getConfiguredSupabaseProjectRef();
    return `${raw} The "${functionName}" function may not be deployed on project "${ref}". From the repo folder run: npx supabase functions deploy ${functionName} (or npx supabase functions deploy for all). For log-day, also run migration 20260601000000_cloud_line_day_logs.sql in the SQL Editor.`;
  }
  return raw;
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Subdomain from `https://xxxx.supabase.co` for troubleshooting deploy vs env mismatches. */
export function getConfiguredSupabaseProjectRef(): string {
  if (!supabaseUrl) return '(VITE_SUPABASE_URL not set)';
  try {
    const host = new URL(supabaseUrl).hostname;
    const m = /^([^.]+)\.supabase\.co$/i.exec(host);
    return m?.[1] ?? host;
  } catch {
    return '(invalid VITE_SUPABASE_URL)';
  }
}

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

/** Create a new cloud line. Optionally pass rootState to share an existing local line. */
export async function createCloudLine(
  name: string,
  password: string,
  rootState?: RootState
): Promise<{ lineId: string; name: string; rootState: RootState; updatedAt?: string; version?: number }> {
  const supabase = getClient();
  const body = rootState
    ? { name: name.trim(), password, rootState }
    : { name: name.trim(), password };
  const { data, error } = await supabase.functions.invoke<{
    lineId: string;
    name: string;
    rootState: RootState;
    updatedAt?: string;
    version?: number;
    error?: string;
  }>('create-line', { body });
  if (error) {
    const message = await getFunctionErrorMessage(error, 'create-line');
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  if (!data?.lineId || !data?.rootState) throw new Error('Invalid response from create-line');
  return {
    lineId: data.lineId,
    name: data.name ?? name.trim(),
    rootState: data.rootState as RootState,
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : undefined,
    version: typeof data.version === 'number' ? data.version : undefined,
  };
}

export interface GetLineStateResult {
  rootState: RootState;
  updatedAt: string;
  version?: number;
  viewerSessionId?: string | null;
  viewerHeartbeatAt?: string | null;
}

/** Get a cloud line's full state (password-protected). Returns state and server updated_at for optimistic locking. */
export async function getLineState(
  lineId: string,
  password: string
): Promise<GetLineStateResult> {
  const supabase = getClient();
  const { data, error } = await supabase.functions.invoke<{
    rootState?: RootState;
    updatedAt?: string;
    version?: number;
    viewerSessionId?: string | null;
    viewerHeartbeatAt?: string | null;
    error?: string;
  }>('get-line-state', {
    body: { lineId, password },
  });
  if (error) {
    let message = await getFunctionErrorMessage(error, 'get-line-state');
    if (message.includes('Line data not found')) {
      const ref = getConfiguredSupabaseProjectRef();
      message += ` Your app is using Supabase project "${ref}". After \`npx supabase functions deploy\`, the dashboard URL must show that same id (Settings → API → Project URL). If the id differs, update Vercel env VITE_SUPABASE_URL and redeploy the site, or run \`npx supabase link --project-ref ${ref}\` in this repo and deploy again.`;
    }
    throw new Error(message);
  }
  if (data?.error) {
    let m = data.error;
    if (m.includes('Line data not found')) {
      const ref = getConfiguredSupabaseProjectRef();
      m += ` Your app is using Supabase project "${ref}". That id must match the project you deploy functions to.`;
    }
    throw new Error(m);
  }
  if (!data?.rootState) throw new Error('Invalid response from get-line-state');
  return {
    rootState: data.rootState as RootState,
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : '',
    version: typeof data.version === 'number' ? data.version : undefined,
    viewerSessionId: data.viewerSessionId ?? null,
    viewerHeartbeatAt: data.viewerHeartbeatAt ?? null,
  };
}

/** Delete a cloud line (password-protected). Use for admin/testing. */
export async function deleteCloudLine(lineId: string, password: string): Promise<void> {
  const supabase = getClient();
  const { data, error } = await supabase.functions.invoke<{ ok?: boolean; error?: string }>(
    'delete-line',
    { body: { lineId, password } }
  );
  if (error) {
    const message = await getFunctionErrorMessage(error, 'delete-line');
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
}

/** Thrown when save is rejected because only the active viewer may edit (403). */
export class CloudNotEditorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CloudNotEditorError';
  }
}

/** Thrown when save is rejected because someone else saved first (409). Refetch and reload. */
export class CloudConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CloudConflictError';
  }
}

/** Save a cloud line's state (password-protected). Pass expectedUpdatedAt from last getLineState to avoid overwriting newer saves. */
export async function setLineState(
  lineId: string,
  password: string,
  rootState: RootState,
  expected?: string | { updatedAt?: string; version?: number; editorSessionId?: string }
): Promise<{ updatedAt: string; version?: number } | void> {
  const supabase = getClient();
  const expectedUpdatedAt = typeof expected === 'string' ? expected : expected?.updatedAt;
  const expectedVersion = typeof expected === 'object' ? expected.version : undefined;
  const editorSessionId = typeof expected === 'object' ? expected.editorSessionId : undefined;
  const base =
    expectedUpdatedAt != null || expectedVersion != null
      ? { lineId, password, rootState, expectedUpdatedAt, expectedVersion }
      : { lineId, password, rootState };
  const body =
    editorSessionId != null && typeof editorSessionId === 'string'
      ? { ...base, editorSessionId }
      : base;
  const { data, error } = await supabase.functions.invoke<{
    ok?: boolean;
    updatedAt?: string;
    version?: number;
    error?: string;
    code?: string;
  }>('set-line-state', { body });
  if (error) {
    const status = (error as { context?: { status?: number } })?.context?.status;
    if (status === 403) {
      const bodyJson = (error as { context?: { json?: () => Promise<{ error?: string; code?: string }> } })?.context?.json;
      const parsed: { error?: string; code?: string } = bodyJson ? await bodyJson().catch(() => ({})) : {};
      if (parsed?.code === 'NOT_EDITOR') {
        throw new CloudNotEditorError(parsed.error ?? 'Only the active viewer can save.');
      }
    }
    if (status === 409) {
      const body = (error as { context?: { json?: () => Promise<{ error?: string }> } })?.context?.json;
      const parsed: { error?: string } = body ? await body().catch(() => ({})) : {};
      throw new CloudConflictError(parsed?.error ?? 'Someone else saved changes. Your view has been updated.');
    }
    const message = await getFunctionErrorMessage(error, 'set-line-state');
    if (message.includes('Someone else saved') || message.includes('409')) {
      throw new CloudConflictError(message);
    }
    throw new Error(message);
  }
  if (data?.error) {
    if (data?.code === 'CONFLICT') throw new CloudConflictError(data.error);
    throw new Error(data.error);
  }
  if (data?.updatedAt) return { updatedAt: data.updatedAt, version: data.version };
}

export type ViewerPresenceAction = 'sync' | 'yeet' | 'release';

export async function viewerPresence(
  lineId: string,
  password: string,
  sessionId: string,
  action: ViewerPresenceAction
): Promise<{ role?: string; ok?: boolean }> {
  const supabase = getClient();
  const { data, error } = await supabase.functions.invoke<{
    ok?: boolean;
    role?: string;
    error?: string;
  }>('viewer-presence', {
    body: { lineId, password, sessionId, action },
  });
  if (error) {
    const message = await getFunctionErrorMessage(error, 'viewer-presence');
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return { role: data?.role, ok: data?.ok };
}

export interface LogDayParams {
  lineId: string;
  password: string;
  workDate: string;
  lineConfig: LineConfig;
  lineState: Pick<
    LineState,
    | 'roster'
    | 'slots'
    | 'leadSlots'
    | 'breakSchedules'
    | 'areaNameOverrides'
    | 'slotLabelsByArea'
    | 'juicedAreas'
    | 'dayNotes'
  >;
  shiftHours?: number;
  notes?: string;
  loggedBy?: string;
}

export async function logDay(params: LogDayParams): Promise<{
  logId: string;
  workDate: string;
  assignmentCount: number;
}> {
  const supabase = getClient();
  const { data, error } = await supabase.functions.invoke<{
    ok?: boolean;
    logId?: string;
    workDate?: string;
    assignmentCount?: number;
    error?: string;
  }>('log-day', {
    body: {
      lineId: params.lineId,
      password: params.password,
      workDate: params.workDate,
      shiftHours: params.shiftHours ?? SHIFT_HOURS,
      notes: params.notes,
      loggedBy: params.loggedBy,
      lineConfig: params.lineConfig,
      lineState: params.lineState,
    },
  });
  if (error) {
    const message = await getFunctionErrorMessage(error, 'log-day');
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  if (!data?.logId) throw new Error('Invalid response from log-day');
  return {
    logId: data.logId,
    workDate: data.workDate ?? params.workDate,
    assignmentCount: data.assignmentCount ?? 0,
  };
}

/** Convenience: build extract input from config + state. */
export function prepareLogDayPayload(lineConfig: LineConfig, lineState: LogDayParams['lineState']) {
  return buildDayLogExtractInput(lineConfig, lineState);
}

export async function listDayLogs(
  lineId: string,
  password: string,
  fromDate?: string,
  toDate?: string
): Promise<DayLogSummary[]> {
  const supabase = getClient();
  const { data, error } = await supabase.functions.invoke<{ logs?: DayLogSummary[]; error?: string }>(
    'list-day-logs',
    { body: { lineId, password, fromDate, toDate } }
  );
  if (error) {
    const message = await getFunctionErrorMessage(error, 'list-day-logs');
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return (data?.logs ?? []).map((l) => ({
    ...l,
    workDate: normalizeWorkDate(l.workDate),
  }));
}

export async function getDayLog(
  lineId: string,
  password: string,
  opts: { logId?: string; workDate?: string }
): Promise<DayLogDetail> {
  const supabase = getClient();
  const { data, error } = await supabase.functions.invoke<{
    log?: DayLogDetail & { snapshot?: Record<string, unknown> };
    assignments?: DayLogAssignment[];
    error?: string;
  }>('get-day-log', {
    body: { lineId, password, logId: opts.logId, workDate: opts.workDate },
  });
  if (error) {
    const message = await getFunctionErrorMessage(error, 'get-day-log');
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  if (!data?.log) throw new Error('Day log not found');
  const log = data.log;
  return {
    id: log.id,
    workDate: normalizeWorkDate(log.workDate),
    loggedAt: log.loggedAt,
    shiftHours: log.shiftHours,
    assignmentCount: log.assignmentCount ?? (data.assignments?.length ?? 0),
    notes: log.notes ?? null,
    loggedBy: log.loggedBy ?? null,
    snapshot: log.snapshot ?? {},
    assignments: data.assignments ?? [],
  };
}

export async function deleteDayLog(
  lineId: string,
  password: string,
  opts: { logId?: string; workDate?: string }
): Promise<void> {
  const supabase = getClient();
  const { data, error } = await supabase.functions.invoke<{ ok?: boolean; error?: string }>('delete-day-log', {
    body: { lineId, password, logId: opts.logId, workDate: opts.workDate },
  });
  if (error) {
    const message = await getFunctionErrorMessage(error, 'delete-day-log');
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  if (!data?.ok) throw new Error('Could not delete day log');
}

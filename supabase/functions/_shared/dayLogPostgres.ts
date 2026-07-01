/**
 * Direct Postgres access for day-log tables (bypasses PostgREST schema cache / PGRST205).
 * Uses SUPABASE_DB_URL provided automatically in deployed Edge Functions.
 */
import postgres from 'https://deno.land/x/postgresjs@v3.4.3/mod.js';
import type { DbDayAssignment } from './dayLogExtract.ts';
import { SHIFT_HOURS } from './shiftHours.ts';

/** postgres.js may return `date` as a JS Date; always emit YYYY-MM-DD for the client. */
export function formatWorkDateIso(value: unknown): string {
  if (value instanceof Date) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(value);
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (m) return m[1];
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getUTCFullYear();
    const mo = String(parsed.getUTCMonth() + 1).padStart(2, '0');
    const d = String(parsed.getUTCDate()).padStart(2, '0');
    return `${y}-${mo}-${d}`;
  }
  return s.slice(0, 10);
}

export function hasDirectDbUrl(): boolean {
  return Boolean(Deno.env.get('SUPABASE_DB_URL'));
}

export async function withPostgres<T>(fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const url = Deno.env.get('SUPABASE_DB_URL');
  if (!url) throw new Error('SUPABASE_DB_URL not available');
  const sql = postgres(url, { prepare: false, max: 1 });
  try {
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function saveDayLogPostgres(
  lineId: string,
  workDate: string,
  snapshot: Record<string, unknown>,
  assignments: DbDayAssignment[],
  opts: { loggedBy?: string | null; notes?: string | null; shiftHours?: number }
): Promise<{ logId: string; assignmentCount: number }> {
  const hours = opts.shiftHours ?? SHIFT_HOURS;
  const nowIso = new Date().toISOString();
  const loggedBy = opts.loggedBy ?? null;
  const notes = opts.notes ?? null;

  return await withPostgres(async (sql) => {
    return await sql.begin(async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        INSERT INTO public.cloud_line_day_logs (
          line_id, work_date, logged_at, logged_by, shift_hours, snapshot, notes
        ) VALUES (
          ${lineId}::uuid,
          ${workDate}::date,
          ${nowIso}::timestamptz,
          ${loggedBy},
          ${hours},
          ${tx.json(snapshot)},
          ${notes}
        )
        ON CONFLICT (line_id, work_date) DO UPDATE SET
          logged_at = EXCLUDED.logged_at,
          logged_by = EXCLUDED.logged_by,
          shift_hours = EXCLUDED.shift_hours,
          snapshot = EXCLUDED.snapshot,
          notes = EXCLUDED.notes
        RETURNING id
      `;
      const logId = row.id;
      await tx`DELETE FROM public.cloud_line_day_assignments WHERE log_id = ${logId}::uuid`;

      if (assignments.length > 0) {
        const rows = assignments.map((a) => ({
          log_id: logId,
          line_id: lineId,
          work_date: workDate,
          person_id: a.person_id,
          person_name: a.person_name,
          assignment_type: a.assignment_type,
          area_id: a.area_id,
          area_name: a.area_name,
          slot_index: a.slot_index,
          slot_label: a.slot_label,
          break_rotation: a.break_rotation,
          lunch_rotation: a.lunch_rotation,
          skill_level: a.skill_level,
        }));
        await tx`INSERT INTO public.cloud_line_day_assignments ${tx(rows)}`;
      }

      return { logId, assignmentCount: assignments.length };
    });
  });
}

export type DayLogListRow = {
  id: string;
  workDate: string;
  loggedAt: string;
  shiftHours: number;
  assignmentCount: number;
  notes: string | null;
};

export async function listDayLogsPostgres(
  lineId: string,
  fromDate: string | null,
  toDate: string | null
): Promise<DayLogListRow[]> {
  return await withPostgres(async (sql) => {
    const rows = await sql<{
      id: string;
      work_date: string;
      logged_at: string;
      shift_hours: string;
      notes: string | null;
      assignment_count: number;
    }[]>`
      SELECT
        l.id,
        l.work_date::text AS work_date,
        l.logged_at,
        l.shift_hours,
        l.notes,
        (SELECT COUNT(*)::int FROM public.cloud_line_day_assignments a WHERE a.log_id = l.id) AS assignment_count
      FROM public.cloud_line_day_logs l
      WHERE l.line_id = ${lineId}::uuid
      ${fromDate ? sql`AND l.work_date >= ${fromDate}::date` : sql``}
      ${toDate ? sql`AND l.work_date <= ${toDate}::date` : sql``}
      ORDER BY l.work_date DESC
    `;
    return rows.map((l) => ({
      id: l.id,
      workDate: formatWorkDateIso(l.work_date),
      loggedAt: l.logged_at,
      shiftHours: Number(l.shift_hours ?? SHIFT_HOURS),
      assignmentCount: l.assignment_count ?? 0,
      notes: l.notes,
    }));
  });
}

export async function getDayLogPostgres(
  lineId: string,
  logId: string | null,
  workDate: string | null
): Promise<{
  log: {
    id: string;
    workDate: string;
    loggedAt: string;
    shiftHours: number;
    notes: string | null;
    loggedBy: string | null;
    snapshot: Record<string, unknown>;
    assignmentCount: number;
  };
  assignments: Record<string, unknown>[];
} | null> {
  return await withPostgres(async (sql) => {
    const [log] = logId
      ? await sql<{
          id: string;
          work_date: string;
          logged_at: string;
          shift_hours: string;
          notes: string | null;
          logged_by: string | null;
          snapshot: Record<string, unknown>;
        }[]>`
          SELECT id, work_date::text AS work_date, logged_at, shift_hours, notes, logged_by, snapshot
          FROM public.cloud_line_day_logs
          WHERE line_id = ${lineId}::uuid AND id = ${logId}::uuid
          LIMIT 1
        `
      : await sql<{
          id: string;
          work_date: string;
          logged_at: string;
          shift_hours: string;
          notes: string | null;
          logged_by: string | null;
          snapshot: Record<string, unknown>;
        }[]>`
          SELECT id, work_date::text AS work_date, logged_at, shift_hours, notes, logged_by, snapshot
          FROM public.cloud_line_day_logs
          WHERE line_id = ${lineId}::uuid AND work_date = ${workDate}::date
          LIMIT 1
        `;

    if (!log) return null;

    const assignmentRows = await sql<Record<string, unknown>[]>`
      SELECT
        person_id, person_name, assignment_type, area_id, area_name,
        slot_index, slot_label, break_rotation, lunch_rotation, skill_level
      FROM public.cloud_line_day_assignments
      WHERE log_id = ${log.id}::uuid
      ORDER BY area_name ASC
    `;

    return {
      log: {
        id: log.id,
        workDate: formatWorkDateIso(log.work_date),
        loggedAt: log.logged_at,
        shiftHours: Number(log.shift_hours ?? SHIFT_HOURS),
        notes: log.notes,
        loggedBy: log.logged_by,
        snapshot: log.snapshot ?? {},
        assignmentCount: assignmentRows.length,
      },
      assignments: assignmentRows,
    };
  });
}

export async function deleteDayLogPostgres(
  lineId: string,
  logId: string | null,
  workDate: string | null
): Promise<boolean> {
  return await withPostgres(async (sql) => {
    const rows = logId
      ? await sql<{ id: string }[]>`
          DELETE FROM public.cloud_line_day_logs
          WHERE line_id = ${lineId}::uuid AND id = ${logId}::uuid
          RETURNING id
        `
      : await sql<{ id: string }[]>`
          DELETE FROM public.cloud_line_day_logs
          WHERE line_id = ${lineId}::uuid AND work_date = ${workDate}::date
          RETURNING id
        `;
    return rows.length > 0;
  });
}

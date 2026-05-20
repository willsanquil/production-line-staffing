/** Project ref from SUPABASE_URL (e.g. ecnjhxngexogrggtwhlh). */
export function supabaseProjectRef(): string {
  try {
    const url = Deno.env.get('SUPABASE_URL') ?? '';
    const m = /^https?:\/\/([^.]+)\.supabase\.co/i.exec(url);
    return m?.[1] ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Surface PostgREST / Postgres errors to the client (sanitized). */
export function formatDbError(err: { code?: string; message?: string; details?: string; hint?: string } | null): {
  error: string;
  details?: string;
  hint?: string;
} {
  if (!err) return { error: 'Database error' };
  const msg = err.message ?? 'Unknown database error';
  const code = err.code ?? '';
  const ref = supabaseProjectRef();

  /** Table exists in DB but API has not picked it up yet (common right after running SQL). */
  if (code === 'PGRST205' || msg.includes('schema cache')) {
    return {
      error: 'Day log tables not visible to the API yet',
      details: msg,
      hint: `In SQL Editor for project ${ref}, run: NOTIFY pgrst, 'reload schema'; wait a few seconds, then try Log the day again.`,
    };
  }

  if (code === '42P01' || /relation .* does not exist/i.test(msg)) {
    return {
      error: 'Day log tables are missing',
      details: msg,
      hint: `Run supabase/migrations/20260601000000_cloud_line_day_logs.sql in SQL Editor for project ${ref}. Vercel VITE_SUPABASE_URL must use the same project (https://${ref}.supabase.co).`,
    };
  }

  if (code === '23503') {
    return {
      error: 'Invalid line id',
      details: msg,
      hint: 'The line may have been deleted from the cloud.',
    };
  }

  return { error: 'Could not save day log', details: msg };
}

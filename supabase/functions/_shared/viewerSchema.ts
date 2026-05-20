/**
 * Detect PostgREST / Postgres errors when `cloud_line_data` lacks viewer lock
 * columns (migration `20260511120000_cloud_line_viewer_presence.sql` not applied).
 */
export function isMissingViewerColumnsSchemaError(err: unknown): boolean {
  if (err == null || typeof err !== 'object') return false;
  const e = err as { code?: string; message?: string; details?: string };
  const code = e.code ?? '';
  const text = `${e.message ?? ''} ${e.details ?? ''}`.toLowerCase();
  if (code === '42703') return true;
  if (!text.includes('viewer_session_id') && !text.includes('viewer_heartbeat_at')) return false;
  return (
    text.includes('does not exist') ||
    text.includes('schema cache') ||
    text.includes('could not find')
  );
}

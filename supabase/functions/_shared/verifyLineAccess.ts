import { createAdminClient } from './supabaseAdmin.ts';
import { verifyPassword } from './password.ts';

export async function verifyLinePassword(
  lineId: string,
  password: string
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const supabase = createAdminClient();
  const { data: line, error: errLine } = await supabase
    .from('cloud_lines')
    .select('id, password_hash')
    .eq('id', lineId)
    .single();
  if (errLine || !line) {
    return { ok: false, status: 404, error: 'Line not found' };
  }
  const valid = await verifyPassword(password, line.password_hash);
  if (!valid) {
    return { ok: false, status: 401, error: 'Invalid password' };
  }
  return { ok: true };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseWorkDate(workDate: unknown): string | null {
  if (typeof workDate !== 'string' || !DATE_RE.test(workDate)) return null;
  const d = new Date(`${workDate}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return workDate;
}

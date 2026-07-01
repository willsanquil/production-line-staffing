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
  if (typeof workDate !== 'string') return null;
  const trimmed = workDate.trim();
  if (!trimmed) return null;
  if (DATE_RE.test(trimmed)) {
    const d = new Date(`${trimmed}T12:00:00Z`);
    if (Number.isNaN(d.getTime())) return null;
    return trimmed;
  }
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

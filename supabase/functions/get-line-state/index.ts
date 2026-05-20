import { createAdminClient } from '../_shared/supabaseAdmin.ts';
import { verifyPassword } from '../_shared/password.ts';
import { corsHeadersFor } from '../_shared/cors.ts';
import { buildDefaultRootState } from '../_shared/defaultCloudLineRootState.ts';
import { isMissingViewerColumnsSchemaError } from '../_shared/viewerSchema.ts';

function isNoRowSelectError(err: { code?: string; message?: string; details?: string } | null | undefined): boolean {
  if (!err) return false;
  if (err.code === 'PGRST116') return true;
  const text = `${err.message ?? ''} ${err.details ?? ''}`.toLowerCase();
  return text.includes('0 rows') || text.includes('no rows') || text.includes('multiple (or no)');
}

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  try {
    const { lineId, password } = (await req.json()) as { lineId?: string; password?: string };
    if (!lineId || typeof lineId !== 'string' || !password || typeof password !== 'string') {
      return new Response(
        JSON.stringify({ error: 'lineId and password required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const supabase = createAdminClient();

    const { data: line, error: errLine } = await supabase
      .from('cloud_lines')
      .select('id, password_hash')
      .eq('id', lineId)
      .single();
    if (errLine || !line) {
      return new Response(
        JSON.stringify({ error: 'Line not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const ok = await verifyPassword(password, line.password_hash);
    if (!ok) {
      return new Response(
        JSON.stringify({ error: 'Invalid password' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    /** Use maybeSingle: zero rows returns { data: null, error: null }, so we can heal without relying on PGRST116 alone. */
    const full = await supabase
      .from('cloud_line_data')
      .select('state, updated_at, version, viewer_session_id, viewer_heartbeat_at')
      .eq('line_id', lineId)
      .maybeSingle();

    let row = full.data;
    let errData = full.error;

    if (errData && isMissingViewerColumnsSchemaError(errData)) {
      const legacy = await supabase
        .from('cloud_line_data')
        .select('state, updated_at, version')
        .eq('line_id', lineId)
        .maybeSingle();
      row = legacy.data
        ? {
            ...legacy.data,
            viewer_session_id: null,
            viewer_heartbeat_at: null,
          }
        : null;
      errData = legacy.error;
    }

    /** Orphaned cloud_lines row (no cloud_line_data), e.g. after partial deletes — create empty roster row. */
    const missingDataRow = !row && (!errData || isNoRowSelectError(errData));
    if (missingDataRow) {
      const { data: meta, error: metaErr } = await supabase
        .from('cloud_lines')
        .select('name')
        .eq('id', lineId)
        .single();
      if (!metaErr && meta) {
        const defaultState = buildDefaultRootState(lineId, String(meta.name));
        const nowIso = new Date().toISOString();
        const { error: insErr } = await supabase.from('cloud_line_data').insert({
          line_id: lineId,
          state: defaultState,
          updated_at: nowIso,
          version: 1,
        });
        if (!insErr) {
          row = {
            state: defaultState,
            updated_at: nowIso,
            version: 1,
            viewer_session_id: null,
            viewer_heartbeat_at: null,
          };
          errData = null;
        } else if (insErr.code === '23505') {
          const retry = await supabase
            .from('cloud_line_data')
            .select('state, updated_at, version, viewer_session_id, viewer_heartbeat_at')
            .eq('line_id', lineId)
            .maybeSingle();
          row = retry.data;
          errData = retry.error;
          if (errData && isMissingViewerColumnsSchemaError(errData)) {
            const legacy2 = await supabase
              .from('cloud_line_data')
              .select('state, updated_at, version')
              .eq('line_id', lineId)
              .maybeSingle();
            row = legacy2.data
              ? {
                  ...legacy2.data,
                  viewer_session_id: null,
                  viewer_heartbeat_at: null,
                }
              : null;
            errData = legacy2.error;
          }
        } else {
          console.error('get-line-state heal insert failed', insErr);
          return new Response(
            JSON.stringify({ error: 'Could not restore line data' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }
    }

    if (errData || !row) {
      const code = errData && typeof errData === 'object' && 'code' in errData ? String((errData as { code?: string }).code ?? '') : '';
      const msg =
        errData && typeof errData === 'object' && 'message' in errData
          ? String((errData as { message?: string }).message ?? '').slice(0, 180)
          : '';
      const suffix = code || msg ? ` (${[code, msg].filter(Boolean).join(' ')})` : '';
      return new Response(
        JSON.stringify({ error: `Line data not found${suffix}` }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        rootState: row.state,
        updatedAt: row.updated_at,
        version: row.version ?? 1,
        viewerSessionId: row.viewer_session_id ?? null,
        viewerHeartbeatAt: row.viewer_heartbeat_at ?? null,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    console.error('get-line-state failed', e);
    return new Response(
      JSON.stringify({ error: 'Unexpected server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

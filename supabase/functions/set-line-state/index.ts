import { createAdminClient } from '../_shared/supabaseAdmin.ts';
import { verifyPassword } from '../_shared/password.ts';
import { corsHeadersFor } from '../_shared/cors.ts';
import { validateRootStatePayload } from '../_shared/rootStateValidation.ts';

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  try {
    const body = (await req.json()) as {
      lineId?: string;
      password?: string;
      rootState?: unknown;
      expectedUpdatedAt?: string;
      expectedVersion?: number;
    };
    const { lineId, password, rootState, expectedUpdatedAt, expectedVersion } = body;
    if (!lineId || typeof lineId !== 'string' || !password || typeof password !== 'string') {
      return new Response(
        JSON.stringify({ error: 'lineId and password required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (rootState == null || typeof rootState !== 'object') {
      return new Response(
        JSON.stringify({ error: 'rootState required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const validation = validateRootStatePayload(rootState);
    if (!validation.ok) {
      return new Response(
        JSON.stringify({ error: validation.error ?? 'Invalid rootState' }),
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

    const { data: existingData, error: errExisting } = await supabase
      .from('cloud_line_data')
      .select('version')
      .eq('line_id', lineId)
      .single();
    if (errExisting || !existingData) {
      return new Response(
        JSON.stringify({ error: 'Line data not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const currentVersion = typeof existingData.version === 'number' ? existingData.version : 1;
    const newUpdatedAt = new Date().toISOString();
    let query = supabase
      .from('cloud_line_data')
      .update({ state: rootState, updated_at: newUpdatedAt, version: currentVersion + 1 })
      .eq('line_id', lineId);
    if (expectedVersion != null && Number.isInteger(expectedVersion)) {
      query = query.eq('version', expectedVersion);
    }
    if (expectedUpdatedAt != null && typeof expectedUpdatedAt === 'string') {
      query = query.eq('updated_at', expectedUpdatedAt);
    }
    const { data: updatedRows, error: errUpdate } = await query.select('line_id');
    if (errUpdate) {
      return new Response(
        JSON.stringify({ error: 'Could not save line state' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if ((expectedUpdatedAt != null || expectedVersion != null) && (!updatedRows || updatedRows.length === 0)) {
      return new Response(
        JSON.stringify({
          error: 'Someone else saved changes to this line. Your view has been updated.',
          code: 'CONFLICT',
        }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    await supabase
      .from('cloud_line_revisions')
      .insert({ line_id: lineId, version: currentVersion + 1, state: rootState });

    return new Response(
      JSON.stringify({ ok: true, updatedAt: newUpdatedAt, version: currentVersion + 1 }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    console.error('set-line-state failed', e);
    return new Response(
      JSON.stringify({ error: 'Unexpected server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

import { createAdminClient } from '../_shared/supabaseAdmin.ts';
import { verifyPassword } from '../_shared/password.ts';
import { corsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  try {
    const body = (await req.json()) as {
      lineId?: string;
      password?: string;
      rootState?: unknown;
      expectedUpdatedAt?: string;
    };
    const { lineId, password, rootState, expectedUpdatedAt } = body;
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

    const newUpdatedAt = new Date().toISOString();
    let query = supabase
      .from('cloud_line_data')
      .update({ state: rootState, updated_at: newUpdatedAt })
      .eq('line_id', lineId);
    if (expectedUpdatedAt != null && typeof expectedUpdatedAt === 'string') {
      query = query.eq('updated_at', expectedUpdatedAt);
    }
    const { data: updatedRows, error: errUpdate } = await query.select('line_id');
    if (errUpdate) {
      return new Response(
        JSON.stringify({ error: errUpdate.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (expectedUpdatedAt != null && (!updatedRows || updatedRows.length === 0)) {
      return new Response(
        JSON.stringify({
          error: 'Someone else saved changes to this line. Your view has been updated.',
          code: 'CONFLICT',
        }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ ok: true, updatedAt: newUpdatedAt }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: String(e) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

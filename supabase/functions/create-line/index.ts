import { createAdminClient } from '../_shared/supabaseAdmin.ts';
import { hashPassword } from '../_shared/password.ts';
import { corsHeadersFor } from '../_shared/cors.ts';
import { buildDefaultRootState } from '../_shared/defaultCloudLineRootState.ts';
import { normalizeRootStateForCloudLine, validateRootStatePayload } from '../_shared/rootStateValidation.ts';

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  try {
    const body = (await req.json()) as { name?: string; password?: string; rootState?: unknown };
    const { name, password, rootState: providedState } = body;
    if (!name || typeof name !== 'string' || !password || typeof password !== 'string') {
      return new Response(
        JSON.stringify({ error: 'name and password required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const supabase = createAdminClient();
    const lineId = crypto.randomUUID();
    const passwordHash = await hashPassword(password);
    const rootState =
      providedState && typeof providedState === 'object' && providedState !== null
        ? normalizeRootStateForCloudLine(
            providedState as { currentLineId: string; lines: unknown[]; lineStates: Record<string, unknown> },
            lineId,
            name
          )
        : buildDefaultRootState(lineId, name);
    const validation = validateRootStatePayload(rootState);
    if (!validation.ok) {
      return new Response(
        JSON.stringify({ error: validation.error ?? 'Invalid rootState' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { error: errLine } = await supabase.from('cloud_lines').insert({
      id: lineId,
      name: name.trim() || 'New Line',
      password_hash: passwordHash,
    });
    if (errLine) {
      return new Response(
        JSON.stringify({ error: 'Could not create line' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { error: errData } = await supabase.from('cloud_line_data').insert({
      line_id: lineId,
      state: rootState,
    });
    if (errData) {
      await supabase.from('cloud_lines').delete().eq('id', lineId);
      return new Response(
        JSON.stringify({ error: 'Could not initialize line data' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ lineId, name: name.trim() || 'New Line', rootState, version: 1 }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    console.error('create-line failed', e);
    return new Response(
      JSON.stringify({ error: 'Unexpected server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

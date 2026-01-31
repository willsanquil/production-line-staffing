import { createAdminClient } from '../_shared/supabaseAdmin.ts';
import { verifyPassword } from '../_shared/password.ts';
import { corsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req) => {
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

    const { error: errData } = await supabase.from('cloud_line_data').delete().eq('line_id', lineId);
    if (errData) {
      return new Response(
        JSON.stringify({ error: errData.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { error: errLineDelete } = await supabase.from('cloud_lines').delete().eq('id', lineId);
    if (errLineDelete) {
      return new Response(
        JSON.stringify({ error: errLineDelete.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ ok: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: String(e) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

import { createAdminClient } from '../_shared/supabaseAdmin.ts';
import { verifyPassword } from '../_shared/password.ts';
import { corsHeadersFor } from '../_shared/cors.ts';

/** Must match client idle kick and set-line-state editor check. */
const VIEWER_STALE_MS = 10 * 60 * 1000;

function isHeartbeatStale(iso: string | null | undefined): boolean {
  if (!iso) return true;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) || Date.now() - t > VIEWER_STALE_MS;
}

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  try {
    const body = (await req.json()) as {
      lineId?: string;
      password?: string;
      sessionId?: string;
      action?: string;
    };
    const { lineId, password, sessionId, action } = body;
    if (!lineId || typeof lineId !== 'string' || !password || typeof password !== 'string') {
      return new Response(JSON.stringify({ error: 'lineId and password required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!sessionId || typeof sessionId !== 'string') {
      return new Response(JSON.stringify({ error: 'sessionId required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const act = action === 'yeet' || action === 'release' || action === 'sync' ? action : 'sync';

    const supabase = createAdminClient();

    const { data: line, error: errLine } = await supabase
      .from('cloud_lines')
      .select('id, password_hash')
      .eq('id', lineId)
      .single();
    if (errLine || !line) {
      return new Response(JSON.stringify({ error: 'Line not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const ok = await verifyPassword(password, line.password_hash);
    if (!ok) {
      return new Response(JSON.stringify({ error: 'Invalid password' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: row, error: errData } = await supabase
      .from('cloud_line_data')
      .select('viewer_session_id, viewer_heartbeat_at')
      .eq('line_id', lineId)
      .single();
    if (errData || !row) {
      return new Response(JSON.stringify({ error: 'Line data not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const nowIso = new Date().toISOString();

    if (act === 'release') {
      if (row.viewer_session_id === sessionId) {
        await supabase
          .from('cloud_line_data')
          .update({ viewer_session_id: null, viewer_heartbeat_at: null })
          .eq('line_id', lineId)
          .eq('viewer_session_id', sessionId);
      }
      return new Response(JSON.stringify({ ok: true, role: 'released' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (act === 'yeet') {
      await supabase
        .from('cloud_line_data')
        .update({ viewer_session_id: sessionId, viewer_heartbeat_at: nowIso })
        .eq('line_id', lineId);
      return new Response(JSON.stringify({ ok: true, role: 'editor' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // sync: claim if stale / empty / same session renews
    const stale = isHeartbeatStale(row.viewer_heartbeat_at as string | null);
    const same = row.viewer_session_id === sessionId;
    const empty = row.viewer_session_id == null;
    if (stale || empty || same) {
      await supabase
        .from('cloud_line_data')
        .update({ viewer_session_id: sessionId, viewer_heartbeat_at: nowIso })
        .eq('line_id', lineId);
      return new Response(JSON.stringify({ ok: true, role: 'editor' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: true, role: 'readonly' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('viewer-presence failed', e);
    return new Response(JSON.stringify({ error: 'Unexpected server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

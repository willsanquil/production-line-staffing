import { createAdminClient } from '../_shared/supabaseAdmin.ts';
import { corsHeadersFor } from '../_shared/cors.ts';
import { parseWorkDate, verifyLinePassword } from '../_shared/verifyLineAccess.ts';
import { formatDbError, formatPostgresJsError } from '../_shared/pgError.ts';
import { deleteDayLogPostgres, hasDirectDbUrl } from '../_shared/dayLogPostgres.ts';

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  try {
    const body = (await req.json()) as {
      lineId?: string;
      password?: string;
      logId?: string;
      workDate?: string;
    };
    const { lineId, password, logId, workDate: workDateRaw } = body;
    if (!lineId || typeof lineId !== 'string' || !password || typeof password !== 'string') {
      return new Response(JSON.stringify({ error: 'lineId and password required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!logId && !workDateRaw) {
      return new Response(JSON.stringify({ error: 'logId or workDate required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const auth = await verifyLinePassword(lineId, password);
    if (!auth.ok) {
      return new Response(JSON.stringify({ error: auth.error }), {
        status: auth.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const workDate = !logId && workDateRaw ? parseWorkDate(workDateRaw) : null;
    if (!logId && workDateRaw && !workDate) {
      return new Response(JSON.stringify({ error: 'workDate must be YYYY-MM-DD' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (hasDirectDbUrl()) {
      try {
        const deleted = await deleteDayLogPostgres(
          lineId,
          logId && typeof logId === 'string' ? logId : null,
          workDate
        );
        if (!deleted) {
          return new Response(JSON.stringify({ error: 'Day log not found' }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (e) {
        console.error('delete-day-log postgres failed', e);
        return new Response(JSON.stringify(formatPostgresJsError(e)), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const supabase = createAdminClient();
    let targetId = logId && typeof logId === 'string' ? logId : null;
    if (!targetId && workDate) {
      const { data: row, error: findErr } = await supabase
        .from('cloud_line_day_logs')
        .select('id')
        .eq('line_id', lineId)
        .eq('work_date', workDate)
        .maybeSingle();
      if (findErr) {
        return new Response(JSON.stringify(formatDbError(findErr)), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      targetId = row?.id as string | null;
    }
    if (!targetId) {
      return new Response(JSON.stringify({ error: 'Day log not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { error: delErr } = await supabase.from('cloud_line_day_logs').delete().eq('id', targetId);
    if (delErr) {
      console.error('delete-day-log failed', delErr);
      return new Response(JSON.stringify(formatDbError(delErr)), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('delete-day-log failed', e);
    return new Response(JSON.stringify({ error: 'Unexpected server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

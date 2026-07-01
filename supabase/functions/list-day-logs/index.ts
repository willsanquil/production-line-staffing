import { createAdminClient } from '../_shared/supabaseAdmin.ts';
import { corsHeadersFor } from '../_shared/cors.ts';
import { parseWorkDate, verifyLinePassword } from '../_shared/verifyLineAccess.ts';
import { SHIFT_HOURS } from '../_shared/shiftHours.ts';
import { formatPostgresJsError } from '../_shared/pgError.ts';
import { hasDirectDbUrl, listDayLogsPostgres } from '../_shared/dayLogPostgres.ts';

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  try {
    const body = (await req.json()) as {
      lineId?: string;
      password?: string;
      fromDate?: string;
      toDate?: string;
    };
    const { lineId, password, fromDate: fromRaw, toDate: toRaw } = body;
    if (!lineId || typeof lineId !== 'string' || !password || typeof password !== 'string') {
      return new Response(JSON.stringify({ error: 'lineId and password required' }), {
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

    const fromDate = fromRaw != null && fromRaw !== '' ? parseWorkDate(fromRaw) : null;
    const toDate = toRaw != null && toRaw !== '' ? parseWorkDate(toRaw) : null;
    if (fromRaw && !fromDate) {
      return new Response(JSON.stringify({ error: 'fromDate must be YYYY-MM-DD' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (toRaw && !toDate) {
      return new Response(JSON.stringify({ error: 'toDate must be YYYY-MM-DD' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (hasDirectDbUrl()) {
      try {
        const logs = await listDayLogsPostgres(lineId, fromDate, toDate);
        return new Response(JSON.stringify({ logs }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (e) {
        console.error('list-day-logs postgres failed', e);
        return new Response(JSON.stringify(formatPostgresJsError(e)), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const supabase = createAdminClient();
    let query = supabase
      .from('cloud_line_day_logs')
      .select('id, work_date, logged_at, shift_hours, notes')
      .eq('line_id', lineId)
      .order('work_date', { ascending: false });

    if (fromDate) query = query.gte('work_date', fromDate);
    if (toDate) query = query.lte('work_date', toDate);

    const { data: logs, error: logsErr } = await query;
    if (logsErr) {
      console.error('list-day-logs failed', logsErr);
      return new Response(JSON.stringify({ error: 'Could not list day logs' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const ids = (logs ?? []).map((l) => l.id as string);
    const counts = new Map<string, number>();
    if (ids.length > 0) {
      const { data: rows, error: countErr } = await supabase
        .from('cloud_line_day_assignments')
        .select('log_id')
        .in('log_id', ids);
      if (!countErr && rows) {
        for (const r of rows) {
          const lid = r.log_id as string;
          counts.set(lid, (counts.get(lid) ?? 0) + 1);
        }
      }
    }

    const result = (logs ?? []).map((l) => ({
      id: l.id,
      workDate: l.work_date,
      loggedAt: l.logged_at,
      shiftHours: Number(l.shift_hours ?? SHIFT_HOURS),
      assignmentCount: counts.get(l.id as string) ?? 0,
      notes: l.notes ?? null,
    }));

    return new Response(JSON.stringify({ logs: result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('list-day-logs failed', e);
    return new Response(JSON.stringify({ error: 'Unexpected server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

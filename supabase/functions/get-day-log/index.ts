import { createAdminClient } from '../_shared/supabaseAdmin.ts';
import { corsHeadersFor } from '../_shared/cors.ts';
import { parseWorkDate, verifyLinePassword } from '../_shared/verifyLineAccess.ts';
import { SHIFT_HOURS } from '../_shared/shiftHours.ts';

function mapAssignment(row: Record<string, unknown>) {
  return {
    personId: row.person_id,
    personName: row.person_name,
    assignmentType: row.assignment_type,
    areaId: row.area_id,
    areaName: row.area_name,
    slotIndex: row.slot_index,
    slotLabel: row.slot_label,
    breakRotation: row.break_rotation,
    lunchRotation: row.lunch_rotation,
    skillLevel: row.skill_level,
  };
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

    const supabase = createAdminClient();
    let logQuery = supabase
      .from('cloud_line_day_logs')
      .select('id, work_date, logged_at, shift_hours, notes, logged_by, snapshot')
      .eq('line_id', lineId);

    if (logId && typeof logId === 'string') {
      logQuery = logQuery.eq('id', logId);
    } else {
      const workDate = parseWorkDate(workDateRaw);
      if (!workDate) {
        return new Response(JSON.stringify({ error: 'workDate must be YYYY-MM-DD' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      logQuery = logQuery.eq('work_date', workDate);
    }

    const { data: log, error: logErr } = await logQuery.maybeSingle();
    if (logErr) {
      console.error('get-day-log failed', logErr);
      return new Response(JSON.stringify({ error: 'Could not load day log' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!log) {
      return new Response(JSON.stringify({ error: 'Day log not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: assignmentRows, error: aErr } = await supabase
      .from('cloud_line_day_assignments')
      .select(
        'person_id, person_name, assignment_type, area_id, area_name, slot_index, slot_label, break_rotation, lunch_rotation, skill_level'
      )
      .eq('log_id', log.id)
      .order('area_name', { ascending: true });

    if (aErr) {
      console.error('get-day-log assignments failed', aErr);
      return new Response(JSON.stringify({ error: 'Could not load assignments' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({
        log: {
          id: log.id,
          workDate: log.work_date,
          loggedAt: log.logged_at,
          shiftHours: Number(log.shift_hours ?? SHIFT_HOURS),
          notes: log.notes ?? null,
          loggedBy: log.logged_by ?? null,
          assignmentCount: (assignmentRows ?? []).length,
          snapshot: log.snapshot ?? {},
        },
        assignments: (assignmentRows ?? []).map((r) => mapAssignment(r as Record<string, unknown>)),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    console.error('get-day-log failed', e);
    return new Response(JSON.stringify({ error: 'Unexpected server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

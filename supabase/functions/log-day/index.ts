import { createAdminClient } from '../_shared/supabaseAdmin.ts';
import { corsHeadersFor } from '../_shared/cors.ts';
import { buildDayLogSnapshotJson, extractDayAssignmentsDb } from '../_shared/dayLogExtract.ts';
import { parseWorkDate, verifyLinePassword } from '../_shared/verifyLineAccess.ts';
import { SHIFT_HOURS } from '../_shared/shiftHours.ts';
import { formatDbError, formatPostgresJsError } from '../_shared/pgError.ts';
import { hasDirectDbUrl, saveDayLogPostgres } from '../_shared/dayLogPostgres.ts';

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  try {
    const body = (await req.json()) as {
      lineId?: string;
      password?: string;
      workDate?: string;
      shiftHours?: number;
      notes?: string;
      loggedBy?: string;
      lineConfig?: unknown;
      lineState?: unknown;
    };
    const { lineId, password, workDate: workDateRaw, notes, loggedBy, lineConfig, lineState } = body;
    if (!lineId || typeof lineId !== 'string' || !password || typeof password !== 'string') {
      return new Response(JSON.stringify({ error: 'lineId and password required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const workDate = parseWorkDate(workDateRaw);
    if (!workDate) {
      return new Response(JSON.stringify({ error: 'workDate required (YYYY-MM-DD)' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (lineConfig == null || typeof lineConfig !== 'object' || lineState == null || typeof lineState !== 'object') {
      return new Response(JSON.stringify({ error: 'lineConfig and lineState required' }), {
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

    const cfg = lineConfig as {
      id: string;
      name: string;
      areas: { id: string; name: string; defaultSlotLabels?: string[] }[];
      floatSlots?: { id: string; name: string; supportedAreaIds: string[] }[];
      leadAreaIds?: string[];
      leadSlotNames?: string[];
      combinedSections: [string, string][];
      breaksScope?: 'line' | 'station';
      breakRotations?: number;
    };
    const st = lineState as {
      roster: { id: string; name: string; skills: Record<string, string> }[];
      slots: Record<string, { personId: string | null; disabled?: boolean }[]>;
      leadSlots: Record<string, string | null>;
      breakSchedules?: Record<string, Record<string, { breakRotation: number; lunchRotation: number }>>;
      areaNameOverrides?: Record<string, string>;
      slotLabelsByArea?: Record<string, string[]>;
      juicedAreas?: Record<string, boolean>;
      dayNotes?: string;
    };

    const extractInput = {
      lineConfig: cfg,
      roster: st.roster ?? [],
      slots: st.slots ?? {},
      leadSlots: st.leadSlots ?? {},
      breakSchedules: st.breakSchedules,
      areaNameOverrides: st.areaNameOverrides,
      slotLabelsByArea: st.slotLabelsByArea,
    };
    const assignments = extractDayAssignmentsDb(extractInput);
    const snapshot = buildDayLogSnapshotJson({
      ...extractInput,
      juicedAreas: st.juicedAreas,
      dayNotes: st.dayNotes,
    });

    const notesVal = typeof notes === 'string' ? notes : st.dayNotes ?? null;
    const loggedByVal = typeof loggedBy === 'string' ? loggedBy : null;

    if (hasDirectDbUrl()) {
      try {
        const { logId, assignmentCount } = await saveDayLogPostgres(lineId, workDate, snapshot, assignments, {
          loggedBy: loggedByVal,
          notes: notesVal,
          shiftHours: SHIFT_HOURS,
        });
        return new Response(
          JSON.stringify({
            ok: true,
            logId,
            workDate,
            assignmentCount,
            replaced: true,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } catch (e) {
        console.error('log-day postgres failed', e);
        return new Response(JSON.stringify(formatPostgresJsError(e)), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const hours = SHIFT_HOURS;
    const nowIso = new Date().toISOString();
    const supabase = createAdminClient();

    const rowPayload = {
      line_id: lineId,
      work_date: workDate,
      logged_at: nowIso,
      logged_by: loggedByVal,
      shift_hours: hours,
      snapshot,
      notes: notesVal,
    };

    const { data: existing, error: existErr } = await supabase
      .from('cloud_line_day_logs')
      .select('id')
      .eq('line_id', lineId)
      .eq('work_date', workDate)
      .maybeSingle();

    if (existErr) {
      console.error('log-day lookup failed', existErr);
      return new Response(JSON.stringify(formatDbError(existErr)), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let logId: string;
    if (existing?.id) {
      const { data: updated, error: updErr } = await supabase
        .from('cloud_line_day_logs')
        .update(rowPayload)
        .eq('id', existing.id)
        .select('id')
        .single();
      if (updErr || !updated?.id) {
        console.error('log-day update failed', updErr);
        return new Response(JSON.stringify(formatDbError(updErr)), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      logId = updated.id as string;
    } else {
      const { data: inserted, error: insErr } = await supabase
        .from('cloud_line_day_logs')
        .insert(rowPayload)
        .select('id')
        .single();
      if (insErr || !inserted?.id) {
        console.error('log-day insert failed', insErr);
        return new Response(JSON.stringify(formatDbError(insErr)), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      logId = inserted.id as string;
    }
    await supabase.from('cloud_line_day_assignments').delete().eq('log_id', logId);

    if (assignments.length > 0) {
      const { error: insErr } = await supabase.from('cloud_line_day_assignments').insert(
        assignments.map((a) => ({
          ...a,
          log_id: logId,
          line_id: lineId,
          work_date: workDate,
        }))
      );
      if (insErr) {
        console.error('log-day assignments insert failed', insErr);
        const errBody = formatDbError(insErr);
        errBody.error = 'Could not save assignments';
        return new Response(JSON.stringify(errBody), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        logId,
        workDate,
        assignmentCount: assignments.length,
        replaced: true,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    console.error('log-day failed', e);
    return new Response(JSON.stringify({ error: 'Unexpected server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

import { createAdminClient } from '../_shared/supabaseAdmin.ts';
import { hashPassword } from '../_shared/password.ts';
import { corsHeaders } from '../_shared/cors.ts';

function nanoid(): string {
  return Math.random().toString(36).slice(2, 11);
}

/** Minimal default line config and empty state for a new cloud line. */
function buildDefaultRootState(lineId: string, lineName: string) {
  const areaId = 'area_general';
  const config = {
    id: lineId,
    name: lineName.trim() || 'New Line',
    areas: [
      { id: areaId, name: 'General', minSlots: 1, maxSlots: 10, requiresTrainedOrExpert: true },
    ],
    leadAreaIds: [] as string[],
    combinedSections: [] as [string, string][],
    breaksEnabled: true,
    breaksScope: 'line' as const,
    breakRotations: 3,
  };
  const slots: Record<string, { id: string; personId: string | null }[]> = {};
  slots[areaId] = [{ id: nanoid(), personId: null }];
  const sectionTasks: Record<string, unknown[]> = {};
  sectionTasks[areaId] = [];
  const schedule = Array.from({ length: 12 }, (_, i) => ({
    hour: i + 6,
    taskList: [],
    breakRotation: undefined,
    lunchRotation: undefined,
  }));
  const lineState = {
    roster: [],
    slots,
    leadSlots: {},
    juicedAreas: {},
    deJuicedAreas: {},
    sectionTasks,
    schedule,
    dayNotes: '',
    documents: [],
    breakSchedules: {},
    areaCapacityOverrides: {},
    areaNameOverrides: {},
    slotLabelsByArea: {},
  };
  return {
    currentLineId: lineId,
    lines: [config],
    lineStates: { [lineId]: lineState },
  };
}

Deno.serve(async (req) => {
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
        ? (providedState as { currentLineId: string; lines: unknown[]; lineStates: Record<string, unknown> })
        : buildDefaultRootState(lineId, name);

    const { error: errLine } = await supabase.from('cloud_lines').insert({
      id: lineId,
      name: name.trim() || 'New Line',
      password_hash: passwordHash,
    });
    if (errLine) {
      return new Response(
        JSON.stringify({ error: errLine.message }),
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
        JSON.stringify({ error: errData.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ lineId, name: name.trim() || 'New Line', rootState }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: String(e) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

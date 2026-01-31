import type { LineState, RosterPerson } from '../types';

/** Roster to show for a line: own people not flexed away + people flexed in from other lines. */
export function getRosterForLine(lineId: string, lineStates: Record<string, LineState>): RosterPerson[] {
  const own = (lineStates[lineId]?.roster ?? []).filter((p) => !p.flexedToLineId);
  const flexedIn = getFlexedInToLine(lineId, lineStates);
  return [...own, ...flexedIn];
}

/** People who are flexed TO this line (from other lines). Use for a visible "Flex pool" section. */
export function getFlexedInToLine(lineId: string, lineStates: Record<string, LineState>): RosterPerson[] {
  const flexedIn: RosterPerson[] = [];
  for (const [otherLineId, state] of Object.entries(lineStates)) {
    if (otherLineId === lineId) continue;
    const roster = state?.roster ?? [];
    for (const p of roster) {
      if (p.flexedToLineId === lineId) flexedIn.push(p);
    }
  }
  return flexedIn;
}

/** Set of person IDs who are flexed in to this line (for splitting Staff vs Flex pool in UI). */
export function getFlexedInPersonIds(lineId: string, lineStates: Record<string, LineState>): Set<string> {
  const ids = new Set<string>();
  for (const p of getFlexedInToLine(lineId, lineStates)) ids.add(p.id);
  return ids;
}

/** Build display label for a person including status flags: Absent, Lead, OT, Late, Leave early. */
export function formatPersonStatusLabel(p: RosterPerson): string {
  const parts: string[] = [];
  if (p.absent) parts.push('Absent');
  if (p.lead) parts.push('Lead');
  if (p.ot) parts.push('OT');
  if (p.late) parts.push('Late');
  if (p.leavingEarly) parts.push('Leave early');
  const suffix = parts.length ? ` (${parts.join(', ')})` : '';
  return p.name + suffix;
}

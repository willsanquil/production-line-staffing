import type { LineState, RosterPerson } from '../types';

/** Roster shown for a line (home-line roster only). */
export function getRosterForLine(lineId: string, lineStates: Record<string, LineState>): RosterPerson[] {
  return lineStates[lineId]?.roster ?? [];
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

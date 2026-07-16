import { SKILL_SCORE } from './skill';
import type { AreaId, SkillLevel, SlotsByArea } from '../types';

/** Overall line health: average knowledge (0–3) of everyone on the line in their assigned role. */
export function getLineHealthScore(
  slots: SlotsByArea,
  leadSlots: Record<string, string | null>,
  roster: { id: string; skills: Record<AreaId, SkillLevel> | Record<string, SkillLevel> }[],
  areaIds: string[],
  leadSlotKeys: string[]
): number | null {
  let sum = 0;
  let count = 0;
  for (const areaId of areaIds) {
    const areaSlots = slots[areaId] ?? [];
    for (const slot of areaSlots) {
      if (!slot.personId) continue;
      const p = roster.find((r) => r.id === slot.personId);
      if (p) {
        sum += SKILL_SCORE[(p.skills[areaId] as SkillLevel) ?? 'no_experience'];
        count++;
      }
    }
  }
  for (const key of leadSlotKeys) {
    const personId = leadSlots[key];
    if (!personId) continue;
    const p = roster.find((r) => r.id === personId);
    if (p) {
      const areaForSkill = /^\d+$/.test(key) ? areaIds[0] : key;
      sum += SKILL_SCORE[(p.skills[areaForSkill] as SkillLevel) ?? 'no_experience'];
      count++;
    }
  }
  return count > 0 ? sum / count : null;
}

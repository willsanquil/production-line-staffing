import type { SkillLevel } from '../types';

export const SKILL_SCORE: Record<SkillLevel, number> = {
  no_experience: 0,
  training: 1,
  trained: 2,
  expert: 3,
};

export function skillFromAverage(score: number): SkillLevel {
  if (score >= 2.5) return 'expert';
  if (score >= 1.5) return 'trained';
  if (score >= 0.5) return 'training';
  return 'no_experience';
}

import type { AreaId, RosterPerson, SkillLevel } from '../types';
import { AREA_IDS } from '../types';

const NAMES = [
  'Alex Chen', 'Jordan Smith', 'Sam Rivera', 'Morgan Lee', 'Casey Brown',
  'Riley Davis', 'Avery Wilson', 'Quinn Taylor', 'Parker Martinez', 'Skyler Johnson',
  'Dakota White', 'Jamie Anderson', 'Cameron Thomas', 'Reese Clark', 'Finley Lewis',
  'Hayden Walker', 'Emerson Hall', 'Blake Young', 'Peyton King', 'Rowan Wright',
];

function randomSkill(): SkillLevel {
  const r = Math.random();
  if (r < 0.25) return 'no_experience';
  if (r < 0.55) return 'training';
  if (r < 0.85) return 'trained';
  return 'expert';
}

function seedSkills(): Record<AreaId, SkillLevel> {
  const skills = {} as Record<AreaId, SkillLevel>;
  for (const areaId of AREA_IDS) {
    skills[areaId] = randomSkill();
  }
  return skills;
}

/** Mix of specialists and generalists: some strong in one area, few experts in multiple */
export function buildSeedRoster(): RosterPerson[] {
  const roster: RosterPerson[] = [];
  const usedNames = new Set<string>();

  for (let i = 0; i < NAMES.length; i++) {
    const name = NAMES[i];
    if (usedNames.has(name)) continue;
    usedNames.add(name);

    const skills = seedSkills();
    // Make 2–3 people "broad experts" in several areas (shuffle a copy so we never mutate AREA_IDS)
    if (i < 3) {
      const expertAreas = [...AREA_IDS].sort(() => Math.random() - 0.5).slice(0, 3 + Math.floor(Math.random() * 2));
      for (const a of expertAreas) skills[a] = 'expert';
    }
    // Make a few people have more "no experience" in half the areas
    if (i >= 15 && i < 19) {
      const weakAreas = [...AREA_IDS].sort(() => Math.random() - 0.5).slice(0, 4);
      for (const a of weakAreas) skills[a] = 'no_experience';
    }

    roster.push({
      id: `person-${i + 1}`,
      name,
      absent: false,
      lead: false,
      ot: false,
      late: false,
      leavingEarly: false,
      breakPreference: 'no_preference',
      skills,
      areasWantToLearn: [],
    });
  }

  return roster;
}

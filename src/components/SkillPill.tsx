import type { SkillLevel } from '../types';

interface SkillPillProps {
  level: SkillLevel;
  label: string;
  title?: string;
  small?: boolean;
}

export function SkillPill({ level, label, title, small }: SkillPillProps) {
  const safeLevel = level ?? 'no_experience';
  return (
    <span
      className={`skill-pill skill-${safeLevel}`}
      title={title ?? safeLevel}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: small ? '2px 6px' : '4px 8px',
        borderRadius: 6,
        fontSize: small ? '0.8rem' : '0.9rem',
        fontWeight: 500,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

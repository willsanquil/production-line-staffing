import { memo, useMemo, type ReactNode } from 'react';
import type { AreaId, RosterPerson, SkillLevel, SlotsByArea } from '../types';
import { AREA_IDS } from '../types';

interface TrainingReportProps {
  roster: RosterPerson[];
  slots: SlotsByArea;
  areaLabels: Record<AreaId, string>;
  effectiveCapacity: Record<AreaId, { min: number; max: number }>;
  /** Compact list: only no experience / training, with TRAINING REQUEST when they asked to learn that area. */
  presentationMode?: boolean;
  /** For custom lines, pass area IDs. Omit for default IC areas. */
  areaIds?: string[];
}

/** One assignment row: always show (No experience) or (Training) when applicable; optionally "— wanted to learn". */
function formatAssignmentLabel(
  personName: string,
  areaLabel: string,
  skill: SkillLevel,
  wantToLearn: boolean
): ReactNode {
  const skillTag =
    skill === 'no_experience' ? (
      <span style={{ color: '#c0392b', fontWeight: 600 }}> (No experience)</span>
    ) : skill === 'training' ? (
      <span style={{ color: '#b7950b', fontWeight: 600 }}> (Training)</span>
    ) : null;
  const learnTag = wantToLearn ? (
    <span style={{ color: '#2980b9', fontSize: '0.9em' }}> — wanted to learn</span>
  ) : null;
  return (
    <>
      <strong>{personName}</strong> — <strong>{areaLabel}</strong>
      {skillTag}
      {learnTag}
    </>
  );
}

/** Compact presentation line: Name — Area (No experience | Training) [TRAINING REQUEST] */
function PresentationTrainingLine({
  personName,
  areaLabel,
  skill,
  wantToLearn,
}: {
  personName: string;
  areaLabel: string;
  skill: SkillLevel;
  wantToLearn: boolean;
}) {
  const skillLabel = skill === 'no_experience' ? 'No experience' : 'Training';
  return (
    <li style={{ fontSize: '1rem', marginBottom: 4 }}>
      <strong>{personName}</strong> — {areaLabel} ({skillLabel})
      {wantToLearn && (
        <span style={{ marginLeft: 6, fontSize: '0.8rem', fontWeight: 700, color: '#2980b9' }}>
          TRAINING REQUEST
        </span>
      )}
    </li>
  );
}

/** Report: under minimum / disabled slots; all assignments with No experience / Training; who is in an area they wanted to learn. */
function TrainingReportInner({ roster, slots, areaLabels, presentationMode = false, areaIds: areaIdsProp }: TrainingReportProps) {
  const areaIds = areaIdsProp ?? [...AREA_IDS];
  const allAssignments = useMemo(() => {
    const list: { personId: string; personName: string; areaId: AreaId; areaLabel: string; skill: SkillLevel; wantToLearn: boolean }[] = [];
    for (const areaId of areaIds) {
      for (const slot of slots[areaId] ?? []) {
        if (slot.disabled || !slot.personId) continue;
        const person = roster.find((p) => p.id === slot.personId);
        if (!person) continue;
        const skill = person.skills[areaId] ?? 'no_experience';
        const wantToLearn = (person.areasWantToLearn ?? []).includes(areaId);
        list.push({
          personId: person.id,
          personName: person.name,
          areaId,
          areaLabel: areaLabels[areaId],
          skill,
          wantToLearn,
        });
      }
    }
    return list;
  }, [roster, slots, areaLabels, areaIds]);

  const noExperienceOrTraining = useMemo(
    () => allAssignments.filter((a) => a.skill === 'no_experience' || a.skill === 'training'),
    [allAssignments]
  );
  const wantToLearnOnly = useMemo(() => {
    const key = (a: (typeof allAssignments)[0]) => `${a.personId}:${a.areaId}`;
    const inFirst = new Set(noExperienceOrTraining.map(key));
    return allAssignments.filter((a) => a.wantToLearn && !inFirst.has(key(a)));
  }, [allAssignments, noExperienceOrTraining]);

  if (presentationMode) {
    const hasTraining = noExperienceOrTraining.length > 0;
    const hasWantToLearn = wantToLearnOnly.length > 0;
    const hasAny = hasTraining || hasWantToLearn;
    return (
      <section className="line-view" style={{ maxWidth: 520, margin: '0 auto', padding: '0 12px 24px' }}>
        <h2 style={{ margin: '0 0 12px 0', fontSize: '1.35rem', fontWeight: 700 }}>Training Report</h2>
        {!hasAny ? (
          <p style={{ fontSize: '1rem', color: '#666', margin: 0 }}>No one in training.</p>
        ) : (
          <>
            {hasTraining && (
              <>
                <h3 style={{ margin: '12px 0 6px 0', fontSize: '1.1rem', fontWeight: 600 }}>No experience or in training</h3>
                <ul style={{ margin: 0, paddingLeft: '1.25rem', listStyle: 'disc' }}>
                  {noExperienceOrTraining.map(({ personId, personName, areaId, areaLabel, skill, wantToLearn }) => (
                    <PresentationTrainingLine
                      key={`${personId}-${areaId}`}
                      personName={personName}
                      areaLabel={areaLabel}
                      skill={skill}
                      wantToLearn={wantToLearn}
                    />
                  ))}
                </ul>
              </>
            )}
            {hasWantToLearn && (
              <>
                <h3 style={{ margin: '16px 0 6px 0', fontSize: '1.1rem', fontWeight: 600 }}>Assigned to an area they wanted to learn</h3>
                <ul style={{ margin: 0, paddingLeft: '1.25rem', listStyle: 'disc' }}>
                  {wantToLearnOnly.map(({ personId, personName, areaId, areaLabel }) => (
                    <li key={`want-${personId}-${areaId}`} style={{ fontSize: '1rem', marginBottom: 4 }}>
                      <strong>{personName}</strong> — {areaLabel}
                      <span style={{ marginLeft: 6, fontSize: '0.8rem', fontWeight: 700, color: '#2980b9' }}>
                        TRAINING REQUEST
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </section>
    );
  }

  const hasAnyAssignments = allAssignments.length > 0;
  if (!hasAnyAssignments) return null;

  return (
    <section className="section-card" style={{ marginTop: '1rem' }}>
      <h2 style={{ margin: '0 0 0.5rem 0' }}>Assignment report</h2>
      <p style={{ fontSize: '0.9rem', color: '#555', margin: '0 0 0.75rem 0' }}>
        Assignments are tagged when someone is in an area they have <strong>no experience</strong> in or are in <strong>training</strong>. Also shows who is in an area they listed as &quot;want to learn&quot;.
      </p>

      {noExperienceOrTraining.length > 0 && (
        <>
          <h3 style={{ margin: '0.75rem 0 0.35rem 0', fontSize: '1rem' }}>No experience or in training</h3>
          <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.95rem' }}>
            {noExperienceOrTraining.map(({ personId, personName, areaId, areaLabel, skill, wantToLearn }) => (
              <li key={`${personId}-${areaId}`}>
                {formatAssignmentLabel(personName, areaLabel, skill, wantToLearn)}
              </li>
            ))}
          </ul>
        </>
      )}

      {wantToLearnOnly.length > 0 && (
        <>
          <h3 style={{ margin: '0.75rem 0 0.35rem 0', fontSize: '1rem' }}>Assigned to an area they wanted to learn</h3>
          <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.95rem' }}>
            {wantToLearnOnly.map(({ personId, personName, areaId, areaLabel, skill, wantToLearn }) => (
              <li key={`want-${personId}-${areaId}`}>
                {formatAssignmentLabel(personName, areaLabel, skill, wantToLearn)}
              </li>
            ))}
          </ul>
        </>
      )}

      {hasAnyAssignments && noExperienceOrTraining.length === 0 && wantToLearnOnly.length === 0 && (
        <p style={{ fontSize: '0.9rem', fontStyle: 'italic', color: '#666' }}>
          Everyone assigned is Trained or Expert in their area. No one is in an area they listed as &quot;want to learn&quot;.
        </p>
      )}
    </section>
  );
}

export const TrainingReport = memo(TrainingReportInner);

import type { DayLogAssignment, LineConfig } from '../../types';
import { getAreaIds, getLineSections, isCombinedSection } from '../../lib/lineConfig';

interface DayLogPlacementProps {
  lineConfig: LineConfig;
  assignments: DayLogAssignment[];
  areaNameOverrides?: Record<string, string>;
}

function assignmentsForArea(assignments: DayLogAssignment[], areaId: string): DayLogAssignment[] {
  return assignments
    .filter((a) => a.assignmentType === 'primary' && a.areaId === areaId)
    .sort((x, y) => (x.slotIndex ?? 0) - (y.slotIndex ?? 0));
}

function StationCard({
  areaId,
  title,
  rows,
}: {
  areaId: string;
  title: string;
  rows: DayLogAssignment[];
}) {
  return (
    <div key={areaId} className="section-card" style={{ padding: 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>{title}</div>
      {rows.length === 0 ? (
        <span style={{ color: '#888', fontSize: '0.85rem' }}>No assignments</span>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {rows.map((a) => (
            <li key={`${a.slotIndex}-${a.personId}`} style={{ marginBottom: 4, fontSize: '0.9rem' }}>
              {a.slotLabel ? <span style={{ color: '#666' }}>{a.slotLabel}: </span> : null}
              <strong>{a.personName}</strong>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function DayLogPlacement({ lineConfig, assignments, areaNameOverrides }: DayLogPlacementProps) {
  const sections = getLineSections(lineConfig);
  const areaIds = new Set(getAreaIds(lineConfig));
  const leads = assignments.filter((a) => a.assignmentType === 'lead');

  const labelFor = (areaId: string, fallback: string) =>
    areaNameOverrides?.[areaId]?.trim() || fallback;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {leads.length > 0 && (
        <section>
          <h4 style={{ margin: '0 0 8px' }}>Leads</h4>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {leads.map((a) => (
              <li key={`${a.areaId}-${a.personId}`}>
                <strong>{a.areaName}</strong>: {a.personName}
              </li>
            ))}
          </ul>
        </section>
      )}
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
          gap: 12,
        }}
      >
        {sections.flatMap((section) => {
          if (isCombinedSection(section)) {
            return section
              .filter((areaId) => areaIds.has(areaId))
              .map((areaId) => {
                const rows = assignmentsForArea(assignments, areaId);
                const areaMeta = lineConfig.areas.find((a) => a.id === areaId);
                const title = labelFor(areaId, areaMeta?.name ?? areaId);
                return (
                  <StationCard key={areaId} areaId={areaId} title={title} rows={rows} />
                );
              });
          }
          const areaId = section;
          if (!areaIds.has(areaId)) return [];
          const rows = assignmentsForArea(assignments, areaId);
          const areaMeta = lineConfig.areas.find((a) => a.id === areaId);
          const floatMeta = (lineConfig.floatSlots ?? []).find((f) => f.id === areaId);
          const title = labelFor(areaId, floatMeta?.name ?? areaMeta?.name ?? areaId);
          return [<StationCard key={areaId} areaId={areaId} title={title} rows={rows} />];
        })}
      </section>
    </div>
  );
}

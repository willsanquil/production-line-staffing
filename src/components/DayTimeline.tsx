import { memo } from 'react';
import type { ScheduleHour } from '../types';
import { TaskList } from './TaskList';

interface DayTimelineProps {
  schedule: ScheduleHour[];
  onScheduleChange: (schedule: ScheduleHour[]) => void;
}

function formatHour(h: number): string {
  if (h === 0) return '12am';
  if (h < 12) return `${h}am`;
  if (h === 12) return '12pm';
  return `${h - 12}pm`;
}

function DayTimelineInner({ schedule, onScheduleChange }: DayTimelineProps) {
  function updateHour(hour: number, updates: Partial<ScheduleHour>) {
    onScheduleChange(
      schedule.map((block) =>
        block.hour === hour ? { ...block, ...updates } : block
      )
    );
  }

  return (
    <section className="section-card">
      <h2>Day timeline (6am – 6pm)</h2>
      <p style={{ fontSize: '0.9rem', margin: '0 0 8px 0' }}>
        Breaks 8:30am, 2pm, 4pm (15 min, 3 rotations). Lunch 11:30am (30 min, 3 rotations).
      </p>
      <div className="timeline-row">
        {schedule.map((block) => {
          const hasBreak = block.breakRotation != null;
          const hasLunch = block.lunchRotation != null;
          const classes = [
            'timeline-hour',
            hasBreak ? 'has-break' : '',
            hasLunch ? 'has-lunch' : '',
          ].filter(Boolean).join(' ');
          return (
            <div key={block.hour} className={classes}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>
                {formatHour(block.hour)}–{formatHour(block.hour + 1)}
              </div>
              {hasBreak && (
                <div style={{ fontSize: '0.75rem', color: '#b7950b', marginBottom: 2 }}>
                  Break (Slot {block.breakRotation})
                </div>
              )}
              {hasLunch && (
                <div style={{ fontSize: '0.75rem', color: '#2980b9', marginBottom: 2 }}>
                  Lunch (Slot {block.lunchRotation})
                </div>
              )}
              <TaskList
                tasks={block.taskList}
                onChange={(taskList) => updateHour(block.hour, { taskList })}
                placeholder="Task..."
                compact
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}

export const DayTimeline = memo(DayTimelineInner);

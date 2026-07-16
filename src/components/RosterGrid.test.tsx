import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { RosterGrid } from './RosterGrid';
import type { RosterPerson } from '../types';

function makePerson(overrides: Partial<RosterPerson> & { id: string; name: string }): RosterPerson {
  const { id, name, ...rest } = overrides;
  return {
    id,
    name,
    absent: false,
    lead: false,
    ot: false,
    late: false,
    leavingEarly: false,
    skills: {},
    ...rest,
  };
}

function renderRosterGrid(roster: RosterPerson[]) {
  return render(
    <RosterGrid
      roster={roster}
      visible
      areaLabels={{}}
      onToggleVisible={vi.fn()}
      onNameChange={vi.fn()}
      onRemovePerson={vi.fn()}
      onAddPerson={vi.fn()}
      onAddOT={vi.fn()}
      onToggleAbsent={vi.fn()}
      onToggleOT={vi.fn()}
      onToggleOTHereToday={vi.fn()}
      onSkillChange={vi.fn()}
    />
  );
}

describe('RosterGrid', () => {
  it('hides only OT pool when hide OT is toggled', () => {
    renderRosterGrid([
      makePerson({ id: 'staff-1', name: 'Alice Staff' }),
      makePerson({ id: 'ot-1', name: 'Oscar OT', ot: true }),
    ]);

    expect(screen.getByRole('heading', { name: 'Staff' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'OT pool' })).toBeTruthy();

    fireEvent.click(screen.getAllByRole('button', { name: 'Hide OT' })[0]);

    expect(screen.getByRole('heading', { name: 'Staff' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'OT pool' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Show OT' })).toBeTruthy();
  });

  it('filters staff and OT rows by roster search text', () => {
    renderRosterGrid([
      makePerson({ id: 'staff-1', name: 'Alice Staff' }),
      makePerson({ id: 'staff-2', name: 'Bobby Worker' }),
      makePerson({ id: 'ot-1', name: 'Oscar OT', ot: true }),
    ]);

    fireEvent.change(screen.getByLabelText('Search roster'), {
      target: { value: 'os' },
    });

    expect(screen.queryByDisplayValue('Alice Staff')).toBeNull();
    expect(screen.queryByDisplayValue('Bobby Worker')).toBeNull();
    expect(screen.getByDisplayValue('Oscar OT')).toBeTruthy();
  });
});

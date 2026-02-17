import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AreaStaffing } from './AreaStaffing';

describe('AreaStaffing', () => {
  it('shows clear area button and calls handler with area id', () => {
    const onClearArea = vi.fn();

    render(
      <AreaStaffing
        areaId="area_a"
        areaLabel="Area A"
        minSlots={1}
        maxSlots={2}
        slots={[{ id: 's1', personId: 'p1' }]}
        roster={[
          {
            id: 'p1',
            name: 'Pat',
            absent: false,
            lead: false,
            ot: false,
            late: false,
            leavingEarly: false,
            skills: { area_a: 'trained' },
          },
        ]}
        allAssignedPersonIds={new Set(['p1'])}
        leadAssignedPersonIds={new Set()}
        juiced={false}
        deJuiced={false}
        onToggleJuice={vi.fn()}
        onToggleDeJuice={vi.fn()}
        onAreaNameChange={vi.fn()}
        onCapacityChange={vi.fn()}
        onSlotLabelChange={vi.fn()}
        onSlotsChange={vi.fn()}
        onAssign={vi.fn()}
        onClearArea={onClearArea}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Clear area' }));
    expect(onClearArea).toHaveBeenCalledWith('area_a');
  });
});

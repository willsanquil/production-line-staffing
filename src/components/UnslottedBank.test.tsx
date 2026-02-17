import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UnslottedBank } from './UnslottedBank';

describe('UnslottedBank', () => {
  it('shows absent list below unslotted section', () => {
    render(
      <UnslottedBank
        roster={[
          {
            id: 'p1',
            name: 'Alex',
            absent: false,
            lead: false,
            ot: false,
            late: false,
            leavingEarly: false,
            skills: {},
          },
          {
            id: 'p2',
            name: 'Blake',
            absent: true,
            lead: false,
            ot: false,
            late: false,
            leavingEarly: false,
            skills: {},
          },
        ]}
        leadAssignedPersonIds={new Set()}
        allAssignedPersonIds={new Set()}
      />
    );

    expect(screen.getByRole('heading', { name: 'Absent list' })).toBeTruthy();
    expect(screen.getByText('Blake')).toBeTruthy();
  });
});

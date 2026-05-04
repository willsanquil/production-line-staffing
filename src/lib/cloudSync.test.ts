import { describe, expect, it } from 'vitest';
import { shouldPollCloudLine } from './cloudSync';

describe('cloudSync', () => {
  it('does not poll outside active app cloud mode', () => {
    expect(
      shouldPollCloudLine({
        appMode: 'entry',
        cloudLineId: 'line-1',
        password: 'secret',
        saveInProgress: false,
        lastLocalChangeAt: 0,
        now: 20_000,
      })
    ).toBe(false);
  });

  it('skips polling shortly after local edits', () => {
    expect(
      shouldPollCloudLine({
        appMode: 'app',
        cloudLineId: 'line-1',
        password: 'secret',
        saveInProgress: false,
        lastLocalChangeAt: 10_000,
        now: 12_000,
      })
    ).toBe(false);
  });

  it('polls an idle cloud line in app mode', () => {
    expect(
      shouldPollCloudLine({
        appMode: 'app',
        cloudLineId: 'line-1',
        password: 'secret',
        saveInProgress: false,
        lastLocalChangeAt: 1_000,
        now: 20_000,
      })
    ).toBe(true);
  });
});

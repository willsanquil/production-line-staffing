import { describe, expect, it } from 'vitest';
import { parseMode } from './theme';

describe('theme helpers', () => {
  it('parses light/dark modes', () => {
    expect(parseMode('dark')).toBe('dark');
    expect(parseMode('light')).toBe('light');
    expect(parseMode(null)).toBe('light');
  });
});

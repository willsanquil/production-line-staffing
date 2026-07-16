import { describe, expect, it } from 'vitest';
import { parseMode, parseTheme } from './theme';

describe('theme helpers', () => {
  it('parses known themes and falls back to classic', () => {
    expect(parseTheme('classic')).toBe('classic');
    expect(parseTheme('factory')).toBe('factory');
    expect(parseTheme('soft')).toBe('soft');
    expect(parseTheme('nope')).toBe('classic');
    expect(parseTheme(null)).toBe('classic');
  });

  it('parses light/dark modes', () => {
    expect(parseMode('dark')).toBe('dark');
    expect(parseMode('light')).toBe('light');
    expect(parseMode(null)).toBe('light');
  });
});

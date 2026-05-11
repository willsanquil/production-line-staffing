import { describe, it, expect } from 'vitest';
import { buildTeamsClipboardDocument } from './copyHtmlForTeams';

describe('copyHtmlForTeams', () => {
  it('buildTeamsClipboardDocument wraps content and strips exclude nodes', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p style="font-weight:700">Hello</p><button data-teams-copy-exclude type="button">X</button>';
    const { html, plainText } = buildTeamsClipboardDocument(root);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Hello');
    expect(html).not.toContain('data-teams-copy-exclude');
    expect(plainText).toContain('Hello');
    expect(plainText).not.toContain('X');
  });

  it('removes subtrees marked data-teams-copy-exclude (e.g. leads after float schedule)', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<section><p>Keep</p></section><section data-teams-copy-exclude=""><p>Drop</p></section>';
    const { plainText } = buildTeamsClipboardDocument(root);
    expect(plainText).toContain('Keep');
    expect(plainText).not.toContain('Drop');
  });
});

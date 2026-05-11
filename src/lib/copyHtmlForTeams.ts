/**
 * Build rich HTML for Microsoft Teams / Outlook paste: class-based CSS from the app
 * is often dropped, so we clone the visible staffing block, remove UI-only nodes, inline
 * key computed styles, and add legacy table attributes.
 */

const TEAMS_COPY_EXCLUDE = '[data-teams-copy-exclude]';

/** Depth-first element walk; skips subtrees rooted at elements matching `skipSelector`. */
function* dfsElements(root: Element, skipSelector: string | null): Generator<Element> {
  yield root;
  for (const child of root.children) {
    if (skipSelector && (child as Element).matches(skipSelector)) continue;
    yield* dfsElements(child, skipSelector);
  }
}

const CLIPBOARD_STYLE_PROPS = [
  'color',
  'background-color',
  'font-size',
  'font-weight',
  'font-family',
  'font-style',
  'text-align',
  'vertical-align',
  'line-height',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'width',
  'max-width',
  'min-width',
  'display',
  'border-collapse',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-top-style',
  'border-right-style',
  'border-bottom-style',
  'border-left-style',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'border-radius',
] as const;

function mergeComputedStylesOntoClone(orig: HTMLElement, clone: HTMLElement): void {
  const cs = getComputedStyle(orig);
  const parts: string[] = [];
  for (const prop of CLIPBOARD_STYLE_PROPS) {
    const v = cs.getPropertyValue(prop).trim();
    if (!v) continue;
    if (prop.startsWith('border-') && (v === '0px' || v === 'none' || v === 'rgba(0, 0, 0, 0)')) continue;
    if ((prop === 'margin-top' || prop === 'margin-right' || prop === 'margin-bottom' || prop === 'margin-left') && v === '0px') continue;
    parts.push(`${prop}: ${v}`);
  }
  const existing = clone.getAttribute('style')?.trim();
  if (existing) parts.push(existing);
  if (parts.length) clone.setAttribute('style', parts.join('; '));
}

function parallelInlineStyles(origRoot: HTMLElement, cloneRoot: HTMLElement): void {
  const origList = [...dfsElements(origRoot, TEAMS_COPY_EXCLUDE)];
  const cloneList = [...dfsElements(cloneRoot, null)];
  if (origList.length !== cloneList.length) {
    console.warn(
      '[copyHtmlForTeams] DOM shape mismatch after exclude; paste styling may be partial.',
      { orig: origList.length, clone: cloneList.length },
    );
  }
  const n = Math.min(origList.length, cloneList.length);
  for (let i = 0; i < n; i++) {
    const o = origList[i];
    const c = cloneList[i];
    if (o instanceof HTMLElement && c instanceof HTMLElement) {
      mergeComputedStylesOntoClone(o, c);
    }
  }
}

function enhanceTables(clone: HTMLElement): void {
  clone.querySelectorAll('table').forEach((t) => {
    if (!t.getAttribute('border')) t.setAttribute('border', '1');
    if (!t.getAttribute('cellpadding')) t.setAttribute('cellpadding', '6');
    if (!t.getAttribute('cellspacing')) t.setAttribute('cellspacing', '0');
  });
}

export function buildTeamsClipboardDocument(root: HTMLElement): { html: string; plainText: string } {
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(TEAMS_COPY_EXCLUDE).forEach((n) => n.remove());
  parallelInlineStyles(root, clone);
  enhanceTables(clone);

  const inner = clone.outerHTML;
  const plainText = (clone.textContent ?? '').replace(/\u00a0/g, ' ').replace(/\s+\n/g, '\n').trim();

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><div style="font-family:Segoe UI,system-ui,sans-serif;font-size:14px;line-height:1.35;color:#1a1a1a">${inner}</div></body></html>`;

  return { html, plainText };
}

export type CopyTeamsResult = { ok: true } | { ok: false; message: string };

/**
 * Writes `text/html` + `text/plain` to the system clipboard when supported; otherwise plain text only.
 */
export async function copyTeamsPresentationToClipboard(root: HTMLElement): Promise<CopyTeamsResult> {
  if (typeof window === 'undefined' || !root) {
    return { ok: false, message: 'Nothing to copy.' };
  }

  const { html, plainText } = buildTeamsClipboardDocument(root);

  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      const htmlBlob = new Blob([html], { type: 'text/html' });
      const textBlob = new Blob([plainText], { type: 'text/plain' });
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': htmlBlob,
          'text/plain': textBlob,
        }),
      ]);
      return { ok: true };
    }
  } catch (e) {
    console.warn('[copyHtmlForTeams] rich clipboard failed, falling back to text', e);
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(plainText);
      return { ok: true };
    }
  } catch (e) {
    console.warn('[copyHtmlForTeams] writeText failed', e);
  }

  return { ok: false, message: 'Clipboard unavailable. Use a secure (https) page and grant clipboard permission.' };
}

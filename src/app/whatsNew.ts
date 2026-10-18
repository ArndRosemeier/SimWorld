/**
 * The version label and the What's new panel. `whatsNewButton()` sits on the loading screen (plan R2); once the town
 * is up, the menu's "What's new" entry opens the same panel (src/app/shell.ts). The text is CHANGELOG.md, bundled at
 * build time.
 */
import changelogMd from '../../CHANGELOG.md?raw';
import { parseChangelog, type Release } from './changelog';
import { el, openDialog } from './dom';

const RELEASES: Release[] = parseChangelog(changelogMd);

/** This build's version, e.g. "v0.010" (the newest entry in CHANGELOG.md). */
export const VERSION = RELEASES[0]?.version ?? 'dev';

/** A button reading "v0.010 · What's new" that opens the panel. */
export function whatsNewButton(): HTMLButtonElement {
  const b = el('button', 'wn-button', `${VERSION} · What's new`);
  b.type = 'button';
  b.addEventListener('click', openWhatsNew);
  return b;
}

/** Shows every version, newest first. Closes on its button, Escape, or a click outside. */
export function openWhatsNew(): void {
  const close = el('button', 'wn-close', 'Close');
  close.type = 'button';
  const panel = openDialog('wn', "What's new", close);
  if (!panel) return;
  const header = el('div', 'wn-head');
  header.append(el('h2', '', "What's new"), close);
  const list = el('div', 'wn-list');
  for (const r of RELEASES) {
    const item = el('section', 'wn-release');
    const h = el('h3', '');
    h.append(el('span', 'wn-version', r.version), document.createTextNode(` ${r.title}`));
    const ul = el('ul', '');
    for (const n of r.notes) ul.append(el('li', '', n));
    item.append(h, ul);
    list.append(item);
  }
  if (!RELEASES.length) list.append(el('p', '', 'No versions yet.'));
  panel.append(header, list);
}


/**
 * The version label and the What's new panel. `whatsNewButton()` is a self-contained control: the
 * start screen shows it now, and the loading screen / character selector takes it over when it
 * comes (docs/design/simworld-plan.md R2). The text is CHANGELOG.md, bundled at build time.
 */
import changelogMd from '../../CHANGELOG.md?raw';
import { parseChangelog, type Release } from './changelog';

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
  if (document.querySelector('.wn-backdrop')) return;
  const backdrop = el('div', 'wn-backdrop');
  const panel = el('div', 'wn-panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', "What's new");
  const close = el('button', 'wn-close', 'Close');
  close.type = 'button';
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
  backdrop.append(panel);
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') shut(); };
  const shut = (): void => { backdrop.remove(); removeEventListener('keydown', onKey); };
  close.addEventListener('click', shut);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) shut(); });
  addEventListener('keydown', onKey);
  document.body.append(backdrop);
  close.focus();
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

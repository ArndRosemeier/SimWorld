/**
 * The "More about …" window (Arnd, 2026-10-19): everything the town knows about one inhabitant, in plain words and
 * short lists, over the picker or the play panel. The text comes from the sim worker (`detailsOf` in
 * src/chat/details.ts, op `details`) for the town as shown, so it follows the picker's start slider. Secrets are
 * marked as known only to the player. No language model is asked anything here.
 */
import type { PersonDetails } from '../chat/details';
import { button, el, openDialog } from './dom';

/** Open the window for `name`; `load` fetches their details (null: they are no longer in the sim). */
export function openPersonDetails(name: string, when: string, load: () => Promise<PersonDetails | null>): void {
  const close = button('wn-close', 'Close', () => {});
  const panel = openDialog('wn', `About ${name}`, close);
  if (!panel) return;
  panel.classList.add('pd-panel');
  const head = el('div', 'wn-head');
  const title = el('div', 'pd-title');
  const h2 = el('h2', '', name);
  const sub = el('p', 'pd-line', when);
  title.append(h2, sub);
  head.append(title, close);
  const body = el('div', 'wn-list pd-body', 'Asking around town…');
  panel.append(head, body);
  void load().then((d) => {
    if (!panel.isConnected) return;
    if (!d) { body.textContent = 'Nothing more is known about them.'; return; }
    h2.replaceChildren(document.createTextNode(d.name), el('span', 'pd-age', ` ${d.age}`));
    sub.textContent = `${d.line} · ${when}`;
    body.replaceChildren(...d.sections.map((s) => {
      const sec = el('section', 'pd-section');
      sec.append(el('h3', '', s.title));
      if (s.intro) sec.append(el('p', 'pd-intro', s.intro));
      if (s.items.length) {
        const ul = el('ul', '');
        for (const it of s.items) {
          const li = el('li', it.secret ? 'pd-secret' : '');
          if (it.secret) li.append(el('span', 'pd-only', 'Only you know: '));
          li.append(document.createTextNode(it.text));
          if (it.note) li.append(el('span', 'pd-note', ` · ${it.note}`));
          ul.append(li);
        }
        sec.append(ul);
      }
      return sec;
    }));
  }).catch(() => { if (panel.isConnected) body.textContent = 'The town could not be asked just now. Try again in a moment.'; });
}

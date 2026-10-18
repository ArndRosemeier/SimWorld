/**
 * The town's weekly paper, to read in play: the menu's "Paper" entry opens the newest edition as the sim
 * printed it (src/sim/media.ts, through `SimView.media`): the masthead, the front page, the town's news by section,
 * What's on, and the notices up on the boards (lost pets, funerals, coming events). Nothing here is made up on the
 * main thread; before the first edition the panel says the paper is not out yet.
 */
import type { Notice, Section, Story } from '../sim/media';
import type { SimView } from '../sim/view';
import { el, openDialog } from './dom';

const SECTIONS: { id: Section; name: string }[] = [
  { id: 'town', name: 'Around town' },
  { id: 'business', name: 'Business' },
  { id: 'police', name: 'Police news' },
  { id: 'family', name: 'Births, marriages and deaths' },
  { id: 'whatson', name: "What's on" },
];

/** Notices worth a line in the paper's notices column (a shop's window poster is not). */
const COLUMN: readonly Notice['kind'][] = ['lostPet', 'funeral', 'event'];

function story(s: Story, big: boolean): HTMLElement {
  const a = el('article', big ? 'pp-lead' : 'pp-story');
  a.append(el(big ? 'h3' : 'h4', '', s.headline));
  if (s.text) a.append(el('p', '', s.text));
  return a;
}

/** The paper as it stands in `view` (pure DOM, no state). */
function page(view: SimView): HTMLElement {
  const { paper, edition, notices } = view.media;
  const body = el('div', 'pp-body');
  const mast = el('header', 'pp-mast');
  mast.append(el('h2', '', paper));
  body.append(mast);
  if (!edition) {
    body.append(el('p', 'pp-empty', 'This week\'s paper is not out yet.'));
    return body;
  }
  mast.append(el('div', 'pp-dated', `No. ${edition.no} · ${edition.dated}`));
  const front = edition.stories.find((s) => s.section === 'front');
  if (front) body.append(story(front, true));
  else body.append(el('p', 'pp-empty', 'A quiet week in town.'));
  for (const sec of SECTIONS) {
    const items = edition.stories.filter((s) => s.section === sec.id);
    if (!items.length) continue;
    const box = el('section', `pp-section pp-${sec.id}`);
    box.append(el('h5', '', sec.name));
    for (const s of items) box.append(story(s, false));
    body.append(box);
  }
  const column = notices.filter((n) => COLUMN.includes(n.kind));
  if (column.length) {
    const box = el('section', 'pp-section pp-notices');
    box.append(el('h5', '', 'Notices'));
    for (const n of column) {
      const a = el('article', 'pp-story');
      a.append(el('h4', '', n.title), el('p', '', n.lines.join(' · ')));
      box.append(a);
    }
    body.append(box);
  }
  return body;
}

/** Open the paper (from the menu, src/app/shell.ts) with today's edition from the sim's latest view. */
export function openPaper(v: SimView): void {
  const close = el('button', 'pp-close', 'Close');
  close.type = 'button';
  openDialog('pp', v.media.paper, close)?.append(close, page(v));
}

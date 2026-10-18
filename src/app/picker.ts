/**
 * The character picker (D4, plan R2): who will you be? A panel over the live town from above, listing every
 * inhabitant's card (src/sim/profile.ts) with a search, the filters (in love, has a secret, new in town, …), an age
 * band and a sort. Picking someone shows their whole card (secrets marked as known only to you); "Be …" plays as
 * them. The loading screen hands over to it once the town is up; it comes back when the player wants to be
 * someone else.
 */
import { deriveSeed, Rng } from '@futuremagic/core';
import { CARD_FILTERS, type InhabitantCard } from '../sim/profile';
import { el } from './dom';

/** Age bands for the picker's age filter: [label, from, to) in years. */
const AGES: [string, number, number][] = [['Any age', 0, 200], ['Children', 0, 18], ['18 to 34', 18, 35], ['35 to 54', 35, 55], ['55 to 74', 55, 75], ['75 and over', 75, 200]];

/** Sorts: the most going on in their life first (the default), by name, by age. */
const SORTS: [string, (a: InhabitantCard, b: InhabitantCard) => number][] = [
  ['Most going on', (a, b) => story(b) - story(a) || a.name.localeCompare(b.name)],
  ['Name', (a, b) => a.name.localeCompare(b.name)],
  ['Youngest', (a, b) => a.age - b.age || a.name.localeCompare(b.name)],
  ['Oldest', (a, b) => b.age - a.age || a.name.localeCompare(b.name)],
];

/** How much is going on in someone's life (sum of the situations' weights). */
const story = (c: InhabitantCard): number => c.situations.reduce((s, x) => s + x.weight, 0);

/** Cards listed at once; "Show more" adds as many again. */
const PAGE = 120;

export interface PickerOptions {
  seed: number;
  /** Who the player is now, if anyone (offered as "Stay as …"). */
  current?: InhabitantCard | null;
  onPick: (card: InhabitantCard) => void;
  /** Called when the player closes the picker without picking (only offered while they are someone). */
  onClose?: () => void;
}

export class Picker {
  readonly root = el('aside', 'pk-panel');
  private readonly list = el('div', 'pk-list');
  private readonly count = el('span', 'pk-count');
  private readonly search = el('input', 'pk-search');
  private readonly tags = new Set<number>();
  private age = 0;
  private sort = 0;
  private shown = PAGE;
  private open: number | null = null;
  private surprises = 0;

  constructor(private readonly cards: readonly InhabitantCard[], private readonly opts: PickerOptions) {
    this.root.setAttribute('aria-label', 'Choose who to be');
    const head = el('div', 'pk-head');
    head.append(el('h2', '', 'Who will you be?'), this.count);
    if (opts.current && opts.onClose) {
      const stay = el('button', 'pk-stay', `Stay as ${opts.current.name.split(' ')[0]}`);
      stay.type = 'button';
      stay.addEventListener('click', () => opts.onClose?.());
      head.append(stay);
    }
    this.search.type = 'search';
    this.search.placeholder = 'Search names, jobs, streets…';
    this.search.addEventListener('input', () => { this.shown = PAGE; this.render(); });
    const chips = el('div', 'pk-chips');
    for (const f of CARD_FILTERS) {
      const b = el('button', 'pk-chip', f.label);
      b.type = 'button';
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', () => {
        if (this.tags.has(f.tag)) this.tags.delete(f.tag); else this.tags.add(f.tag);
        b.setAttribute('aria-pressed', String(this.tags.has(f.tag)));
        this.shown = PAGE;
        this.render();
      });
      chips.append(b);
    }
    const row = el('div', 'pk-row');
    row.append(select(AGES.map((a) => a[0]), (i) => { this.age = i; this.shown = PAGE; this.render(); }), select(SORTS.map((s) => s[0]), (i) => { this.sort = i; this.render(); }));
    const surprise = el('button', 'pk-surprise', 'Surprise me');
    surprise.type = 'button';
    surprise.addEventListener('click', () => this.surprise());
    row.append(surprise);
    this.root.append(head, this.search, chips, row, this.list);
    this.render();
  }

  /** The cards that pass the search and the filters, sorted. */
  private matching(): InhabitantCard[] {
    const q = this.search.value.trim().toLowerCase();
    const [, from, to] = AGES[this.age];
    let tagMask = 0;
    for (const t of this.tags) tagMask |= t;
    return this.cards
      .filter((c) => c.age >= from && c.age < to && (c.tags & tagMask) === tagMask
        && (!q || `${c.name} ${c.line} ${c.household}`.toLowerCase().includes(q)))
      .sort(SORTS[this.sort][1]);
  }

  private render(): void {
    const all = this.matching();
    this.count.textContent = `${all.length} of ${this.cards.length}`;
    this.list.replaceChildren();
    for (const c of all.slice(0, this.shown)) this.list.append(this.cardEl(c));
    if (all.length > this.shown) {
      const more = el('button', 'pk-more', `Show more (${all.length - this.shown} left)`);
      more.type = 'button';
      more.addEventListener('click', () => { this.shown += PAGE; this.render(); });
      this.list.append(more);
    }
    if (!all.length) this.list.append(el('p', 'pk-none', 'Nobody in town fits all of that.'));
  }

  private cardEl(c: InhabitantCard): HTMLElement {
    const open = this.open === c.id;
    const card = el('article', open ? 'pk-card pk-open' : 'pk-card');
    card.tabIndex = 0;
    const name = el('h3', '');
    name.append(document.createTextNode(c.name), el('span', 'pk-age', ` ${c.age}`));
    card.append(name, el('p', 'pk-line', c.line));
    if (open) {
      card.append(el('p', 'pk-home', c.household));
      const ul = el('ul', 'pk-sits');
      for (const s of c.situations) {
        const li = el('li', s.secret ? 'pk-secret' : '', s.text);
        if (s.secret) li.prepend(el('span', 'pk-only', 'Only you know: '));
        ul.append(li);
      }
      if (c.situations.length) card.append(ul);
      const be = el('button', 'pk-be', `Be ${c.name.split(' ')[0]}`);
      be.type = 'button';
      be.addEventListener('click', (e) => { e.stopPropagation(); this.opts.onPick(c); });
      card.append(be);
    }
    const toggle = (): void => { this.open = open ? null : c.id; this.render(); };
    card.addEventListener('click', toggle);
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    return card;
  }

  /** Open a random card among those that pass the filters (seeded, a new one each press). */
  private surprise(): void {
    const all = this.matching();
    if (!all.length) return;
    const c = all[new Rng(deriveSeed(this.opts.seed, 'surprise', this.surprises++)).int(0, all.length - 1)];
    this.open = c.id;
    const i = all.indexOf(c);
    if (i >= this.shown) this.shown = i + 1;
    this.render();
    this.list.querySelector('.pk-open')?.scrollIntoView({ block: 'nearest' });
  }
}

function select(options: string[], onChange: (i: number) => void): HTMLSelectElement {
  const s = el('select', 'pk-select');
  options.forEach((o, i) => { const opt = el('option', '', o); opt.value = String(i); s.append(opt); });
  s.addEventListener('change', () => onChange(Number(s.value)));
  return s;
}

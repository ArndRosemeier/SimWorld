/**
 * Playing as an inhabitant (plan R5, R4): the panel that says who you are and what you are doing, with the
 * controls of a life lived in real time. Autopilot hands you back to your routine (you walk to work, do your shift)
 * and takes you off it again; "What now?" lists what you could do (here, at home, at work, visiting the people
 * closest to you, the town's places); the time skip moves days on and then shows what you would know of them; and
 * be someone else. Saving and loading are in the menu (src/app/shell.ts). The game (src/game/playing.ts) wires it to the sim.
 */
import type { DigestItem } from '../sim/chronicle';
import type { PlayerAction, PlayerStatus } from '../sim/player';
import { capitalize, type InhabitantCard } from '../sim/profile';
import { NEEDS } from '../sim/species';
import { button, el, onEscape, showToggle } from './dom';

export interface PlayHandlers {
  autopilot: (on: boolean) => void;
  actions: () => Promise<PlayerAction[]>;
  go: (a: PlayerAction) => void;
  skipDays: (days: number) => Promise<void>;
  switchPerson: () => void;
}

/** Time skip lengths offered, in days. */
const SKIPS: [string, number][] = [['A day', 1], ['Three days', 3], ['A week', 7], ['Two weeks', 14], ['A month', 30], ['Three months', 91], ['Half a year', 182], ['A year', 365]];

const NEED_LABEL: Record<string, string> = { food: 'Fed', rest: 'Rested', social: 'Company', hygiene: 'Clean', fun: 'Fun' };

export class PlayPanel {
  readonly root = el('section', 'pl-panel');
  private readonly doing = el('p', 'pl-doing');
  private readonly auto = el('button', 'pl-auto');
  private readonly bars: HTMLElement[] = [];
  private last = '';
  private autopilot = true;
  private menu: HTMLElement | null = null;

  constructor(readonly card: InhabitantCard, private readonly h: PlayHandlers) {
    this.root.setAttribute('aria-label', `Playing as ${card.name}`);
    const name = el('h2', '');
    name.append(document.createTextNode(card.name), el('span', 'pl-age', ` ${card.age}`));
    const needs = el('div', 'pl-needs');
    for (const n of NEEDS) {
      const row = el('div', 'pl-need');
      const bar = el('i', '');
      const track = el('span', 'pl-track');
      track.append(bar);
      row.append(el('span', '', NEED_LABEL[n] ?? n), track);
      needs.append(row);
      this.bars.push(bar);
    }
    this.auto.type = 'button';
    this.auto.addEventListener('click', () => { this.autopilot = !this.autopilot; this.labelAuto(); h.autopilot(this.autopilot); });
    this.labelAuto();
    const buttons = el('div', 'pl-buttons');
    buttons.append(
      this.auto,
      button('', 'What now?', () => void this.openActions()),
      button('', 'Skip time', () => this.openSkip()),
      button('', 'Someone else', () => h.switchPerson()),
    );
    this.root.append(name, el('p', 'pl-occ', card.occupation), this.doing, needs, buttons);
  }

  private labelAuto(): void {
    showToggle(this.auto, this.autopilot, ['Autopilot on', 'Autopilot off'], ['Your routine runs your day. Click to take over.', 'You decide what to do. Click to hand back to your routine.']);
  }

  /** Show the player's status (cheap to call every frame: the DOM changes only when it does). */
  show(s: PlayerStatus): void {
    const key = `${s.doing}|${s.autopilot}|${s.needs.map((n) => Math.round(n * 20)).join(',')}`;
    if (key === this.last) return;
    this.last = key;
    this.doing.textContent = capitalize(s.doing);
    s.needs.forEach((n, i) => { const b = this.bars[i]; if (b) { b.style.width = `${Math.round(n * 100)}%`; b.className = n < 0.25 ? 'pl-low' : ''; } });
    if (s.autopilot !== this.autopilot) { this.autopilot = s.autopilot; this.labelAuto(); }
  }

  private closeMenu(): void {
    this.menu?.remove();
    this.menu = null;
  }

  /** A small window above the panel; closes on its button, Escape, or opening another. */
  private popup(title: string): HTMLElement {
    this.closeMenu();
    const m = el('div', 'pl-menu');
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-label', title);
    const head = el('div', 'pl-menu-head');
    const stop = onEscape(() => close());
    const close = (): void => { stop(); if (this.menu === m) this.closeMenu(); };
    head.append(el('h3', '', title), button('', 'Close', close));
    m.append(head);
    // Just above the panel, however tall it is.
    m.style.bottom = `${Math.round(innerHeight - this.root.getBoundingClientRect().top + 8)}px`;
    document.body.append(m);
    this.menu = m;
    return m;
  }

  private async openActions(): Promise<void> {
    const m = this.popup('What now?');
    const body = el('div', 'pl-menu-body', 'Thinking…');
    m.append(body);
    const actions = await this.h.actions();
    if (this.menu !== m) return;
    body.textContent = '';
    let group = '';
    for (const a of actions) {
      if (a.group !== group) { group = a.group; body.append(el('h4', '', group)); }
      const b = button('', '', () => { this.h.go(a); this.closeMenu(); });
      b.className = a.open ? 'pl-act' : 'pl-act pl-closed';
      b.append(el('span', '', a.label), el('span', 'pl-min', a.open ? (a.minutes ? `${a.minutes} min` : 'here') : 'closed'));
      body.append(b);
    }
    if (!this.autopilot) return;
    body.prepend(el('p', 'pl-note', 'On autopilot you do this, then your routine carries on.'));
  }

  private openSkip(): void {
    const m = this.popup('Skip time');
    const body = el('div', 'pl-menu-body');
    body.append(el('p', 'pl-note', 'Your life goes on without you watching. Afterwards you hear what you would know of it.'));
    for (const [label, days] of SKIPS) {
      body.append(button('', label, async () => {
        body.replaceChildren(el('p', 'pl-note', 'Time passes…'));
        await this.h.skipDays(days);
        if (this.menu === m) this.closeMenu();
      }));
    }
    m.append(body);
  }

  /** What the person knows of the skipped days: lived first, then heard, most important first. */
  showDigest(days: number, items: DigestItem[]): void {
    const m = this.popup(days === 1 ? 'A day later' : `${days} days later`);
    const body = el('div', 'pl-menu-body');
    if (!items.length) body.append(el('p', 'pl-note', 'Nothing much happened that you know of.'));
    const ul = el('ul', 'pl-digest');
    for (const it of items) ul.append(el('li', it.kind === 'heard' ? 'pl-heard' : 'pl-lived', it.text));
    body.append(ul);
    m.append(body);
  }

  /** The person has died or left town. */
  gone(onPick: () => void): void {
    const m = this.popup(`${this.card.name} is gone`);
    const body = el('div', 'pl-menu-body');
    body.append(el('p', 'pl-note', `${this.card.name.split(' ')[0]}'s life in this town has ended. Who will you be now?`), button('', 'Choose someone', () => { this.closeMenu(); onPick(); }));
    m.append(body);
  }

  close(): void {
    this.closeMenu();
    this.root.remove();
  }
}

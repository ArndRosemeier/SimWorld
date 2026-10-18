/**
 * The screen's frame (plan R2, R4): one thin bar along the top with the date, time and weather, and one Menu button
 * at its right that holds every window the game has (who to be, the paper, the map, save and load, sound, What's
 * new, and chat's past talks, usage and models). Only chat's own launcher sits beside it (`addTool`). Panels open from the menu instead of each bringing its own fixed button, so the
 * screen stays clear for the town and chat keeps the right-hand side: while the chat panel is open
 * (`body.chat-open`, width `--chat-w`) the bar and the picker stop short of it (`--right` in index.html).
 */
import { el, onEscape } from './dom';

/** One menu entry. `note` adds a small second text (e.g. "off", a version), read each time the menu opens. */
export interface MenuItem {
  label: string;
  group: MenuGroup;
  open: () => void;
  note?: () => string;
  /** Hidden while this says false (e.g. Save before there is a town). */
  shown?: () => boolean;
}

/** The menu's sections, in the order they are listed. */
export type MenuGroup = 'Chat' | 'Play' | 'Town' | 'Game' | 'Settings';
const GROUPS: MenuGroup[] = ['Chat', 'Play', 'Town', 'Game', 'Settings'];

export class Shell {
  readonly bar = el('header', 'sh-bar');
  private readonly when = el('span', 'sh-when');
  private readonly said = el('span', 'sh-said');
  private saidTimer = 0;
  private readonly tools = el('div', 'sh-tools');
  private readonly button = el('button', 'sh-menu-button', 'Menu');
  private readonly items: MenuItem[] = [];
  private menu: HTMLElement | null = null;
  private stopKeys = (): void => {};

  constructor() {
    this.button.type = 'button';
    this.button.setAttribute('aria-haspopup', 'menu');
    this.button.setAttribute('aria-expanded', 'false');
    this.button.addEventListener('click', () => (this.menu ? this.closeMenu() : this.openMenu()));
    this.said.setAttribute('role', 'status');
    this.bar.append(this.when, this.said);
    this.tools.append(this.button);
    document.body.append(this.bar, this.tools);
  }

  /** A button that must stay one click away (chat's launcher) goes beside Menu, not into it. */
  addTool(b: HTMLElement): void {
    this.tools.insertBefore(b, this.button);
  }

  /** Add an entry; entries keep the order they were added in within their group. */
  add(item: MenuItem): void {
    this.items.push(item);
  }

  /** The date, time and weather line (cheap every frame: the DOM changes only when the text does). */
  setWhen(text: string): void {
    if (this.when.textContent !== text) this.when.textContent = text;
    this.bar.classList.toggle('sh-empty', !text);
  }

  /** A short word in the bar for a moment (e.g. "Saved"), for things done from the menu that show nothing else. */
  say(text: string): void {
    this.said.textContent = text;
    clearTimeout(this.saidTimer);
    this.saidTimer = window.setTimeout(() => { this.said.textContent = ''; }, 2500);
  }

  private openMenu(): void {
    const m = el('nav', 'sh-menu');
    m.setAttribute('role', 'menu');
    m.setAttribute('aria-label', 'Menu');
    for (const g of GROUPS) {
      const items = this.items.filter((i) => i.group === g && (i.shown?.() ?? true));
      if (!items.length) continue;
      m.append(el('h3', '', g));
      for (const it of items) {
        const b = el('button', 'sh-item');
        b.type = 'button';
        b.setAttribute('role', 'menuitem');
        b.append(el('span', '', it.label));
        const note = it.note?.();
        if (note) b.append(el('span', 'sh-note', note));
        b.addEventListener('click', () => { this.closeMenu(); it.open(); });
        m.append(b);
      }
    }
    document.body.append(m);
    this.menu = m;
    this.button.setAttribute('aria-expanded', 'true');
    this.stopKeys = onEscape(() => this.closeMenu());
    addEventListener('pointerdown', this.outside, true);
    (m.querySelector('button') as HTMLButtonElement | null)?.focus();
  }

  private readonly outside = (e: PointerEvent): void => {
    const t = e.target as Node;
    if (this.menu && !this.menu.contains(t) && !this.button.contains(t)) this.closeMenu();
  };

  private closeMenu(): void {
    this.menu?.remove();
    this.menu = null;
    this.button.setAttribute('aria-expanded', 'false');
    this.stopKeys();
    removeEventListener('pointerdown', this.outside, true);
  }
}

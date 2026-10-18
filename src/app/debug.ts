/**
 * The debug menu (Arnd: Shift+Ctrl+F12): a panel at the left kept out of the normal Menu, with a live info block
 * (version, seed, game time, where you are, frames, shaders) and the tools to look into what the game does. One in
 * main.ts; every thread adds its own tools here, never a key or a button of its own:
 *
 *  - `debug.add({ label, group, run })`: a button; `{ label, group, on, set }`: a switch; `{ label, group, custom }`:
 *    your own small control (a form). `key` (a `KeyboardEvent.code`) also runs it from the keyboard, menu shut or not.
 *  - `debug.addInfo(() => text)`: a line in the info block (read four times a second while the panel is open).
 *  - `debug.frame(ms)` once a frame: the frame times behind the FPS line.
 *
 * How threads use it, and "Report this spot", is in docs/REPORTS.md.
 */
import { button, checkbox, el } from './dom';

/** The panel's sections, in the order they are listed. */
export type DebugGroup = 'Report' | 'Time' | 'Play' | 'Go' | 'Show' | 'Render';
const GROUPS: DebugGroup[] = ['Report', 'Time', 'Play', 'Go', 'Show', 'Render'];

export interface DebugItem {
  label: string;
  group: DebugGroup;
  /** A button: what it does. */
  run?: () => void;
  /** A switch: whether it is on now, and turning it on or off. */
  on?: () => boolean;
  set?: (on: boolean) => void;
  /** Your own control instead (made each time the panel opens). */
  custom?: () => HTMLElement;
  /** A small second text, read each time the panel opens (e.g. the key). */
  note?: () => string;
  /** A `KeyboardEvent.code` (with `shift`/`ctrl` as given) that runs `run` or flips the switch, the panel shut or not. */
  key?: { code: string; shift?: boolean; ctrl?: boolean };
}

/** Real ms of frames kept for the FPS line. */
const FRAMES_MS = 1000;

export class DebugMenu {
  private readonly items: DebugItem[] = [];
  private readonly info: (() => string)[] = [];
  private panel: HTMLElement | null = null;
  private infoBox: HTMLElement | null = null;
  private timer = 0;
  private readonly frames: number[] = [];

  constructor() {
    addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === 'F12' && e.ctrlKey && e.shiftKey) { e.preventDefault(); this.toggle(); return; }
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('input, textarea, [contenteditable]')) return;
      const it = this.items.find((i) => i.key && i.key.code === e.code && !!i.key.shift === e.shiftKey && !!i.key.ctrl === e.ctrlKey);
      if (!it) return;
      e.preventDefault();
      if (it.run) it.run(); else if (it.on && it.set) it.set(!it.on());
      this.refresh();
    });
  }

  /** Add a tool; tools keep the order they were added in within their group. */
  add(item: DebugItem): void {
    this.items.push(item);
    this.refresh();
  }

  /** Add a line to the info block. */
  addInfo(line: () => string): void {
    this.info.push(line);
  }

  /** One frame took `ms` real milliseconds. */
  frame(ms: number): void {
    this.frames.push(ms);
    let sum = 0;
    for (const f of this.frames) sum += f;
    while (this.frames.length > 1 && sum - this.frames[0] >= FRAMES_MS) sum -= this.frames.shift()!;
  }

  /** Frames per second over the last second, the slowest frame in it, as one line. */
  fps(): string {
    const f = this.frames;
    if (!f.length) return 'no frames yet';
    const sum = f.reduce((a, b) => a + b, 0), worst = Math.max(...f);
    return `${(1000 * f.length / Math.max(1, sum)).toFixed(0)} fps, slowest frame ${worst.toFixed(0)} ms`;
  }

  get isOpen(): boolean { return this.panel !== null; }

  toggle(): void {
    if (this.panel) this.close(); else this.open();
  }

  open(): void {
    if (this.panel) return;
    const p = el('aside', 'dbg-panel');
    p.setAttribute('aria-label', 'Debug');
    const head = el('div', 'dbg-head');
    head.append(el('strong', '', 'Debug'), el('span', 'dbg-note', 'Shift+Ctrl+F12'), button('dbg-close', '×', () => this.close()));
    p.append(head);
    this.infoBox = el('pre', 'dbg-info');
    p.append(this.infoBox);
    for (const g of GROUPS) {
      const items = this.items.filter((i) => i.group === g);
      if (!items.length) continue;
      p.append(el('h3', '', g));
      for (const it of items) p.append(this.control(it));
    }
    document.body.append(p);
    this.panel = p;
    this.showInfo();
    this.timer = window.setInterval(() => this.showInfo(), 250);
  }

  close(): void {
    this.panel?.remove();
    this.panel = this.infoBox = null;
    clearInterval(this.timer);
  }

  /** Redraw an open panel (a tool was added, a switch flipped from the keyboard). */
  private refresh(): void {
    if (!this.panel) return;
    this.close();
    this.open();
  }

  private showInfo(): void {
    if (!this.infoBox) return;
    const text = this.info.map((f) => { try { return f(); } catch (e) { return `(${e instanceof Error ? e.message : String(e)})`; } }).filter(Boolean).join('\n');
    if (this.infoBox.textContent !== text) this.infoBox.textContent = text;
  }

  private control(it: DebugItem): HTMLElement {
    const note = [it.note?.(), it.key ? keyName(it.key) : ''].filter(Boolean).join(' · ');
    if (it.custom) {
      const row = el('div', 'dbg-custom');
      row.append(el('span', 'dbg-label', it.label), it.custom());
      return row;
    }
    if (it.on && it.set) {
      const row = el('label', 'dbg-item');
      const set = it.set;
      row.append(checkbox(it.on(), (on) => set(on)), el('span', 'dbg-label', it.label));
      if (note) row.append(el('span', 'dbg-note', note));
      return row;
    }
    const b = button('dbg-item', '', () => it.run?.());
    b.append(el('span', 'dbg-label', it.label));
    if (note) b.append(el('span', 'dbg-note', note));
    return b;
  }
}

function keyName(k: NonNullable<DebugItem['key']>): string {
  return `${k.ctrl ? 'Ctrl+' : ''}${k.shift ? 'Shift+' : ''}${k.code.replace(/^Key/, '')}`;
}

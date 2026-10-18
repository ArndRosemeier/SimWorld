/**
 * Speech bubbles (plan §4): what the people around you say (src/street/talk.ts, from the sim worker with each street
 * update), over their heads, one line at a time, each up for as long as it takes to read. The nearest few are
 * readable; further off, a conversation shows as a small "…" (a busy bar murmurs). Out of view or too far away:
 * nothing. DOM over the canvas; the game places them each frame from the figures it draws.
 *
 * New in SimWorld (idea from Scale's barks, src/ui/Barks.ts; no code ported).
 */
import { Vector3, type PerspectiveCamera } from 'three/webgpu';
import type { Said } from '../street/talk';

/** Readable bubbles at once (the nearest), and how far off talk shows at all (m). */
const READABLE = 6;
const FAR = 80;
/** Beyond this (m) a bubble shrinks to "…". */
const CLOSE = 50;

interface Bubble { speaker: number; text: string; start: number; end: number; el: HTMLElement | null }

/** Where a speaker's head is (x, top of the head y, z), null when they are not drawn. */
export type HeadOf = (id: number) => { x: number; y: number; z: number } | null;

export class Bubbles {
  readonly root = document.createElement('div');
  private lines: Bubble[] = [];
  /** When each speaker is free to say the next line (real seconds). */
  private readonly freeAt = new Map<number, number>();
  private n = 0;
  private readonly v = new Vector3();

  constructor() {
    this.root.className = 'bubbles';
    this.root.setAttribute('aria-hidden', 'true');
  }

  /**
   * New talk at real time `now` (seconds). A minute's talk is spread over the minute (the sim says it all at once),
   * each conversation's lines one after the other; game time runs `rate` times real time.
   */
  addTalk(said: readonly Said[], now: number, rate = 1): void {
    for (const s of said) {
      this.n = (this.n * 1103515245 + 12345 + s.a * 31 + s.b) >>> 0;
      let t = Math.max(now + ((this.n >>> 8) % 1000) / 1000 * 40 / rate, this.freeAt.get(s.a) ?? 0, this.freeAt.get(s.b) ?? 0);
      for (const l of s.lines) {
        const dur = Math.min(7, Math.max(2.2, 1.4 + l.text.length * 0.055)) / Math.min(rate, 3);
        this.lines.push({ speaker: l.speaker, text: l.text, start: t, end: t + dur, el: null });
        t += dur + 0.35;
      }
      this.freeAt.set(s.a, t + 1);
      this.freeAt.set(s.b, t + 1);
    }
  }

  /** Place the bubbles up now (real seconds) over the heads `headOf` gives, seen from `camera`. */
  layout(now: number, camera: PerspectiveCamera, headOf: HeadOf, width: number, height: number): void {
    const up: { b: Bubble; d: number; x: number; y: number }[] = [];
    this.lines = this.lines.filter((b) => {
      if (now < b.end) return true;
      b.el?.remove();
      return false;
    });
    for (const b of this.lines) {
      const h = now >= b.start ? headOf(b.speaker) : null;
      const d = h ? Math.hypot(h.x - camera.position.x, h.y - camera.position.y, h.z - camera.position.z) : Infinity;
      if (!h || d > FAR) { this.hide(b); continue; }
      this.v.set(h.x, h.y, h.z).project(camera);
      if (this.v.z > 1 || Math.abs(this.v.x) > 1.1 || Math.abs(this.v.y) > 1.1) { this.hide(b); continue; }
      up.push({ b, d, x: (this.v.x * 0.5 + 0.5) * width, y: (-this.v.y * 0.5 + 0.5) * height });
    }
    up.sort((p, q) => p.d - q.d);
    up.forEach((u, i) => {
      const read = i < READABLE && u.d < CLOSE;
      let el = u.b.el;
      if (!el) {
        el = u.b.el = document.createElement('div');
        this.root.append(el);
      }
      const cls = read ? 'bubble' : 'bubble murmur';
      if (el.className !== cls) { el.className = cls; el.textContent = read ? u.b.text : '…'; }
      el.style.transform = `translate(${u.x.toFixed(1)}px, ${u.y.toFixed(1)}px) translate(-50%, -100%)`;
      el.style.opacity = String(Math.min(1, (FAR - u.d) / 15, (u.b.end - now) * 3, (now - u.b.start) * 4 + 0.2));
      el.style.zIndex = String(1000 - Math.round(u.d * 10));
    });
  }

  /** Drop everything said (after a skip: everyone is somewhere else). */
  clear(): void {
    for (const b of this.lines) b.el?.remove();
    this.lines = [];
    this.freeAt.clear();
  }

  private hide(b: Bubble): void {
    if (b.el) { b.el.remove(); b.el = null; }
  }
}

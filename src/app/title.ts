/**
 * The title screen (plan R2): the game's name, the alpha badge with the version, a town at dusk whose windows light
 * up as the game gets ready (src/app/titleScene.ts), and the title music. It is the first thing on screen: index.html
 * paints its words before any script runs, and this module comes in the small first chunk (src/main.ts), so the
 * picture is up while three.js, the shaders' warm-up, the town's build and the sim's year of history load behind it.
 *
 * Browsers start sound only after a click or key, so the first gesture ("Click to start") starts the music. Once the
 * game behind is ready (`ready`) and the player has clicked once, "Enter the town" appears; it fades the title out
 * and hands over to the picker (src/game/playing.ts). The mute toggle and What's new sit on it too.
 */
import type { AudioEngine } from '../audio/engine';
import { button, el } from './dom';
import { GROUND, SPAN, lit, skyline, type Skyline } from './titleScene';

/** Frames per second of the picture: enough for twinkling stars, little for the main thread that loads the game. */
const FPS = 20;

export class TitleScreen {
  readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly scene: Skyline;
  private readonly t0 = performance.now();
  private progress = 0;
  private clicked = false;
  private onEnter: (() => void) | null = null;
  private raf = 0;
  private last = 0;
  private gone = false;
  private readonly go: HTMLElement;
  private readonly stepEl: HTMLElement;
  private readonly barEl: HTMLElement;
  private readonly muteEl: HTMLButtonElement;

  constructor(seed: number, private readonly engine: AudioEngine, version: string) {
    // index.html holds the words already; fall back to building them (a page without them, e.g. a test page).
    this.root = document.getElementById('loading') ?? document.body.appendChild(el('div', ''));
    this.root.id = 'loading';
    document.body.classList.add('title-up');
    this.canvas = this.root.querySelector<HTMLCanvasElement>('.ti-scene') ?? this.root.insertBefore(el('canvas', 'ti-scene'), this.root.firstChild);
    this.go = this.root.querySelector<HTMLElement>('.ti-go') ?? this.root.appendChild(el('div', 'ti-go'));
    this.stepEl = this.root.querySelector<HTMLElement>('.step') ?? this.root.appendChild(el('div', 'step'));
    this.barEl = this.root.querySelector<HTMLElement>('.bar i') ?? this.root.appendChild(el('div', 'bar')).appendChild(el('i', ''));
    const badge = this.root.querySelector('.ti-badge');
    if (badge) badge.textContent = `Alpha ${version}`;
    this.scene = skyline(seed);

    this.muteEl = button('ti-mute', '', (e) => {
      e.stopPropagation();
      this.engine.wake();
      this.engine.setMuted(!this.engine.muted);
      this.showMute();
    });
    this.showMute();
    this.root.append(this.muteEl);

    // A click before this script ran counts too (the browser remembers it, and so does the audio engine).
    const active = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive;
    if (active) this.gesture();
    else {
      const once = (): void => { for (const ev of GESTURES) removeEventListener(ev, once); this.gesture(); };
      for (const ev of GESTURES) addEventListener(ev, once, { passive: true });
    }
    addEventListener('resize', this.resize);
    this.resize();
    this.raf = requestAnimationFrame(this.frame);
  }

  /** What the game behind is doing, and how far it is (0 … 1, the windows follow it). */
  step(text: string, frac?: number): void {
    this.stepEl.textContent = text;
    if (frac !== undefined) {
      this.progress = Math.max(this.progress, Math.min(1, frac));
      this.barEl.style.width = `${Math.round(this.progress * 100)}%`;
    }
  }

  /** Something went wrong behind: say so where the prompt is, and keep the title up. */
  fail(text: string): void {
    this.stepEl.textContent = text;
    this.root.classList.add('ti-failed');
    this.go.replaceChildren();
  }

  /** The game behind is ready: offer the way in (after the first click), which calls `enter`. */
  ready(enter: () => void): void {
    this.onEnter = enter;
    this.progress = 1;
    this.barEl.style.width = '100%';
    this.stepEl.textContent = '';
    this.root.classList.add('ti-ready');
    this.showWayIn();
  }

  /** Take the title away now (the game was asked to start straight away, e.g. `?be=` or `?still`). */
  dismiss(fade = false): void {
    if (this.gone) return;
    this.gone = true;
    document.body.classList.remove('title-up');
    removeEventListener('resize', this.resize);
    const end = (): void => { cancelAnimationFrame(this.raf); this.root.remove(); };
    if (!fade) return end();
    this.root.classList.add('ti-out');
    setTimeout(end, 1300);
  }

  get shown(): boolean { return !this.gone; }

  private gesture(): void {
    if (this.clicked) return;
    this.clicked = true;
    this.engine.wake();
    this.root.classList.add('ti-started');
    this.showWayIn();
  }

  private showWayIn(): void {
    if (!this.clicked || !this.onEnter || this.gone) {
      if (!this.clicked) this.go.replaceChildren(el('span', 'ti-click', 'Click to start'));
      else if (!this.onEnter) this.go.replaceChildren();
      return;
    }
    const enter = this.onEnter;
    const b = button('ti-enter', 'Enter the town', (e) => { e.stopPropagation(); this.dismiss(true); enter(); });
    this.go.replaceChildren(b);
    b.focus({ preventScroll: true });
  }

  private showMute(): void {
    const off = this.engine.muted;
    this.muteEl.setAttribute('aria-label', off ? 'Sound off: turn it on' : 'Sound on: turn it off');
    this.muteEl.setAttribute('aria-pressed', String(off));
    this.muteEl.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/>${off
      ? '<path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>'
      : '<path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>'}</svg>`;
  }

  private readonly resize = (): void => {
    const dpr = Math.min(2, devicePixelRatio || 1);
    this.canvas.width = Math.round(innerWidth * dpr);
    this.canvas.height = Math.round(innerHeight * dpr);
    this.last = 0;
  };

  private readonly frame = (now: number): void => {
    if (this.gone && !this.root.isConnected) return;
    this.raf = requestAnimationFrame(this.frame);
    if (now - this.last < 1000 / FPS) return;
    this.last = now;
    paintDusk(this.canvas, this.scene, (now - this.t0) / 1000, this.progress);
  };
}

const GESTURES = ['pointerdown', 'keydown', 'touchend'] as const;

/** The picture at `t` seconds with the game this far ready. */
function paintDusk(canvas: HTMLCanvasElement, s: Skyline, t: number, progress: number): void {
  const g = canvas.getContext('2d');
  if (!g) return;
  const W = canvas.width, H = canvas.height;
  // Picture units: 1 = the canvas height; the planned town's middle in the middle of the screen.
  const k = H, ox = W / 2 - (SPAN / 2) * k;
  const X = (x: number): number => ox + x * k, Y = (y: number): number => y * k;

  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#060b18');
  sky.addColorStop(0.45, '#14203a');
  sky.addColorStop(0.68, '#3b3550');
  sky.addColorStop(0.8, '#a8674a');
  sky.addColorStop(1, '#2a1a16');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);
  // The last of the sun behind the town.
  const glow = g.createRadialGradient(X(SPAN / 2 - 0.35), Y(GROUND), 0, X(SPAN / 2 - 0.35), Y(GROUND), k * 0.9);
  glow.addColorStop(0, '#e9a15a55');
  glow.addColorStop(1, '#e9a15a00');
  g.fillStyle = glow;
  g.fillRect(0, 0, W, H);

  for (const st of s.stars) {
    const a = (1 - st.y / 0.55) * (0.55 + 0.45 * Math.sin(st.phase + t * st.rate));
    if (a <= 0.02) continue;
    g.fillStyle = `rgba(236,227,208,${a.toFixed(3)})`;
    g.fillRect(X(st.x), Y(st.y), Math.max(1, st.r * k), Math.max(1, st.r * k));
  }
  // A thin moon, low on the right, clear of the name.
  const mx = X(SPAN / 2 + 0.62), my = Y(0.4), mr = k * 0.035;
  g.fillStyle = '#ece3d0';
  g.beginPath(); g.arc(mx, my, mr, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#0f1930';
  g.beginPath(); g.arc(mx + mr * 0.45, my - mr * 0.15, mr * 0.95, 0, Math.PI * 2); g.fill();

  // Two slow bands of cloud drifting left to right.
  for (let i = 0; i < 2; i++) {
    const cy = Y(0.3 + i * 0.12), drift = ((t * (6 + i * 4)) % (W + k)) - k * 0.5;
    // A round soft blot squashed flat: no edges anywhere.
    const cl = g.createRadialGradient(0, 0, 0, 0, 0, k * 0.5);
    cl.addColorStop(0, i ? '#8a5a5a22' : '#6a587a26');
    cl.addColorStop(1, '#00000000');
    g.save();
    g.translate(drift, cy);
    g.scale(1, 0.22);
    g.fillStyle = cl;
    g.fillRect(-k * 0.5, -k * 0.5, k, k);
    g.restore();
  }

  for (const h of s.hills) {
    g.fillStyle = h.depth ? '#141822' : '#232838';
    g.beginPath();
    g.moveTo(X(h.points[0]), H);
    for (let i = 0; i < h.points.length; i += 2) g.lineTo(X(h.points[i]), Y(h.points[i + 1]));
    g.lineTo(X(h.points[h.points.length - 2]), H);
    g.closePath();
    g.fill();
  }

  const dark = '#090b10';
  g.fillStyle = dark;
  for (const tr of s.trees) { g.beginPath(); g.arc(X(tr.x), Y(tr.y), tr.r * k, 0, Math.PI * 2); g.fill(); }
  for (const b of s.buildings) {
    const x0 = X(b.x), x1 = X(b.x + b.w), top = Y(b.top);
    if (x1 < 0 || x0 > W) continue;
    g.fillRect(x0, top, x1 - x0, Y(GROUND) - top + 1);
    if (b.chimney) g.fillRect(X(b.chimney.x), Y(b.top - b.chimney.h), Math.max(2, b.chimney.w * k), b.chimney.h * k + 1);
    g.beginPath();
    if (b.roof === 'gable') { g.moveTo(x0 - 1, top + 1); g.lineTo((x0 + x1) / 2, Y(b.top - b.rise)); g.lineTo(x1 + 1, top + 1); }
    else if (b.roof === 'spire') {
      const mid = (x0 + x1) / 2, tw = (x1 - x0) * 0.3;
      g.rect(mid - tw, Y(b.top - 0.05), tw * 2, 0.05 * k + 1);
      g.moveTo(mid - tw * 1.1, Y(b.top - 0.05)); g.lineTo(mid, Y(b.top - 0.05 - b.rise)); g.lineTo(mid + tw * 1.1, Y(b.top - 0.05));
    } else g.rect(x0 + (x1 - x0) * 0.1, top - b.rise * k, (x1 - x0) * 0.8, b.rise * k + 1);
    g.fill();
  }
  g.fillRect(0, Y(GROUND), W, H - Y(GROUND));

  // The windows: warm when lit, a few flickering as people move about inside.
  for (const b of s.buildings) {
    if (X(b.x + b.w) < 0 || X(b.x) > W) continue;
    for (const w of b.windows) {
      if (!lit(w, progress)) continue;
      const f = 0.85 + 0.15 * Math.sin(t * 0.7 + w.at * 40);
      g.fillStyle = `rgba(242,196,109,${f.toFixed(3)})`;
      g.fillRect(X(w.x), Y(w.y), Math.max(1, w.w * k), Math.max(1, w.h * k));
    }
  }
  // Street lamps along the foot of the town.
  for (let x = 0.05; x < SPAN; x += 0.11) {
    const lx = X(x), ly = Y(GROUND - 0.005);
    if (lx < -20 || lx > W + 20) continue;
    const lamp = g.createRadialGradient(lx, ly, 0, lx, ly, k * 0.025);
    lamp.addColorStop(0, '#f2c46dcc');
    lamp.addColorStop(1, '#f2c46d00');
    g.fillStyle = lamp;
    g.fillRect(lx - k * 0.03, ly - k * 0.03, k * 0.06, k * 0.06);
  }
}

/**
 * A small 2D painter with the subset of the canvas API the leaf atlas draws with
 * (src/build/vegetationTex.ts): paths (lines, quadratic curves, rects, ellipses), nonzero fills,
 * strokes with round joins, linear gradients, clipping, save/restore with translate and rotate,
 * source-over compositing. Pure (no DOM): runs in workers and in Node.
 *
 * Anti-aliased by exact horizontal coverage on 4 sub-scanlines per pixel row. Colours are sRGB
 * 0..1 with alpha, composited premultiplied (as a canvas does). Row 0 is the top, like a canvas.
 *
 * New in SimWorld: Scale painted its leaf atlas on a DOM canvas (src/props/vegetation.ts).
 */
import { clamp, hsl2rgb } from '@futuremagic/core';
import { ensureCCW } from '../geom/geom2';

/** sRGB r, g, b (0..1) and alpha. */
export type RGBA = [number, number, number, number];

/** A canvas-style `hsla(h, s%, l%, a)` colour, the lightness shifted by `dl` (percent, clamped). */
export function hsla(h: number, s: number, l: number, a = 1, dl = 0): RGBA {
  const [r, g, b] = hsl2rgb(h / 360, clamp(s, 0, 100) / 100, clamp(l + dl, 0, 100) / 100);
  return [r, g, b, a];
}

export class LinearGradient {
  readonly stops: [number, RGBA][] = [];
  constructor(readonly x0: number, readonly y0: number, readonly x1: number, readonly y1: number) {}
  addColorStop(t: number, c: RGBA): void {
    this.stops.push([t, c]);
    this.stops.sort((a, b) => a[0] - b[0]);
  }
  colorAt(t: number): RGBA {
    const s = this.stops;
    if (!s.length) return [0, 0, 0, 0];
    if (t <= s[0][0]) return s[0][1];
    for (let i = 1; i < s.length; i++) {
      if (t <= s[i][0]) {
        const [ta, a] = s[i - 1], [tb, b] = s[i];
        const f = tb > ta ? (t - ta) / (tb - ta) : 0;
        return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f];
      }
    }
    return s[s.length - 1][1];
  }
}

export type Style = RGBA | LinearGradient;

/** A coverage (or clip) mask over a pixel rectangle. */
interface Mask { x0: number; y0: number; w: number; h: number; v: Float32Array }

/** Affine transform [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f. */
type Mat = [number, number, number, number, number, number];

interface State { m: Mat; clip: Mask | null; fillStyle: Style; strokeStyle: Style; lineWidth: number }

const SS = 4;

export class Paint2D {
  /** Premultiplied RGBA, row 0 at the top. */
  readonly data: Float32Array;
  fillStyle: Style = [0, 0, 0, 1];
  strokeStyle: Style = [0, 0, 0, 1];
  lineWidth = 1;
  /** Accepted for canvas compatibility; joins and caps are always round. */
  lineCap = 'round';
  private m: Mat = [1, 0, 0, 1, 0, 0];
  private clipMask: Mask | null = null;
  private stack: State[] = [];
  private subs: { pts: number[]; closed: boolean }[] = [];

  constructor(readonly width: number, readonly height: number) {
    this.data = new Float32Array(width * height * 4);
  }

  // ------------------------------------------------------------------ state

  save(): void {
    this.stack.push({ m: [...this.m] as Mat, clip: this.clipMask, fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth });
  }
  restore(): void {
    const s = this.stack.pop();
    if (!s) return;
    this.m = s.m; this.clipMask = s.clip; this.fillStyle = s.fillStyle; this.strokeStyle = s.strokeStyle; this.lineWidth = s.lineWidth;
  }
  translate(x: number, y: number): void {
    const m = this.m;
    m[4] += m[0] * x + m[2] * y;
    m[5] += m[1] * x + m[3] * y;
  }
  rotate(a: number): void {
    const m = this.m, c = Math.cos(a), s = Math.sin(a);
    const [a0, b0, c0, d0] = m;
    m[0] = a0 * c + c0 * s; m[1] = b0 * c + d0 * s;
    m[2] = -a0 * s + c0 * c; m[3] = -b0 * s + d0 * c;
  }
  private tx(x: number, y: number): [number, number] {
    const m = this.m;
    return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  }

  // ------------------------------------------------------------------ paths

  beginPath(): void { this.subs = []; }
  moveTo(x: number, y: number): void { this.subs.push({ pts: this.tx(x, y), closed: false }); }
  lineTo(x: number, y: number): void {
    const s = this.subs[this.subs.length - 1];
    if (!s || s.closed) { this.moveTo(x, y); return; }
    s.pts.push(...this.tx(x, y));
  }
  closePath(): void {
    const s = this.subs[this.subs.length - 1];
    if (s) s.closed = true;
  }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void {
    const s = this.subs[this.subs.length - 1];
    if (!s) { this.moveTo(x, y); return; }
    // The current point back in user space is not needed: interpolate in device space.
    const p0x = s.pts[s.pts.length - 2], p0y = s.pts[s.pts.length - 1];
    const [qx, qy] = this.tx(cx, cy), [p1x, p1y] = this.tx(x, y);
    for (let k = 1; k <= 10; k++) {
      const t = k / 10, u = 1 - t;
      s.pts.push(u * u * p0x + 2 * u * t * qx + t * t * p1x, u * u * p0y + 2 * u * t * qy + t * t * p1y);
    }
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.subs.push({ pts: [...this.tx(x, y), ...this.tx(x + w, y), ...this.tx(x + w, y + h), ...this.tx(x, y + h)], closed: true });
  }
  /** A full ellipse (the atlas only draws whole ones), as a closed sub-path of its own. */
  ellipse(x: number, y: number, rx: number, ry: number, rot: number): void {
    const n = clamp(Math.ceil(Math.max(rx, ry) * 1.5), 10, 48);
    const cr = Math.cos(rot), sr = Math.sin(rot);
    const pts: number[] = [];
    for (let k = 0; k < n; k++) {
      const t = (k / n) * Math.PI * 2, ex = Math.cos(t) * rx, ey = Math.sin(t) * ry;
      pts.push(...this.tx(x + ex * cr - ey * sr, y + ex * sr + ey * cr));
    }
    this.subs.push({ pts, closed: true });
  }

  // ------------------------------------------------------------------ painting

  fill(): void {
    this.paint(this.cover(this.subs.map((s) => s.pts)), this.fillStyle);
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    const p = [...this.tx(x, y), ...this.tx(x + w, y), ...this.tx(x + w, y + h), ...this.tx(x, y + h)];
    this.paint(this.cover([p]), this.fillStyle);
  }

  /** Stroke the path: one nonzero fill of a quad per segment and a disc per vertex (round joins and caps). */
  stroke(): void {
    const hw = this.lineWidth / 2, polys: number[][] = [];
    const penDisc = (x: number, y: number) => {
      const n = clamp(Math.ceil(hw * 3), 6, 24), p: number[] = [];
      for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2; p.push(x + Math.cos(a) * hw, y + Math.sin(a) * hw); }
      polys.push(p);
    };
    for (const s of this.subs) {
      const P = s.pts, n = P.length / 2;
      const segs = s.closed ? n : n - 1;
      for (let i = 0; i < segs; i++) {
        const ax = P[i * 2], ay = P[i * 2 + 1], j = (i + 1) % n, bx = P[j * 2], by = P[j * 2 + 1];
        const dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy);
        if (l < 1e-6) continue;
        const nx = (-dy / l) * hw, ny = (dx / l) * hw;
        polys.push([ax + nx, ay + ny, bx + nx, by + ny, bx - nx, by - ny, ax - nx, ay - ny]);
      }
      for (let i = 0; i < n; i++) penDisc(P[i * 2], P[i * 2 + 1]);
    }
    // Every piece wound the same way, so the nonzero rule paints their union once.
    this.paint(this.cover(polys.map(ensureCCW)), this.strokeStyle);
  }

  /** Intersect the clip with the current path. */
  clip(): void {
    const c = this.cover(this.subs.map((s) => s.pts));
    const old = this.clipMask;
    if (!c) { this.clipMask = { x0: 0, y0: 0, w: 0, h: 0, v: new Float32Array(0) }; return; }
    if (old) for (let j = 0; j < c.h; j++) for (let i = 0; i < c.w; i++) c.v[j * c.w + i] *= maskAt(old, c.x0 + i, c.y0 + j);
    this.clipMask = c;
  }

  createLinearGradient(x0: number, y0: number, x1: number, y1: number): LinearGradient {
    return new LinearGradient(x0, y0, x1, y1);
  }

  /** The image as straight (not premultiplied) RGBA8, row 0 at the top. */
  imageData(): Uint8Array {
    const d = this.data, out = new Uint8Array(this.width * this.height * 4);
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3];
      if (a <= 0) continue;
      out[i] = Math.round(clamp(d[i] / a, 0, 1) * 255);
      out[i + 1] = Math.round(clamp(d[i + 1] / a, 0, 1) * 255);
      out[i + 2] = Math.round(clamp(d[i + 2] / a, 0, 1) * 255);
      out[i + 3] = Math.round(clamp(a, 0, 1) * 255);
    }
    return out;
  }

  // ------------------------------------------------------------------ raster

  /** Nonzero coverage of device-space polygons, inside the canvas and the clip's rectangle. */
  private cover(polys: number[][]): Mask | null {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of polys) for (let i = 0; i < p.length; i += 2) {
      x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]);
    }
    let ix0 = Math.max(0, Math.floor(x0)), iy0 = Math.max(0, Math.floor(y0)), ix1 = Math.min(this.width, Math.ceil(x1)), iy1 = Math.min(this.height, Math.ceil(y1));
    const c = this.clipMask;
    if (c) { ix0 = Math.max(ix0, c.x0); iy0 = Math.max(iy0, c.y0); ix1 = Math.min(ix1, c.x0 + c.w); iy1 = Math.min(iy1, c.y0 + c.h); }
    if (ix1 <= ix0 || iy1 <= iy0) return null;
    const w = ix1 - ix0, h = iy1 - iy0;
    const E: number[] = [];
    for (const p of polys) {
      const n = p.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, ya = p[i * 2 + 1], yb = p[j * 2 + 1];
        if (ya === yb) continue;
        E.push(p[i * 2], ya, p[j * 2], yb);
      }
    }
    const v = new Float32Array(w * h);
    const xs: number[] = [], ds: number[] = [];
    const wt = 1 / SS;
    for (let r = 0; r < h; r++) {
      for (let s = 0; s < SS; s++) {
        const y = iy0 + r + (s + 0.5) / SS;
        xs.length = 0; ds.length = 0;
        for (let e = 0; e < E.length; e += 4) {
          const ya = E[e + 1], yb = E[e + 3];
          if ((y < ya) === (y < yb)) continue;
          const x = E[e] + ((y - ya) * (E[e + 2] - E[e])) / (yb - ya);
          // insertion into the sorted crossings
          let k = xs.length;
          xs.push(x); ds.push(yb > ya ? 1 : -1);
          while (k > 0 && xs[k - 1] > x) { xs[k] = xs[k - 1]; ds[k] = ds[k - 1]; k--; }
          xs[k] = x; ds[k] = yb > ya ? 1 : -1;
        }
        let wind = 0, start = 0;
        for (let k = 0; k < xs.length; k++) {
          const before = wind;
          wind += ds[k];
          if (before === 0 && wind !== 0) start = xs[k];
          else if (before !== 0 && wind === 0) span(v, r * w, start - ix0, xs[k] - ix0, w, wt);
        }
      }
    }
    return { x0: ix0, y0: iy0, w, h, v };
  }

  /** Composite `style` source-over through coverage `c` (and the clip). */
  private paint(c: Mask | null, style: Style): void {
    if (!c) return;
    const d = this.data, W = this.width, clip = this.clipMask;
    let grad: { g: LinearGradient; ox: number; oy: number; dx: number; dy: number; l2: number } | null = null;
    let solid: RGBA = [0, 0, 0, 1];
    if (style instanceof LinearGradient) {
      const [ax, ay] = this.tx(style.x0, style.y0), [bx, by] = this.tx(style.x1, style.y1);
      grad = { g: style, ox: ax, oy: ay, dx: bx - ax, dy: by - ay, l2: (bx - ax) ** 2 + (by - ay) ** 2 || 1 };
    } else solid = style;
    for (let j = 0; j < c.h; j++) for (let i = 0; i < c.w; i++) {
      let a = c.v[j * c.w + i];
      if (a <= 0) continue;
      const px = c.x0 + i, py = c.y0 + j;
      if (clip) a *= maskAt(clip, px, py);
      if (a <= 0) continue;
      const col = grad ? grad.g.colorAt(((px + 0.5 - grad.ox) * grad.dx + (py + 0.5 - grad.oy) * grad.dy) / grad.l2) : solid;
      const sa = Math.min(1, a) * col[3];
      if (sa <= 0) continue;
      const o = (py * W + px) * 4, k = 1 - sa;
      d[o] = col[0] * sa + d[o] * k;
      d[o + 1] = col[1] * sa + d[o + 1] * k;
      d[o + 2] = col[2] * sa + d[o + 2] * k;
      d[o + 3] = sa + d[o + 3] * k;
    }
  }
}

/** Add weight `wt` times the exact coverage of [xa, xb) (pixel units, local) to the row at `row`. */
function span(v: Float32Array, row: number, xa: number, xb: number, w: number, wt: number): void {
  xa = Math.max(0, xa); xb = Math.min(w, xb);
  if (xb <= xa) return;
  const ia = Math.floor(xa), ib = Math.floor(xb);
  if (ia === ib) { v[row + ia] += (xb - xa) * wt; return; }
  v[row + ia] += (ia + 1 - xa) * wt;
  for (let i = ia + 1; i < ib; i++) v[row + i] += wt;
  if (ib < w) v[row + ib] += (xb - ib) * wt;
}

function maskAt(m: Mask, x: number, y: number): number {
  const i = x - m.x0, j = y - m.y0;
  return i < 0 || j < 0 || i >= m.w || j >= m.h ? 0 : m.v[j * m.w + i];
}

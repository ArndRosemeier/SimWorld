/**
 * The title screen's picture: a small town at dusk seen across the fields, its windows lighting up one by one
 * as the game gets ready behind it (src/app/title.ts draws it on a 2D canvas, before three.js has loaded).
 * `skyline(seed)` plans it: pure and seeded, in units of the picture's height (0 at the top, 1 at the bottom),
 * spread over `SPAN` widths so any screen shape crops out of the middle of the same town.
 */
import { Rng, deriveSeed } from '@futuremagic/core';

/** How wide the planned town is, in picture heights (a 4:1 screen still shows only part of it). */
export const SPAN = 4.4;
/** Where the street level (the foot of the houses) sits. */
export const GROUND = 0.85;

export interface TitleWindow { x: number; y: number; w: number; h: number; /** Lights when the progress passes this (0 … 1). */ at: number }
export interface TitleBuilding {
  x: number; w: number; /** Top of the walls. */ top: number;
  roof: 'gable' | 'flat' | 'spire';
  /** Height of the roof above the walls. */ rise: number;
  chimney: { x: number; w: number; h: number } | null;
  windows: TitleWindow[];
}
export interface TitleTree { x: number; y: number; r: number }
export interface TitleStar { x: number; y: number; r: number; phase: number; rate: number }
export interface TitleHill { points: number[]; /** Its colour's depth, 0 far … 1 near. */ depth: number }

export interface Skyline { buildings: TitleBuilding[]; trees: TitleTree[]; stars: TitleStar[]; hills: TitleHill[] }

/** The town at dusk for `seed`. */
export function skyline(seed: number): Skyline {
  const r = new Rng(deriveSeed(seed, 'title-scene'));
  const buildings: TitleBuilding[] = [];
  const trees: TitleTree[] = [];
  // The church a little right of the middle, the rest houses and a few taller blocks round the centre.
  const church = SPAN / 2 + 0.28;
  let x = 0;
  while (x < SPAN) {
    const nearMiddle = 1 - Math.min(1, Math.abs(x - SPAN / 2) / (SPAN / 2));
    if (Math.abs(x - church) < 0.06) {
      x = church + 0.07;
      buildings.push(house(r, church - 0.06, 0.12, GROUND - 0.32, 'spire', 0.15));
      continue;
    }
    if (r.float() < 0.18) {
      // A gap with a tree or two.
      const n = 1 + Math.floor(r.float() * 2);
      for (let i = 0; i < n; i++) trees.push({ x: x + 0.03 + i * 0.04, y: GROUND - 0.02 - r.float() * 0.02, r: 0.025 + r.float() * 0.025 });
      x += 0.04 * n + 0.02;
      continue;
    }
    const tall = r.float() < 0.15 + 0.35 * nearMiddle;
    const w = tall ? 0.09 + r.float() * 0.07 : 0.07 + r.float() * 0.06;
    const h = tall ? 0.16 + r.float() * 0.1 * (0.5 + nearMiddle) : 0.07 + r.float() * 0.05;
    buildings.push(house(r, x, w, GROUND - h, tall && r.float() < 0.6 ? 'flat' : 'gable', tall ? 0.02 : 0.035 + r.float() * 0.03));
    x += w + (r.float() < 0.5 ? 0 : r.float() * 0.02);
  }
  const stars: TitleStar[] = [];
  for (let i = 0; i < 260; i++) stars.push({ x: r.float() * SPAN, y: Math.pow(r.float(), 1.6) * 0.55, r: 0.0008 + r.float() * 0.0016, phase: r.float() * Math.PI * 2, rate: 0.6 + r.float() * 1.8 });
  const hills: TitleHill[] = [0, 1].map((d) => {
    const points: number[] = [];
    const base = GROUND - 0.1 + d * 0.06, amp = 0.05 - d * 0.02, f1 = 1.2 + r.float(), f2 = 3 + r.float() * 2, p = r.float() * 6;
    for (let i = 0; i <= 88; i++) {
      const t = (i / 88) * SPAN;
      points.push(t, base - amp * (0.6 * Math.sin(t * f1 + p) + 0.4 * Math.sin(t * f2 + p * 2)));
    }
    return { points, depth: d };
  });
  return { buildings, trees, stars, hills };
}

function house(r: Rng, x: number, w: number, top: number, roof: TitleBuilding['roof'], rise: number): TitleBuilding {
  const windows: TitleWindow[] = [];
  if (roof === 'spire') {
    // The church: a tall lancet window and the clock up the tower.
    windows.push({ x: x + w / 2 - 0.008, y: top + 0.12, w: 0.016, h: 0.1, at: 0.98 });
    windows.push({ x: x + w / 2 - 0.012, y: top + 0.03, w: 0.024, h: 0.024, at: 0 });
  } else {
    const ww = 0.012, wh = 0.016, gapX = 0.02, gapY = 0.034;
    const cols = Math.max(1, Math.floor((w - 0.016) / gapX)), rows = Math.max(1, Math.floor((GROUND - top - 0.03) / gapY));
    const left = x + (w - (cols - 1) * gapX - ww) / 2;
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      if (r.float() < 0.12) continue;
      windows.push({ x: left + j * gapX, y: top + 0.018 + i * gapY, w: ww, h: wh, at: r.float() });
    }
  }
  const chimney = roof === 'gable' && r.float() < 0.6 ? { x: x + w * (0.2 + r.float() * 0.5), w: 0.008, h: rise * 0.9 + 0.012 } : null;
  return { x, w, top, roof, rise, chimney, windows };
}

/** Whether a window is lit at this progress (0 … 1): a few already at the start, most once the game is ready. */
export function lit(win: TitleWindow, progress: number): boolean {
  return win.at < 0.1 + 0.72 * Math.min(1, Math.max(0, progress));
}

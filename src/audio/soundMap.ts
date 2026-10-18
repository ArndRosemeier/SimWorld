/**
 * What the town sounds like where: a coarse grid of how built-up, busy, green, wet and rural each
 * spot is, and the places sounds come from (church towers, schools, the station, farms, gardens).
 * Made once by a town worker from the plan (`soundMapOf`), sent to the main thread with the town
 * summary, read by the soundscape (`soundAt`). Pure: no Web Audio, no three.js.
 */
import { clamp } from '@futuremagic/core';
import { polyArea, polyCentroid } from '../geom/geom2';
import type { Town } from '../plan/town';

export type SourceKind = 'church' | 'school' | 'station' | 'sports' | 'farm' | 'garden';

/** A place sounds come from; y is where the sound starts (a bell tower's top, a farmyard). */
export interface SoundSource { kind: SourceKind; x: number; y: number; z: number }

/** The channels of the grid, each 0 … 255 per cell. */
export const CHANNELS = ['built', 'busy', 'green', 'water', 'sea', 'rural'] as const;
export type Channel = typeof CHANNELS[number];

export interface SoundMap {
  /** Grid origin (corner of cell 0), cell size (m), cells per side. */
  x0: number;
  z0: number;
  step: number;
  n: number;
  grid: Record<Channel, Uint8Array>;
  /** Ground height at each cell centre (m): how high above the town the listener is. */
  height: Float32Array;
  sources: SoundSource[];
  /** A coastal town (its weather is milder and foggier). */
  coastal: boolean;
}

/** What one spot sounds like, every channel 0 … 1. */
export type SoundSample = Record<Channel, number>;

export const newSample = (): SoundSample => ({ built: 0, busy: 0, green: 0, water: 0, sea: 0, rural: 0 });

const STEP = 40;
/** River and lake water is heard up to this far from the bank (m); the sea farther. */
const WATER_REACH = 90, SEA_REACH = 260;
/** Gardens kept as sources at most (every n-th one beyond). */
const MAX_GARDENS = 600;
/** How high above the church floor the bells hang (m). */
const BELFRY = 22;

const BUSY_DISTRICT = new Set(['downtown', 'commercial', 'oldtown']);

export function soundMapOf(town: Town): SoundMap {
  const { terrain, land, macro, cells, rural } = town;
  const ext = Math.min(terrain.worldExtent, terrain.profile.radius + 2600);
  const n = Math.ceil((2 * ext) / STEP), x0 = -ext, z0 = -ext;
  const grid = Object.fromEntries(CHANNELS.map((c) => [c, new Uint8Array(n * n)])) as Record<Channel, Uint8Array>;
  const height = new Float32Array(n * n);
  const area = STEP * STEP;
  const cellOf = (x: number, z: number): number => {
    const i = Math.floor((x - x0) / STEP), j = Math.floor((z - z0) / STEP);
    return i < 0 || j < 0 || i >= n || j >= n ? -1 : j * n + i;
  };
  // Built-up and busy: building footprint per grid cell (shops and busy districts count as busy).
  const builtF = new Float32Array(n * n), busyF = new Float32Array(n * n), greenF = new Float32Array(n * n);
  const gardens: SoundSource[] = [];
  for (const c of cells) {
    const busyDistrict = BUSY_DISTRICT.has(c.district);
    for (const b of c.buildings) {
      const [cx, cz] = polyCentroid(b.poly);
      const k = cellOf(cx, cz);
      if (k < 0) continue;
      const a = polyArea(b.poly) * Math.min(3, b.floors) / 2;
      builtF[k] += a;
      if (b.shopfront || busyDistrict) busyF[k] += a;
      if (b.use === 'residential' && b.floors <= 2) gardens.push({ kind: 'garden', x: cx, y: terrain.height(cx, cz) + 1, z: cz });
    }
    for (const p of c.parks) {
      const [cx, cz] = polyCentroid(p.outer);
      const k = cellOf(cx, cz);
      if (k >= 0) greenF[k] += polyArea(p.outer);
    }
  }
  const sample = { rural: 0, forest: 0, field: 0, meadow: 1, bank: 0, edge: 0, water: Infinity };
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i, x = x0 + (i + 0.5) * STEP, z = z0 + (j + 0.5) * STEP;
    land.sample(x, z, sample, 0);
    height[k] = terrain.height(x, z);
    const w = terrain.water(x, z);
    const river = w.river >= 0 ? clamp(1 - (w.d - w.halfWidth) / WATER_REACH, 0, 1) : 0;
    const lake = clamp(1 - terrain.lakeAt(x, z).e / WATER_REACH, 0, 1);
    const coast = terrain.coastDistance(x, z);
    grid.built[k] = q(builtF[k] / (area * 0.45));
    grid.busy[k] = q(busyF[k] / (area * 0.35));
    grid.green[k] = q(Math.max(greenF[k] / area, sample.rural * (sample.forest + sample.meadow * 0.6), sample.bank));
    grid.water[k] = q(Math.max(river, lake));
    grid.sea[k] = q(Number.isFinite(coast) ? 1 - coast / SEA_REACH : 0);
    grid.rural[k] = q(sample.rural);
  }
  blur(grid.built, n); blur(grid.busy, n); blur(grid.green, n);

  const sources: SoundSource[] = [];
  for (const lm of macro.landmarks) {
    const kind: SourceKind | null = lm.kind === 'church' ? 'church' : lm.kind === 'school' ? 'school' : lm.kind === 'station' ? 'station' : lm.kind === 'sports' ? 'sports' : null;
    if (kind) sources.push({ kind, x: lm.x, y: lm.base + (kind === 'church' ? BELFRY : 2), z: lm.z });
  }
  for (const f of rural.farms) sources.push({ kind: 'farm', x: f.x, y: terrain.height(f.x, f.z) + 1.5, z: f.z });
  const stride = Math.max(1, Math.ceil(gardens.length / MAX_GARDENS));
  for (let i = 0; i < gardens.length; i += stride) sources.push(gardens[i]);
  return { x0, z0, step: STEP, n, grid, height, sources, coastal: terrain.profile.coastal };
}

const q = (v: number): number => Math.round(clamp(v, 0, 1) * 255);

/** A 3×3 box blur in place: sound does not stop at a grid line. */
function blur(a: Uint8Array, n: number): void {
  const src = Uint8Array.from(a);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
      s += src[jj * n + ii]; c++;
    }
    a[j * n + i] = Math.round(s / c);
  }
}

/** The channels at (x, z), bilinear; outside the grid: open country. */
export function soundAt(map: SoundMap, x: number, z: number, out: SoundSample = newSample()): SoundSample {
  const fx = (x - map.x0) / map.step - 0.5, fz = (z - map.z0) / map.step - 0.5;
  const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, n = map.n;
  for (const c of CHANNELS) {
    const g = map.grid[c];
    const at = (ii: number, jj: number): number => (ii < 0 || jj < 0 || ii >= n || jj >= n ? (c === 'rural' || c === 'green' ? 255 : 0) : g[jj * n + ii]);
    const v = (at(i, j) * (1 - tx) + at(i + 1, j) * tx) * (1 - tz) + (at(i, j + 1) * (1 - tx) + at(i + 1, j + 1) * tx) * tz;
    out[c] = v / 255;
  }
  return out;
}

/** Ground height at (x, z), bilinear (the edge value outside the grid). */
export function groundAt(map: SoundMap, x: number, z: number): number {
  const n = map.n;
  const fx = clamp((x - map.x0) / map.step - 0.5, 0, n - 1.001), fz = clamp((z - map.z0) / map.step - 0.5, 0, n - 1.001);
  const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, h = map.height;
  const at = (ii: number, jj: number): number => h[Math.min(n - 1, jj) * n + Math.min(n - 1, ii)];
  return (at(i, j) * (1 - tx) + at(i + 1, j) * tx) * (1 - tz) + (at(i, j + 1) * (1 - tx) + at(i + 1, j + 1) * tx) * tz;
}

/** The typed arrays of a sound map (to transfer it from the worker without a copy). */
export const soundMapTransferables = (m: SoundMap): ArrayBuffer[] => [...CHANNELS.map((c) => m.grid[c].buffer as ArrayBuffer), m.height.buffer as ArrayBuffer];

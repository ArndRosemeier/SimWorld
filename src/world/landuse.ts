/**
 * Countryside land use: a global, seed-driven classification of the land beyond the city into
 * forest, farmland (a patchwork of parcels with crops), meadow and green river banks.
 *
 * Everything is a pure function of world position (plus the terrain), cheap enough to run per
 * terrain vertex and per tree candidate in the workers. It does not depend on the macro plan,
 * only on the city outline (a function of the profile), so a later world with several cities
 * can blend several outlines the same way.
 *
 * Ported from Scale (src/world/landuse.ts). Scale's GLSL twin of the parcel layout (for its
 * ground shader) is left behind: the ground material ports it to TSL with the same integer hash,
 * so the two agree to the millimetre. The farm ring starts closer to the town than Scale's (a
 * town has fields at its doorstep).
 */
import { Noise, Rng, deriveSeed, hash2i, hashToFloat, smoothstep } from '@futuremagic/core';
import { makeBoundary, boundaryAt } from './boundary';
import type { Terrain, WaterQuery } from './terrain';
import type { RuralPlan } from './rural';

export interface LandSample {
  /** Countryside weight: 0 in the city … 1 out in the country. */
  rural: number;
  /** Shares of the countryside part (forest + field + meadow = 1). */
  forest: number;
  field: number;
  meadow: number;
  /** Green river bank strip 0..1. */
  bank: number;
  /** Distance beyond the city outline (m, negative inside). */
  edge: number;
  /** Distance from the nearest river bank (m, Infinity when far). */
  water: number;
}

export function newLandSample(): LandSample {
  return { rural: 0, forest: 0, field: 0, meadow: 1, bank: 0, edge: 0, water: Infinity };
}

/** Parcel grid parameters (seed-derived; shared with the shader). */
export interface ParcelParams {
  seed: number;
  cos: number;
  sin: number;
  /** Cell size across (u) and along (v) the rows of parcels (m). */
  su: number;
  sv: number;
  /** Gentle warp of the grid (amplitude m, phases). */
  warp: number;
  ph1: number;
  ph2: number;
}

export const enum Crop { Wheat = 0, Barley = 1, Green = 2, Maize = 3, Ploughed = 4, Pasture = 5, Rapeseed = 6, Stubble = 7 }
/** Parcel id (mod 16) → crop. */
export const CROP_OF = [0, 0, 0, 1, 2, 2, 2, 3, 3, 4, 4, 5, 5, 5, 6, 7];

/**
 * How a parcel of each crop looks through the year (the farming calendar of a temperate climate): `out` gets the
 * crop's colour (sRGB) and how much of the soil it covers (0 bare … 1 closed; under 0.08 the field is ploughed and
 * shows furrows). Winter wheat and barley come up green in the autumn, ripen gold in July and leave stubble until
 * the plough; rapeseed flowers yellow in late April and May; maize and beet are sown in spring into ploughed
 * fields and harvested in the autumn. The parcels of `Ploughed` grow spring barley and those of `Stubble` a late
 * sown wheat, so every field changes with the seasons. `doy`: day of the year, 0 … 365.
 */
export function cropLook(crop: Crop, doy: number, out: number[]): number[] {
  const keys = CROP_YEAR[crop];
  const d = ((doy % 365) + 365) % 365;
  let k = 0;
  while (k + 1 < keys.length && keys[k + 1][0] <= d) k++;
  const a = keys[k], b = keys[(k + 1) % keys.length];
  const span = (b[0] - a[0] + 365) % 365 || 365;
  const t = ((d - a[0] + 365) % 365) / span;
  for (let i = 0; i < 4; i++) out[i] = a[i + 1] + (b[i + 1] - a[i + 1]) * t;
  return out;
}

type CropKey = readonly [day: number, r: number, g: number, b: number, cover: number];
const SOIL: [number, number, number, number] = [0.38, 0.29, 0.2, 0];
const SHOOTS = (cover: number): [number, number, number, number] => [0.42, 0.55, 0.2, cover];
const GREEN: [number, number, number, number] = [0.36, 0.5, 0.17, 0.85];
const STUBBLE: [number, number, number, number] = [0.64, 0.58, 0.4, 0.75];
const cereal = (ripe: number, colour: [number, number, number]): CropKey[] => [
  [0, ...SHOOTS(0.3)], [70, ...SHOOTS(0.4)], [ripe - 95, ...GREEN], [ripe - 40, 0.4, 0.5, 0.2, 0.92],
  [ripe - 18, 0.6, 0.55, 0.28, 0.9], [ripe, ...colour, 0.9], [ripe + 12, ...colour, 0.9], [ripe + 16, ...STUBBLE],
  [ripe + 50, ...STUBBLE], [ripe + 57, ...SOIL], [ripe + 80, ...SOIL], [ripe + 100, ...SHOOTS(0.15)],
];
/** Key days of each crop's year (`Crop` order): [day, r, g, b, cover], interpolated, wrapping at the year's end. */
const CROP_YEAR: readonly CropKey[][] = [
  cereal(200, [0.66, 0.56, 0.3]),
  cereal(190, [0.72, 0.66, 0.42]),
  [[0, ...SOIL], [100, ...SOIL], [135, ...SHOOTS(0.15)], [175, ...GREEN], [260, ...GREEN], [280, 0.45, 0.48, 0.22, 0.7], [290, ...SOIL]],
  [[0, 0.55, 0.5, 0.35, 0.5], [85, 0.55, 0.5, 0.35, 0.5], [92, ...SOIL], [130, ...SOIL], [150, ...SHOOTS(0.12)], [190, 0.3, 0.45, 0.15, 0.6], [215, 0.25, 0.37, 0.13, 0.95], [262, 0.25, 0.37, 0.13, 0.95], [278, 0.6, 0.55, 0.35, 0.9], [288, 0.55, 0.5, 0.35, 0.5]],
  [[0, ...SOIL], [78, ...SOIL], [95, ...SHOOTS(0.15)], [150, ...GREEN], [185, 0.6, 0.55, 0.28, 0.9], [205, 0.72, 0.66, 0.42, 0.9], [215, 0.72, 0.66, 0.42, 0.9], [219, ...STUBBLE], [300, ...STUBBLE], [307, ...SOIL]],
  [[0, 0.4, 0.5, 0.22, 1]],
  [[0, ...SHOOTS(0.55)], [100, ...SHOOTS(0.8)], [112, 0.8, 0.74, 0.2, 0.95], [140, 0.8, 0.74, 0.2, 0.95], [152, 0.42, 0.5, 0.22, 0.9], [188, 0.5, 0.45, 0.28, 0.85], [196, ...STUBBLE], [238, ...STUBBLE], [244, ...SOIL], [250, ...SOIL], [262, ...SHOOTS(0.2)]],
  cereal(212, [0.66, 0.56, 0.3]),
];

export const WARP_K1 = 1 / 730, WARP_K2 = 1 / 910;

export function parcelParams(seed: number): ParcelParams {
  const rng = new Rng(deriveSeed(seed, 'parcels'));
  const a = rng.range(0, Math.PI);
  return { seed: deriveSeed(seed, 'parcel-hash'), cos: Math.cos(a), sin: Math.sin(a), su: rng.range(170, 250), sv: rng.range(110, 160), warp: rng.range(20, 45), ph1: rng.range(0, 6.28), ph2: rng.range(0, 6.28) };
}

export interface Parcel {
  /** Cell (i, j) and strip within the cell. */
  i: number;
  j: number;
  strip: number;
  /** Parcel hash. */
  id: number;
  crop: Crop;
  /** Distance to the parcel's edge (m). */
  border: number;
  /** Fractions across the cell (fu) and the row (fv), 0..1. */
  fu: number;
  fv: number;
}

/** Parcel at a world position (mirrors PARCEL_GLSL). */
export function parcelAt(P: ParcelParams, x: number, z: number, out: Parcel): Parcel {
  const px = x + P.warp * Math.sin(z * WARP_K1 + P.ph1), pz = z + P.warp * Math.sin(x * WARP_K2 + P.ph2);
  const u = px * P.cos + pz * P.sin, v = -px * P.sin + pz * P.cos;
  const vv = v / P.sv;
  const j = Math.floor(vv), fv = vv - j;
  const off = hashToFloat(hash2i(P.seed, 7, j)) * P.su;
  const uu = (u + off) / P.su;
  const i = Math.floor(uu), fu = uu - i;
  const h = hash2i(P.seed, i, j);
  const k = 1 + (h % 3);
  const fsk = fu * k, si = Math.floor(fsk), fs = fsk - si;
  const id = hash2i(P.seed ^ 0x9e37, i * 4 + si, j);
  out.i = i; out.j = j; out.strip = si; out.id = id; out.crop = CROP_OF[id % 16] as Crop;
  out.border = Math.min(Math.min(fs, 1 - fs) * (P.su / k), Math.min(fv, 1 - fv) * P.sv);
  out.fu = fu; out.fv = fv;
  return out;
}

/** World position of parcel-grid coordinates (u, v) (inverse rotation; ignores the small warp). */
export function parcelToWorld(P: ParcelParams, u: number, v: number): [number, number] {
  return [u * P.cos - v * P.sin, u * P.sin + v * P.cos];
}

/** Does the border between row j and j+1 (above cell i), or the border left of cell i in row j, carry a hedgerow? */
export function hedgeOnRow(P: ParcelParams, i: number, j: number): boolean { return hashToFloat(hash2i(P.seed ^ 0x51ed, i, j)) < 0.3; }
export function hedgeOnCol(P: ParcelParams, i: number, j: number): boolean { return hashToFloat(hash2i(P.seed ^ 0x2c1b, i, j)) < 0.25; }

/**
 * The land-use field of one world. Construct once per thread (it holds a noise table and the
 * city outline); `sample` is the hot path.
 */
export class LandUse {
  readonly parcels: ParcelParams;
  private noise: Noise;
  private boundary: number[];
  private wq: WaterQuery = { d: Infinity, s: 0, river: -1, halfWidth: 0, level: 0 };
  /**
   * Farms and country roads (world/rural), attached once planned (the plan reads this land use
   * without them): fields and forest give way to them.
   */
  settle: RuralPlan | null = null;

  constructor(readonly terrain: Terrain) {
    const p = terrain.profile;
    this.noise = new Noise(deriveSeed(p.seed, 'landuse'));
    this.boundary = makeBoundary(p);
    this.parcels = parcelParams(p.seed);
  }

  /** Distance beyond the city outline (negative inside). */
  edge(x: number, z: number): number {
    return Math.hypot(x, z) - boundaryAt(this.boundary, x, z);
  }

  /** Land use at (x, z); `slope` (rise per metre) is computed when not given. */
  sample(x: number, z: number, out: LandSample, slope = -1): LandSample {
    const e = this.edge(x, z);
    out.edge = e;
    out.rural = smoothstep(-40, 160, e);
    if (out.rural <= 0) { out.forest = 0; out.field = 0; out.meadow = 1; out.bank = 0; out.water = Infinity; return out; }
    if (slope < 0) slope = this.terrain.slope(x, z, 6);
    const n = this.noise;
    // River banks: green strip, no fields, a ragged forest edge.
    const w = this.terrain.water(x, z, this.wq);
    const dr = w.river >= 0 ? w.d - w.halfWidth : Infinity;
    // Lake shores count as banks too, with a narrower green strip (a wide one reads as a dark ring).
    const lq = this.terrain.lakeAt(x, z);
    const dl = lq.lake >= 0 ? Math.max(0, lq.e) : Infinity;
    const dw = Math.min(dr, dl);
    out.water = dw;
    out.bank = Math.max(1 - smoothstep(4, 35, dr), 1 - smoothstep(2, 12, dl));
    // Forest: large warped patches, preferring slopes, thinning towards the city.
    const wx = x + 650 * n.n2(x / 4100, z / 4100), wz = z + 650 * n.n2(x / 4100 + 19.3, z / 4100 - 7.1);
    let f = n.fbm2(wx / 2300, wz / 2300, 4) * 0.5 + 0.5;
    f += Math.min(0.35, slope * 1.8);
    f -= 0.2 * (1 - smoothstep(150, 1400, e));
    let forest = smoothstep(0.57, 0.63, f) * smoothstep(1, 14, dw);
    if (this.terrain.profile.coastal) forest *= smoothstep(30, 140, this.terrain.coastDistance(x, z));
    // Fields: flat, dry, away from the city edge, in farming regions.
    const flat = 1 - smoothstep(0.07, 0.14, slope);
    const dry = smoothstep(18, 45, dw);
    const coast = this.terrain.profile.coastal ? smoothstep(60, 170, this.terrain.coastDistance(x, z)) : 1;
    const ring = smoothstep(40, 220, e);
    const farm = smoothstep(0.26, 0.4, n.fbm2(x / 3100 + 50.7, z / 3100 - 3.3, 3) * 0.5 + 0.5);
    let field = (1 - forest) * flat * dry * coast * ring * farm;
    // Yards and orchards clear the land; roads cut through forests and run between fields.
    const S = this.settle;
    if (S) {
      const c = S.clearing(x, z), re = S.roadEdge(x, z);
      forest *= (1 - c) * smoothstep(2.5, 9, re);
      field *= (1 - c) * smoothstep(0.5, 3, re);
    }
    forest = Math.max(0, Math.min(1, forest));
    out.forest = forest;
    out.field = field;
    out.meadow = Math.max(0, 1 - forest - field);
    return out;
  }
}

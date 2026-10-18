/**
 * Procedural trees and shrubs as mesh data (pure, runs in the town workers), deterministic per
 * (species, variant):
 *  - wood: recursive branching (per-species level parameters, gravitropism, random curvature),
 *    every branch limited by a species crown envelope so silhouettes read as the real species;
 *  - leaves: alpha-tested cards carrying whole twig clusters from the leaf atlas
 *    (src/build/vegetationTex.ts), with spherical (crown-ellipsoid) normals for soft canopy
 *    lighting and baked crown occlusion;
 *  - far: a ≤150-triangle canopy hull (envelope-shaped, noise-dissolved edges in the shader).
 *
 * The meshes carry the attributes of their material kinds (src/render/materials.ts `BARK`,
 * `LEAVES`, `TREE_FAR`): `BARK_SPECS`, `LEAF_SPECS`, `FAR_SPECS`. Instances go in at any yaw and
 * uniform scale (src/render/vegetationView.ts).
 *  - aWind (0 at the root … 1 at the tips): how far the wind moves the vertex.
 *  - aOcc (0 open … 1 deep inside the crown): baked crown occlusion, wood and leaves.
 *  - wood uv.x encodes the bark atlas strip: uv.x = strip * 16 + u (u wraps around the branch).
 *  - far: color (linear), aAutumn (linear autumn colour), uv = (kind, deciduous).
 *
 * Ported from Scale (src/props/vegetation.ts): the model generation, with three.js vectors
 * swapped for core's tuples and the BufferGeometry builders for MeshBuilder. Its materials went
 * to src/render/tsl/vegetation.ts, its atlases to src/build/vegetationTex.ts; toppling and the
 * other destruction is left behind.
 */
import {
  Noise, Rng, clamp, smoothstep as smooth, srgbToLinear, dist3, v3add, v3cross, v3dot, v3len, v3lerp, v3madd, v3norm, v3scale, v3sub, type Vec3,
} from '@futuremagic/core';
import { MeshBuilder, type AttrSpec, type MeshData } from './meshBuilder';

export type TreeSpecies = 'plane' | 'linden' | 'maple' | 'oak' | 'birch' | 'pine' | 'palm' | 'cypress' | 'chestnut' | 'ginkgo';
export const TREE_SPECIES: readonly TreeSpecies[] = ['plane', 'linden', 'maple', 'oak', 'birch', 'pine', 'palm', 'cypress', 'chestnut', 'ginkgo'];

/** The attributes of the three vegetation kinds' meshes (besides position and normal). */
export const BARK_SPECS: AttrSpec[] = [{ name: 'uv', size: 2 }, { name: 'aWind', size: 1, type: 'u8n' }, { name: 'aOcc', size: 1, type: 'u8n' }];
export const LEAF_SPECS: AttrSpec[] = [{ name: 'uv', size: 2 }, { name: 'aWind', size: 1, type: 'u8n' }, { name: 'aLeafTint', size: 1, type: 'u8n' }, { name: 'aOcc', size: 1, type: 'u8n' }];
export const FAR_SPECS: AttrSpec[] = [{ name: 'uv', size: 2 }, { name: 'color', size: 3 }, { name: 'aAutumn', size: 3 }, { name: 'aWind', size: 1, type: 'u8n' }];

/** Columns of the bark atlas (src/build/vegetationTex.ts). */
export const BARK_STRIPS = 8;

export interface TreeModelData {
  /** Height of the model at scale 1 (m). */
  height: number;
  trunkRadius: number;
  /** Crown radius (m). */
  crownRadius: number;
  wood: MeshData;
  leaves: MeshData;
  far: MeshData;
}

// ---------------------------------------------------------------------------------------------
// The model roster: every (species, variant) the town and the countryside draw, by index
// ---------------------------------------------------------------------------------------------

export interface VegModel { species: TreeSpecies | 'shrub'; variant: number }

/** Every model, two variants per tree species and four shrubs (odd shrubs: evergreen box). */
export const VEG_MODELS: readonly VegModel[] = [
  ...TREE_SPECIES.flatMap((species) => [0, 1].map((variant) => ({ species, variant }))),
  ...[0, 1, 2, 3].map((variant) => ({ species: 'shrub' as const, variant })),
];

/** Index of a model in `VEG_MODELS` (trees: variant mod 2, shrubs mod 4). */
export function vegModelIndex(species: TreeSpecies | 'shrub', variant: number): number {
  if (species === 'shrub') return TREE_SPECIES.length * 2 + (Math.abs(variant | 0) % 4);
  return TREE_SPECIES.indexOf(species) * 2 + (Math.abs(variant | 0) % 2);
}

/** The mesh data of model `index` (of `VEG_MODELS`). */
export function buildVegModel(index: number): TreeModelData {
  const m = VEG_MODELS[index];
  if (!m) throw new Error(`vegetation: no model ${index}`);
  return m.species === 'palm' ? buildPalm(m.variant) : buildGeneric(m.species, m.variant);
}

// ---------------------------------------------------------------------------------------------
// Small vector helpers
// ---------------------------------------------------------------------------------------------

const UP: Vec3 = [0, 1, 0];
const X: Vec3 = [1, 0, 0];
const deg = Math.PI / 180;

function perpBasis(t: Vec3): [Vec3, Vec3] {
  const p1 = v3norm(v3cross(t, Math.abs(t[1]) < 0.92 ? UP : X));
  return [p1, v3norm(v3cross(t, p1))];
}

const randUnit = (rng: Rng): Vec3 => rng.onSphere();
/** A random horizontal unit vector. */
function randFlat(rng: Rng): Vec3 {
  const o = randUnit(rng);
  return v3norm([o[0], 0, o[2]]);
}

/** v rotated by `angle` around the unit `axis` (Rodrigues). */
function rotateAxis(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle), s = Math.sin(angle);
  return v3madd(v3madd(v3scale(v, c), v3cross(axis, v), s), axis, v3dot(axis, v) * (1 - c));
}

/** v rotated by the rotation that takes unit `a` to unit `b` (three's Quaternion.setFromUnitVectors). */
function rotateFromTo(v: Vec3, a: Vec3, b: Vec3): Vec3 {
  const ax = v3cross(a, b), s = v3len(ax), c = v3dot(a, b);
  if (s < 1e-9) return c > 0 ? v : rotateAxis(v, perpBasis(a)[0], Math.PI);
  return rotateAxis(v, v3scale(ax, 1 / s), Math.atan2(s, c));
}

// ---------------------------------------------------------------------------------------------
// Crown envelope
// ---------------------------------------------------------------------------------------------

class Envelope {
  constructor(
    public base: number,
    public top: number,
    public rx: number,
    public rz: number,
    public prof: (t: number) => number,
    public cx = 0,
    public cz = 0,
  ) {}
  get cy(): number { return (this.base + this.top) * 0.5; }
  get ry(): number { return (this.top - this.base) * 0.5; }
  /** Normalised "radius" (≈1 on the envelope surface). */
  rel(p: Vec3): number {
    const t = (p[1] - this.base) / (this.top - this.base);
    if (t > 1) return 1 + (t - 1) * 4;
    const f = Math.max(0.02, this.prof(clamp(t, 0, 1)));
    const dx = (p[0] - this.cx) / (this.rx * f), dz = (p[2] - this.cz) / (this.rz * f);
    const r = Math.sqrt(dx * dx + dz * dz);
    return t < 0 ? Math.max(r, 1 + -t * 3) : r;
  }
  inside(p: Vec3, m = 1): boolean { return this.rel(p) <= m; }
  /** Ellipsoid-ish normal (unit) and depth (0 centre, 1 surface) for lighting. */
  shade(p: Vec3): [Vec3, number] {
    const o: Vec3 = [(p[0] - this.cx) / this.rx, (p[1] - this.cy) / this.ry, (p[2] - this.cz) / this.rz];
    const d = v3len(o);
    return [d < 1e-4 ? [0, 1, 0] : v3scale(o, 1 / d), d];
  }
  /** Distance from the centre to the envelope along a direction (for far hulls). */
  extent(dir: Vec3): number {
    const c: Vec3 = [this.cx, this.cy, this.cz];
    const maxR = Math.max(this.rx, this.rz, this.ry) * 1.6;
    let last = 0;
    for (let s = 0.05; s < maxR; s += 0.08) {
      if (this.inside(v3madd(c, dir, s), 1)) last = s;
      else if (s > last + 1) break;
    }
    return last;
  }
}

// ---------------------------------------------------------------------------------------------
// Species configuration
// ---------------------------------------------------------------------------------------------

interface LevelCfg {
  n: [number, number];
  start: number;
  end: number;
  angle: number;
  angleVar: number;
  /** length: multiple of crown radius ('width') or of parent length ('parent'). */
  len: number;
  lenRef: 'width' | 'parent';
  rr: number;
  segs: number;
  radial: number;
  up: number;
  curve: number;
  phyllo: number;
  whorl?: number;
  /** extra length factor along the parent: f(t) where t = attach fraction. */
  lenProfile?: (t: number) => number;
}

type CardMode = 'cluster' | 'flat' | 'up' | 'tuft';

interface SpeciesCfg {
  height: [number, number];
  trunkR: number;
  bark: number;
  leafCell: number;
  leafSize: number;
  density: number;
  leafStart: number;
  cardMode: CardMode;
  width: number;
  crownBase: number;
  prof: (t: number) => number;
  trunkTop: number;
  trunkUp: number;
  trunkCurve: number;
  lean: number;
  flare: number;
  lobes: number;
  levels: LevelCfg[];
  /** levels whose branches carry leaves (default: last level). */
  leafLevels?: number[];
  /** cards on the trunk itself (columnar conifers). */
  trunkLeaves?: number;
  /** canopy colour for the far hull (sRGB) and autumn colour (sRGB). */
  farColor: [number, number, number];
  autumn: [number, number, number];
  evergreen?: boolean;
  /** leaf cards per tuft (crossed). */
  cross?: number;
  /** target number of leaf tufts (overrides density when given). */
  cards?: number;
}

const L = (o: Partial<LevelCfg> & Pick<LevelCfg, 'n'>): LevelCfg => ({
  start: 0.2, end: 1, angle: 45, angleVar: 12, len: 0.5, lenRef: 'parent', rr: 0.55,
  segs: 4, radial: 5, up: 0.05, curve: 0.25, phyllo: 137.5, ...o,
});

function speciesCfg(sp: TreeSpecies | 'shrub', variant: number): SpeciesCfg {
  switch (sp) {
    case 'plane':
      return {
        height: [14, 18], trunkR: 0.36, bark: 3, leafCell: 0, cards: 1700, leafSize: 1.35, density: 4.2, leafStart: 0.25, cardMode: 'cluster',
        width: 7.2, crownBase: 0.24, prof: (t) => Math.pow(Math.sin(Math.PI * Math.pow(t, 0.8)), 0.55),
        trunkTop: 0.3, trunkUp: 0, trunkCurve: 0.08, lean: 0.04, flare: 0.35, lobes: 0.06,
        levels: [
          L({ n: [3, 4], start: 1, end: 1, whorl: 4, angle: 32, angleVar: 10, len: 1.25, lenRef: 'width', rr: 0.72, segs: 8, radial: 8, up: 0.06, curve: 0.22 }),
          L({ n: [8, 10], start: 0.18, end: 0.98, angle: 52, angleVar: 15, len: 0.55, rr: 0.5, segs: 4, radial: 5, up: 0.04, curve: 0.3 }),
          L({ n: [3, 4], start: 0.3, end: 1, angle: 48, angleVar: 15, len: 0.45, rr: 0.55, segs: 2, radial: 3, up: 0.0, curve: 0.3 }),
        ],
        farColor: [0.36, 0.45, 0.22], autumn: [0.72, 0.55, 0.25],
      };
    case 'linden':
      return {
        height: [13, 16], trunkR: 0.3, bark: 0, leafCell: 1, cards: 1600, leafSize: 1.15, density: 5.5, leafStart: 0.2, cardMode: 'cluster',
        width: 4.6, crownBase: 0.2, prof: (t) => Math.pow(Math.sin(Math.PI * Math.pow(t, 0.85)), 0.7),
        trunkTop: 0.93, trunkUp: 0.02, trunkCurve: 0.05, lean: 0.02, flare: 0.3, lobes: 0.03,
        levels: [
          L({ n: [15, 19], start: 0.2, end: 0.92, angle: 58, angleVar: 12, len: 1.5, lenRef: 'width', rr: 0.42, segs: 5, radial: 6, up: 0.1, curve: 0.2 }),
          L({ n: [5, 7], start: 0.2, end: 0.95, angle: 48, angleVar: 14, len: 0.5, rr: 0.55, segs: 3, radial: 4, up: -0.04, curve: 0.3 }),
        ],
        leafLevels: [1, 2],
        farColor: [0.3, 0.42, 0.18], autumn: [0.82, 0.68, 0.22],
      };
    case 'maple':
      return {
        height: [11, 14], trunkR: 0.3, bark: 0, leafCell: 2, cards: 1500, leafSize: 1.2, density: 4.6, leafStart: 0.25, cardMode: 'cluster',
        width: 5.2, crownBase: 0.26, prof: (t) => Math.pow(Math.sin(Math.PI * Math.pow(t, 0.9)), 0.5),
        trunkTop: 0.3, trunkUp: 0, trunkCurve: 0.06, lean: 0.03, flare: 0.3, lobes: 0.04,
        levels: [
          L({ n: [4, 5], start: 1, end: 1, whorl: 5, angle: 30, angleVar: 10, len: 1.3, lenRef: 'width', rr: 0.65, segs: 7, radial: 7, up: 0.08, curve: 0.2 }),
          L({ n: [7, 9], start: 0.2, end: 0.98, angle: 50, angleVar: 14, len: 0.55, rr: 0.5, segs: 3, radial: 4, up: 0.05, curve: 0.3 }),
          L({ n: [3, 3], start: 0.35, end: 1, angle: 45, angleVar: 12, len: 0.45, rr: 0.55, segs: 2, radial: 3, up: 0.02, curve: 0.3 }),
        ],
        farColor: [0.27, 0.4, 0.16], autumn: [0.85, 0.3, 0.08],
      };
    case 'oak':
      return {
        height: [12, 15], trunkR: 0.46, bark: 1, leafCell: 3, cards: 1700, leafSize: 1.15, density: 4.6, leafStart: 0.25, cardMode: 'cluster',
        width: 8, crownBase: 0.2, prof: (t) => Math.pow(Math.sin(Math.PI * Math.pow(t, 0.72)), 0.45),
        trunkTop: 0.26, trunkUp: 0, trunkCurve: 0.14, lean: 0.06, flare: 0.45, lobes: 0.1,
        levels: [
          L({ n: [4, 5], start: 0.7, end: 1, whorl: 1, phyllo: 140, angle: 66, angleVar: 12, len: 1.3, lenRef: 'width', rr: 0.62, segs: 9, radial: 8, up: 0.0, curve: 0.95 }),
          L({ n: [7, 9], start: 0.15, end: 0.98, angle: 60, angleVar: 18, len: 0.55, rr: 0.5, segs: 4, radial: 4, up: 0.02, curve: 0.85 }),
          L({ n: [3, 4], start: 0.3, end: 1, angle: 50, angleVar: 18, len: 0.45, rr: 0.55, segs: 2, radial: 3, up: 0.02, curve: 0.5 }),
        ],
        farColor: [0.26, 0.36, 0.15], autumn: [0.55, 0.36, 0.12],
      };
    case 'birch':
      return {
        height: [13, 16], trunkR: 0.17, bark: 2, leafCell: 4, cards: 1150, leafSize: 0.95, density: 6.5, leafStart: 0.15, cardMode: 'cluster',
        width: 3.0, crownBase: 0.3, prof: (t) => Math.pow(Math.sin(Math.PI * Math.pow(t, 0.75)), 0.9) * (1 - 0.25 * t),
        trunkTop: 0.96, trunkUp: 0.02, trunkCurve: 0.07, lean: 0.05, flare: 0.15, lobes: 0,
        levels: [
          L({ n: [20, 26], start: 0.28, end: 0.95, angle: 48, angleVar: 12, len: 1.6, lenRef: 'width', rr: 0.36, segs: 5, radial: 4, up: 0.02, curve: 0.25 }),
          L({ n: [4, 5], start: 0.25, end: 0.95, angle: 40, angleVar: 14, len: 0.6, rr: 0.55, segs: 3, radial: 3, up: -0.22, curve: 0.2 }),
        ],
        leafLevels: [1, 2],
        farColor: [0.38, 0.5, 0.22], autumn: [0.9, 0.75, 0.25],
      };
    case 'pine':
      if ((variant & 1) === 0) {
        // Stone / umbrella pine: tall bare trunk, flat spreading crown.
        return {
          height: [12, 15], trunkR: 0.3, bark: 4, leafCell: 8, cards: 950, leafSize: 1.05, density: 5, leafStart: 0.35, cardMode: 'tuft',
          width: 6, crownBase: 0.58,
          prof: (t) => (t < 0.45 ? Math.pow(t / 0.45, 0.6) : Math.sqrt(Math.max(0, 1 - Math.pow((t - 0.45) / 0.55, 2.4)))),
          trunkTop: 0.6, trunkUp: 0.03, trunkCurve: 0.12, lean: 0.1, flare: 0.25, lobes: 0.03,
          levels: [
            L({ n: [4, 5], start: 1, end: 1, whorl: 5, angle: 42, angleVar: 10, len: 1.3, lenRef: 'width', rr: 0.65, segs: 6, radial: 6, up: 0.1, curve: 0.3 }),
            L({ n: [5, 7], start: 0.35, end: 0.98, angle: 45, angleVar: 14, len: 0.5, rr: 0.5, segs: 3, radial: 4, up: 0.08, curve: 0.3 }),
            L({ n: [3, 4], start: 0.4, end: 1, angle: 40, angleVar: 14, len: 0.4, rr: 0.55, segs: 2, radial: 3, up: 0.1, curve: 0.3 }),
          ],
          farColor: [0.17, 0.3, 0.14], autumn: [0.17, 0.3, 0.14], evergreen: true, cross: 2,
        };
      }
      // Conical, whorled pine / spruce form.
      return {
        height: [12, 16], trunkR: 0.27, bark: 4, leafCell: 10, cards: 1800, leafSize: 1.1, density: 3.4, leafStart: 0.1, cardMode: 'flat',
        width: 3.4, crownBase: 0.1, prof: (t) => Math.pow(1 - t, 0.95) * Math.min(1, 0.55 + t * 4),
        trunkTop: 1.0, trunkUp: 0.03, trunkCurve: 0.03, lean: 0.015, flare: 0.25, lobes: 0.02,
        levels: [
          L({ n: [22, 26], whorl: 4, phyllo: 41, start: 0.1, end: 0.97, angle: 82, angleVar: 8, len: 1.4, lenRef: 'width', rr: 0.32, segs: 4, radial: 4, up: -0.02, curve: 0.12 }),
        ],
        leafLevels: [1],
        trunkLeaves: 3,
        farColor: [0.13, 0.25, 0.14], autumn: [0.13, 0.25, 0.14], evergreen: true,
      };
    case 'cypress':
      return {
        height: [12, 16], trunkR: 0.24, bark: 6, leafCell: 9, cards: 1500, leafSize: 0.72, density: 9, leafStart: 0.0, cardMode: 'up',
        width: 1.0, crownBase: 0.03, prof: (t) => Math.pow(Math.min(1, t * 5 + 0.25), 0.5) * Math.pow(1 - t, 0.62),
        trunkTop: 0.98, trunkUp: 0.05, trunkCurve: 0.02, lean: 0.01, flare: 0.2, lobes: 0.04,
        levels: [
          L({ n: [44, 56], start: 0.04, end: 0.96, angle: 22, angleVar: 8, len: 2.2, lenRef: 'width', rr: 0.32, segs: 3, radial: 3, up: 0.25, curve: 0.15 }),
        ],
        leafLevels: [1],
        trunkLeaves: 9,
        farColor: [0.11, 0.22, 0.1], autumn: [0.11, 0.22, 0.1], evergreen: true,
      };
    case 'chestnut':
      return {
        height: [14, 17], trunkR: 0.42, bark: 1, leafCell: 5, cards: 1700, leafSize: 1.35, density: 4.4, leafStart: 0.25, cardMode: 'cluster',
        width: 6.2, crownBase: 0.24, prof: (t) => Math.pow(Math.sin(Math.PI * Math.pow(t, 0.8)), 0.55),
        trunkTop: 0.32, trunkUp: 0, trunkCurve: 0.08, lean: 0.03, flare: 0.35, lobes: 0.06,
        levels: [
          L({ n: [3, 4], start: 1, end: 1, whorl: 4, angle: 30, angleVar: 9, len: 1.3, lenRef: 'width', rr: 0.7, segs: 8, radial: 8, up: 0.07, curve: 0.2 }),
          L({ n: [8, 10], start: 0.15, end: 0.98, angle: 55, angleVar: 14, len: 0.55, rr: 0.5, segs: 4, radial: 4, up: -0.03, curve: 0.25 }),
          L({ n: [3, 4], start: 0.3, end: 1, angle: 45, angleVar: 12, len: 0.45, rr: 0.55, segs: 2, radial: 3, up: 0.06, curve: 0.25 }),
        ],
        farColor: [0.24, 0.36, 0.14], autumn: [0.62, 0.42, 0.16],
      };
    case 'ginkgo':
      return {
        height: [12, 15], trunkR: 0.27, bark: 7, leafCell: 6, cards: 1150, leafSize: 1.0, density: 4.6, leafStart: 0.2, cardMode: 'cluster',
        width: 3.6, crownBase: 0.2, prof: (t) => Math.pow(Math.sin(Math.PI * Math.pow(t, 0.62)), 0.75) * (1 - 0.3 * t),
        trunkTop: 0.94, trunkUp: 0.02, trunkCurve: 0.05, lean: 0.03, flare: 0.2, lobes: 0.03,
        levels: [
          L({ n: [10, 13], start: 0.2, end: 0.9, angle: 48, angleVar: 20, len: 1.5, lenRef: 'width', rr: 0.42, segs: 5, radial: 5, up: 0.16, curve: 0.3 }),
          L({ n: [4, 5], start: 0.2, end: 0.95, angle: 48, angleVar: 16, len: 0.45, rr: 0.55, segs: 3, radial: 3, up: 0.1, curve: 0.3 }),
        ],
        leafLevels: [1, 2],
        farColor: [0.36, 0.48, 0.2], autumn: [0.98, 0.78, 0.12],
      };
    case 'shrub': {
      const box = (variant & 1) === 1;
      return {
        height: [1.2, 1.8], trunkR: 0.035, bark: 7, leafCell: box ? 11 : 7, cards: 320, leafSize: 0.5, density: 15, leafStart: 0.1, cardMode: 'cluster',
        width: 0.85, crownBase: 0.04, prof: (t) => Math.pow(Math.sin(Math.PI * Math.pow(t, 0.75)), 0.55),
        trunkTop: 0.02, trunkUp: 0, trunkCurve: 0, lean: 0, flare: 0, lobes: 0,
        levels: [
          L({ n: [6, 7], start: 1, end: 1, whorl: 7, angle: 38, angleVar: 16, len: 1.6, lenRef: 'width', rr: 1.0, segs: 4, radial: 4, up: 0.2, curve: 0.3 }),
          L({ n: [3, 4], start: 0.25, end: 0.95, angle: 45, angleVar: 14, len: 0.5, rr: 0.6, segs: 2, radial: 3, up: 0.1, curve: 0.3 }),
        ],
        leafLevels: [1, 2],
        farColor: box ? [0.16, 0.28, 0.12] : [0.27, 0.4, 0.17], autumn: box ? [0.16, 0.28, 0.12] : [0.7, 0.35, 0.12], evergreen: box,
      };
    }
    default:
      return speciesCfg('linden', variant);
  }
}

// ---------------------------------------------------------------------------------------------
// Branch growth
// ---------------------------------------------------------------------------------------------

interface Branch {
  pts: Vec3[];
  rad: number[];
  /** cumulative arc length per point */
  arc: number[];
  level: number;
  /** path distance from the root at the branch base */
  d0: number;
  children: Branch[];
}

function branchLen(b: Branch): number { return b.arc[b.arc.length - 1]; }

/** Point, unit tangent and radius at fraction t of the branch. */
function sampleBranch(b: Branch, t: number): [Vec3, Vec3, number] {
  const total = branchLen(b);
  const s = clamp(t, 0, 1) * total;
  let i = 1;
  while (i < b.arc.length - 1 && b.arc[i] < s) i++;
  const a0 = b.arc[i - 1], a1 = b.arc[i];
  const f = a1 > a0 ? (s - a0) / (a1 - a0) : 0;
  return [v3lerp(b.pts[i - 1], b.pts[i], f), v3norm(v3sub(b.pts[i], b.pts[i - 1])), b.rad[i - 1] + (b.rad[i] - b.rad[i - 1]) * f];
}

function makeBranch(pts: Vec3[], r0: number, rTip: number, level: number, d0: number, taperPow = 1): Branch {
  const arc = [0];
  for (let i = 1; i < pts.length; i++) arc.push(arc[i - 1] + dist3(pts[i], pts[i - 1]));
  const total = arc[arc.length - 1] || 1;
  const rad = arc.map((a) => rTip + (r0 - rTip) * Math.pow(1 - a / total, taperPow));
  return { pts, rad, arc, level, d0, children: [] };
}

function growPath(rng: Rng, start: Vec3, dir: Vec3, len: number, segs: number, up: number, curve: number, env: Envelope | null, minLen: number): Vec3[] {
  const pts: Vec3[] = [start];
  let d = v3norm(dir), p = start;
  const segL = len / segs;
  let acc = 0;
  for (let i = 0; i < segs; i++) {
    if (i > 0) {
      d = v3madd(d, UP, up * segL);
      d = v3norm(v3madd(d, randUnit(rng), curve * Math.sqrt(segL) * 0.45));
    }
    const np = v3madd(p, d, segL);
    if (env && acc + segL > minLen && !env.inside(np, 1)) {
      // bisect to the envelope boundary
      let lo = 0, hi = 1;
      for (let k = 0; k < 6; k++) {
        const m = (lo + hi) / 2;
        if (env.inside(v3madd(p, d, segL * m), 1)) lo = m; else hi = m;
      }
      if (lo * segL > 0.08) pts.push(v3madd(p, d, segL * lo));
      break;
    }
    p = np;
    acc += segL;
    pts.push(p);
  }
  return pts;
}

interface TreeSkeleton {
  branches: Branch[];
  env: Envelope;
  height: number;
  maxPath: number;
}

function buildSkeleton(cfg: SpeciesCfg, rng: Rng): TreeSkeleton {
  const H = rng.range(cfg.height[0], cfg.height[1]);
  const wScale = rng.range(0.88, 1.12);
  const branches: Branch[] = [];

  // Trunk
  const leanDir = randFlat(rng);
  const trunkDir = v3norm(v3madd(UP, leanDir, cfg.lean * rng.range(0.4, 1.2)));
  const trunkLen = Math.max(0.05, H * cfg.trunkTop);
  const trunkSegs = trunkLen < 0.5 ? 1 : Math.max(6, Math.round(trunkLen / 0.7));
  const tPts = growPath(rng, [0, -0.15, 0], trunkDir, trunkLen + 0.15, trunkSegs, cfg.trunkUp, cfg.trunkCurve, null, 0);
  const excurrent = cfg.trunkTop > 0.8;
  const trunkR = cfg.trunkR * rng.range(0.9, 1.1);
  const trunk = makeBranch(tPts, trunkR * 1.05, excurrent ? 0.02 : trunkR * 0.78, 0, 0, excurrent ? 0.9 : 1);
  branches.push(trunk);
  const top = tPts[tPts.length - 1];

  const envBase = H * cfg.crownBase;
  const env = new Envelope(
    envBase, H,
    cfg.width * wScale * rng.range(0.92, 1.08), cfg.width * wScale * rng.range(0.92, 1.08),
    cfg.prof,
    excurrent ? top[0] * 0.4 + rng.range(-0.2, 0.2) : top[0] + rng.range(-0.3, 0.3),
    excurrent ? top[2] * 0.4 + rng.range(-0.2, 0.2) : top[2] + rng.range(-0.3, 0.3),
  );

  const spawn = (parent: Branch, li: number) => {
    const lv = cfg.levels[li];
    if (!lv) return;
    const nodes = rng.int(lv.n[0], lv.n[1]);
    const perNode = lv.whorl && lv.start < 1 ? lv.whorl : 1;
    const isTop = lv.start >= 1;
    let az = rng.range(0, Math.PI * 2);
    const pLen = branchLen(parent);
    const count = nodes;
    for (let k = 0; k < count; k++) {
      const t = isTop ? 1 : lv.start + (lv.end - lv.start) * ((k + 0.5 + rng.range(-0.35, 0.35)) / count);
      const [P, T, pr] = sampleBranch(parent, t);
      for (let w = 0; w < perNode; w++) {
        let a = az + (perNode > 1 ? (w / perNode) * Math.PI * 2 + rng.range(-0.25, 0.25) : 0);
        if (isTop) a = az + (k / count) * Math.PI * 2 + rng.range(-0.3, 0.3);
        const ang = (lv.angle + rng.range(-lv.angleVar, lv.angleVar)) * deg;
        const [p1, p2] = perpBasis(T);
        const mk = (aa: number) => v3norm(v3madd(v3scale(T, Math.cos(ang)), v3madd(v3scale(p1, Math.cos(aa)), p2, Math.sin(aa)), Math.sin(ang)));
        let dir = mk(a);
        if (dir[1] < -0.3 && li > 0) dir = mk(a + Math.PI);
        let len = lv.lenRef === 'width' ? lv.len * env.rx : lv.len * pLen * (1 - t * 0.45);
        len *= rng.range(0.75, 1.1) * (lv.lenProfile ? lv.lenProfile(t) : 1);
        const segs = Math.max(1, lv.segs);
        const minLen = Math.min(len, lv.lenRef === 'width' ? 0.8 : 0.25);
        const pts = growPath(rng, P, dir, len, segs, lv.up, lv.curve, env, minLen);
        if (pts.length < 2) continue;
        const r0 = Math.max(0.008, pr * lv.rr * rng.range(0.85, 1.05));
        const parentArcAt = parent.d0 + t * pLen;
        const b = makeBranch(pts, r0, Math.max(0.004, r0 * 0.18), li + 1, parentArcAt);
        parent.children.push(b);
        branches.push(b);
        spawn(b, li + 1);
      }
      az += lv.phyllo * deg + rng.range(-0.3, 0.3);
    }
  };
  spawn(trunk, 0);

  let maxPath = 1, maxY = 0;
  for (const b of branches) {
    maxPath = Math.max(maxPath, b.d0 + branchLen(b));
    for (const p of b.pts) maxY = Math.max(maxY, p[1]);
  }
  return { branches, env, height: Math.max(H, maxY), maxPath };
}

// ---------------------------------------------------------------------------------------------
// Wood mesh
// ---------------------------------------------------------------------------------------------

const woodNoise = new Noise(0x7ee5);

/** One vertex of a vegetation mesh (bark or leaves: uv, aWind, aOcc, and aLeafTint on leaves). */
function vert(mb: MeshBuilder, p: Vec3, n: Vec3, u: number, v: number, w: number, tint: number, occ: number): number {
  mb.cur.aWind[0] = w;
  mb.cur.aOcc[0] = occ;
  if (mb.cur.aLeafTint) mb.cur.aLeafTint[0] = tint;
  return mb.v(p[0], p[1], p[2], n[0], n[1], n[2], u, v);
}

function tube(mb: MeshBuilder, b: Branch, radial: number, strip: number, maxPath: number, env: Envelope | null, trunk: SpeciesCfg | null, seed: number): void {
  const n = b.pts.length;
  if (n < 2) return;
  // parallel transport frames
  const tans: Vec3[] = [];
  for (let i = 0; i < n; i++) tans.push(v3norm(v3sub(b.pts[Math.min(n - 1, i + 1)], b.pts[Math.max(0, i - 1)])));
  let [nx, ny] = perpBasis(tans[0]);
  const frames: [Vec3, Vec3][] = [];
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      nx = rotateFromTo(nx, tans[i - 1], tans[i]);
      ny = v3norm(v3cross(tans[i], nx));
      nx = v3norm(v3cross(ny, tans[i]));
    }
    frames.push([nx, ny]);
  }
  const r0 = b.rad[0];
  const wraps = Math.max(1, Math.round((2 * Math.PI * r0) / 0.55));
  const wrapWidth = (2 * Math.PI * Math.max(r0, 0.02)) / wraps;
  const base = mb.vcount;
  let v = (seed % 97) * 0.173;
  for (let i = 0; i < n; i++) {
    if (i > 0) v += dist3(b.pts[i], b.pts[i - 1]) / (wrapWidth * 4 * Math.max(0.35, b.rad[i] / r0));
    const c = b.pts[i];
    let r = b.rad[i];
    const y = c[1];
    if (trunk) r *= 1 + trunk.flare * Math.exp(-Math.max(0, y) / 0.45);
    const w = (b.d0 + b.arc[i]) / maxPath;
    let occ = 0;
    if (env) {
      const d = env.shade(c)[1];
      if (d < 1.05) occ = 0.55 * (1 - smooth(0.2, 1.05, d));
    }
    occ = Math.max(occ, 0.5 * Math.exp(-Math.max(0, y) / 0.35));
    const [fx, fy] = frames[i];
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const nn = v3madd(v3scale(fx, ca), fy, sa);
      let rr = r;
      if (trunk && trunk.lobes > 0) {
        const k = woodNoise.n2(ca * 1.3 + seed * 0.01, y * 0.35) * 0.6 + woodNoise.n2(sa * 2.1, y * 0.9 + 4.2) * 0.4;
        rr *= 1 + trunk.lobes * k * (1 + 1.5 * Math.exp(-Math.max(0, y) / 0.8));
      }
      vert(mb, v3madd(c, nn, rr), nn, strip * 16 + (j / radial) * wraps, v, w, 0, occ);
    }
  }
  const rs = radial + 1;
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = base + i * rs + j, b2 = a + rs;
      // Counter-clockwise seen from outside (the ring runs counter-clockwise around the branch
      // direction): the bark is front-sided, and the opposite winding showed the trunks inside-out.
      mb.tri(a, a + 1, b2);
      mb.tri(a + 1, b2 + 1, b2);
    }
  }
}

function buildWood(cfg: SpeciesCfg, sk: TreeSkeleton, seed: number): MeshData {
  const mb = new MeshBuilder(BARK_SPECS);
  sk.branches.forEach((b, i) => {
    const radial = b.level === 0 ? (cfg.trunkR > 0.1 ? 10 : 6) : cfg.levels[b.level - 1].radial;
    tube(mb, b, radial, cfg.bark, sk.maxPath, b.level === 0 ? null : sk.env, b.level === 0 ? cfg : null, seed + i * 7);
  });
  return mb.build();
}

// ---------------------------------------------------------------------------------------------
// Leaf cards
// ---------------------------------------------------------------------------------------------

const ATLAS_GRID = 4;
/** atlas uv for a cell: (u,v) in [0,1], v = 0 at the card base. */
function cellUV(cell: number, u: number, v: number, wideCells = 1): [number, number] {
  const cx = cell % ATLAS_GRID, cy = Math.floor(cell / ATLAS_GRID);
  const m = 0.006;
  return [(cx + m + u * (wideCells - 2 * m)) / ATLAS_GRID, (cy + 1 - m - v * (1 - 2 * m)) / ATLAS_GRID];
}

function addCard(mb: MeshBuilder, base: Vec3, axis: Vec3, side: Vec3, w: number, h: number, cell: number, sphN: Vec3, cardN: Vec3, wind: number, tint: number, occ: number, flip: boolean): void {
  const s = v3dot(cardN, sphN) >= 0 ? 1 : -1;
  const n = v3norm(v3madd(v3scale(sphN, 0.78), cardN, 0.22 * s));
  const i0 = mb.vcount;
  for (const [a, b] of [[-0.5, 0], [0.5, 0], [0.5, 1], [-0.5, 1]]) {
    const p = v3madd(v3madd(base, side, a * w), axis, b * h);
    const [u, v] = cellUV(cell, flip ? 0.5 - a : a + 0.5, b);
    vert(mb, p, n, u, v, Math.min(1, wind + b * 0.12), tint, occ);
  }
  mb.tri(i0, i0 + 1, i0 + 2);
  mb.tri(i0, i0 + 2, i0 + 3);
}

function buildLeaves(cfg: SpeciesCfg, sk: TreeSkeleton, rng: Rng): MeshData {
  const mb = new MeshBuilder(LEAF_SPECS);
  const env = sk.env;
  const leafLevels = cfg.leafLevels ?? [cfg.levels.length];
  const maxLevel = cfg.levels.length;

  const placeCard = (pt: Vec3, tan: Vec3, wPath: number, sizeMul: number) => {
    const size = cfg.leafSize * 1.3 * sizeMul * rng.range(0.8, 1.2);
    // unmodelled twigs: scatter the tuft around the branch, biased outwards
    if (cfg.cardMode !== 'flat') {
      const [q1, q2] = perpBasis(tan);
      const a = rng.range(0, Math.PI * 2);
      let off = v3madd(v3scale(q1, Math.cos(a)), q2, Math.sin(a));
      const toOut = v3norm([pt[0] - env.cx, pt[1] - env.cy, pt[2] - env.cz]);
      if (v3dot(off, toOut) < 0) off = v3scale(off, -0.6);
      pt = v3madd(pt, off, rng.range(0, cfg.leafSize * 0.7));
    }
    const [sph, d] = env.shade(pt);
    let outward: Vec3 = [pt[0] - env.cx, 0, pt[2] - env.cz];
    if (v3dot(outward, outward) < 1e-4) { const o = randUnit(rng); outward = [o[0], 0, o[2]]; }
    outward = v3norm(outward);
    let axis: Vec3, nrm0: Vec3;
    switch (cfg.cardMode) {
      case 'flat': {
        const sideDir = v3scale(v3norm(v3cross(tan, UP)), rng.sign());
        axis = v3norm(v3madd(v3madd(tan, sideDir, rng.range(0.3, 1.0)), UP, rng.range(-0.45, 0.35)));
        pt = [pt[0], pt[1] + rng.range(-0.25, 0.2), pt[2]];
        nrm0 = v3madd(UP, randUnit(rng), 0.25);
        break;
      }
      case 'up':
        axis = v3norm(v3madd(v3madd(v3scale(UP, 1.2), outward, rng.range(0.2, 0.7)), randUnit(rng), 0.35));
        nrm0 = v3madd(outward, randUnit(rng), 0.6);
        break;
      case 'tuft':
        axis = v3norm(v3madd(v3madd(v3madd(v3scale(UP, 0.9), tan, 0.6), outward, 0.3), randUnit(rng), 0.45));
        nrm0 = randUnit(rng);
        break;
      default: {
        const rnd = randUnit(rng);
        axis = v3norm(v3madd(v3madd(v3madd(v3scale(tan, 0.55), outward, 0.5), rnd, 0.75), UP, 0.25));
        nrm0 = v3madd(v3madd(v3scale(UP, 0.7), sph, 0.5), randUnit(rng), 0.8);
      }
    }
    nrm0 = v3madd(nrm0, axis, -v3dot(nrm0, axis));
    if (v3dot(nrm0, nrm0) < 1e-4) nrm0 = perpBasis(axis)[0];
    nrm0 = v3norm(nrm0);
    const side = v3norm(v3cross(axis, nrm0));
    const occ = clamp(0.8 * (1 - smooth(0.25, 1.0, d)) + 0.25 * clamp(-sph[1], 0, 1), 0, 1);
    const tint = rng.float();
    const base = v3madd(pt, axis, -size * 0.08);
    const nCross = cfg.cross ?? 1;
    for (let c = 0; c < nCross; c++) {
      const ang = (Math.PI / nCross) * c;
      const sd = c > 0 ? rotateAxis(side, axis, ang) : side, nr = c > 0 ? rotateAxis(nrm0, axis, ang) : nrm0;
      addCard(mb, base, axis, sd, size, size, cfg.leafCell, sph, nr, wPath, tint, occ, rng.chance(0.5));
    }
  };

  let density = cfg.density;
  if (cfg.cards) {
    let total = 0, n = 0;
    for (const b of sk.branches) {
      if (!leafLevels.includes(b.level)) continue;
      const terminal = b.level === maxLevel || b.children.length === 0;
      const start = terminal ? cfg.leafStart : Math.max(cfg.leafStart, 0.55);
      total += branchLen(b) * (1 - start);
      n++;
    }
    density = Math.max(0.5, (cfg.cards - n) / Math.max(1, total));
  }
  for (const b of sk.branches) {
    if (!leafLevels.includes(b.level)) continue;
    const len = branchLen(b);
    const terminal = b.level === maxLevel || b.children.length === 0;
    const start = terminal ? cfg.leafStart : Math.max(cfg.leafStart, 0.55);
    const count = Math.max(1, Math.round(len * (1 - start) * density * rng.range(0.85, 1.15)));
    for (let i = 0; i < count; i++) {
      const t = start + (1 - start) * ((i + rng.range(0.1, 0.9)) / count);
      const [P, T] = sampleBranch(b, t);
      placeCard(P, T, Math.max(0.35, (b.d0 + t * len) / sk.maxPath), 1);
    }
    // tip card
    const [P, T] = sampleBranch(b, 1);
    placeCard(P, T, Math.max(0.4, (b.d0 + len) / sk.maxPath), 1.1);
  }

  if (cfg.trunkLeaves) {
    const trunk = sk.branches[0];
    const tl = branchLen(trunk);
    const s0 = Math.max(0.02, (env.base - trunk.pts[0][1]) / tl);
    const count = Math.round(tl * (1 - s0) * cfg.trunkLeaves);
    for (let i = 0; i < count; i++) {
      const t = s0 + (1 - s0) * ((i + rng.float()) / count);
      const [P0, T] = sampleBranch(trunk, t);
      const out = randFlat(rng);
      const r = env.rx * cfg.prof(clamp((P0[1] - env.base) / (env.top - env.base), 0, 1)) * rng.range(0.1, 0.6);
      placeCard(v3madd(P0, out, r), cfg.cardMode === 'flat' ? out : T, Math.max(0.3, (t * tl) / sk.maxPath), 0.95);
    }
  }
  return mb.build();
}

// ---------------------------------------------------------------------------------------------
// Far hull
// ---------------------------------------------------------------------------------------------

/** One vertex of a far hull: uv = (kind: 0 trunk, 0.5 palm frond, 1 canopy; deciduous), colours sRGB in. */
function farVert(mb: MeshBuilder, p: Vec3, n: Vec3, kind: number, decid: number, col: readonly number[], aut: readonly number[], w: number): number {
  mb.set('color', srgbToLinear(col[0]), srgbToLinear(col[1]), srgbToLinear(col[2]));
  mb.set('aAutumn', srgbToLinear(aut[0]), srgbToLinear(aut[1]), srgbToLinear(aut[2]));
  mb.set('aWind', w);
  return mb.v(p[0], p[1], p[2], n[0], n[1], n[2], kind, decid);
}

const BARK_FAR: [number, number, number][] = [
  [0.33, 0.29, 0.25], [0.3, 0.26, 0.22], [0.82, 0.8, 0.76], [0.55, 0.53, 0.43],
  [0.45, 0.3, 0.22], [0.47, 0.42, 0.35], [0.4, 0.29, 0.22], [0.38, 0.35, 0.31],
];

function farTrunk(mb: MeshBuilder, base: Vec3, top: Vec3, r: number, barkIdx: number, sides = 4): void {
  const col = BARK_FAR[barkIdx];
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2 + 0.4, a1 = ((i + 1) / sides) * Math.PI * 2 + 0.4;
    const q = (a: number, c: Vec3, rr: number): Vec3 => [c[0] + Math.cos(a) * rr, c[1], c[2] + Math.sin(a) * rr];
    const am = (a0 + a1) / 2;
    const n: Vec3 = [Math.cos(am), 0, Math.sin(am)];
    const quad = [q(a0, base, r), q(a1, base, r), q(a1, top, r * 0.6), q(a0, top, r * 0.6)];
    const i0 = mb.vcount;
    quad.forEach((p, k) => farVert(mb, p, n, 0, 0, col, col, k >= 2 ? 0.3 : 0));
    mb.tri(i0, i0 + 2, i0 + 1);
    mb.tri(i0, i0 + 3, i0 + 2);
  }
}

/** The unit icosahedron subdivided once (42 vertices, 80 faces, outward winding). */
function icosphere(): { verts: Vec3[]; faces: [number, number, number][] } {
  const t = (1 + Math.sqrt(5)) / 2;
  const verts: Vec3[] = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((p) => v3norm(p as Vec3));
  const base: [number, number, number][] = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  const mid = new Map<number, number>();
  const half = (a: number, b: number) => {
    const k = Math.min(a, b) * 64 + Math.max(a, b);
    let i = mid.get(k);
    if (i === undefined) { i = verts.push(v3norm(v3add(verts[a], verts[b]))) - 1; mid.set(k, i); }
    return i;
  };
  const faces: [number, number, number][] = [];
  for (const [a, b, c] of base) {
    const ab = half(a, b), bc = half(b, c), ca = half(c, a);
    faces.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
  }
  return { verts, faces };
}
const ICO = icosphere();

function buildFar(cfg: SpeciesCfg, sk: TreeSkeleton): MeshData {
  const mb = new MeshBuilder(FAR_SPECS);
  const env = sk.env;
  const trunk = sk.branches[0];
  const tt = trunk.pts[trunk.pts.length - 1];
  farTrunk(mb, [0, -0.1, 0], [tt[0], Math.min(tt[1], env.base + (env.top - env.base) * 0.35), tt[2]], cfg.trunkR * 1.1, cfg.bark);
  const c: Vec3 = [env.cx, env.cy, env.cz];
  const decid = cfg.evergreen ? 0 : 1;
  const i0 = mb.vcount;
  for (const d of ICO.verts) {
    let e = env.extent(d) * 0.97;
    e *= 1 + 0.12 * woodNoise.n3(d[0] * 1.7 + 3.1, d[1] * 1.7, d[2] * 1.7);
    const p = v3madd(c, d, Math.max(0.3, e));
    const n = v3norm(v3lerp(env.shade(p)[0], d, 0.4));
    const shade = 0.75 + 0.25 * clamp(d[1] * 0.5 + 0.5, 0, 1);
    farVert(mb, p, n, 1, decid, cfg.farColor.map((x) => x * shade), cfg.autumn.map((x) => x * shade * 0.85), 0.75);
  }
  for (const [a, b, cc] of ICO.faces) mb.tri(i0 + a, i0 + b, i0 + cc);
  return mb.build();
}

// ---------------------------------------------------------------------------------------------
// Palm (dedicated builder)
// ---------------------------------------------------------------------------------------------

function buildPalm(variant: number): TreeModelData {
  const rng = Rng.from('tree', 'palm', variant);
  const H = rng.range(8.5, 11.5);
  const wood = new MeshBuilder(BARK_SPECS);
  const leaves = new MeshBuilder(LEAF_SPECS);
  const leanDir = randFlat(rng);
  const lean = rng.range(0.25, 0.5);
  // curved trunk: leans out at the base and gravitropically turns up again
  const pts: Vec3[] = [[0, -0.15, 0]];
  let d = v3norm(v3madd(UP, leanDir, lean));
  const segs = 16;
  const segL = H / segs;
  let p = pts[0];
  for (let i = 0; i < segs; i++) {
    p = v3madd(p, d, segL);
    pts.push(p);
    d = v3madd(d, UP, 0.05 + 0.02 * (i / segs));
    d = v3norm(v3madd(d, randUnit(rng), 0.015));
  }
  const trunk = makeBranch(pts, 0.22, 0.2, 0, 0);
  for (let i = 0; i < trunk.rad.length; i++) trunk.rad[i] = 0.2 + 0.12 * Math.exp(-Math.max(0, pts[i][1]) / 0.6) + (i >= segs - 1 ? 0.03 : 0);
  const maxPath = branchLen(trunk) + 4.5;
  tube(wood, trunk, 9, 5, maxPath, null, null, variant * 31);
  const top = pts[pts.length - 1];
  const tTan = v3norm(v3sub(top, pts[pts.length - 2]));
  const crownC = v3add(top, [0, 0.4, 0]);

  // leaf-base "boots" knob under the crown
  const boot = makeBranch([v3madd(top, tTan, -0.7), v3madd(top, tTan, 0.25)], 0.27, 0.16, 1, branchLen(trunk) - 0.7);
  tube(wood, boot, 9, 5, maxPath, null, null, 5);

  const nFronds = rng.int(18, 23);
  const frond = (az: number, elev: number, len: number, dead: boolean) => {
    const dir0: Vec3 = [Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev)];
    const start = v3madd(top, dir0, 0.12);
    // petiole (wood)
    const petLen = dead ? 0.4 : 0.55;
    const pet = makeBranch([start, v3madd(start, dir0, petLen)], 0.045, 0.03, 2, branchLen(trunk));
    tube(wood, pet, 4, 5, maxPath, null, null, 3);
    // leaflet strip with a V fold
    const fs = 11;
    let fd = dir0;
    let c = pet.pts[1];
    const halfW = dead ? 0.42 : 0.62;
    const cell = dead ? 14 : 12;
    const tint = rng.float();
    const base = leaves.vcount;
    const sl = (len - petLen) / fs;
    for (let i = 0; i <= fs; i++) {
      const t = i / fs;
      if (i > 0) {
        fd = v3norm(v3madd(fd, UP, dead ? -0.5 * sl : -(0.12 + 0.25 * t) * sl * 1.6));
        c = v3madd(c, fd, sl);
      }
      let side = v3cross(fd, UP);
      if (v3dot(side, side) < 1e-4) side = [Math.sin(az), 0, -Math.cos(az)];
      side = v3norm(side);
      const upP = v3norm(v3cross(side, fd));
      const w = halfW * (i === fs ? 0.35 : 1) * (dead ? 0.8 : 1);
      const fold = dead ? -0.5 : 0.38;
      const wind = clamp((branchLen(trunk) + petLen + t * len) / maxPath, 0.5, 1);
      const sph = v3norm(v3sub(c, crownC));
      const occ = dead ? 0.35 : 0.15 * (1 - t);
      const nL = v3norm(v3madd(v3scale(sph, 0.55), upP, 0.45));
      const [u0, vL] = cellUV(cell, t, 1, 2);
      const [, vC] = cellUV(cell, t, 0.5, 2);
      const [, vR] = cellUV(cell, t, 0, 2);
      vert(leaves, v3madd(v3madd(c, side, -w), upP, w * fold), nL, u0, vL, wind, tint, occ);
      vert(leaves, v3madd(c, upP, -0.02), nL, u0, vC, wind, tint, occ);
      vert(leaves, v3madd(v3madd(c, side, w), upP, w * fold), nL, u0, vR, wind, tint, occ);
    }
    for (let i = 0; i < fs; i++) {
      const a = base + i * 3, b = a + 3;
      leaves.tri(a, b, a + 1); leaves.tri(a + 1, b, b + 1);
      leaves.tri(a + 1, b + 1, a + 2); leaves.tri(a + 2, b + 1, b + 2);
    }
  };
  let az = rng.range(0, Math.PI * 2);
  for (let i = 0; i < nFronds; i++) {
    const f = i / (nFronds - 1);
    const elev = (70 - f * 95 + rng.range(-8, 8)) * deg;
    const len = rng.range(3.4, 4.4) * (f < 0.15 ? 0.8 : 1);
    frond(az, elev, len, false);
    az += 137.5 * deg + rng.range(-0.15, 0.15);
  }
  const nDead = rng.int(3, 6);
  for (let i = 0; i < nDead; i++) frond(rng.range(0, Math.PI * 2), rng.range(-82, -65) * deg, rng.range(2.2, 2.9), true);

  // far: trunk + 9 frond ribbons
  const fb = new MeshBuilder(FAR_SPECS);
  farTrunk(fb, [0, -0.1, 0], top, 0.24, 5);
  const green = [0.3, 0.42, 0.18];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.3;
    const elev = (i % 3 === 0 ? 30 : i % 3 === 1 ? 0 : -25) * deg;
    const dir: Vec3 = [Math.cos(a) * Math.cos(elev), Math.sin(elev), Math.sin(a) * Math.cos(elev)];
    const side: Vec3 = [-Math.sin(a), 0, Math.cos(a)];
    const mid = v3add(v3madd(top, dir, 2.0), [0, -0.2, 0]);
    const tip = v3add(v3madd(top, dir, 3.8), [0, -1.2, 0]);
    const q = [v3madd(top, side, 0.15), v3madd(mid, side, 0.55), tip, v3madd(mid, side, -0.55), v3madd(top, side, -0.15)];
    const i0 = fb.vcount;
    for (const k of q) farVert(fb, k, UP, 0.5, 0, green, green, 0.8);
    for (const [a1, b1, c1] of [[0, 1, 4], [1, 3, 4], [1, 2, 3]]) fb.tri(i0 + a1, i0 + b1, i0 + c1);
  }
  return { height: top[1] + 2.2, trunkRadius: 0.22, crownRadius: 4.2, wood: wood.build(), leaves: leaves.build(), far: fb.build() };
}

// ---------------------------------------------------------------------------------------------
// Generic trees and shrubs
// ---------------------------------------------------------------------------------------------

function buildGeneric(kind: TreeSpecies | 'shrub', variant: number): TreeModelData {
  const cfg = speciesCfg(kind, variant);
  const rng = Rng.from('tree', kind, variant);
  const sk = buildSkeleton(cfg, rng.fork('skeleton'));
  const wood = buildWood(cfg, sk, variant * 131 + 7);
  const leaves = buildLeaves(cfg, sk, rng.fork('leaves'));
  const far = buildFar(cfg, sk);
  return { height: Math.max(sk.height, leaves.bounds[4]), trunkRadius: cfg.trunkR, crownRadius: Math.max(sk.env.rx, sk.env.rz), wood, leaves, far };
}

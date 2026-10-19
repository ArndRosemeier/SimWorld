/**
 * Countryside trees of one square tile, from the land-use field (worker side, no three.js):
 * forests, river-bank rows, solitary trees in meadows, hedgerows along some parcel borders and
 * the farms' orchards.
 *
 * Tiles of `FOREST_DETAIL` m and smaller hold the real trees; bigger (far) tiles hold a constant
 * number of canopy clumps (`spread` > 1: each stands for a patch of forest), so a far tile costs
 * the same as a near one whatever its size.
 *
 * Record (FOREST_STRIDE floats): x, y, z, scale, yaw, model (index into VEG_MODELS), spread. The
 * town's own trees, shrubs and yews (`townTrees`, from the cells' props) come as the same records.
 *
 * Ported from Scale (src/build/forest.ts; the town's species from src/props/PropRenderer.ts). SimWorld's countryside has farms only (no villages),
 * so the village gardens are gone and the orchards are the farms'; the kinds name VEG_MODELS.
 */
import { Noise, deriveSeed, hash2i, hash32, hashToFloat, smoothstep } from '@futuremagic/core';
import { distPointPolyEdge, pointInPoly, polyBounds } from '../geom/geom2';
import { hedgeOnCol, hedgeOnRow, newLandSample, parcelToWorld, type LandUse } from '../world/landuse';
import { TERRAIN_DROP } from '../world/ground';
import type { Terrain } from '../world/terrain';
import type { MacroPlan } from '../plan/types';
import { PropType, type CellPlan } from '../plan/cell';
import { vegModelIndex, type TreeSpecies } from './vegetation';

export const FOREST_STRIDE = 7;
/** Tiles of this size and smaller hold real trees. */
export const FOREST_DETAIL = 256;

const M = (s: TreeSpecies | 'shrub', v: number) => vegModelIndex(s, v);
const DECIDUOUS = [M('oak', 0), M('oak', 1), M('linden', 0), M('linden', 1), M('maple', 0), M('maple', 1), M('birch', 0), M('birch', 1), M('chestnut', 0), M('oak', 0), M('oak', 1), M('plane', 0)];
const CONIFER = [M('pine', 0), M('pine', 1), M('pine', 0), M('pine', 1), M('birch', 0)];
const WARM = [M('pine', 0), M('pine', 1), M('cypress', 0), M('oak', 0), M('pine', 0)];
const BANK = [M('birch', 0), M('birch', 1), M('linden', 0), M('linden', 1), M('oak', 0), M('maple', 0)];
const SHRUBS = [M('shrub', 0), M('shrub', 1)];
const HEDGE = [M('oak', 0), M('oak', 1), M('maple', 0), M('linden', 0), ...SHRUBS, ...SHRUBS, SHRUBS[0]];
const SOLO = [M('oak', 0), M('oak', 1), M('linden', 0), M('chestnut', 0), M('maple', 0), M('plane', 0), M('oak', 0)];
const ORCHARD = [M('oak', 0), M('oak', 1), M('maple', 0), M('chestnut', 0)];
const isShrub = (model: number) => model >= M('shrub', 0);

/**
 * Where the town's streets and blocks reach: trees and hedges keep off cells near the outline
 * and off arterial roads (with their sidewalks).
 */
class TownMask {
  private bucket = new Map<number, { poly: number[]; road: number }[]>();
  private static B = 256;
  constructor(macro: MacroPlan, land: LandUse) {
    const addEdge = (poly: number[], road: number) => {
      const b = polyBounds(poly);
      const m = road + 4;
      for (let i = Math.floor((b[0] - m) / TownMask.B); i <= Math.floor((b[2] + m) / TownMask.B); i++) {
        for (let j = Math.floor((b[1] - m) / TownMask.B); j <= Math.floor((b[3] + m) / TownMask.B); j++) {
          const k = (i + 4096) * 8192 + (j + 4096);
          let l = this.bucket.get(k);
          if (!l) this.bucket.set(k, (l = []));
          l.push({ poly, road });
        }
      }
    };
    const nearEdge = (pts: number[]) => { for (let i = 0; i < pts.length; i += 2) if (land.edge(pts[i], pts[i + 1]) > -250) return true; return false; };
    for (const c of macro.cells) if (nearEdge(c.poly)) addEdge(c.poly, 0);
    for (const e of macro.edges) if (nearEdge(e.pts)) addEdge(e.pts, e.width / 2 + e.sidewalk + 3);
  }
  /** Is (x, z) on the town's ground (within `margin` of a cell, or on a road)? */
  has(x: number, z: number, margin: number): boolean {
    const l = this.bucket.get((Math.floor(x / TownMask.B) + 4096) * 8192 + (Math.floor(z / TownMask.B) + 4096));
    if (!l) return false;
    for (const it of l) {
      if (it.road > 0) {
        const p = it.poly;
        for (let i = 0; i + 3 < p.length; i += 2) {
          const ax = p[i], az = p[i + 1], dx = p[i + 2] - ax, dz = p[i + 3] - az, l2 = dx * dx + dz * dz;
          const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
          if (Math.hypot(ax + dx * t - x, az + dz * t - z) < it.road) return true;
        }
      } else if (pointInPoly(it.poly, x, z) || distPointPolyEdge(it.poly, x, z) < margin) return true;
    }
    return false;
  }
}

export class ForestGen {
  private noise: Noise;
  private seed: number;
  private mask: TownMask;
  private ls = newLandSample();
  private warm: number;

  constructor(readonly land: LandUse, macro: MacroPlan) {
    const p = land.terrain.profile;
    this.seed = deriveSeed(p.seed, 'forest');
    this.noise = new Noise(this.seed);
    this.mask = new TownMask(macro, land);
    this.warm = p.warmth;
  }

  /** Tree records of the tile [x0, x0+size) × [z0, z0+size). */
  tile(x0: number, z0: number, size: number): Float32Array {
    const out: number[] = [];
    const detail = size <= FOREST_DETAIL;
    const n = detail ? Math.round(size / 7) : 40;
    const sp = size / n;
    const spread = detail ? 1 : sp / 7;
    const T = this.land.terrain, ls = this.ls, nz = this.noise;
    const gi0 = Math.round(x0 / sp), gj0 = Math.round(z0 / sp);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const h = hash2i(this.seed, gi0 + i, gj0 + j);
      const r0 = hashToFloat(h), r1 = hashToFloat(hash32(h + 701)), r2 = hashToFloat(hash32(h + 1305)), r3 = hashToFloat(hash32(h + 3109));
      const x = x0 + (i + r1) * sp, z = z0 + (j + r2) * sp;
      if (this.land.edge(x, z) < -40) continue;
      this.land.sample(x, z, ls, detail ? -1 : T.slope(x, z, sp * 0.5));
      if (ls.rural <= 0.05 || ls.water < 1.5) continue;
      if (T.profile.coastal && T.coastDistance(x, z) < 6) continue;
      // Acceptance: forest, the green bank strip along rivers, solitary trees in the meadows.
      let bankRow = ls.water < 22 ? 0.42 * (1 - smoothstep(14, 22, ls.water)) : 0;
      // Round a lake the bank trees come in groups, with open shore between.
      if (bankRow > 0 && T.lakeAt(x, z).e < 25) bankRow *= smoothstep(0.42, 0.62, nz.fbm2(x / 90 - 13.1, z / 90 + 4.2, 2) * 0.5 + 0.5);
      let p = ls.rural * ls.forest * 0.95 + ls.rural * bankRow * (1 - ls.forest);
      let pal = DECIDUOUS;
      if (detail) {
        const clump = smoothstep(0.5, 0.8, nz.fbm2(x / 260 + 7.7, z / 260, 2) * 0.5 + 0.5);
        const near = 1 - smoothstep(0, 500, ls.edge);
        p += ls.rural * ls.meadow * (0.006 + 0.05 * clump + 0.02 * near) * (1 - bankRow);
      }
      if (r0 >= p) continue;
      if (ls.edge < 260 && this.mask.has(x, z, 6)) continue;
      // Never on a road, a yard or a building.
      const S = this.land.settle;
      const clear = S ? S.clearing(x, z) : 0;
      if (S && (S.roadEdge(x, z) < 1.8 || (clear > 0 && (S.onPaved(x, z, 1.5) || S.onBuilding(x, z, 2.5))))) continue;
      // Species: conifer stands by region (and up the hills), warm-climate mix, river-bank trees.
      if (ls.forest > 0.5) {
        const con = nz.fbm2(x / 1700 - 31, z / 1700 + 12, 3) * 0.5 + 0.5 + (this.warm < 0.3 ? 0.15 : 0);
        pal = this.warm > 0.75 ? WARM : con > 0.58 ? CONIFER : con > 0.52 && r3 < 0.5 ? CONIFER : DECIDUOUS;
      } else if (bankRow > 0) pal = BANK;
      else pal = this.warm > 0.75 ? WARM : SOLO;
      const solo = ls.forest < 0.5;
      // Undergrowth: some forest spots get a shrub instead of a tree.
      const under = detail && !solo && hashToFloat(hash32(h + 4111)) < 0.14;
      const model = under ? SHRUBS[h & 1] : pal[Math.floor(r3 * pal.length) % pal.length];
      const scale = under ? 0.9 + r3 * 0.6 : (solo ? 0.95 : 0.66) + hashToFloat(hash32(h + 1703)) * (solo ? 0.35 : 0.5);
      const y = T.height(x, z) - TERRAIN_DROP - 0.15;
      out.push(x, y, z, scale, hashToFloat(hash32(h + 2307)) * Math.PI * 2, model, spread);
    }
    if (detail) this.hedges(x0, z0, size, out);
    this.orchards(x0, z0, size, out, detail ? 1 : sp / 7);
    return Float32Array.from(out);
  }

  /** The farms' orchards: rows of small fruit trees (far tiles: a few clumps for them). */
  private orchards(x0: number, z0: number, size: number, out: number[], spread: number): void {
    const S = this.land.settle, T = this.land.terrain;
    if (!S) return;
    const step = 6.5;
    for (const f of S.farms) {
      const o = f.orchard;
      if (!o || f.x < x0 - 120 || f.x > x0 + size + 120 || f.z < z0 - 120 || f.z > z0 + size + 120) continue;
      const every = Math.max(1, Math.round(spread * 1.4));
      let k = 0;
      for (let u = o[0] + step / 2; u < o[2]; u += step) for (let v = o[1] + step / 2; v < o[3]; v += step) {
        if (k++ % every) continue;
        const h = hash2i(this.seed ^ 0x0c4a, Math.round(u * 2) + f.id * 977, Math.round(v * 2));
        const [x, z] = S.fromFrame(f, u + (hashToFloat(h) - 0.5) * 0.6, v + (hashToFloat(hash32(h + 3)) - 0.5) * 0.6);
        if (x < x0 || x >= x0 + size || z < z0 || z >= z0 + size) continue;
        if (hashToFloat(hash32(h + 7)) < 0.06) continue; // a gap now and then
        const model = ORCHARD[Math.floor(hashToFloat(hash32(h + 11)) * ORCHARD.length) % ORCHARD.length];
        out.push(x, T.height(x, z) - TERRAIN_DROP - 0.1, z, 0.36 + hashToFloat(hash32(h + 13)) * 0.12, hashToFloat(hash32(h + 17)) * Math.PI * 2, model, every > 1 ? Math.sqrt(every) : 1);
      }
    }
  }

  /** Hedgerows (trees and shrubs) along some parcel borders between fields. */
  private hedges(x0: number, z0: number, size: number, out: number[]): void {
    const P = this.land.parcels, T = this.land.terrain, ls = this.ls;
    // Tile corners in parcel coordinates (ignoring the warp, plus a margin for it).
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, z] of [[x0, z0], [x0 + size, z0], [x0, z0 + size], [x0 + size, z0 + size]]) {
      const u = x * P.cos + z * P.sin, v = -x * P.sin + z * P.cos;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const m = P.warp + 10;
    u0 -= m; u1 += m; v0 -= m; v1 += m;
    const STEP = 7;
    const plant = (u: number, v: number, salt: number) => {
      // Parcel space → world: undo the rotation, then the warp (fixed point).
      const [px, pz] = parcelToWorld(P, u, v);
      let x = px, z = pz;
      for (let k = 0; k < 3; k++) { x = px - P.warp * Math.sin(z / 730 + P.ph1); z = pz - P.warp * Math.sin(x / 910 + P.ph2); }
      if (x < x0 || x >= x0 + size || z < z0 || z >= z0 + size) return;
      const h = hash2i(this.seed ^ 0x6e1, Math.round(u * 3), Math.round(v * 3) + salt);
      if (hashToFloat(h) > 0.82) return; // gaps
      this.land.sample(x, z, ls);
      if (ls.rural < 0.9 || ls.field < 0.5 || ls.water < 4) return;
      if (ls.edge < 260 && this.mask.has(x, z, 6)) return;
      const S = this.land.settle;
      if (S && (S.roadEdge(x, z) < 2.5 || S.clearing(x, z) > 0.2)) return;
      const model = HEDGE[Math.floor(hashToFloat(hash32(h + 501)) * HEDGE.length) % HEDGE.length];
      const jx = (hashToFloat(hash32(h + 1102)) - 0.5) * 1.6, jz = (hashToFloat(hash32(h + 1304)) - 0.5) * 1.6;
      const y = T.height(x + jx, z + jz) - TERRAIN_DROP - 0.1;
      out.push(x + jx, y, z + jz, (isShrub(model) ? 1.1 : 0.8) + hashToFloat(hash32(h + 703)) * 0.4, hashToFloat(hash32(h + 309)) * Math.PI * 2, model, 1);
    };
    for (let j = Math.floor(v0 / P.sv); j <= Math.ceil(v1 / P.sv); j++) {
      const v = j * P.sv;
      // Row border (between rows j-1 and j), split by the cells of row j.
      const off = hashToFloat(hash2i(P.seed, 7, j)) * P.su;
      for (let u = Math.floor(u0 / STEP) * STEP; u <= u1; u += STEP) {
        if (hedgeOnRow(P, Math.floor((u + off) / P.su), j)) plant(u, v, 0);
      }
      // Cell borders across row j.
      for (let i = Math.floor((u0 + off) / P.su); i <= Math.ceil((u1 + off) / P.su); i++) {
        if (!hedgeOnCol(P, i, j)) continue;
        const u = i * P.su - off;
        for (let vv = v + STEP * 0.5; vv < v + P.sv; vv += STEP) if (vv >= v0 && vv <= v1) plant(u, vv, 1);
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The town's trees
// ---------------------------------------------------------------------------------------------

/** One species per cell along its streets; the parks mix (warm climates: palms and cypresses). */
const STREET_SPECIES: readonly TreeSpecies[] = ['plane', 'linden', 'maple', 'chestnut', 'ginkgo', 'oak'];
const PARK_SPECIES: readonly TreeSpecies[] = ['oak', 'plane', 'birch', 'pine', 'maple', 'linden', 'chestnut', 'cypress'];
const WARM_SPECIES: readonly TreeSpecies[] = ['palm', 'cypress', 'pine', 'plane'];

/** Tree records (FOREST_STRIDE) of the town's trees, shrubs, hedges and yews (the cells' `props`). */
export function townTrees(cells: readonly CellPlan[], terrain: Terrain, ground: (x: number, z: number) => number): Float32Array {
  const out: number[] = [];
  const warm = terrain.profile.warmth > 0.75;
  const streetSp = warm ? WARM_SPECIES : STREET_SPECIES, parkSp = warm ? WARM_SPECIES : PARK_SPECIES;
  for (const plan of cells) {
    const P = plan.props, seed = plan.id * 7919;
    const cellSpecies = streetSp[seed % streetSp.length];
    for (let i = 0; i < P.length; i += 6) {
      const t = P[i], x = P[i + 1], z = P[i + 2], yaw = P[i + 3], sc = P[i + 4], v = P[i + 5];
      let model: number;
      if (t === PropType.Tree) {
        const park = plan.district === 'park' || v >= 3;
        // x can be negative: keep the index non-negative.
        const sp = park ? parkSp[(((seed + v * 31 + Math.round(x)) % parkSp.length) + parkSp.length) % parkSp.length] : cellSpecies;
        model = vegModelIndex(sp, Math.round(x * 7 + z * 3) & 1);
      } else if (t === PropType.Yew) model = vegModelIndex('cypress', Math.round(x * 7 + z * 3) & 1);
      else if (t === PropType.Bush || t === PropType.Hedge) model = vegModelIndex('shrub', v);
      else continue;
      out.push(x, ground(x, z), z, sc, yaw, model, 1);
    }
  }
  return Float32Array.from(out);
}

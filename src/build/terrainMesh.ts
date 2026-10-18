/**
 * Terrain tiles (regular grid with skirts), the tiling of the world, and water surfaces.
 *
 * Ported from Scale (src/build/terrainMesh.ts; the water sources from Scale's
 * src/stream/city.worker.ts init). TERRAIN_DROP lives in src/world/ground.ts.
 */
import type { Terrain } from '../world/terrain';
import { TERRAIN_DROP } from '../world/ground';
import { MeshBuilder, type AttrSpec } from './meshBuilder';
import { riverChunks, seaPolygon, type WaterChunk } from '../plan/water';
import { intersection } from '../geom/clip';
import { polyBounds, ensureCCW, type Poly } from '../geom/geom2';
import { smoothstep } from '@futuremagic/core';
import { drapeShape, groundSpecs } from './ground';
import { newLandSample, type LandUse } from '../world/landuse';

export { TERRAIN_DROP };

/** One terrain tile: its corner, edge length (m) and grid resolution (quads per side). */
export interface TerrainTileSpec { x0: number; z0: number; size: number; res: number }

const ROOT = 2048;
/** Grid quads per tile side (the same at every level: 64 m … 8 m spacing). */
const RES = 32;
/** Box distance from the town centre below which a tile of this size splits into four. */
const SPLIT: Record<number, number> = { 2048: 4000, 1024: 2000, 512: 1000 };

/**
 * Tiles covering the whole world (±terrain.worldExtent), finest round the town: 256 m tiles
 * (8 m grid) within ~1 km of the centre, 512 m (16 m) out to ~2 km, 1024 m (32 m) out to
 * ~4 km, 2048 m (64 m) beyond. Neighbouring levels do not share edges; the skirts
 * (`terrainSkirt`) hide the cracks.
 */
export function terrainTiles(terrain: Terrain): TerrainTileSpec[] {
  const out: TerrainTileSpec[] = [];
  const quarter = (x0: number, z0: number, size: number) => {
    const dx = Math.max(0, x0, -(x0 + size)), dz = Math.max(0, z0, -(z0 + size));
    const split = SPLIT[size];
    if (split !== undefined && Math.hypot(dx, dz) < split) {
      const h = size / 2;
      for (const [i, j] of [[0, 0], [1, 0], [0, 1], [1, 1]]) quarter(x0 + i * h, z0 + j * h, h);
    } else out.push({ x0, z0, size, res: RES });
  };
  const n = Math.ceil(terrain.worldExtent / ROOT);
  for (let j = -n; j < n; j++) for (let i = -n; i < n; i++) quarter(i * ROOT, j * ROOT, ROOT);
  return out;
}

/** Skirt depth of a tile (deep enough to hide the crack to a coarser neighbour). */
export function terrainSkirt(size: number): number {
  return Math.max(2, size / 40);
}

/** The terrain attributes with land use: uv (world x/z), aLand, aShore. */
export const TERRAIN_SPECS: AttrSpec[] = [{ name: 'uv', size: 2 }, { name: 'aLand', size: 4, type: 'u8n' }, { name: 'aShore', size: 1, type: 'u8n' }];

/** Beach: full at the water's edge of the sea and the lakes, gone ~30 m inland and above ~2.5 m. */
const SHORE_IN = 30, SHORE_H0 = 1.5, SHORE_H1 = 2.5;

/**
 * Beach weight at (x, z) with natural ground height h: 1 at (and below) the water's edge of
 * the sea and the lakes, fading out by SHORE_IN metres inland and above SHORE_H1. River banks
 * are aLand's bank channel.
 */
export function shoreWeight(terrain: Terrain, x: number, z: number, h: number): number {
  if (h > SHORE_H1) return 0;
  let d = terrain.coastDistance(x, z);
  if (d > SHORE_IN && terrain.lakes.length) d = Math.min(d, terrain.lakeAt(x, z).e);
  if (d >= SHORE_IN) return 0;
  return (1 - smoothstep(0, SHORE_IN, d)) * (1 - smoothstep(SHORE_H0, SHORE_H1, h));
}

/**
 * A terrain tile. With `land` (TERRAIN_SPECS), every vertex carries aLand = (forest, field,
 * meadow, bank), each premultiplied by the countryside weight (all zero in the city), and
 * aShore (shoreWeight), for the terrain shader. Without it: uv only.
 */
export function buildTerrainTile(terrain: Terrain, x0: number, z0: number, size: number, res: number, skirt: number, land?: LandUse): MeshBuilder {
  const mb = new MeshBuilder(land ? TERRAIN_SPECS : [{ name: 'uv', size: 2 }]);
  const ls = newLandSample();
  const n = res + 1;
  // aLand and aShore per grid vertex, kept for the skirts (which repeat the edge vertices).
  const lands = new Float32Array(land ? n * n * 5 : 0);
  const setLand = (x: number, z: number, slope: number, vi: number, h: number) => {
    if (!land) return;
    land.sample(x, z, ls, slope);
    const o = vi * 5;
    lands[o] = ls.rural * ls.forest; lands[o + 1] = ls.rural * ls.field; lands[o + 2] = ls.rural * ls.meadow; lands[o + 3] = ls.rural * ls.bank;
    lands[o + 4] = shoreWeight(terrain, x, z, h);
    mb.set('aLand', lands[o], lands[o + 1], lands[o + 2], lands[o + 3]);
    mb.set('aShore', lands[o + 4]);
  };
  mb.setOrigin(x0 + size / 2, 0, z0 + size / 2);
  const h = new Float32Array(n * n);
  const step = size / res;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) h[j * n + i] = terrain.height(x0 + i * step, z0 + j * step) - TERRAIN_DROP;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = x0 + i * step, z = z0 + j * step;
      const hl = h[j * n + Math.max(0, i - 1)], hr = h[j * n + Math.min(n - 1, i + 1)];
      const hd = h[Math.max(0, j - 1) * n + i], hu = h[Math.min(n - 1, j + 1) * n + i];
      const dx = (hr - hl) / ((Math.min(n - 1, i + 1) - Math.max(0, i - 1)) * step);
      const dz = (hu - hd) / ((Math.min(n - 1, j + 1) - Math.max(0, j - 1)) * step);
      const l = Math.hypot(dx, 1, dz);
      setLand(x, z, Math.hypot(dx, dz), j * n + i, h[j * n + i] + TERRAIN_DROP);
      mb.v(x, h[j * n + i], z, -dx / l, 1 / l, -dz / l, x, z);
    }
  }
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const a = j * n + i, b = a + 1, c = a + n + 1, d = a + n;
      // Face +y: (a, d, c) and (a, c, b) given x right, z down the rows.
      mb.tri(a, d, c);
      mb.tri(a, c, b);
    }
  }
  // Skirts hide cracks between LOD levels.
  if (skirt > 0) {
    const edge = (idx: (k: number) => number, nx: number, nz: number, flip: boolean) => {
      const base = mb.vcount;
      for (let k = 0; k < n; k++) {
        const vi = idx(k);
        const i = vi % n, j = Math.floor(vi / n);
        const x = x0 + i * step, z = z0 + j * step;
        if (land) mb.set('aLand', lands[vi * 5], lands[vi * 5 + 1], lands[vi * 5 + 2], lands[vi * 5 + 3]).set('aShore', lands[vi * 5 + 4]);
        mb.v(x, h[vi], z, nx, 0, nz, x, z);
        mb.v(x, h[vi] - skirt, z, nx, 0, nz, x, z);
      }
      for (let k = 0; k < n - 1; k++) {
        const a = base + k * 2, b = a + 2;
        if (flip) { mb.tri(a, a + 1, b + 1); mb.tri(a, b + 1, b); }
        else { mb.tri(a, b + 1, a + 1); mb.tri(a, b, b + 1); }
      }
    };
    edge((k) => k, 0, -1, false); // z0 row
    edge((k) => (n - 1) * n + k, 0, 1, true); // z1 row
    edge((k) => k * n, -1, 0, true); // x0 column
    edge((k) => k * n + n - 1, 1, 0, false); // x1 column
  }
  return mb;
}

/** Everything water surfaces are cut from: river chunks, the sea, the lakes (made once per world). */
export interface WaterSources {
  chunks: WaterChunk[];
  sea: Poly | null;
  lakes: { poly: Poly; bounds: [number, number, number, number] }[];
}

function ccwOrNull(p: Poly | null): Poly | null {
  return p ? ensureCCW(p) : null;
}

export function waterSources(terrain: Terrain): WaterSources {
  return {
    // Every outline counter-clockwise: the clip's non-zero fill would cancel a clockwise sea
    // against the river chunks where the river runs out into it (a gap in the water at the mouth).
    chunks: riverChunks(terrain, 0.0),
    // The sea surface reaches along the whole coast of the world.
    sea: ccwOrNull(seaPolygon(terrain, 0, 40, terrain.worldExtent * 1.1)),
    lakes: terrain.lakes.map((_, k) => { const poly = ensureCCW(terrain.lakePolygon(k)); return { poly, bounds: polyBounds(poly) }; }),
  };
}

/** Water surfaces (rivers, sea, lakes) clipped to a square tile; aLayer is 0. Null when dry. */
export function buildWaterTile(terrain: Terrain, x0: number, z0: number, size: number, src: WaterSources): MeshBuilder | null {
  const { chunks, sea, lakes } = src;
  const mb = new MeshBuilder(groundSpecs());
  mb.setOrigin(x0 + size / 2, 0, z0 + size / 2);
  const tile = [x0, z0, x0 + size, z0, x0 + size, z0 + size, x0, z0 + size];
  const polys: number[][] = [];
  for (const ch of chunks) {
    if (ch.bounds[0] > x0 + size || ch.bounds[2] < x0 || ch.bounds[1] > z0 + size || ch.bounds[3] < z0) continue;
    for (const s of ch.shapes) polys.push(s.outer);
  }
  if (sea) polys.push(sea);
  for (const L of lakes) if (!(L.bounds[0] > x0 + size || L.bounds[2] < x0 || L.bounds[1] > z0 + size || L.bounds[3] < z0)) polys.push(L.poly);
  if (!polys.length) return null;
  const clipped = intersection(polys, [tile]);
  if (!clipped.length) return null;
  // Water level: a lake's level; a river's at each vertex (rivers slope gently), easing down to
  // the sea's (0) over the first 60 m out from the coast; the sea's elsewhere.
  const level = (x: number, z: number) => {
    const lq = terrain.lakeAt(x, z);
    if (lq.lake >= 0 && lq.e < 30) return lq.level;
    const w = terrain.water(x, z);
    const river = w.river >= 0 && w.d <= w.halfWidth + 5 ? w.level : 0;
    const c = terrain.coastDistance(x, z);
    return c < 0 ? river * (1 - smoothstep(0, 60, -c)) : river;
  };
  for (const s of clipped) drapeShape(mb, s, terrain, 0, 0, level, Math.max(30, size / 24));
  return mb.empty ? null : mb;
}

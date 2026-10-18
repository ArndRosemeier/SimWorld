/**
 * The town map (town-realism track H): what a printed map of the town shows, as plain data for the map panel
 * (src/app/mapPanel.ts). Water and woods as a coarse raster, parks and building footprints as outlines, the roads
 * by class with their street names and a place to print each name, the railway, and the landmarks by name. Pure,
 * made in a town worker on request (it needs the whole plan); typed arrays, so it transfers.
 */
import { townRoads } from './roads';
import type { LandmarkKind } from './landmarks';
import type { Town } from './town';

/** Raster cells: 0 land, 1 water, 2 woods. */
export const MAP_LAND = 0, MAP_WATER = 1, MAP_WOODS = 2;

export interface MapRoad {
  /** Centreline x, z, … */
  pts: Float32Array;
  /** `RoadClass` (0 boulevard … 4 path). */
  cls: number;
  /** Index into `TownMap.streets`, -1 for unnamed paths and tracks. */
  street: number;
}

export interface MapLabel {
  name: string;
  /** Where to print it and along which direction (radians, x towards z), on the street's longest stretch. */
  x: number;
  z: number;
  angle: number;
  /** Length of that stretch (m): long names go on long streets first. */
  length: number;
}

export interface TownMap {
  /** The square the map covers: centre and half side (m). */
  cx: number;
  cz: number;
  half: number;
  /** Raster of `n` × `n` (row = z) cells over the square: MAP_LAND, MAP_WATER, MAP_WOODS. */
  n: number;
  ground: Uint8Array;
  /** Outlines as flat x, z runs; `*Ends[i]` is the end (exclusive, in floats) of outline i. */
  parks: Float32Array;
  parkEnds: Uint32Array;
  buildings: Float32Array;
  buildingEnds: Uint32Array;
  roads: MapRoad[];
  streets: MapLabel[];
  rail: Float32Array | null;
  landmarks: { kind: LandmarkKind; name: string; x: number; z: number }[];
}

const RASTER = 384;

function packed(polys: readonly number[][]): [Float32Array, Uint32Array] {
  const ends = new Uint32Array(polys.length);
  let total = 0;
  polys.forEach((p, i) => { total += p.length; ends[i] = total; });
  const out = new Float32Array(total);
  let at = 0;
  for (const p of polys) { out.set(p, at); at += p.length; }
  return [out, ends];
}

export function townMapOf(town: Town): TownMap {
  const { terrain, land, macro, cells } = town;
  const cx = 0, cz = 0; // the town is planned around the origin
  const half = terrain.profile.radius * 1.3;
  const n = RASTER, ground = new Uint8Array(n * n), cell = (2 * half) / n;
  const sample = { rural: 0, forest: 0, field: 0, meadow: 1, bank: 0, edge: 0, water: Infinity };
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = cx - half + (i + 0.5) * cell, z = cz - half + (j + 0.5) * cell;
    if (terrain.isWater(x, z, 0)) { ground[j * n + i] = MAP_WATER; continue; }
    land.sample(x, z, sample, 0);
    if (sample.rural * sample.forest > 0.5) ground[j * n + i] = MAP_WOODS;
  }
  const [parks, parkEnds] = packed(cells.flatMap((c) => c.parks.map((p) => p.outer)));
  const [buildings, buildingEnds] = packed(cells.flatMap((c) => c.buildings.map((b) => b.poly)));
  const roads = townRoads(town);
  const inside = (x: number, z: number) => Math.abs(x - cx) < half && Math.abs(z - cz) < half;
  const mapRoads: MapRoad[] = roads.lines.filter((l) => {
    for (let k = 0; k < l.pts.length; k += 2) if (inside(l.pts[k], l.pts[k + 1])) return true;
    return false;
  }).map((l) => ({ pts: Float32Array.from(l.pts), cls: l.cls, street: l.street }));
  const streets = roads.streets.map((s): MapLabel => {
    // The longest straight-ish stretch: the longest segment of the street's lines, its middle.
    let best: MapLabel = { name: s.name, x: 0, z: 0, angle: 0, length: 0 };
    for (const li of s.lines) {
      const p = roads.lines[li].pts;
      for (let k = 0; k + 3 < p.length; k += 2) {
        const dx = p[k + 2] - p[k], dz = p[k + 3] - p[k + 1], len = Math.hypot(dx, dz);
        const mx = (p[k] + p[k + 2]) / 2, mz = (p[k + 1] + p[k + 3]) / 2;
        if (len > best.length && inside(mx, mz)) best = { name: s.name, x: mx, z: mz, angle: Math.atan2(dz, dx), length: len };
      }
    }
    return best;
  });
  // The station is named after the town; on a map it reads "Harborwick Station".
  const lms = macro.landmarks.map((l) => ({ kind: l.kind, name: l.kind === 'station' && !/station/i.test(l.name) ? `${l.name} Station` : l.name, x: l.x, z: l.z }));
  return { cx, cz, half, n, ground, parks, parkEnds, buildings, buildingEnds, roads: mapRoads, streets, rail: macro.rail ? Float32Array.from(macro.rail.pts) : null, landmarks: lms };
}

/** The buffers of a map, for postMessage's transfer list. */
export function townMapTransferables(m: TownMap): Transferable[] {
  return [m.ground.buffer, m.parks.buffer, m.parkEnds.buffer, m.buildings.buffer, m.buildingEnds.buffer, ...m.roads.map((r) => r.pts.buffer), ...(m.rail ? [m.rail.buffer] : [])];
}

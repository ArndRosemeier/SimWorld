/**
 * Building descriptors: pure data that fully determines a building's
 * geometry (with the seed). Styles define facade grammar, materials, roofs
 * and massing rules.
 *
 * Ported from Scale (src/plan/building.ts) with town-sized floor counts; `dwellingsOf`,
 * `doorBayOf`, `streetDoor`, `isSliver` and `asLockUp` are new here.
 */
import { polyArea, minAreaRect, rectangularity, type Poly } from '../geom/geom2';
import { type Rng } from '@futuremagic/core';
import type { District } from './types';
import type { AmenityKind } from './amenities';
import type { WorldProfile } from '../world/settings';

export type StyleId =
  | 'rowhouse'      // narrow brick/brownstone townhouse, stoop, cornice
  | 'tenement'      // 4-7 floor brick walk-up, fire escapes, water tank
  | 'haussmann'     // stone 5-7 floors, balconies, mansard zinc roof
  | 'timber'        // old-town half-timbered gable house
  | 'oldstone'      // old-town plastered stone with tile gable roof
  | 'artdeco'       // stepped tower, stone and setbacks
  | 'glass'         // curtain-wall office tower
  | 'modern'        // contemporary residential, balconies, render
  | 'brutalist'     // concrete slab blocks
  | 'house'         // suburban detached house
  | 'warehouse'     // brick/metal industrial hall, sawtooth roofs
  | 'church'        // stone church with tower
  | 'shop'          // one/two floor commercial pavilion
  | 'garage'        // multi-storey car park
  | 'mediterranean';// stucco with terracotta roofs, loggias

export type RoofKind = 'flat' | 'gable' | 'hip' | 'mansard' | 'sawtooth' | 'shed';
export type Use = 'residential' | 'office' | 'mixed' | 'retail' | 'industrial' | 'civic' | 'parking';

export interface BuildingDesc {
  id: number;
  /** Footprint polygon (CCW). */
  poly: Poly;
  /** Index of the footprint edge facing the main street. */
  front: number;
  style: StyleId;
  use: Use;
  floors: number;
  floorH: number;
  groundH: number;
  roof: RoofKind;
  /** Roof pitch for gable/hip (rise/run). */
  pitch: number;
  /** Tower setbacks: list of [fromFloor, insetMeters]. */
  setbacks: [number, number][];
  /** Palette indices (style-specific): wall material, trim, roof, accent. */
  wall: number;
  trim: number;
  roofMat: number;
  accent: number;
  /** Window bay width target in m. */
  bay: number;
  /** Has ground-floor shop front. */
  shopfront: boolean;
  /** Seed for per-building variation. */
  seed: number;
  /** Attached to neighbours on side edges (no side windows). */
  attached: boolean;
  /** Residential units per floor (for population). */
  units: number;
  /** Is a landmark (church tower, notable tower). */
  landmark: boolean;
  /** Place to eat or drink on the ground floor (plan/eatery.ts Eatery; 0 / absent: none). */
  eatery?: number;
  /** What the ground floor (or the whole building, for a workplace) is, set by the town planner. */
  amenity?: AmenityKind;
  /** A street door set by the building's own design instead of the door bay (a public building's walk-in body, src/interior/landmark.ts): its middle along the front edge (0 to 1) and its width. */
  door?: { at: number; w: number };
  /** How many homes it holds when its design says so instead of its style and storeys (a farmhouse: one family's). */
  homes?: number;
}

/** Wall material ids — must match render material atlas layers. */
export const enum WallMat {
  BrickRed = 0,
  BrickBrown = 1,
  BrickYellow = 2,
  Brownstone = 3,
  Limestone = 4,
  Sandstone = 5,
  Plaster = 6,
  Stucco = 7,
  Concrete = 8,
  ConcretePanel = 9,
  GlassCurtain = 10,
  MetalPanel = 11,
  Timber = 12,
  Granite = 13,
  WoodSiding = 14,
  BrickWhite = 15,
}
export const WALL_MAT_COUNT = 16;

export const enum RoofMat {
  Tar = 0,
  ClayTile = 1,
  Slate = 2,
  Zinc = 3,
  Asphalt = 4,
  Metal = 5,
  Gravel = 6,
  Green = 7,
}

interface StyleRule {
  floors: (r: Rng, dens: number, p: WorldProfile) => number;
  floorH: [number, number];
  groundH: [number, number];
  roofs: RoofKind[];
  walls: WallMat[];
  roofMats: RoofMat[];
  bay: [number, number];
  shopP: number;
  use: Use;
}

/**
 * Building styles. The floor counts are a town's (SimWorld): Scale's ranges were a city's, with
 * five- to seven-storey blocks and towers; a town of 1,000–2,500 people builds two to four
 * storeys, a few five-storey blocks at most.
 */
export const STYLES: Record<StyleId, StyleRule> = {
  rowhouse: { floors: (r) => r.int(2, 3), floorH: [3.1, 3.5], groundH: [3.3, 3.8], roofs: ['flat', 'flat', 'mansard'], walls: [WallMat.Brownstone, WallMat.BrickRed, WallMat.BrickBrown, WallMat.Limestone], roofMats: [RoofMat.Tar, RoofMat.Slate], bay: [1.9, 2.4], shopP: 0.12, use: 'residential' },
  tenement: { floors: (r) => r.int(3, 4), floorH: [3.0, 3.3], groundH: [3.6, 4.2], roofs: ['flat'], walls: [WallMat.BrickRed, WallMat.BrickBrown, WallMat.BrickYellow, WallMat.BrickWhite], roofMats: [RoofMat.Tar, RoofMat.Gravel], bay: [2.2, 2.8], shopP: 0.6, use: 'mixed' },
  haussmann: { floors: (r) => r.int(3, 4), floorH: [3.0, 3.6], groundH: [4.2, 5.0], roofs: ['mansard'], walls: [WallMat.Limestone, WallMat.Sandstone, WallMat.Limestone], roofMats: [RoofMat.Zinc, RoofMat.Slate], bay: [2.6, 3.2], shopP: 0.7, use: 'mixed' },
  timber: { floors: (r) => r.int(2, 3), floorH: [2.7, 3.0], groundH: [3.0, 3.4], roofs: ['gable', 'gable', 'hip'], walls: [WallMat.Timber, WallMat.Plaster], roofMats: [RoofMat.ClayTile, RoofMat.Slate], bay: [1.8, 2.3], shopP: 0.4, use: 'mixed' },
  oldstone: { floors: (r) => r.int(2, 3), floorH: [2.8, 3.2], groundH: [3.2, 3.8], roofs: ['gable', 'hip', 'gable'], walls: [WallMat.Plaster, WallMat.Sandstone, WallMat.Stucco, WallMat.Limestone], roofMats: [RoofMat.ClayTile, RoofMat.Slate, RoofMat.ClayTile], bay: [2.0, 2.6], shopP: 0.45, use: 'mixed' },
  artdeco: { floors: (r) => r.int(4, 6), floorH: [3.6, 3.9], groundH: [5.5, 7], roofs: ['flat'], walls: [WallMat.Limestone, WallMat.BrickYellow, WallMat.Granite, WallMat.BrickBrown], roofMats: [RoofMat.Tar], bay: [1.9, 2.4], shopP: 0.8, use: 'office' },
  glass: { floors: (r) => r.int(3, 5), floorH: [3.8, 4.1], groundH: [5, 7], roofs: ['flat'], walls: [WallMat.GlassCurtain], roofMats: [RoofMat.Gravel, RoofMat.Tar], bay: [1.5, 1.8], shopP: 0.6, use: 'office' },
  modern: { floors: (r, d) => r.int(2, 3 + Math.round(d)), floorH: [2.9, 3.1], groundH: [3.5, 4.2], roofs: ['flat'], walls: [WallMat.Stucco, WallMat.ConcretePanel, WallMat.MetalPanel, WallMat.BrickWhite, WallMat.WoodSiding], roofMats: [RoofMat.Gravel, RoofMat.Green], bay: [2.6, 3.4], shopP: 0.35, use: 'residential' },
  brutalist: { floors: (r) => r.int(4, 5), floorH: [2.9, 3.1], groundH: [3.6, 4.2], roofs: ['flat'], walls: [WallMat.Concrete, WallMat.ConcretePanel], roofMats: [RoofMat.Tar, RoofMat.Gravel], bay: [2.8, 3.6], shopP: 0.2, use: 'residential' },
  house: { floors: (r) => r.int(1, 2), floorH: [2.7, 2.9], groundH: [2.8, 3.0], roofs: ['gable', 'hip', 'gable', 'hip', 'flat'], walls: [WallMat.WoodSiding, WallMat.BrickRed, WallMat.Stucco, WallMat.Plaster, WallMat.BrickBrown], roofMats: [RoofMat.Asphalt, RoofMat.ClayTile, RoofMat.Slate, RoofMat.Asphalt], bay: [2.6, 3.4], shopP: 0, use: 'residential' },
  warehouse: { floors: (r) => r.int(1, 2), floorH: [4.5, 6], groundH: [5, 7], roofs: ['flat', 'sawtooth', 'gable', 'flat'], walls: [WallMat.BrickRed, WallMat.MetalPanel, WallMat.Concrete, WallMat.BrickBrown], roofMats: [RoofMat.Metal, RoofMat.Tar], bay: [4, 6], shopP: 0, use: 'industrial' },
  church: { floors: () => 1, floorH: [12, 16], groundH: [12, 16], roofs: ['gable'], walls: [WallMat.Sandstone, WallMat.Limestone, WallMat.Granite, WallMat.BrickRed], roofMats: [RoofMat.Slate, RoofMat.ClayTile, RoofMat.Zinc], bay: [4, 5], shopP: 0, use: 'civic' },
  shop: { floors: (r) => r.int(1, 2), floorH: [3.6, 4.2], groundH: [4, 4.6], roofs: ['flat'], walls: [WallMat.Stucco, WallMat.BrickRed, WallMat.MetalPanel, WallMat.Concrete], roofMats: [RoofMat.Tar, RoofMat.Gravel], bay: [3, 4], shopP: 1, use: 'retail' },
  garage: { floors: (r) => r.int(2, 3), floorH: [2.9, 3.1], groundH: [3.2, 3.4], roofs: ['flat'], walls: [WallMat.Concrete], roofMats: [RoofMat.Asphalt], bay: [5, 6], shopP: 0, use: 'parking' },
  mediterranean: { floors: (r) => r.int(2, 3), floorH: [2.9, 3.3], groundH: [3.2, 3.8], roofs: ['hip', 'flat', 'gable'], walls: [WallMat.Stucco, WallMat.Plaster, WallMat.Sandstone], roofMats: [RoofMat.ClayTile], bay: [2.2, 2.8], shopP: 0.4, use: 'mixed' },
};

/** Style weights per district, modulated by the world's architectural flavour. */
export function pickStyle(r: Rng, district: District, p: WorldProfile, dens: number, era: number, lotArea: number, frontLen: number): StyleId {
  const a = p.arch;
  const w: Partial<Record<StyleId, number>> = {};
  const add = (s: StyleId, v: number) => { w[s] = (w[s] ?? 0) + v; };
  switch (district) {
    case 'downtown':
      add('glass', 1.8 * a.modern + 0.5 * era);
      add('artdeco', 1.5 * a.american + 0.6 * (1 - era));
      add('brutalist', 0.3);
      add('haussmann', 0.6 * a.oldWorld);
      if (lotArea < 1100) {
        add('tenement', 1.2 * a.american);
        add('haussmann', 1.0 * a.oldWorld);
        add('modern', 0.7);
        add('artdeco', 0.6);
        add('glass', -1.2);
      }
      add('garage', 0.08);
      break;
    case 'commercial':
      // (A town's main street: shops under flats, the odd small office building.)
      add('glass', 0.15 * a.modern);
      add('haussmann', 1.4 * a.oldWorld);
      add('tenement', 1.2 * a.american);
      add('modern', 0.8 * a.modern);
      add('shop', 0.4);
      add('mediterranean', 1.2 * a.warm);
      add('garage', 0.06);
      break;
    case 'oldtown':
      add('timber', 1.6 * a.oldWorld * (1 - a.warm));
      add('oldstone', 1.6);
      add('haussmann', 0.5 * a.oldWorld);
      add('mediterranean', 2 * a.warm);
      add('rowhouse', 0.6 * a.american);
      break;
    case 'apartments':
      add('haussmann', 1.0 * a.oldWorld);
      add('tenement', 1.4 * a.american);
      add('modern', 1.2 * a.modern + era);
      add('brutalist', 0.6 * a.modern * era);
      add('mediterranean', 1.4 * a.warm);
      add('rowhouse', 0.3);
      break;
    case 'rowhouses':
      add('rowhouse', 3);
      add('tenement', 0.6 * a.american);
      add('oldstone', 0.5 * a.oldWorld);
      add('mediterranean', 0.8 * a.warm);
      break;
    case 'suburban':
      add('house', 6);
      add('modern', 0.2);
      add('shop', 0.15);
      break;
    case 'industrial':
    case 'port':
      add('warehouse', 6);
      add('garage', 0.2);
      add('brutalist', 0.2);
      break;
    default:
      add('modern', 1);
  }
  // Very narrow frontages favour rowhouses / timber houses.
  if (frontLen < 9 && district !== 'suburban' && district !== 'industrial' && district !== 'port') add(district === 'oldtown' ? 'timber' : 'rowhouse', 2);
  void dens;
  const keys = Object.keys(w) as StyleId[];
  return r.weighted(keys, (k) => w[k]!);
}

/** How many window bays a facade edge `L` metres long has (the building's bay width fitted to it): one seam for the facade, its doors, its windows inside and its signs. */
export function baysOf(b: { bay: number }, L: number): number {
  return Math.max(1, Math.round(L / b.bay));
}

/**
 * Which bay of the front facade holds the door (Scale: build/buildingLayout doorBayOf): the
 * planner (terraces keep clear of it), the sim (where people go in) and the meshes agree on it.
 */
export function doorBayOf(seed: number, bays: number): number {
  if (bays <= 2) return 0;
  return 1 + ((seed >>> 5) % Math.min(bays - 2, 3));
}

/** The building's front edge: its first corner (ax, az), its direction (dx, dz) and length L, and the outward normal (nx, nz). */
export function facadeFront(b: BuildingDesc): { ax: number; az: number; dx: number; dz: number; L: number; nx: number; nz: number } {
  const P = b.poly, n = P.length >> 1, i = b.front % n, j = (i + 1) % n;
  const ax = P[i * 2], az = P[i * 2 + 1], L = Math.hypot(P[j * 2] - ax, P[j * 2 + 1] - az) || 1;
  const dx = (P[j * 2] - ax) / L, dz = (P[j * 2 + 1] - az) / L;
  return { ax, az, dx, dz, L, nx: dz, nz: -dx };
}

/**
 * The street door: on the front edge, centred in the door bay (`doorBayOf`), at most 1.3 m wide
 * (or where the building's design puts it, `door`).
 * `s0`, `s1` its span along the edge from the edge's first corner, `x`, `z` its middle on the
 * facade. Scale: build/buildingLayout doorOf; the one door the facade, the interior and the
 * place graph agree on.
 */
export function streetDoor(b: BuildingDesc): FrontDoor {
  if (b.door) {
    const P = b.poly, n = P.length >> 1, i = b.front % n, j = (i + 1) % n, t = b.door.at;
    const L = Math.hypot(P[j * 2] - P[i * 2], P[j * 2 + 1] - P[i * 2 + 1]);
    return { edge: i, s0: t * L - b.door.w / 2, s1: t * L + b.door.w / 2, x: P[i * 2] + (P[j * 2] - P[i * 2]) * t, z: P[i * 2 + 1] + (P[j * 2 + 1] - P[i * 2 + 1]) * t };
  }
  return frontBayDoor(b, (bays) => doorBayOf(b.seed, bays))!;
}

/**
 * A street door's size: at most `maxW` wide and `bayShare` of its bay, `h` high. The interior's doorway and leaf
 * (src/interior/indoors.ts), the facade shader's painted door (src/render/tsl/facade.ts) and the shell's cut-out
 * while you are inside all take it from here, so the painted door and the real one are the same door.
 */
export const STREET_DOOR = { maxW: 1.3, bayShare: 0.62, h: 2.15 } as const;

/** A door on the front edge: the edge, its span along it from the edge's first corner, its middle on the facade. */
export type FrontDoor = { edge: number; s0: number; s1: number; x: number; z: number };

/** The door in the front bay `bayOf(bays)` picks (null for a negative bay), `STREET_DOOR` wide. */
function frontBayDoor(b: BuildingDesc, bayOf: (bays: number) => number): FrontDoor | null {
  const P = b.poly, n = P.length >> 1, i = b.front % n, j = (i + 1) % n;
  const L = Math.hypot(P[j * 2] - P[i * 2], P[j * 2 + 1] - P[i * 2 + 1]);
  const bays = baysOf(b, L), bayW = L / bays, bay = bayOf(bays);
  if (bay < 0) return null;
  const dw = Math.min(STREET_DOOR.maxW, bayW * STREET_DOOR.bayShare), dc = (bay + 0.5) * bayW, t = dc / Math.max(1e-6, L);
  return { edge: i, s0: dc - dw / 2, s1: dc + dw / 2, x: P[i * 2] + (P[j * 2] - P[i * 2]) * t, z: P[i * 2 + 1] + (P[j * 2 + 1] - P[i * 2 + 1]) * t };
}

/**
 * The flats' own street door, when homes sit over a ground-floor workplace (a shop, a café, a
 * salon): a second door on the front, in bay 1 when the workplace's door is in bay 0, else in
 * bay 0, so the people living upstairs never walk through the shop. Null when the building has
 * no such homes or its front is a single bay (then the stairs open off the workplace). SimWorld;
 * the facade, the interior (its hall to the stairs) and the place graph agree on it.
 */
export function flatsDoor(b: BuildingDesc): FrontDoor | null {
  return frontBayDoor(b, (bays) => flatsDoorBay(b, bays));
}

/** The bay of a front facade of `bays` bays that `flatsDoor` is in (0 or 1), or -1 for none. */
export function flatsDoorBay(b: BuildingDesc, bays: number): number {
  if (bays < 2 || b.floors < 2 || !(b.shopfront || b.amenity) || dwellingsOf(b) === 0) return -1;
  return doorBayOf(b.seed, bays) === 0 ? 1 : 0;
}

/**
 * How many households can live in a building (SimWorld; Scale counted `units` per floor for
 * its crowd density only). A detached house or a row house is one home (a few detached houses
 * are split into two flats); a block of flats has `units` flats on each residential floor, the
 * ground floor of a building with a shop front being the shop. A block whose floor cannot hold
 * a flat and the stairs (under MIN_FLAT_FLOOR) is one home over all its storeys (SimWorld, for
 * the interiors).
 */
export const MIN_FLAT_FLOOR = 55;
export function dwellingsOf(b: BuildingDesc): number {
  if (b.use !== 'residential' && b.use !== 'mixed') return 0;
  if (b.homes !== undefined) return b.homes;
  if (b.style === 'house') return b.floors >= 2 && (b.seed >>> 9) % 7 === 0 ? 2 : 1;
  if (b.style === 'rowhouse') return 1;
  const floors = Math.max(0, b.floors - (b.shopfront ? 1 : 0));
  // A floor too small for a flat beside the stairs: the building is one narrow town house.
  if (floors > 1 && Math.abs(polyArea(b.poly)) < MIN_FLAT_FLOOR) return 1;
  return b.units * floors;
}

/**
 * A footprint too small, thin or triangular for more than one storey (the stairs would eat the
 * floor): under MIN_FLAT_FLOOR, under 4.5 m across, or a small wedge. The cell planner builds
 * a single storey on it (a kiosk, a shed, a lock-up garage); SimWorld, for the interiors.
 */
export function isSliver(poly: Poly): boolean {
  const a = Math.abs(polyArea(poly));
  if (a < MIN_FLAT_FLOOR) return true;
  const o = minAreaRect(poly);
  return Math.min(o.hu, o.hv) * 2 < 4.5 || (a < 110 && rectangularity(poly) < 0.6);
}

/** Turn a building into a single-storey lock-up garage or shed (no home, no shop front, no use). */
export function asLockUp(b: BuildingDesc): void {
  const g = STYLES.garage;
  b.style = 'garage';
  b.use = g.use;
  b.floors = 1;
  b.groundH = g.groundH[0];
  b.floorH = g.floorH[0];
  b.roof = 'flat';
  b.pitch = 0.2;
  b.setbacks = [];
  b.wall = g.walls[0];
  b.roofMat = g.roofMats[0];
  b.bay = g.bay[0];
  b.shopfront = false;
  b.units = 0;
  b.amenity = undefined;
  b.eatery = 0;
}

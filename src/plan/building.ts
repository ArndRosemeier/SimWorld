/**
 * Building descriptors: pure data that fully determines a building's
 * geometry (with the seed). Styles define facade grammar, materials, roofs
 * and massing rules.
 *
 * Ported from Scale (src/plan/building.ts) with town-sized floor counts; `dwellingsOf` and
 * `doorBayOf` are new here.
 */
import type { Poly } from '../geom/geom2';
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

/**
 * Which bay of the front facade holds the door (Scale: build/buildingLayout doorBayOf): the
 * planner (terraces keep clear of it), the sim (where people go in) and the meshes agree on it.
 */
export function doorBayOf(seed: number, bays: number): number {
  if (bays <= 2) return 0;
  return 1 + ((seed >>> 5) % Math.min(bays - 2, 3));
}

/**
 * How many households can live in a building (SimWorld; Scale counted `units` per floor for
 * its crowd density only). A detached house or a row house is one home (a few detached houses
 * are split into two flats); a block of flats has `units` flats on each residential floor, the
 * ground floor of a building with a shop front being the shop.
 */
export function dwellingsOf(b: BuildingDesc): number {
  if (b.use !== 'residential' && b.use !== 'mixed') return 0;
  if (b.style === 'house') return b.floors >= 2 && (b.seed >>> 9) % 7 === 0 ? 2 : 1;
  if (b.style === 'rowhouse') return 1;
  return b.units * Math.max(0, b.floors - (b.shopfront ? 1 : 0));
}

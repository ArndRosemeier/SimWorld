/**
 * The whole town at once: terrain, land use, the macro plan (arterials, cells, sites, railway),
 * every cell's streets, lots and buildings, the countryside (farms and the roads out), how many
 * households it houses, and what each shop front and workplace is. New in SimWorld: Scale
 * planned its cells lazily as the camera came near; SimWorld's simulation needs every home and
 * every workplace from the first minute, so the town is planned in full, once, from the seed.
 *
 * Pure (no three.js); a function of the settings alone.
 */
import { Rng, deriveSeed, clamp, hash32 } from '@futuremagic/core';
import { polyArea, polyCentroid, polyBounds } from '../geom/geom2';
import { makeProfile, type TownSettings } from '../world/settings';
import { Terrain } from '../world/terrain';
import { LandUse } from '../world/landuse';
import { RuralPlan } from '../world/rural';
import { buildMacroPlan } from './macro';
import { planCell, type CellPlan } from './cell';
import { placeEateries } from './terrace';
import { dwellingsOf, type BuildingDesc } from './building';
import { EATERY_OF, PREFER, amenityCounts, type AmenityKind } from './amenities';
import type { District, MacroPlan } from './types';
import type { LandmarkKind } from './landmarks';

/** Average household size: dwellings × this ≈ inhabitants. */
export const PEOPLE_PER_HOME = 2.2;

/** Households the town is planned for (about 1,000 inhabitants at size 0 … 2,000 at size 1). */
export function dwellingTarget(size: number): number {
  return Math.round(450 + 450 * clamp(size, 0, 1));
}

export interface Town {
  settings: TownSettings;
  terrain: Terrain;
  land: LandUse;
  macro: MacroPlan;
  /** Cell plans, indexed by cell id. */
  cells: CellPlan[];
  rural: RuralPlan;
  /** Households: flats and houses in the town plus one farmhouse per farm. */
  dwellings: number;
}

export function planTown(settings: TownSettings): Town {
  // The outline and the district mix decide how many homes a radius holds; a town far from the
  // target is planned again with its radius scaled (at most twice more, deterministic).
  const target = dwellingTarget(settings.size);
  let scale = 1, best: Omit<Town, 'settings'> | null = null, bestMiss = Infinity;
  for (let attempt = 0; attempt < 3; attempt++) {
    const t = planAt(settings, scale, target);
    const miss = t.dwellings < target * 0.9 ? target * 0.9 - t.dwellings : t.dwellings > target * 1.1 ? t.dwellings - target * 1.1 : 0;
    if (miss < bestMiss) { best = t; bestMiss = miss; }
    if (miss === 0) break;
    scale *= clamp(Math.sqrt(target / t.dwellings), 0.8, 1.3);
  }
  const t = best!;
  allocateAmenities(t.macro, t.cells, t.dwellings * PEOPLE_PER_HOME, t.terrain.profile.warmth, settings.seed);
  t.macro.cells.forEach((c, i) => placeEateries(t.cells[i], c, t.macro, t.terrain));
  return { settings, ...t };
}

/** Plan terrain, macro plan, countryside and cells with the town's radius scaled. */
function planAt(settings: TownSettings, scale: number, target: number): Omit<Town, 'settings'> {
  const profile = makeProfile(settings);
  profile.radius *= scale;
  profile.coastOffset *= scale;
  const terrain = new Terrain(profile);
  const macro = buildMacroPlan(terrain);
  const land = new LandUse(terrain);
  const rural = new RuralPlan(terrain, land, macro);
  land.settle = rural;
  const cells = macro.cells.map((c) => planCell(macro, c, terrain));
  const dwellings = calibrate(cells, rural.farms.length, target, settings.seed);
  return { terrain, land, macro, cells, rural, dwellings };
}

/**
 * Fit the household count to the target: a town planned with more flats than that has some
 * of its flats merged into bigger ones (fewer units per floor, never below one), the blocks
 * chosen in a seeded order so it stays deterministic. A town below the target keeps what it
 * has: the outline and the districts decide, and a smaller town is still a town. Returns the
 * dwellings (farms included).
 */
function calibrate(cells: CellPlan[], farms: number, target: number, seed: number): number {
  let total = farms;
  const flats: BuildingDesc[] = [];
  for (const c of cells) for (const b of c.buildings) {
    total += dwellingsOf(b);
    if (b.units > 1 && dwellingsOf(b) > 1) flats.push(b);
  }
  const hi = Math.round(target * 1.1);
  if (total <= hi) return total;
  const key = (b: BuildingDesc) => hash32(deriveSeed(seed, 'merge') ^ b.seed);
  flats.sort((a, b) => key(a) - key(b) || a.seed - b.seed);
  for (let progress = true; total > hi && progress;) {
    progress = false;
    for (const b of flats) {
      if (total <= hi) break;
      if (b.units <= 1) continue;
      const before = dwellingsOf(b);
      b.units--;
      total -= before - dwellingsOf(b);
      progress = true;
    }
  }
  return total;
}

/** Kinds that belong in the middle of town (scored by closeness to the core). */
const CENTRAL = new Set<AmenityKind>(['police', 'post', 'bank', 'library', 'pharmacy', 'cafe', 'pub', 'bakery', 'butcher', 'hairdresser', 'restaurant', 'bar', 'icecream', 'pizzeria']);
/** Kinds that like being near a site. */
const NEAR_SITE: Partial<Record<AmenityKind, LandmarkKind>> = { pharmacy: 'clinic', library: 'school', police: 'townhall', post: 'townhall', bank: 'townhall', cafe: 'townhall', pub: 'church' };

interface Cand { b: BuildingDesc; cell: number; x: number; z: number; district: District; open: boolean; area: number }

/**
 * Decide what every shop front and workplace is. The services every town has go first, each
 * to the best free shop front for it (its districts, near the core or the site it goes with,
 * apart from another of its kind); then the eateries and corner shops by the town's size; the
 * rest become shops, offices or stand empty. Office blocks become offices, industrial halls
 * workshops or factories (the garage prefers one of them).
 */
function allocateAmenities(macro: MacroPlan, cells: CellPlan[], pop: number, warmth: number, seed: number): void {
  const rng = new Rng(deriveSeed(seed, 'amenities'));
  const shops: Cand[] = [], halls: Cand[] = [];
  const [cx0, cz0] = macro.core;
  const R = Math.max(...macro.boundary);
  cells.forEach((plan, ci) => {
    const district = macro.cells[ci].district;
    const open = [...plan.plazas, ...plan.parks];
    for (const b of plan.buildings) {
      const [x, z] = polyCentroid(b.poly);
      const c: Cand = { b, cell: ci, x, z, district, open: false, area: Math.abs(polyArea(b.poly)) };
      if (b.shopfront) {
        // Facing a square or a park (within 30 m of its bounds): cafés like those spots.
        c.open = open.some((s) => { const q = polyBounds(s.outer); return x > q[0] - 30 && x < q[2] + 30 && z > q[1] - 30 && z < q[3] + 30; });
        shops.push(c);
      } else if (b.use === 'industrial') halls.push(c);
      else if (b.use === 'office') { b.amenity = 'office'; }
    }
  });
  const taken = new Map<AmenityKind, Cand[]>();
  const site = (k: LandmarkKind) => macro.landmarks.find((l) => l.kind === k);
  const score = (kind: AmenityKind, c: Cand): number => {
    let s = PREFER[kind]?.[c.district] ?? 1;
    if (CENTRAL.has(kind)) s *= 1.6 - Math.min(1, Math.hypot(c.x - cx0, c.z - cz0) / R);
    else s *= 0.6 + Math.min(1, Math.hypot(c.x - cx0, c.z - cz0) / R);
    const lk = NEAR_SITE[kind], lm = lk && site(lk);
    if (lm) s *= 1 + 0.6 * Math.max(0, 1 - Math.hypot(c.x - lm.x, c.z - lm.z) / 250);
    if (c.open && (kind === 'cafe' || kind === 'icecream' || kind === 'restaurant' || kind === 'pub')) s *= 1.5;
    // Apart from another of the same kind.
    for (const o of taken.get(kind) ?? []) s *= Math.min(1, 0.25 + Math.hypot(o.x - c.x, o.z - c.z) / 300);
    return s * rng.range(0.85, 1.15);
  };
  const give = (kind: AmenityKind, pool: Cand[]): boolean => {
    let best: Cand | null = null, bs = -Infinity;
    for (const c of pool) {
      if (c.b.amenity) continue;
      const s = score(kind, c);
      if (s > bs) { bs = s; best = c; }
    }
    if (!best) return false;
    best.b.amenity = kind;
    best.b.eatery = EATERY_OF[kind] ?? 0;
    let l = taken.get(kind);
    if (!l) taken.set(kind, (l = []));
    l.push(best);
    return true;
  };
  for (const [kind, count] of amenityCounts(pop, warmth)) {
    for (let k = 0; k < count; k++) {
      // The garage would rather have a hall of its own (a forecourt, a pit) than a shop front.
      if (kind === 'garage' && halls.some((h) => !h.b.amenity && h.area < 900) && give(kind, halls.filter((h) => h.area < 900))) continue;
      if (!give(kind, shops) && kind === 'garage') give(kind, halls);
    }
  }
  // The other shop fronts: as many shops and offices as a town this size keeps going (about
  // one shop per 30 inhabitants), the rest small trades' workshops or empty.
  const left = { shop: Math.round(pop / 30), office: Math.round(pop / 45) };
  for (const c of shops) {
    if (c.b.amenity) continue;
    const r = rng.fork(c.cell, c.b.id);
    const k = r.weighted<AmenityKind>(['shop', 'office', 'workshop', 'vacant'], (k) => (k === 'shop' ? (left.shop > 0 ? 0.68 : 0) : k === 'office' ? (left.office > 0 ? 0.2 : 0) : k === 'workshop' ? 0.06 : 0.06));
    if (k === 'shop' || k === 'office') left[k]--;
    c.b.amenity = k;
  }
  // Industrial halls: workshops, the big ones factories.
  for (const c of halls) if (!c.b.amenity) c.b.amenity = c.area > 1500 ? 'factory' : 'workshop';
}

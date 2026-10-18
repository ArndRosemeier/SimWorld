/**
 * Landmarks: the town's public buildings with grounds of their own, planned once from the seed
 * (pure data, part of the macro plan). Ported from Scale (src/plan/landmarks.ts); SimWorld keeps
 * the town hall, turns Scale's stadium into the town's sports ground and adds the church, the
 * school, the kindergarten, the health centre, the fire station, the supermarket, the care home
 * and the petrol station. Scale's
 * attractions, marvels and the airport are not part of a town.
 *
 *  * Town hall: at the historic core, a civic square in front (clock tower, dome or belfry).
 *  * Church: near the core, its tower towards the street, a churchyard round it.
 *  * School and kindergarten: among the houses, with a schoolyard, a garden, a playing field.
 *  * Health centre near the middle; fire station and supermarket out towards the edge.
 *  * Care home on a quiet residential edge, a garden behind; petrol station on an arterial at
 *    the edge of town, its forecourt open to the road.
 *  * Sports ground: towards the edge of the centre, on open land: a pitch with a running track
 *    now and then, a clubhouse with changing rooms, a small covered stand and a car park.
 *
 * Every landmark reserves an oriented rectangle (its site) inside one cell, clear of the
 * arterials and their sidewalks. The cell planner keeps local streets, lots and street
 * furniture out of it and lays its ground (square, lawn, car park) and its own props
 * (plan/cell.ts). The structure itself is described by plan/landmarkParts.ts.
 */
import { Rng, deriveSeed, clamp } from '@futuremagic/core';
import { type Poly, polyBounds, pointInPoly, polyCentroid, minAreaRect, segIntersect, distPointPolyEdge, ensureCCW } from '../geom/geom2';
import { offset } from '../geom/clip';
import type { Terrain } from '../world/terrain';
import type { CellInfo, MacroPlan } from './types';
import type { CityField } from './macro';
import { ROOTS, cityName } from './names';
import { CURB_H } from '../world/ground';
import { closestOnPolyline, frameToWorld, worldToFrame } from '../geom/geom2';
/** Site frames are geom2 frames (a site is a Frame plus its half extents). */
const siteToWorld = frameToWorld, worldToSite = worldToFrame;
import { boundaryAt } from '../world/boundary';
import { RAIL_HW } from './rail';

/**
 * The town's public buildings with grounds of their own. Smaller institutions (the pharmacy,
 * the bakery, the post office, …) take over ordinary buildings instead (plan/institutions).
 */
export type LandmarkKind = 'townhall' | 'sports' | 'church' | 'school' | 'kindergarten' | 'clinic' | 'fire' | 'supermarket' | 'station' | 'carehome' | 'petrol';

/** What a landmark is, in words (map tooltips). */
export const LANDMARK_KIND_NAME: Record<LandmarkKind, string> = {
  townhall: 'town hall', sports: 'sports ground', church: 'church', school: 'school', kindergarten: 'kindergarten',
  clinic: 'health centre', fire: 'fire station', supermarket: 'supermarket', station: 'railway station',
  carehome: 'care home', petrol: 'petrol station',
};

export interface Landmark {
  id: number;
  kind: LandmarkKind;
  name: string;
  /** Host cell (-1: outside the town, the station and now and then the sports ground). */
  cell: number;
  /**
   * Site: an oriented rectangle around (x, z), local axes u = (cos angle, sin angle) and
   * v = (-sin, cos), half sizes hu along u and hv along v. The front (entrance, square) faces -v.
   */
  x: number;
  z: number;
  angle: number;
  hu: number;
  hv: number;
  /** Site outline (CCW). */
  site: Poly;
  /** Floor level of the structure (highest ground under the site plus the curb) and the lowest ground. */
  base: number;
  low: number;
  /** Variation seed of the details (plan/landmarkParts). */
  seed: number;
  /** Kind-specific variant and parameters (see plan/landmarkParts for their meaning). */
  style: number;
  p: Record<string, number>;
  /** Outside the town: its access road (x, z, …) from the site's front to an arterial node. */
  road?: number[];
}

/** Ground of a site part: square paving, lawn, or asphalt (car parks, aprons). */
export type ZoneKind = 'plaza' | 'park' | 'paved';
export interface SiteZone { kind: ZoneKind; poly: Poly }

/** Margin kept between a site and local streets (half a street plus its sidewalk, and a bit). */
export const SITE_STREET_CLEAR = 9.5;

/** World point of local site coordinates; local site coordinates of a world point. */
export { siteToWorld, worldToSite };

/** Oriented rectangle (CCW) in local coordinates [u0, v0] – [u1, v1] of a site frame. */
export function siteRect(lm: Pick<Landmark, 'x' | 'z' | 'angle'>, u0: number, v0: number, u1: number, v1: number): Poly {
  return [...siteToWorld(lm, u0, v0), ...siteToWorld(lm, u1, v0), ...siteToWorld(lm, u1, v1), ...siteToWorld(lm, u0, v1)];
}

export function inSite(lm: Landmark, x: number, z: number, m = 0): boolean {
  const [u, v] = worldToSite(lm, x, z);
  return Math.abs(u) < lm.hu + m && Math.abs(v) < lm.hv + m;
}

export function landmarksOfCell(macro: MacroPlan, cell: number): Landmark[] {
  return (macro.landmarks ?? []).filter((l) => l.cell === cell);
}

// ------------------------------------------------------------------ site fitting

interface FitOpts {
  /** Largest height difference allowed under the site (m). */
  maxRange: number;
  /** Preferred point (default: the middle of the cell). */
  target?: (c: CellInfo) => [number, number];
  /** Extra test of a candidate (centre, angle). */
  accept?: (x: number, z: number) => boolean;
  /** Prefer spots whose front (-v) lies on the cell's outline (a square opening onto the street). */
  front?: boolean;
}

interface Fit { cell: CellInfo; x: number; z: number; angle: number; base: number; low: number }

class SiteFitter {
  constructor(readonly plan: MacroPlan, readonly terrain: Terrain, readonly placed: Landmark[]) {}

  /** Clearance from the cell outline: the widest bounding arterial's half width and sidewalk. */
  private clearance(c: CellInfo): number {
    let m = 0;
    for (const eid of c.edges) {
      const e = this.plan.edges[eid];
      if (e) m = Math.max(m, e.width / 2 + e.sidewalk);
    }
    return m + 3.5;
  }

  /** Is the oriented rectangle inside the polygon (corners inside, no outline edge crossing it)? */
  private rectIn(rect: Poly, poly: Poly): boolean {
    for (let k = 0; k < 8; k += 2) if (!pointInPoly(poly, rect[k], rect[k + 1])) return false;
    const n = poly.length >> 1;
    for (let k = 0; k < 4; k++) {
      const a = k * 2, b = ((k + 1) % 4) * 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        if (segIntersect(rect[a], rect[a + 1], rect[b], rect[b + 1], poly[i * 2], poly[i * 2 + 1], poly[j * 2], poly[j * 2 + 1])) return false;
      }
    }
    return true;
  }

  /** Clear of the other landmarks' sites (with a gap). */
  private clearOfOthers(x: number, z: number, hu: number, hv: number): boolean {
    const r = Math.hypot(hu, hv);
    for (const o of this.placed) if (Math.hypot(o.x - x, o.z - z) < r + Math.hypot(o.hu, o.hv) + 30) return false;
    return true;
  }

  /** Ground under the site: [highest, lowest], or null over water / too uneven. */
  private ground(x: number, z: number, angle: number, hu: number, hv: number, maxRange: number): [number, number] | null {
    const T = this.terrain, c = Math.cos(angle), s = Math.sin(angle);
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) {
      const u = (i / 4 - 0.5) * 2 * hu, v = (j / 4 - 0.5) * 2 * hv;
      const px = x + u * c - v * s, pz = z + u * s + v * c;
      if (T.isWater(px, pz, 4)) return null;
      const h = T.height(px, pz);
      lo = Math.min(lo, h); hi = Math.max(hi, h);
    }
    return hi - lo <= maxRange ? [hi, lo] : null;
  }

  /**
   * First cell (in the given order) that takes the site; within it the spot nearest the target,
   * turned so the front (-v) faces the nearest street.
   */
  fit(cells: CellInfo[], hu: number, hv: number, o: FitOpts): Fit | null {
    // (Scale kept one landmark per cell; a town's blocks are fewer, so sites share cells and
    // only keep their distance, clearOfOthers.)
    for (const c of cells) {
      if (c.district === 'water') continue;
      const clear = this.clearance(c);
      for (const sh of offset([c.poly], -clear, 'miter')) {
        const piece = ensureCCW(sh.outer);
        const obb = minAreaRect(piece);
        if (Math.min(obb.hu, obb.hv) < Math.min(hu, hv) || Math.max(obb.hu, obb.hv) < Math.max(hu, hv)) continue;
        const [x0, z0, x1, z1] = polyBounds(piece);
        const [tx, tz] = o.target ? o.target(c) : polyCentroid(piece);
        const step = clamp(Math.min(hu, hv) / 2.5, 5, 18);
        const pts: [number, number, number][] = [];
        for (let x = x0 + step / 2; x < x1; x += step) for (let z = z0 + step / 2; z < z1; z += step) {
          if (pointInPoly(piece, x, z) && distPointPolyEdge(piece, x, z) >= Math.min(hu, hv) * 0.95) pts.push([x, z, Math.hypot(x - tx, z - tz)]);
        }
        pts.sort((a, b) => a[2] - b[2]);
        const angles = [obb.angle, c.gridAngle];
        // With a street front wanted: the best of the first fits by distance plus front gap.
        let pick: Fit | null = null, pickScore = Infinity, fits = 0;
        for (const [x, z, dt] of pts.slice(0, 260)) {
          if (pick && (!o.front || fits >= 30 || dt > pickScore)) break;
          if (!this.clearOfOthers(x, z, hu, hv) || (o.accept && !o.accept(x, z))) continue;
          let best: { angle: number; d: number } | null = null;
          for (const a0 of angles) for (let k = 0; k < 4; k++) {
            const angle = a0 + (k * Math.PI) / 2;
            const fr = { x, z, angle };
            if (!this.rectIn(siteRect(fr, -hu, -hv, hu, hv), piece)) continue;
            // Front edge middle: as close to the cell outline (a street) as possible.
            const [fx, fz] = siteToWorld(fr, 0, -hv);
            const d = distPointPolyEdge(c.poly, fx, fz);
            if (!best || d < best.d - 0.5) best = { angle, d };
          }
          if (!best) continue;
          const g = this.ground(x, z, best.angle, hu, hv, o.maxRange);
          if (!g) continue;
          fits++;
          const score = dt + (o.front ? best.d * 2.5 : 0);
          if (score < pickScore) { pickScore = score; pick = { cell: c, x, z, angle: best.angle, base: g[0] + CURB_H, low: g[1] }; }
        }
        if (pick) return pick;
      }
    }
    return null;
  }
}

// ---------------------------------------------------------------------- designs

/** A landmark's variant, parameters and site half sizes (before it is placed). */
export interface Design { style: number; p: Record<string, number>; hu: number; hv: number; maxRange: number }

/** Shrink a design for a tight spot (k < 1); null when it cannot shrink further. */
export type Designer = (r: Rng, k: number) => Design | null;

function townhallDesign(terrain: Terrain): Designer {
  const pr = terrain.profile, a = pr.arch;
  return (r, k) => {
    if (k < 0.55) return null;
    // 0 classical (portico, dome), 1 gothic (steep roofs, belfry), 2 baroque (clock tower, mansard), 3 modern (slab, campanile).
    const style = r.weighted([0, 1, 2, 3], (s) => [0.4 + a.american, 0.3 + a.oldWorld * (1 - a.warm), 0.3 + a.oldWorld, 0.15 + a.modern * 0.8][s]);
    const big = clamp(pr.radius / 4000, 0.4, 1.6);
    const w = Math.round(r.range(34, 48) * (0.8 + 0.25 * big) * k);
    const d = Math.round(r.range(20, 28) * k);
    const sq = Math.round(r.range(26, 44) * k);
    const wings = style !== 3 && r.chance(0.55) ? 1 : 0;
    const wingD = wings ? Math.round(r.range(10, 18) * k) : 0;
    const tower = style === 0 ? (r.chance(0.75) ? 2 : 1) : style === 3 ? r.int(0, 1) : 1;
    return {
      style, hu: w / 2 + 6, hv: (d + sq + wingD) / 2 + 4, maxRange: 7,
      p: { w, d, sq, wings, wingD, tower, floors: r.int(3, 4), towerH: Math.round(r.range(28, 52) * (0.85 + 0.15 * big)), wall: r.int(0, 3), roof: r.int(0, 2) },
    };
  };
}

/**
 * The sports ground: a football pitch (with a running track round it now and then), a clubhouse
 * with changing rooms and a small bar beside it, a short covered stand along one touchline and,
 * with room to spare, a car park at one end. The front (-v) faces the street.
 */
function sportsDesign(): Designer {
  return (r, k) => {
    if (k < 0.7) return null;
    const track = r.chance(0.35) ? 1 : 0;
    // Pitch (half sizes): a town pitch, a little under the full 105 × 68.
    const pa = Math.round(r.range(45, 52)), pb = Math.round(r.range(29, 34));
    const run = track ? 8 : 4;
    const club = Math.round(r.range(20, 28)), clubD = Math.round(r.range(9, 12));
    const park = k > 0.85 ? 1 : 0;
    const hu = pa + run + 4 + (park ? 16 : 0), hv = pb + run + clubD + 10;
    return {
      style: track, hu, hv, maxRange: 3.5,
      p: { track, pa, pb, run, club, clubD, park, stand: Math.round(r.range(24, 40)), seats: r.int(0, 7), wall: r.int(0, 2), lights: r.chance(0.6) ? 1 : 0 },
    };
  };
}

/** A parish church: a nave with its tower at the front (-v), a churchyard round it. */
function churchDesign(terrain: Terrain): Designer {
  const a = terrain.profile.arch;
  return (r, k) => {
    if (k < 0.7) return null;
    // 0 stone (Romanesque / Gothic revival), 1 brick, 2 white clapboard or render (a New World chapel).
    const style = r.weighted([0, 1, 2], (s) => [0.4 + a.oldWorld, 0.3 + a.american * 0.6, 0.15 + a.american * 0.7][s]);
    const L = Math.round(r.range(24, 32) * k), W = Math.round(r.range(11, 14) * k), tw = Math.round(r.range(6, 8) * k);
    return {
      style, hu: W / 2 + 9, hv: (L + tw) / 2 + 9, maxRange: 5,
      p: { L, W, tw, H: r.range(9, 12), towerH: r.range(26, 38), spire: r.chance(0.7) ? 1 : 0, apse: r.chance(0.5) ? 1 : 0, wall: r.int(0, 3), roof: r.int(0, 2) },
    };
  };
}

/** A primary school: a two- or three-storey block (an L now and then), a schoolyard and a small playing field. */
function schoolDesign(terrain: Terrain): Designer {
  const a = terrain.profile.arch;
  return (r, k) => {
    if (k < 0.55) return null;
    // 0 old brick or stone school with a pitched roof, 1 post-war block with a flat roof.
    const style = r.weighted([0, 1], (s) => [0.5 + a.oldWorld, 0.4 + a.modern][s]);
    const bw = Math.round(r.range(40, 54) * k), bd = Math.round(r.range(12, 15));
    const wing = r.chance(0.5) ? 1 : 0, wingL = wing ? Math.round(r.range(16, 24) * k) : 0;
    const yard = Math.round(r.range(20, 28) * k), field = k > 0.8 ? Math.round(r.range(18, 24)) : 0;
    return {
      style, hu: bw / 2 + 5 + (field ? field + 2 : 0) / 2, hv: (bd + wingL + yard) / 2 + 6, maxRange: 4,
      p: { bw, bd, wing, wingL, yard, field, floors: r.int(2, 3), wall: r.int(0, 3), roof: r.int(0, 2) },
    };
  };
}

/** A kindergarten: a long single storey with a garden and a playground behind. */
function kindergartenDesign(): Designer {
  return (r, k) => {
    if (k < 0.6) return null;
    const bw = Math.round(r.range(22, 30) * k), bd = Math.round(r.range(11, 14));
    const garden = Math.round(r.range(16, 22) * k);
    return { style: r.int(0, 1), hu: bw / 2 + 5, hv: (bd + garden) / 2 + 5, maxRange: 3, p: { bw, bd, garden, wall: r.int(0, 4), roof: r.int(0, 2) } };
  };
}

/** A health centre: the doctors' practices on two floors, a small forecourt. */
function clinicDesign(): Designer {
  return (r, k) => {
    if (k < 0.6) return null;
    const bw = Math.round(r.range(22, 30) * k), bd = Math.round(r.range(12, 15));
    return { style: r.int(0, 1), hu: bw / 2 + 4, hv: bd / 2 + 10, maxRange: 3, p: { bw, bd, floors: 2, wall: r.int(0, 3) } };
  };
}

/** A fire station: the engine hall (three or four bays) with offices on top, the hose tower, an apron in front. */
function fireDesign(): Designer {
  return (r, k) => {
    if (k < 0.7) return null;
    const bays = r.int(3, 4), bayW = 4.6, hall = bays * bayW + 2, office = Math.round(r.range(8, 12)), hd = Math.round(r.range(14, 17));
    return { style: r.int(0, 1), hu: (hall + office) / 2 + 4, hv: hd / 2 + 10, maxRange: 2.5, p: { bays, bayW, hall, office, hd, towerH: Math.round(r.range(14, 19)), wall: r.int(0, 2) } };
  };
}

/** A supermarket: one big flat-roofed hall with its car park in front (-v). */
function supermarketDesign(): Designer {
  return (r, k) => {
    if (k < 0.6) return null;
    const bw = Math.round(r.range(40, 54) * k), bd = Math.round(r.range(26, 34) * k), park = Math.round(r.range(24, 32) * k);
    return { style: r.int(0, 2), hu: bw / 2 + 4, hv: (bd + park) / 2 + 4, maxRange: 2.5, p: { bw, bd, park, colour: r.int(0, 5) } };
  };
}

/**
 * A care home: a long two- or three-storey block along the street (an L with a wing back into
 * the garden in a bigger town), a small forecourt for visitors in front, a garden behind. The
 * bigger the town, the more storeys and the longer the block (`careHomeRooms`).
 */
function careHomeDesign(terrain: Terrain): Designer {
  const s = clamp(terrain.profile.size, 0, 1);
  return (r, k) => {
    if (k < 0.6) return null;
    const bw = Math.round((30 + 14 * s) * r.range(0.95, 1.08) * k), bd = Math.round(r.range(12, 14));
    const wing = s > 0.5 || r.chance(0.4) ? 1 : 0, wingL = wing ? Math.round(r.range(12, 18) * k) : 0;
    const garden = Math.round(r.range(14, 20) * k);
    return {
      style: r.int(0, 1), hu: bw / 2 + 5, hv: (bd + wingL + garden) / 2 + 6, maxRange: 3,
      p: { bw, bd, wing, wingL, garden, floors: s < 0.4 ? 2 : 3, wall: r.int(0, 3), roof: r.int(0, 2) },
    };
  };
}

/** Residents' rooms a care home holds: its floor area over all storeys, about 18 m² a room with its share of the corridors. */
export function careHomeRooms(lm: Landmark): number {
  const P = lm.p;
  return Math.floor((P.floors * (P.bw * P.bd + (P.wing ? 12 * P.wingL : 0)) * 0.6) / 18);
}

/**
 * A petrol station: the forecourt open to the road (-v), the canopy over two or three pump
 * islands, the kiosk (the shop and the till) at the back, a price sign by the road.
 */
function petrolDesign(): Designer {
  return (r, k) => {
    if (k < 0.7) return null;
    const cw = Math.round(r.range(14, 20)), cd = Math.round(r.range(9, 12)), kw = Math.round(r.range(10, 14)), kd = Math.round(r.range(7, 9));
    return { style: r.int(0, 3), hu: Math.max(cw, kw) / 2 + 6, hv: (cd + kd + 10) / 2 + 3, maxRange: 2, p: { cw, cd, kw, kd, islands: cw >= 17 ? 3 : 2, colour: r.int(0, 7) } };
  };
}

/** The railway station: a platform along the track, the station building behind it, a forecourt. */
function stationDesign(terrain: Terrain): Designer {
  const a = terrain.profile.arch;
  return (r) => {
    // 0 a brick or stone station of the railway age, 1 a small modern one (glass and a flat roof).
    const style = r.weighted([0, 1], (s) => [0.6 + a.oldWorld, 0.3 + a.modern][s]);
    const plat = Math.round(r.range(42, 56)), bw = Math.round(r.range(18, 26)), bd = Math.round(r.range(9, 11));
    return { style, hu: plat, hv: 15, maxRange: 6, p: { plat, bw, bd, wall: r.int(0, 2), roof: r.int(0, 2), canopy: Math.round(r.range(18, 30)) } };
  };
}

// ------------------------------------------------------------------------- names

const SAINTS = ['Mary', 'Peter', 'Paul', 'Stephen', 'James', 'John', 'Mark', 'Nicholas', 'Michael', 'Catherine', 'Andrew', 'Lawrence', 'Bartholomew', 'Clement'];

function landmarkName(kind: LandmarkKind, r: Rng, city: string, american: boolean): string {
  const root = r.pick(ROOTS);
  switch (kind) {
    case 'townhall': return american ? 'City Hall' : r.chance(0.5) ? 'Town Hall' : `${city} Town Hall`;
    case 'sports': return r.pick([`${root} Park`, `${root} Field`, `${city} Sports Ground`, `${root} Recreation Ground`, `${root} Lane`]);
    case 'church': return `${r.chance(0.8) ? 'St ' + r.pick(SAINTS) + "'s" : r.pick(['Holy Trinity', 'Christ', 'All Saints'])} ${r.pick(['Church', 'Church', 'Parish Church'])}`;
    case 'school': return r.pick([`${root} Primary School`, `${city} Primary School`, `${root} Elementary School`, `${root} Road School`]);
    case 'kindergarten': return r.pick([`${root} Kindergarten`, 'Little Acorns Kindergarten', `${root} Nursery`, 'Rainbow Kindergarten', 'Busy Bees Nursery']);
    case 'clinic': return r.pick([`${city} Health Centre`, `${root} Medical Practice`, `${root} Surgery`, `${root} Health Centre`]);
    case 'fire': return `${city} Fire Station`;
    case 'station': return `${city}`;
    case 'supermarket': return r.pick(['FreshMart', 'ValueFoods', 'Greenway', 'Harvest Market', 'DailyFare', 'Corner Basket']);
    case 'carehome': return r.pick([`${root} House`, `${root} Court Care Home`, `${root} Lodge`, `${root} Manor Care Home`, 'The Willows', 'Evergreen House']);
    case 'petrol': return r.pick([`${root} Service Station`, `${city} Filling Station`, 'QuickFuel', 'Roadside Fuel', `${root} Garage Fuels`]);
  }
}

// ---------------------------------------------------------------------- planning

/** Plan the town's landmarks (deterministic in the seed). */
export function planLandmarks(plan: MacroPlan, field: CityField, terrain: Terrain): Landmark[] {
  const pr = terrain.profile;
  const rng = new Rng(deriveSeed(pr.seed, 'landmarks'));
  const city = cityName(pr.seed);
  const american = pr.arch.american > pr.arch.oldWorld;
  const out: Landmark[] = [];
  const fitter = new SiteFitter(plan, terrain, out);
  const c0 = plan.centres[0];
  const dist = (c: CellInfo, x: number, z: number) => Math.hypot(c.centroid[0] - x, c.centroid[1] - z);
  const land = plan.cells.filter((c) => c.district !== 'water');

  const fronted = new Set<LandmarkKind>(['townhall', 'church', 'school', 'kindergarten', 'clinic', 'fire', 'supermarket', 'carehome', 'petrol']);
  const place = (kind: LandmarkKind, des: Designer, cells: CellInfo[], target?: FitOpts['target'], accept?: FitOpts['accept'], key: string = kind): Landmark | null => {
    const r = rng.fork(key);
    for (const k of [1, 0.85, 0.7, 0.55]) {
      const d = des(r.fork(k * 100), k);
      if (!d) break;
      const f = fitter.fit(cells, d.hu, d.hv, { maxRange: d.maxRange, target, accept, front: fronted.has(kind) });
      if (!f) continue;
      const lm: Landmark = {
        id: out.length, kind, name: landmarkName(kind, r.fork('name'), city, american), cell: f.cell.id,
        x: f.x, z: f.z, angle: f.angle, hu: d.hu, hv: d.hv, site: [], base: f.base, low: f.low,
        seed: r.nextU32(), style: d.style, p: d.p,
      };
      lm.site = siteRect(lm, -lm.hu, -lm.hv, lm.hu, lm.hv);
      out.push(lm);
      return lm;
    }
    return null;
  };

  // --- Town hall: the old core (its square in front).
  {
    const [cx, cz] = plan.core;
    const cells = land.filter((c) => c.district !== 'industrial' && c.district !== 'port' && c.district !== 'park')
      .sort((a, b) => dist(a, cx, cz) - dist(b, cx, cz)).slice(0, 30);
    place('townhall', townhallDesign(terrain), cells, () => [cx, cz]);
  }
  const outside = (kind: LandmarkKind, des: Designer) => addOutside(kind, des, plan, terrain, out, rng.fork(kind, 'outside'), (k, r) => landmarkName(k, r, city, american));
  // --- The railway station: outside the town where the line passes closest.
  const rail = plan.rail;
  if (rail) {
    const r = rng.fork('station');
    const d = stationDesign(terrain)(r.fork(100), 1)!;
    const nx = Math.cos(rail.side), nz = Math.sin(rail.side);
    const off = d.hv + RAIL_HW + 1.5;
    const lm: Landmark = {
      id: out.length, kind: 'station', name: landmarkName('station', r.fork('name'), city, american), cell: -1,
      x: rail.sx - nx * off, z: rail.sz - nz * off, angle: rail.angle + Math.PI, hu: d.hu, hv: d.hv, site: [], base: 0, low: 0,
      seed: r.nextU32(), style: d.style, p: d.p,
    };
    lm.site = siteRect(lm, -lm.hu, -lm.hv, lm.hu, lm.hv);
    [lm.base, lm.low] = siteGround(terrain, lm);
    lm.road = accessRoad(plan, terrain, lm);
    out.push(lm);
  }
  // --- Sports ground: towards the edge of the centre, on open land rather than in the core.
  {
    const want = clamp(pr.radius * 0.45, 300, 700);
    const pref: Record<string, number> = { park: -150, suburban: -80, industrial: -40, apartments: -20, rowhouses: 0, commercial: 80, port: 60, downtown: 260, oldtown: 400 };
    const score = (c: CellInfo) => Math.abs(dist(c, c0.x, c0.z) - want) + (pref[c.district] ?? 0) - c.area / 2000;
    const cells = land.slice().sort((a, b) => score(a) - score(b)).slice(0, 40);
    // A town too tight for a pitch has it just outside, on the flattest open ground by a road.
    if (!place('sports', sportsDesign(), cells)) outside('sports', sportsDesign());
  }
  // --- The rest of the public buildings, each where it belongs.
  const R = pr.radius;
  const ring = (want: number, pref: Record<string, number>) => (a: CellInfo, b: CellInfo) =>
    (Math.abs(dist(a, c0.x, c0.z) - want) + (pref[a.district] ?? 400)) - (Math.abs(dist(b, c0.x, c0.z) - want) + (pref[b.district] ?? 400));
  // The parish church: in the old town, near the core (but its own square, not the town hall's).
  if (!place('church', churchDesign(terrain), land.slice().sort(ring(R * 0.15, { oldtown: 0, commercial: 60, apartments: 120, rowhouses: 140, suburban: 220 })).slice(0, 30))) outside('church', churchDesign(terrain));
  // The school and the kindergarten: among the houses, a little out from the centre.
  if (!place('school', schoolDesign(terrain), land.slice().sort(ring(R * 0.45, { suburban: 0, apartments: 20, rowhouses: 20, park: 60, oldtown: 160, commercial: 120, industrial: 300 })).slice(0, 40))) outside('school', schoolDesign(terrain));
  if (!place('kindergarten', kindergartenDesign(), land.slice().sort(ring(R * 0.4, { suburban: 0, rowhouses: 20, apartments: 30, oldtown: 150, commercial: 140, industrial: 400 })).slice(0, 40))) outside('kindergarten', kindergartenDesign());
  // The health centre near the middle, the fire station on a through road towards the edge,
  // the supermarket on the way out of town.
  if (!place('clinic', clinicDesign(), land.slice().sort(ring(R * 0.2, { oldtown: 0, commercial: 0, apartments: 20, rowhouses: 40, suburban: 60 })).slice(0, 40))) outside('clinic', clinicDesign());
  if (!place('fire', fireDesign(), land.slice().sort(ring(R * 0.4, { industrial: 0, suburban: 20, apartments: 30, rowhouses: 30, commercial: 60, oldtown: 300 })).slice(0, 40))) outside('fire', fireDesign());
  // An edge-of-town supermarket (by the road out) when no cell has room for it.
  if (!place('supermarket', supermarketDesign(), land.slice().sort(ring(R * 0.7, { commercial: 0, industrial: 0, suburban: 20, apartments: 40, rowhouses: 60, oldtown: 300 })).slice(0, 40))) outside('supermarket', supermarketDesign());
  // The care home on a quiet residential edge; the petrol station on an arterial at the edge
  // of town (the spot on the cell's outer side, its forecourt towards the road).
  if (!place('carehome', careHomeDesign(terrain), land.slice().sort(ring(R * 0.7, { suburban: 0, rowhouses: 30, apartments: 40, park: 80, oldtown: 250, commercial: 250, industrial: 600, port: 600 })).slice(0, 40))) outside('carehome', careHomeDesign(terrain));
  const outer = (c: CellInfo): [number, number] => {
    let bx = c.centroid[0], bz = c.centroid[1], bd = -1;
    for (let i = 0; i < c.poly.length; i += 2) { const d = Math.hypot(c.poly[i] - c0.x, c.poly[i + 1] - c0.z); if (d > bd) { bd = d; bx = c.poly[i]; bz = c.poly[i + 1]; } }
    return [bx, bz];
  };
  if (!place('petrol', petrolDesign(), land.slice().sort(ring(R * 0.85, { industrial: 0, suburban: 10, commercial: 10, port: 30, apartments: 40, rowhouses: 40, oldtown: 400 })).slice(0, 40), outer)) outside('petrol', petrolDesign());
  void field;
  return out;
}

/** Highest ground under a site plus the curb (its floor) and the lowest ground. */
function siteGround(terrain: Terrain, lm: Landmark): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) {
    const [x, z] = siteToWorld(lm, (i / 4 - 0.5) * 2 * lm.hu, (j / 4 - 0.5) * 2 * lm.hv);
    const h = terrain.height(x, z);
    lo = Math.min(lo, h); hi = Math.max(hi, h);
  }
  return [hi + CURB_H, lo];
}

/** Does a site overlap one of the town's cells (or come within `m` of it)? */
function touchesTown(plan: MacroPlan, lm: Landmark, m: number): boolean {
  const pts: [number, number][] = [];
  for (let i = 0; i <= 6; i++) for (let j = 0; j <= 6; j++) pts.push(siteToWorld(lm, (i / 6 - 0.5) * 2 * (lm.hu + m), (j / 6 - 0.5) * 2 * (lm.hv + m)));
  return plan.cells.some((c) => pts.some(([x, z]) => pointInPoly(c.poly, x, z)));
}

/**
 * A site outside the town (cell -1): round the outline, front towards the town, on dry ground
 * clear of the railway and of the other sites; the one nearest an arterial node (the shortest
 * access road) on the levellest ground wins.
 */
function addOutside(kind: LandmarkKind, des: Designer, plan: MacroPlan, terrain: Terrain, out: Landmark[], rng: Rng, name: (k: LandmarkKind, r: Rng) => string): Landmark | null {
  const d = des(rng.fork(100), 1);
  if (!d) return null;
  const a0 = rng.range(0, Math.PI * 2);
  let best: { lm: Landmark; score: number } | null = null;
  for (let k = 0; k < 72; k++) {
    const th = a0 + ((k % 24) * Math.PI * 2) / 24, nx = Math.cos(th), nz = Math.sin(th);
    const R = boundaryAt(plan.boundary, nx, nz) + d.hv + [30, 70, 120][Math.floor(k / 24)];
    const lm: Landmark = {
      id: out.length, kind, name: '', cell: -1, x: nx * R, z: nz * R, angle: th - Math.PI / 2, hu: d.hu, hv: d.hv,
      site: [], base: 0, low: 0, seed: 0, style: d.style, p: d.p,
    };
    // Out of town a site may be cut into a slope (graded: up to 2.5 times the range it takes in town).
    const [hi, lo] = siteGround(terrain, lm);
    const range = hi - CURB_H - lo;
    if (range > d.maxRange * 2.5) continue;
    let ok = !touchesTown(plan, lm, 6);
    for (let i = 0; i <= 4 && ok; i++) for (let j = 0; j <= 4 && ok; j++) {
      const [x, z] = siteToWorld(lm, (i / 4 - 0.5) * 2 * lm.hu, (j / 4 - 0.5) * 2 * lm.hv);
      if (terrain.isWater(x, z, 6) || (terrain.profile.coastal && terrain.coastDistance(x, z) < 20)) ok = false;
      else if (plan.rail && closestOnPolyline(plan.rail.pts, x, z).d < RAIL_HW + 10) ok = false;
    }
    if (!ok || out.some((o) => Math.hypot(o.x - lm.x, o.z - lm.z) < Math.hypot(o.hu, o.hv) + Math.hypot(lm.hu, lm.hv) + 20)) continue;
    const [fx, fz] = siteToWorld(lm, 0, -lm.hv);
    const score = Math.min(...plan.nodes.map((n) => Math.hypot(n.x - fx, n.z - fz))) + 40 * Math.max(0, range - d.maxRange);
    if (!best || score < best.score) { lm.base = hi; lm.low = lo; best = { lm, score }; }
  }
  if (!best) return null;
  const lm = best.lm;
  lm.name = name(kind, rng.fork('name'));
  lm.seed = rng.nextU32();
  lm.site = siteRect(lm, -lm.hu, -lm.hv, lm.hu, lm.hv);
  lm.road = accessRoad(plan, terrain, lm);
  out.push(lm);
  return lm;
}

/**
 * Access road of a site outside the town: from the middle of its front straight out, then
 * straight to the nearest arterial node it reaches without cutting through the town's blocks,
 * the railway, the sea or a lake (a river it may bridge where the crossing is short).
 */
function accessRoad(plan: MacroPlan, terrain: Terrain, lm: Landmark): number[] | undefined {
  const [sx, sz] = siteToWorld(lm, 0, -lm.hv);
  const [ax, az] = siteToWorld(lm, 0, -lm.hv - 12);
  const cands = plan.nodes.map((n, i) => ({ i, d: Math.hypot(n.x - ax, n.z - az) })).sort((a, b) => a.d - b.d).slice(0, 20);
  const wq = { d: Infinity, s: 0, river: -1, halfWidth: 0, level: 0 };
  for (const { i } of cands) {
    const n = plan.nodes[i];
    const L = Math.hypot(n.x - ax, n.z - az);
    let ok = true, wet = 0;
    for (let s = 0; s <= L && ok; s += 8) {
      const t = s / L, x = ax + (n.x - ax) * t, z = az + (n.z - az) * t;
      if ((terrain.profile.coastal && terrain.coastDistance(x, z) < 8) || terrain.lakeAt(x, z).e < 8) ok = false;
      else if (plan.rail && closestOnPolyline(plan.rail.pts, x, z).d < RAIL_HW + 2) ok = false;
      else if (L - s > 30 && plan.cells.some((c) => pointInPoly(c.poly, x, z))) ok = false;
      const w = terrain.water(x, z, wq);
      wet = w.river >= 0 && w.d < w.halfWidth + 5 ? wet + 8 : 0;
      if (wet > 90) ok = false;
    }
    if (ok) return [sx, sz, ax, az, n.x, n.z];
  }
  return undefined;
}

// --------------------------------------------------------------- ground zones

/**
 * Ground of a site, split into zones (disjoint): the rest of the site is the landmark's
 * default ground (first zone kind wins where several touch is avoided by construction).
 */
export function siteZones(lm: Landmark): { base: ZoneKind; zones: SiteZone[] } {
  const P = lm.p;
  const R = (u0: number, v0: number, u1: number, v1: number) => siteRect(lm, u0, v0, u1, v1);
  switch (lm.kind) {
    case 'townhall': case 'clinic': return { base: 'plaza', zones: [] };
    case 'church': return { base: 'park', zones: [{ kind: 'plaza', poly: R(-P.W / 2 - 2, -lm.hv, P.W / 2 + 2, -lm.hv + 7) }] };
    case 'school': {
      // The building along the front, the schoolyard behind it, the playing field at +u.
      const zones: SiteZone[] = [{ kind: 'plaza', poly: R(-lm.hu + 2, -lm.hv, lm.hu - 2 - (P.field ? P.field + 2 : 0), lm.hv - 2) }];
      return { base: 'park', zones };
    }
    case 'kindergarten': return { base: 'park', zones: [{ kind: 'plaza', poly: R(-lm.hu + 2, -lm.hv, lm.hu - 2, -lm.hv + 5) }] };
    case 'fire': case 'supermarket': case 'petrol': return { base: 'paved', zones: [] };
    case 'carehome': return { base: 'park', zones: [{ kind: 'paved', poly: R(-lm.hu + 2, -lm.hv, lm.hu - 2, -lm.hv + 5.5) }] };
    case 'station': {
      // The forecourt paved, a strip of lawn either side of the building.
      return { base: 'paved', zones: [] };
    }
    case 'sports': {
      const zones: SiteZone[] = [];
      // The car park at the -u end (when designed with one).
      if (P.park) zones.push({ kind: 'paved', poly: R(-lm.hu + 2, -lm.hv + 3, -lm.hu + 28, lm.hv - 3) });
      return { base: 'park', zones };
    }
  }
}

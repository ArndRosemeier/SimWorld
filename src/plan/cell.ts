/**
 * Cell plan: everything inside one face of the arterial network.
 *
 *  1. Local streets by recursive splitting of the cell polygon (grammar per district).
 *  2. Surfaces by polygon booleans: carriageway, sidewalks, blocks, quay promenades.
 *  3. Lots: perimeter lots (urban), free lots (suburban/industrial), tower lots (downtown).
 *  4. Buildings, plazas, parks, courtyards and street furniture.
 *  5. Landmark sites (plan/landmarks): no streets, lots or furniture of their own in them; their
 *     ground (square, lawn, car park, with holes for the structure) and their props instead.
 *
 * Ported from Scale (src/plan/cell.ts) without the metro entrances and the random churches
 * (the church is a site now); the eatery terraces come later (plan/town.ts).
 */
import { Rng, deriveSeed, clamp, lerp } from '@futuremagic/core';
import {
  type Poly, polyArea, polyCentroid, minAreaRect, splitPolyByLine, ensureCCW, cleanPoly, pointInPoly,
  distSqPointSeg, polyBounds, resample, polylineLength, simplifyClosed, segIntersect, rectangularity,
} from '../geom/geom2';
import { cleanShapes, difference, inShape, intersection, largest, offset, strokePolylines, union, shapesToPolys, type Shape, shapeArea } from '../geom/clip';
import type { Terrain } from '../world/terrain';
import { RoadClass, type CellInfo, type District, type MacroPlan } from './types';
import { ROAD_SPEC } from './macro';
import { STYLES, asLockUp, isSliver, pickStyle, streetDoor, type BuildingDesc, type StyleId } from './building';
import type { EateryPlan } from './terrace';
import { crossingsOf } from './crossings';
import { planDrives, dressFronts, DRIVE_W, type Driveway } from './drives';
import { landmarksOfCell, siteRect, siteToWorld, siteZones, worldToSite, SITE_STREET_CLEAR, type Landmark, type ZoneKind } from './landmarks';
import { landmarkParts, solidFootprints } from './landmarkParts';

export interface StreetSeg {
  pts: number[];
  cls: RoadClass;
  width: number;
  sidewalk: number;
  lanes: number;
  /** -1 local street; otherwise the arterial edge id. */
  arterial: number;
}

/**
 * A kerbside parking bay: where a car may stand along a street, clear of the junctions (SETBACK
 * from the cross street's kerb), the zebra crossings, and the street's own ends; all of it on
 * the carriageway, against the kerb.
 */
export interface ParkingBay {
  /** Middle of the bay, and the yaw of a car in it (facing with the traffic on its side). */
  x: number;
  z: number;
  yaw: number;
  /** The street (index in `plan.streets`) and its side (+1 right of the polyline, -1 left). */
  street: number;
  side: number;
  /** A parked car stands here in the plan (the rest are free for the traffic's cars). */
  car: boolean;
}

/** Street trees stand this far in from the kerb; a sidewalk keeps at least WALK_CLEAR m free beside its furniture. */
const TREE_PIT = 0.8, WALK_CLEAR = 1.5;

/** Bay length and depth (m); a car keeps SETBACK m from the kerb line of a cross street. */
export const BAY_LENGTH = 6, BAY_DEPTH = 2.1, SETBACK = 5;

export interface Lot {
  poly: Poly;
  /** Frontage edge [ax, az, bx, bz] on the street side. */
  front: number[];
  corner: boolean;
  kind: 'perimeter' | 'free' | 'tower';
}

/** How far in from the kerb the street furniture stands (lamps, bins, sign posts), on a sidewalk `sidewalk` m wide (m). */
export const kerbStrip = (sidewalk: number): number => Math.min(0.5, sidewalk * 0.25);

export const enum PropType {
  Tree = 0,
  Lamp = 1,
  Bench = 2,
  Bin = 3,
  Hydrant = 4,
  TrafficLight = 5,
  ParkedCar = 6,
  BusStop = 7,
  Bollard = 8,
  Fountain = 9,
  Statue = 10,
  Bush = 11,
  Kiosk = 12,
  Planter = 13,
  StopSign = 14,
  Hedge = 15,
  PlayGround = 16,
  // 17: Scale's metro entrance (unused; the numbers stay stable).
  Manhole = 18,
  Mailbox = 19,
  // Café and restaurant terraces (plan/terrace.ts): variant = colour scheme * 2 + model.
  CafeTable = 20,
  CafeChair = 21,
  Parasol = 22,
  Awning = 23,
  MenuBoard = 24,
  TerraceRail = 25,
  Parklet = 26,
  // Cemeteries (variant picks the model): wall segment / gate pillar, headstone / cross,
  // ledger grave / obelisk, mausoleum / stone figure, and yews (cypress).
  CemWall = 27,
  Gravestone = 28,
  Grave = 29,
  Tomb = 30,
  Yew = 31,
  /** A car parked at the kerb of a street (ParkedCar is one in a car park): left out when the traffic draws the household cars in those bays. */
  KerbCar = 32,
  /** A house's front fence (variant 0 pickets, 1 a low wall), a 2.5 m stretch along its yaw's x (plan/drives.ts). */
  GardenFence = 33,
  /** At a driveway's end: variant 0 a garage, 1 a carport, its open front facing the street. */
  Garage = 34,
}

export interface CellPlan {
  id: number;
  district: District;
  streets: StreetSeg[];
  carriageway: Shape[];
  sidewalks: Shape[];
  blocks: Shape[];
  promenade: Shape[];
  plazas: Shape[];
  /** The paved ways onto landmark sites (part of the plazas): kept clear of furniture and terraces. */
  approaches: Poly[];
  parks: Shape[];
  /** Walled cemeteries (lawn ground, graves as props):  */
  cemeteries: Shape[];
  /** Gravel paths of the cemeteries. */
  cemPaths: Shape[];
  /** Back yards / courtyards / gardens. */
  yards: Shape[];
  /** Parking lots / industrial yards (asphalt). */
  paved: Shape[];
  lots: Lot[];
  buildings: BuildingDesc[];
  /** Props: [type, x, z, yaw, scale, variant] * n */
  props: number[];
  /** Kerbside parking bays along the streets (a `KerbCar` prop stands in those with `car`). */
  parking: ParkingBay[];
  /** Junction points of local streets [x, z, degree] * n. */
  junctions: number[];
  bounds: [number, number, number, number];
  /** Cafés, restaurants, … with their terraces (plan/terrace.ts). */
  eateries: EateryPlan[];
  /** Landmarks standing in this cell (their sites are kept clear of streets and lots). */
  landmarks: number[];
  /** Driveways of the detached houses (plan/drives.ts), with a car spot each. */
  driveways: Driveway[];
  /** Paved front paths from the lot front to a house door. */
  paths: Shape[];
}

interface Grammar {
  /** Target block dimensions (short, long) in m. */
  block: [number, number];
  street: RoadClass;
  /** Probability that a grid is used instead of organic splits. */
  grid: number;
  /** Lot frontage width range. */
  lotW: [number, number];
  /** Perimeter lot depth range. */
  lotD: [number, number];
  /** Lot layout. */
  layout: 'perimeter' | 'free' | 'tower' | 'none';
  /** Street tree probability. */
  trees: number;
}

const GRAMMAR: Record<District, Grammar> = {
  downtown: { block: [70, 140], street: RoadClass.Street, grid: 0.85, lotW: [18, 42], lotD: [22, 34], layout: 'perimeter', trees: 0.35 },
  commercial: { block: [65, 130], street: RoadClass.Street, grid: 0.7, lotW: [12, 26], lotD: [16, 24], layout: 'perimeter', trees: 0.5 },
  oldtown: { block: [38, 75], street: RoadClass.Lane, grid: 0.05, lotW: [7, 13], lotD: [11, 17], layout: 'perimeter', trees: 0.15 },
  apartments: { block: [70, 140], street: RoadClass.Street, grid: 0.65, lotW: [14, 28], lotD: [13, 19], layout: 'perimeter', trees: 0.75 },
  rowhouses: { block: [60, 180], street: RoadClass.Street, grid: 0.75, lotW: [6.5, 9.5], lotD: [12, 16], layout: 'perimeter', trees: 0.85 },
  suburban: { block: [70, 190], street: RoadClass.Street, grid: 0.35, lotW: [17, 28], lotD: [28, 40], layout: 'free', trees: 0.8 },
  industrial: { block: [120, 240], street: RoadClass.Street, grid: 0.6, lotW: [40, 90], lotD: [40, 80], layout: 'free', trees: 0.1 },
  port: { block: [120, 220], street: RoadClass.Street, grid: 0.7, lotW: [40, 90], lotD: [40, 70], layout: 'free', trees: 0.05 },
  park: { block: [1e9, 1e9], street: RoadClass.Path, grid: 0, lotW: [0, 0], lotD: [0, 0], layout: 'none', trees: 1 },
  water: { block: [1e9, 1e9], street: RoadClass.Path, grid: 0, lotW: [0, 0], lotD: [0, 0], layout: 'none', trees: 0 },
};

const CURB_R = 4.5;
/** Chance per block of a cemetery (one per cell at most; a few per city). */
const CEMETERY_P: Partial<Record<District, number>> = { oldtown: 0.014, suburban: 0.01, rowhouses: 0.008, apartments: 0.006 };

export function planCell(macro: MacroPlan, cell: CellInfo, terrain: Terrain): CellPlan {
  const p = terrain.profile;
  const rng = new Rng(deriveSeed(p.seed, 'cell', cell.id, Math.round(cell.centroid[0]), Math.round(cell.centroid[1])));
  const g = GRAMMAR[cell.district];
  const plan: CellPlan = {
    id: cell.id, district: cell.district, streets: [], carriageway: [], sidewalks: [], blocks: [], promenade: [],
    plazas: [], approaches: [], parks: [], cemeteries: [], cemPaths: [], yards: [], paved: [], lots: [], buildings: [], props: [], parking: [], junctions: [], bounds: polyBounds(cell.poly), eateries: [],
    landmarks: [], driveways: [], paths: [],
  };
  const sites = landmarksOfCell(macro, cell.id);
  plan.landmarks = sites.map((l) => l.id);
  // Streets keep a street's width (and its sidewalk) away from landmark sites.
  const keepOut = sites.map((l) => siteRect(l, -l.hu - SITE_STREET_CLEAR, -l.hv - SITE_STREET_CLEAR, l.hu + SITE_STREET_CLEAR, l.hv + SITE_STREET_CLEAR));

  // ---------------------------------------------------------- 1. streets
  const chords: { pts: number[]; cls: RoadClass }[] = [];
  if (g.layout !== 'none') splitStreets(cell, g, rng.fork('streets'), chords, keepOut);
  // Curvy suburbs: bend chords (keeping endpoints).
  for (const c of chords) {
    if (cell.district === 'suburban' && cell.gridness < 0.5) {
      const L = Math.hypot(c.pts[2] - c.pts[0], c.pts[3] - c.pts[1]);
      if (L > 60) {
        const n = Math.ceil(L / 12);
        const amp = rng.range(-0.12, 0.12) * L;
        const dx = (c.pts[2] - c.pts[0]) / L, dz = (c.pts[3] - c.pts[1]) / L;
        const pts: number[] = [];
        for (let i = 0; i <= n; i++) {
          const t = i / n;
          const o = Math.sin(Math.PI * t) * amp;
          pts.push(c.pts[0] + (c.pts[2] - c.pts[0]) * t - dz * o, c.pts[1] + (c.pts[3] - c.pts[1]) * t + dx * o);
        }
        // (A bend into a landmark site stays straight.)
        if (!lineHits(pts, keepOut)) c.pts = pts;
      }
    }
  }
  for (const c of chords) {
    const s = ROAD_SPEC[c.cls];
    plan.streets.push({ pts: c.pts, cls: c.cls, width: s.width, sidewalk: s.sidewalk, lanes: s.lanes, arterial: -1 });
  }
  // Arterials bounding the cell.
  for (const eid of cell.edges) {
    const e = macro.edges[eid];
    plan.streets.push({ pts: e.pts, cls: e.cls, width: e.width, sidewalk: e.sidewalk, lanes: e.lanes, arterial: eid });
  }

  // --------------------------------------------------------- 2. surfaces
  const cellPolys = [cell.poly];
  const carrStrokes: Poly[] = [];
  const roadStrokes: Poly[] = [];
  for (const s of plan.streets) {
    for (const sh of strokePolylines([s.pts], s.width / 2, 'round', 'round')) carrStrokes.push(sh.outer);
    for (const sh of strokePolylines([s.pts], s.width / 2 + s.sidewalk, 'round', 'round')) roadStrokes.push(sh.outer);
  }
  // Closing (dilate→erode) rounds the curb corners at junctions.
  const carr = closeShapes(union(carrStrokes), CURB_R);
  const road = closeShapes(union(roadStrokes), CURB_R * 0.6);
  plan.carriageway = intersection(shapesToPolys(carr), cellPolys);
  const roadInCell = intersection(shapesToPolys(road), cellPolys);
  plan.sidewalks = difference(shapesToPolys(roadInCell), shapesToPolys(plan.carriageway));

  // Quay promenade along water edges.
  const waterEdges: number[][] = [];
  {
    const P = cell.poly;
    const n = P.length >> 1;
    let run: number[] = [];
    for (let i = 0; i <= n; i++) {
      const j = i % n, k = (i + 1) % n;
      const mx = (P[j * 2] + P[k * 2]) / 2, mz = (P[j * 2 + 1] + P[k * 2 + 1]) / 2;
      const wet = i < n && terrain.isWater(mx, mz, 3);
      if (wet) {
        if (!run.length) run.push(P[j * 2], P[j * 2 + 1]);
        run.push(P[k * 2], P[k * 2 + 1]);
      } else if (run.length) { waterEdges.push(run); run = []; }
    }
  }
  let blocksBase = difference(cellPolys, shapesToPolys(road));
  if (waterEdges.length) {
    const prom = union(strokePolylines(waterEdges, cell.district === 'park' ? 4 : 9, 'round', 'round').map((s) => s.outer));
    plan.promenade = difference(intersection(shapesToPolys(prom), cellPolys).flatMap((s) => [s.outer, ...s.holes]), shapesToPolys(road));
    blocksBase = difference(shapesToPolys(blocksBase), shapesToPolys(prom));
  }
  // Soften block corners slightly (opening).
  blocksBase = offset(shapesToPolys(offset(shapesToPolys(blocksBase), -1.5, 'miter')), 1.5, 'round').filter((s) => shapeArea(s) > 60);
  plan.blocks = blocksBase;

  // ------------------------------------------------------ 3. lots & uses
  const br = rng.fork('blocks');
  let bid = 0;
  for (const blk of plan.blocks) {
    const area = shapeArea(blk);
    const b = br.fork(bid++);
    // A block holding a landmark site: the site is cut out (its ground comes later), the rest as usual.
    const hit = sites.filter((l) => shapeTouchesSite(blk, l));
    if (hit.length) {
      // Paved approaches from the middle of each side out to the street, so buildings on the
      // leftovers never wall a site in (one could only fly in otherwise).
      const ways = hit.flatMap(siteApproaches);
      for (const s of difference(shapesToPolys(intersection(ways, shapesToPolys([blk]))), hit.map((l) => l.site))) if (shapeArea(s) > 20) { plan.plazas.push(s); plan.approaches.push(s.outer); }
      const rest = difference(shapesToPolys([blk]), [...hit.map((l) => siteRect(l, -l.hu - 1.5, -l.hv - 1.5, l.hu + 1.5, l.hv + 1.5)), ...ways]);
      // (Lots are cut from outlines alone: a site inside the block must not stay a hole.)
      for (const piece of rest.flatMap((sh) => withoutHoles(sh))) {
        const a = shapeArea(piece);
        if (a < 60) continue;
        const o = minAreaRect(piece.outer);
        if (cell.district === 'park') plan.parks.push(piece);
        // Small or thin leftovers (between a site and the street) are paved, not built on.
        else if (a < 250 || Math.min(o.hu, o.hv) < 7) plan.plazas.push(piece);
        else makeLots(piece, g, cell, b, plan);
      }
      continue;
    }
    if (cell.district === 'park') { plan.parks.push(blk); continue; }
    // Now and then a walled cemetery, mostly in the old town and the quiet residential parts.
    const cemP = CEMETERY_P[cell.district] ?? 0;
    if (cemP > 0 && !plan.cemeteries.length && area > 1500 && area < 7000 && !blk.holes.length && b.chance(cemP)) {
      const o = minAreaRect(blk.outer);
      if (Math.min(o.hu, o.hv) >= 14) { plan.cemeteries.push(blk); continue; }
    }
    // Occasional plaza / pocket park.
    const plazaP = cell.district === 'oldtown' ? 0.1 : cell.district === 'downtown' || cell.district === 'commercial' ? 0.07 : 0.05;
    if (area < 9000 && area > 600 && b.chance(plazaP)) {
      if (cell.district === 'suburban' || b.chance(0.4)) plan.parks.push(blk);
      else plan.plazas.push(blk);
      continue;
    }
    if (area < 120) { plan.plazas.push(blk); continue; }
    makeLots(blk, g, cell, b, plan);
  }

  // ------------------------------------------------------- 4. buildings
  const bR = rng.fork('buildings');
  plan.lots.forEach((lot, i) => {
    const bd = makeBuilding(lot, i, cell, bR.fork(i), terrain);
    if (bd) plan.buildings.push(bd);
  });
  frontsOutdoors(plan.buildings);
  const fronts = planDrives(plan, rng.fork('drives'));

  // Junctions (for traffic lights/stop signs and crossings).
  plan.junctions = findJunctions(plan.streets);

  // --------------------------------------------------------- 5. props
  placeProps(plan, cell, macro, g, rng.fork('props'), terrain);
  dressFronts(plan, fronts);
  // ------------------------------------------------------ 5b. landmark props
  for (const lm of sites) placeLandmarkProps(plan, lm, terrain);
  // ------------------------------------------------------ 5c. landmark ground
  for (const lm of sites) placeLandmarkGround(plan, lm, terrain);
  // (The terraces of the cafés and restaurants come later, once the town planner has decided
  // which shop fronts they are: plan/town.ts calls placeEateries.)
  return plan;
}

function closeShapes(shapes: Shape[], r: number): Shape[] {
  const grown = offset(shapesToPolys(shapes), r, 'round');
  return offset(shapesToPolys(grown), -r, 'round');
}

// ------------------------------------------------------------- streets

function splitStreets(cell: CellInfo, g: Grammar, rng: Rng, out: { pts: number[]; cls: RoadClass }[], keepOut: Poly[] = []): void {
  const useGrid = rng.chance(g.grid * (0.4 + cell.gridness * 0.8));
  const ang = cell.gridAngle;
  const ux = Math.cos(ang), uz = Math.sin(ang);
  const [shortT, longT] = g.block;
  // Per-cell spacing jitter for the global grid (aligned across arterials).
  const spU = longT * rng.range(0.9, 1.1), spV = shortT * rng.range(0.9, 1.1);
  const queue: { poly: Poly; depth: number }[] = [{ poly: cell.poly, depth: 0 }];
  let guard = 0;
  while (queue.length && guard++ < 600) {
    const { poly, depth } = queue.shift()!;
    const area = Math.abs(polyArea(poly));
    const obb = minAreaRect(poly);
    const longLen = Math.max(obb.hu, obb.hv) * 2;
    const shortLen = Math.min(obb.hu, obb.hv) * 2;
    if (area < shortT * longT * 1.35 && longLen < longT * 1.4) continue;
    if (shortLen < shortT * 0.9 && longLen < longT * 1.6) continue;
    // Cut across the long axis.
    let dx: number, dz: number, ox: number, oz: number;
    const longAxisU = obb.hu >= obb.hv;
    const lx = longAxisU ? obb.ux : -obb.uz, lz = longAxisU ? obb.uz : obb.ux; // long axis dir
    if (useGrid) {
      // Choose the grid direction closest to the long axis as the cut normal.
      const dotU = Math.abs(lx * ux + lz * uz);
      const nx = dotU > 0.7071 ? ux : -uz, nz = dotU > 0.7071 ? uz : ux; // cut normal
      dx = -nz; dz = nx; // cut line direction
      const sp = dotU > 0.7071 ? spU : spV;
      // Nearest grid line to the centroid along the normal.
      const c = polyCentroid(poly);
      const proj = c[0] * nx + c[1] * nz;
      let k = Math.round(proj / sp);
      // Keep the cut within the polygon's middle 70%.
      const half = (dotU > 0.7071 ? (longAxisU ? obb.hu : obb.hv) : (longAxisU ? obb.hu : obb.hv));
      if (Math.abs(k * sp - proj) > half * 0.7) k = Math.round(proj / sp - 0.5) + 0.5;
      const t = k * sp;
      ox = nx * t; oz = nz * t;
      // Offset origin onto the line through projection.
      ox = c[0] + nx * (t - proj);
      oz = c[1] + nz * (t - proj);
    } else {
      const c = polyCentroid(poly);
      const jitterA = rng.range(-0.3, 0.3);
      const ca = Math.cos(jitterA), sa = Math.sin(jitterA);
      const nx = lx * ca - lz * sa, nz = lx * sa + lz * ca;
      dx = -nz; dz = nx;
      const shift = rng.range(-0.18, 0.18) * longLen;
      ox = c[0] + nx * shift;
      oz = c[1] + nz * shift;
    }
    let { pieces, chords } = splitPolyByLine(poly, ox, oz, dx, dz);
    if (keepOut.length && chords.some((ch) => lineHits(ch, keepOut))) {
      // A cut through a landmark site: move it to run along the site's edge instead (either
      // side, the nearer first); if neither works the piece stays whole around the site.
      const nx = -dz, nz = dx;
      const alt: number[] = [];
      for (const k of keepOut) {
        let lo = Infinity, hi = -Infinity;
        for (let i = 0; i < k.length; i += 2) { const t = (k[i] - ox) * nx + (k[i + 1] - oz) * nz; lo = Math.min(lo, t); hi = Math.max(hi, t); }
        alt.push(lo - 0.5, hi + 0.5);
      }
      alt.sort((a, b) => Math.abs(a) - Math.abs(b));
      let ok = false;
      for (const t of alt) {
        const r2 = splitPolyByLine(poly, ox + nx * t, oz + nz * t, dx, dz);
        if (r2.pieces.length < 2 || r2.chords.some((ch) => lineHits(ch, keepOut))) continue;
        if (r2.pieces.some((q) => Math.abs(polyArea(q)) < shortT * shortT * 0.35)) continue;
        pieces = r2.pieces; chords = r2.chords; ok = true;
        break;
      }
      if (!ok) continue;
    }
    if (pieces.length < 2) continue;
    // Reject slivers.
    if (pieces.some((q) => Math.abs(polyArea(q)) < shortT * shortT * 0.35)) {
      if (depth < 3) {
        // Retry once with a centred cut.
        const c = polyCentroid(poly);
        const r2 = splitPolyByLine(poly, c[0], c[1], -lz, lx);
        if (r2.pieces.length >= 2 && !r2.pieces.some((q) => Math.abs(polyArea(q)) < shortT * shortT * 0.35) && !r2.chords.some((ch) => lineHits(ch, keepOut))) {
          for (const ch of r2.chords) if (Math.hypot(ch[2] - ch[0], ch[3] - ch[1]) > 20) out.push({ pts: ch, cls: chordClass(g, ch, depth) });
          for (const q of r2.pieces) queue.push({ poly: q, depth: depth + 1 });
        }
      }
      continue;
    }
    for (const ch of chords) if (Math.hypot(ch[2] - ch[0], ch[3] - ch[1]) > 20) out.push({ pts: ch, cls: chordClass(g, ch, depth) });
    for (const q of pieces) queue.push({ poly: q, depth: depth + 1 });
  }
}

/** Does a polyline cross or enter any of the polygons? */
function lineHits(pts: number[], polys: Poly[]): boolean {
  for (const k of polys) {
    for (let i = 0; i < pts.length; i += 2) if (pointInPoly(k, pts[i], pts[i + 1])) return true;
    const n = k.length >> 1;
    for (let i = 0; i + 3 < pts.length; i += 2) {
      for (let a = 0; a < n; a++) {
        const b = (a + 1) % n;
        if (segIntersect(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], k[a * 2], k[a * 2 + 1], k[b * 2], k[b * 2 + 1])) return true;
      }
    }
  }
  return false;
}

/** A shape cut into pieces without holes (split through each hole). */
function withoutHoles(sh: Shape, depth = 0): Shape[] {
  if (!sh.holes.length || depth > 3) return [sh];
  const h = sh.holes[0], c = polyCentroid(h), o = minAreaRect(h);
  const out: Shape[] = [];
  for (const half of splitPolyByLine(sh.outer, c[0], c[1], -o.uz, o.ux).pieces) {
    for (const s of difference([ensureCCW(half)], sh.holes)) out.push(...withoutHoles(s, depth + 1));
  }
  return out;
}

/** Strips from the middle of each side of a site straight out (cut from the blocks round it). */
function siteApproaches(lm: Landmark): Poly[] {
  const w = clamp(Math.min(lm.hu, lm.hv) * 0.3, 8, 16) / 2, L = 400, hu = lm.hu, hv = lm.hv;
  return [
    siteRect(lm, -w, -hv - L, w, -hv + 1), siteRect(lm, -w, hv - 1, w, hv + L),
    siteRect(lm, -hu - L, -w, -hu + 1, w), siteRect(lm, hu - 1, -w, hu + L, w),
  ];
}

/** Does a block overlap a landmark's site? */
function shapeTouchesSite(blk: Shape, lm: Landmark): boolean {
  for (let i = 0; i < blk.outer.length; i += 2) {
    const [u, v] = worldToSite(lm, blk.outer[i], blk.outer[i + 1]);
    if (Math.abs(u) < lm.hu && Math.abs(v) < lm.hv) return true;
  }
  for (let i = 0; i < lm.site.length; i += 2) if (inShape(blk, lm.site[i], lm.site[i + 1])) return true;
  return lineHits([...lm.site, lm.site[0], lm.site[1]], [blk.outer]);
}

function chordClass(g: Grammar, ch: number[], depth: number): RoadClass {
  const L = Math.hypot(ch[2] - ch[0], ch[3] - ch[1]);
  if (g.street === RoadClass.Lane) return L > 160 && depth === 0 ? RoadClass.Street : RoadClass.Lane;
  return g.street;
}

function findJunctions(streets: StreetSeg[]): number[] {
  // Endpoints that coincide (or lie on another street) are junctions.
  const pts: number[] = [];
  const add = (x: number, z: number) => {
    for (let i = 0; i < pts.length; i += 3) {
      if (Math.abs(pts[i] - x) < 3 && Math.abs(pts[i + 1] - z) < 3) { pts[i + 2]++; return; }
    }
    pts.push(x, z, 1);
  };
  for (const s of streets) {
    add(s.pts[0], s.pts[1]);
    add(s.pts[s.pts.length - 2], s.pts[s.pts.length - 1]);
  }
  // Endpoints touching the middle of another street count as T-junctions.
  for (let i = 0; i < pts.length; i += 3) {
    for (const s of streets) {
      for (let k = 0; k + 3 < s.pts.length; k += 2) {
        const d = distSqPointSeg(pts[i], pts[i + 1], s.pts[k], s.pts[k + 1], s.pts[k + 2], s.pts[k + 3]);
        const atEnd = (Math.hypot(pts[i] - s.pts[0], pts[i + 1] - s.pts[1]) < 3) || (Math.hypot(pts[i] - s.pts[s.pts.length - 2], pts[i + 1] - s.pts[s.pts.length - 1]) < 3);
        if (d < 4 && !atEnd) { pts[i + 2] += 2; break; }
      }
    }
  }
  const out: number[] = [];
  for (let i = 0; i < pts.length; i += 3) if (pts[i + 2] >= 3) out.push(pts[i], pts[i + 1], pts[i + 2]);
  return out;
}

// ------------------------------------------------------------------ lots

function makeLots(blk: Shape, g: Grammar, cell: CellInfo, r: Rng, plan: CellPlan): void {
  const outer = blk.outer;
  const area = shapeArea(blk);
  // Downtown: some blocks are a single tower on a plaza.
  if (cell.district === 'downtown' && area < 14000 && area > 1200 && r.chance(0.22)) {
    plan.lots.push({ poly: outer, front: longestEdge(outer), corner: true, kind: 'tower' });
    plan.plazas.push(blk);
    return;
  }
  if (g.layout === 'perimeter' && area < g.lotW[1] * g.lotD[1] * 1.3) {
    // Small block: one or two buildings.
    const parts = splitFree(outer, area / (area > g.lotW[1] * g.lotD[0] ? 2 : 1), r, 1);
    // The front is on the street (the block's outline), never the cut between the two.
    for (const q of parts) plan.lots.push({ poly: q, front: frontEdge(q, outer) ?? longestEdge(q), corner: true, kind: 'perimeter' });
    return;
  }
  if (g.layout === 'free') {
    const lotArea = (g.lotW[0] + g.lotW[1]) / 2 * ((g.lotD[0] + g.lotD[1]) / 2);
    const parts = splitFree(outer, lotArea, r, 12);
    for (const q of parts) {
      const fr = frontEdge(q, outer);
      if (!fr) { plan.yards.push({ outer: q, holes: [] }); continue; }
      plan.lots.push({ poly: q, front: fr, corner: false, kind: 'free' });
    }
    for (const h of blk.holes) plan.yards.push({ outer: h, holes: [] });
    return;
  }
  // Perimeter block: a ring of lots along the street edges around a courtyard.
  // Built constructively: one depth strip per (simplified) edge, mitred at the
  // corners, split into frontage lots; long edges first, later strips only take
  // what is left (handles reflex corners and short edges).
  const depth = r.range(g.lotD[0], g.lotD[1]);
  const simp = ensureCCW(simplifyClosed(outer, 0.9));
  const n = simp.length >> 1;
  if (n < 3) return;
  const nrm: number[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = simp[j * 2] - simp[i * 2], dz = simp[j * 2 + 1] - simp[i * 2 + 1];
    const L = Math.hypot(dx, dz) || 1;
    nrm.push(-dz / L, dx / L);
  }
  const inner: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i + n - 1) % n;
    let bx = nrm[a * 2] + nrm[i * 2], bz = nrm[a * 2 + 1] + nrm[i * 2 + 1];
    const bl = Math.hypot(bx, bz);
    if (bl < 1e-3) { bx = nrm[i * 2]; bz = nrm[i * 2 + 1]; } else { bx /= bl; bz /= bl; }
    const sc = Math.min(depth * 2.2, depth / Math.max(0.35, bx * nrm[i * 2] + bz * nrm[i * 2 + 1]));
    inner.push(simp[i * 2] + bx * sc, simp[i * 2 + 1] + bz * sc);
  }
  const order = [...Array(n).keys()].sort((x, y) => edgeLen(simp, y) - edgeLen(simp, x));
  const taken: Poly[] = [];
  const minLot = g.lotW[0] * depth * 0.45;
  for (const i of order) {
    const j = (i + 1) % n;
    const L = edgeLen(simp, i);
    if (L < 2) continue;
    const strip = [simp[i * 2], simp[i * 2 + 1], simp[j * 2], simp[j * 2 + 1], inner[j * 2], inner[j * 2 + 1], inner[i * 2], inner[i * 2 + 1]];
    const stripClean = union([strip, ]).filter((sh) => shapeArea(sh) > 1);
    if (!stripClean.length) continue;
    let pieces = intersection(shapesToPolys(stripClean), [outer]);
    if (taken.length) pieces = difference(shapesToPolys(pieces), taken);
    taken.push(...shapesToPolys(stripClean));
    const ax = simp[i * 2], az = simp[i * 2 + 1];
    const dx = (simp[j * 2] - ax) / L, dz = (simp[j * 2 + 1] - az) / L;
    for (const pc of pieces) {
      let rest = ensureCCW(cleanPoly(pc.outer, 0.05));
      if (Math.abs(polyArea(rest)) < minLot) { if (Math.abs(polyArea(rest)) > 20) plan.yards.push({ outer: rest, holes: [] }); continue; }
      // Extent of this piece along the edge.
      let t0 = Infinity, t1 = -Infinity;
      for (let k = 0; k < rest.length; k += 2) {
        const t = (rest[k] - ax) * dx + (rest[k + 1] - az) * dz;
        t0 = Math.min(t0, t); t1 = Math.max(t1, t);
      }
      const cutsT: number[] = [];
      let t = t0;
      while (true) {
        const w = r.range(g.lotW[0], g.lotW[1]);
        if (t + w > t1 - g.lotW[0] * 0.7) break;
        t += w;
        cutsT.push(t);
      }
      const lotsHere: Poly[] = [];
      for (const ct of cutsT) {
        const res = splitPolyByLine(rest, ax + dx * ct, az + dz * ct, -dz, dx);
        if (res.pieces.length < 2) continue;
        // The piece on the low-t side is a finished lot.
        res.pieces.sort((p1, p2) => polyCentroid(p1)[0] * dx + polyCentroid(p1)[1] * dz - (polyCentroid(p2)[0] * dx + polyCentroid(p2)[1] * dz));
        lotsHere.push(res.pieces[0]);
        rest = res.pieces[res.pieces.length - 1];
        for (let k = 1; k < res.pieces.length - 1; k++) lotsHere.push(res.pieces[k]);
      }
      lotsHere.push(rest);
      for (const q0 of lotsHere) {
        const q = ensureCCW(cleanPoly(q0, 0.05));
        if (q.length < 6 || Math.abs(polyArea(q)) < 20) continue;
        const fr = frontEdge(q, outer) ?? frontEdge(q, simp);
        if (!fr) { plan.yards.push({ outer: q, holes: [] }); continue; }
        plan.lots.push({ poly: q, front: fr, corner: countFrontEdges(q, simp) > 1, kind: 'perimeter' });
      }
    }
  }
  // Courtyard: whatever the strips did not take.
  const yard = taken.length ? difference([outer], taken) : [];
  for (const s of yard) {
    const a = shapeArea(s);
    if (a < 30) continue;
    if ((cell.district === 'downtown' || cell.district === 'commercial') && a > 200 && r.chance(0.55)) {
      const sh = offset([s.outer], -1.0, 'miter');
      for (const q of sh) if (shapeArea(q) > 150) plan.lots.push({ poly: q.outer, front: longestEdge(q.outer), corner: false, kind: 'free' });
      continue;
    }
    plan.yards.push(s);
  }
}

function edgeLen(p: Poly, i: number): number {
  const n = p.length >> 1, j = (i + 1) % n;
  return Math.hypot(p[j * 2] - p[i * 2], p[j * 2 + 1] - p[i * 2 + 1]);
}

/** Recursive OBB splitting until pieces are near the target area. */
function splitFree(poly: Poly, target: number, r: Rng, maxDepth: number): Poly[] {
  const out: Poly[] = [];
  const stack: [Poly, number][] = [[poly, 0]];
  while (stack.length) {
    const [q, d] = stack.pop()!;
    const a = Math.abs(polyArea(q));
    if (a < target * 1.6 || d >= maxDepth) { out.push(q); continue; }
    const o = minAreaRect(q);
    const longU = o.hu >= o.hv;
    const lx = longU ? o.ux : -o.uz, lz = longU ? o.uz : o.ux;
    const c = polyCentroid(q);
    const shift = r.range(-0.12, 0.12) * Math.max(o.hu, o.hv);
    const res = splitPolyByLine(q, c[0] + lx * shift, c[1] + lz * shift, -lz, lx);
    if (res.pieces.length < 2) { out.push(q); continue; }
    if (res.pieces.some((pc) => rectangularity(pc) < 0.45 && Math.abs(polyArea(pc)) > 80)) { out.push(q); continue; }
    for (const pc of res.pieces) stack.push([pc, d + 1]);
  }
  return out;
}

/** Edge of q that lies on the block outline (street side); longest one wins. */
function frontEdge(q: Poly, outer: Poly): number[] | null {
  let best: number[] | null = null, bl = 0;
  const n = q.length >> 1;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = q[i * 2], az = q[i * 2 + 1], bx = q[j * 2], bz = q[j * 2 + 1];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 2.5) continue;
    if (!onOutline((ax + bx) / 2, (az + bz) / 2, outer)) continue;
    if (L > bl) { bl = L; best = [ax, az, bx, bz]; }
  }
  return best;
}

function countFrontEdges(q: Poly, outer: Poly): number {
  let c = 0;
  const n = q.length >> 1;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const L = Math.hypot(q[j * 2] - q[i * 2], q[j * 2 + 1] - q[i * 2 + 1]);
    if (L > 4 && onOutline((q[i * 2] + q[j * 2]) / 2, (q[i * 2 + 1] + q[j * 2 + 1]) / 2, outer)) c++;
  }
  return c;
}

function onOutline(x: number, z: number, outer: Poly): boolean {
  const n = outer.length >> 1;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (distSqPointSeg(x, z, outer[i * 2], outer[i * 2 + 1], outer[j * 2], outer[j * 2 + 1]) < 0.3) return true;
  }
  return false;
}

function longestEdge(q: Poly): number[] {
  let best = [0, 0, 1, 0], bl = -1;
  const n = q.length >> 1;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const L = Math.hypot(q[j * 2] - q[i * 2], q[j * 2 + 1] - q[i * 2 + 1]);
    if (L > bl) { bl = L; best = [q[i * 2], q[i * 2 + 1], q[j * 2], q[j * 2 + 1]]; }
  }
  return best;
}

// ------------------------------------------------------------- buildings

/**
 * A building whose street door would open into a neighbour (its front picked on a party wall:
 * slivers, wedges at bent block corners) gets the longest edge whose door opens outdoors.
 */
function frontsOutdoors(B: BuildingDesc[]): void {
  const indoors = (b: BuildingDesc) => {
    const d = streetDoor(b), P = b.poly, n = P.length >> 1, i = b.front % n, j = (i + 1) % n;
    const L = Math.hypot(P[j * 2] - P[i * 2], P[j * 2 + 1] - P[i * 2 + 1]) || 1;
    const x = d.x + ((P[j * 2 + 1] - P[i * 2 + 1]) / L) * 0.8, z = d.z - ((P[j * 2] - P[i * 2]) / L) * 0.8;
    return B.some((o) => pointInPoly(o.poly, x, z));
  };
  for (const b of B) {
    if (!indoors(b)) continue;
    const n = b.poly.length >> 1, was = b.front;
    const order = [...Array(n).keys()].sort((p, q) => edgeLen(b.poly, q) - edgeLen(b.poly, p));
    for (const k of order) { b.front = k; if (!indoors(b)) break; }
    if (indoors(b)) b.front = was;
  }
}

function makeBuilding(lot: Lot, index: number, cell: CellInfo, r: Rng, terrain: Terrain): BuildingDesc | null {
  const p = terrain.profile;
  const frontLen = Math.hypot(lot.front[2] - lot.front[0], lot.front[3] - lot.front[1]);
  const area = Math.abs(polyArea(lot.poly));
  const c = polyCentroid(lot.poly);
  let style: StyleId = pickStyle(r, cell.district, p, cell.density, cell.era, area, frontLen);
  if (lot.kind === 'tower') style = r.chance(0.3 + 0.5 * p.arch.american / (p.arch.american + p.arch.modern + 0.1)) ? 'artdeco' : 'glass';
  let poly = lot.poly;
  // Setbacks for detached styles.
  if (lot.kind === 'free') {
    const fx = lot.front[2] - lot.front[0], fz = lot.front[3] - lot.front[1];
    const fl = Math.hypot(fx, fz) || 1;
    const nx = -fz / fl, nz = fx / fl;
    if (style === 'house') {
      // Detached house: a rectangle set back from the front edge; shrink until it fits.
      const ux = fx / fl, uz = fz / fl;
      const depth0 = r.range(9, 14), width0 = Math.min(frontLen - r.range(4, 7), r.range(9, 15));
      const setback = r.range(4, 8);
      const along = r.range(-1.5, 1.5);
      const wingP = r.chance(0.35), ww0 = r.range(0.35, 0.5), wd0 = r.range(4, 7), side = r.sign();
      let ok = false;
      for (let k = 0; k < 5 && !ok; k++) {
        const f = 1 - k * 0.12;
        const depth = depth0 * f, width = width0 * f;
        if (width < 5.5) break;
        const mx = (lot.front[0] + lot.front[2]) / 2 + ux * along, mz = (lot.front[1] + lot.front[3]) / 2 + uz * along;
        const x0 = mx + nx * setback * f, z0 = mz + nz * setback * f;
        let cand = [
          x0 - ux * width / 2, z0 - uz * width / 2,
          x0 + ux * width / 2, z0 + uz * width / 2,
          x0 + ux * width / 2 + nx * depth, z0 + uz * width / 2 + nz * depth,
          x0 - ux * width / 2 + nx * depth, z0 - uz * width / 2 + nz * depth,
        ];
        if (wingP && k < 2) {
          const ww = width * ww0, wd = wd0 * f;
          const sx = x0 + ux * side * (width / 2 - ww / 2) + nx * depth, sz = z0 + uz * side * (width / 2 - ww / 2) + nz * depth;
          const wing = [
            sx - ux * ww / 2 - nx * 0.5, sz - uz * ww / 2 - nz * 0.5,
            sx + ux * ww / 2 - nx * 0.5, sz + uz * ww / 2 - nz * 0.5,
            sx + ux * ww / 2 + nx * wd, sz + uz * ww / 2 + nz * wd,
            sx - ux * ww / 2 + nx * wd, sz - uz * ww / 2 + nz * wd,
          ];
          const u = union([ensureCCW(cand), ensureCCW(wing)]);
          if (u.length === 1) cand = u[0].outer;
        }
        if (polyInside(cand, lot.poly, 0.5)) { poly = cand; ok = true; }
      }
      if (!ok) return null;
    } else {
      const inset = style === 'warehouse' ? r.range(3, 8) : r.range(2, 5);
      const sh = offset([lot.poly], -inset, 'miter');
      if (!sh.length) return null;
      poly = sh.sort((a, b) => shapeArea(b) - shapeArea(a))[0].outer;
    }
  } else if (lot.kind === 'tower') {
    // Whole-block tower: a rectangle aligned to the block's frontage, standing on a plaza.
    const fx = lot.front[2] - lot.front[0], fz = lot.front[3] - lot.front[1];
    const fl = Math.hypot(fx, fz) || 1;
    const ux = fx / fl, uz = fz / fl, vx = -uz, vz = ux;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (let i = 0; i < lot.poly.length; i += 2) {
      const u = lot.poly[i] * ux + lot.poly[i + 1] * uz, v = lot.poly[i] * vx + lot.poly[i + 1] * vz;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
    const hu = (u1 - u0) / 2 * r.range(0.45, 0.75), hv = (v1 - v0) / 2 * r.range(0.45, 0.75);
    const rect = [
      ux * (cu - hu) + vx * (cv - hv), uz * (cu - hu) + vz * (cv - hv),
      ux * (cu + hu) + vx * (cv - hv), uz * (cu + hu) + vz * (cv - hv),
      ux * (cu + hu) + vx * (cv + hv), uz * (cu + hu) + vz * (cv + hv),
      ux * (cu - hu) + vx * (cv + hv), uz * (cu - hu) + vz * (cv + hv),
    ];
    const sh = intersection([ensureCCW(rect)], [lot.poly]);
    if (!sh.length) return null;
    poly = sh.sort((a, b) => shapeArea(b) - shapeArea(a))[0].outer;
  }
  // A lot cut from a bent block can come out pinched (two parts touching at a corner, or a
  // spike folding back): keep its biggest simple part.
  const simple = largest(cleanShapes([poly]));
  if (!simple) return null;
  poly = ensureCCW(cleanPoly(simple, 0.05));
  if (Math.abs(polyArea(poly)) < 30 || poly.length < 6) return null;

  // Front edge index of the footprint: the edge closest to and most parallel with the lot
  // frontage (a long party wall at right angles to the street never wins: its door would open
  // into the neighbour).
  const fmx = (lot.front[0] + lot.front[2]) / 2, fmz = (lot.front[1] + lot.front[3]) / 2;
  const fL = Math.hypot(lot.front[2] - lot.front[0], lot.front[3] - lot.front[1]) || 1;
  const fdx = (lot.front[2] - lot.front[0]) / fL, fdz = (lot.front[3] - lot.front[1]) / fL;
  let front = 0, bd = Infinity;
  const n = poly.length >> 1;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const d = Math.sqrt(distSqPointSeg(fmx, fmz, poly[i * 2], poly[i * 2 + 1], poly[j * 2], poly[j * 2 + 1]));
    const L = Math.hypot(poly[j * 2] - poly[i * 2], poly[j * 2 + 1] - poly[i * 2 + 1]);
    if (L < 1e-6) continue;
    const par = Math.abs(((poly[j * 2] - poly[i * 2]) * fdx + (poly[j * 2 + 1] - poly[i * 2 + 1]) * fdz) / L);
    const score = d + 8 * (1 - par) - L * 0.05;
    if (score < bd) { bd = score; front = i; }
  }

  const rule = STYLES[style];
  let floors = rule.floors(r, cell.density, p);
  // Height gradient towards the centre for towers, plus a few landmarks.
  if (style === 'glass' || style === 'artdeco') {
    const boost = 0.6 + cell.density * 0.8;
    floors = Math.round(floors * boost);
    if (r.chance(0.04 * p.skyline)) floors = Math.round(floors * r.range(1.4, 2.0));
    // Small lots cannot carry tall towers.
    const maxF = Math.max(8, Math.round(Math.sqrt(area) * 1.6));
    floors = Math.min(floors, maxF);
  }
  if (lot.kind === 'perimeter' && style !== 'church') {
    // Neighbouring buildings vary a little; corner buildings are often taller.
    floors = Math.max(1, floors + (lot.corner && r.chance(0.4) ? 1 : 0));
  }
  const floorH = r.range(rule.floorH[0], rule.floorH[1]);
  const groundH = r.range(rule.groundH[0], rule.groundH[1]);
  const roofs = rule.roofs;
  let roof = r.pick(roofs);
  const rect = rectangularity(poly);
  if ((roof === 'gable' || roof === 'hip') && rect < 0.85) roof = lot.kind === 'perimeter' ? 'gable' : 'flat';
  const setbacks: [number, number][] = [];
  if (style === 'artdeco' && floors > 14) {
    const steps = r.int(1, 3);
    for (let k = 1; k <= steps; k++) setbacks.push([Math.round(floors * (0.45 + 0.17 * k)), r.range(2, 4) * k]);
  } else if (style === 'glass' && floors > 25 && r.chance(0.4)) {
    setbacks.push([Math.round(floors * r.range(0.55, 0.8)), r.range(2, 5)]);
  }
  const shopfront = r.chance(rule.shopP * (cell.district === 'commercial' || cell.district === 'downtown' || cell.district === 'oldtown' ? 1.3 : 0.8));
  const bayW = r.range(rule.bay[0], rule.bay[1]);
  const walls = rule.walls;
  const fpArea = Math.abs(polyArea(poly));
  const units = rule.use === 'residential' || rule.use === 'mixed' ? Math.max(1, Math.round(fpArea / r.range(70, 110))) : 0;
  void c;
  const desc: BuildingDesc = {
    id: index,
    poly,
    front,
    style,
    use: style === 'house' ? 'residential' : rule.use === 'mixed' && !shopfront ? 'residential' : rule.use,
    floors,
    floorH,
    groundH,
    roof,
    pitch: roof === 'gable' || roof === 'hip' ? r.range(0.45, 0.95) : roof === 'mansard' ? 1.6 : 0.2,
    setbacks,
    wall: r.pick(walls),
    trim: r.int(0, 7),
    roofMat: r.pick(rule.roofMats),
    accent: r.int(0, 7),
    bay: bayW,
    shopfront,
    seed: r.nextU32(),
    attached: lot.kind === 'perimeter',
    units,
    landmark: style === 'church' || floors > 45,
  };
  // A sliver of a lot (a corner wedge, a thin strip) carries a single storey: a kiosk where it
  // has a shop front, a bungalow or a shed where it is a house or a hall, else a lock-up garage.
  if (style !== 'church' && isSliver(poly)) {
    desc.floors = 1;
    desc.setbacks = [];
    if (!shopfront && style !== 'house' && style !== 'warehouse' && style !== 'shop') asLockUp(desc);
  }
  return desc;
}

function polyInside(inner: Poly, outer: Poly, margin: number): boolean {
  for (let i = 0; i < inner.length; i += 2) {
    if (!pointInPoly(outer, inner[i], inner[i + 1])) return false;
  }
  void margin;
  return true;
}

// ----------------------------------------------------------------- props

/**
 * A walled cemetery on a block: a stone wall just inside the outline with pillars at the corners
 * and a gate in the middle of the longest side, a main path from the gate (yews along it, a
 * mausoleum at its end), a cross path with a monument, and rows of graves facing the gate.
 */
function placeCemetery(cem: Shape, plan: CellPlan, r: Rng, push: (t: PropType, x: number, z: number, yaw: number, scale?: number, variant?: number) => void, free: (x: number, z: number, rad: number) => boolean): void {
  const wallLine = offset([cem.outer], -0.9).sort((a, b) => shapeArea(b) - shapeArea(a))[0]?.outer;
  const inner = offset([cem.outer], -2.6).sort((a, b) => shapeArea(b) - shapeArea(a))[0]?.outer;
  if (!wallLine || !inner) return;
  const n = wallLine.length >> 1;
  const SEG = 2.5, GATE = 1.8;
  // The gate goes in the longest side.
  let gi = 0, gl = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, l = Math.hypot(wallLine[j * 2] - wallLine[i * 2], wallLine[j * 2 + 1] - wallLine[i * 2 + 1]);
    if (l > gl) { gl = l; gi = i; }
  }
  const pillar = (x: number, z: number, yaw: number) => push(PropType.CemWall, x, z, yaw, 1, 1);
  const run = (ax: number, az: number, ux: number, uz: number, a: number, b: number, yaw: number) => {
    const len = b - a;
    if (len < 0.6) return;
    const k = Math.max(1, Math.ceil(len / SEG));
    const step = len / k;
    for (let s = 0; s < k; s++) {
      const t = a + (s + 0.5) * step;
      push(PropType.CemWall, ax + ux * t, az + uz * t, yaw, 1, 0);
    }
  };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = wallLine[i * 2], az = wallLine[i * 2 + 1];
    const dx = wallLine[j * 2] - ax, dz = wallLine[j * 2 + 1] - az, l = Math.hypot(dx, dz);
    if (l < 0.3) continue;
    const ux = dx / l, uz = dz / l, yaw = Math.atan2(-uz, ux);
    // A pillar where the wall turns (not at every bend of a curved side).
    const h = (i + n - 1) % n, px = ax - wallLine[h * 2], pz = az - wallLine[h * 2 + 1], pl = Math.hypot(px, pz);
    if (pl < 1e-6 || (px * ux + pz * uz) / pl < 0.94) pillar(ax, az, yaw);
    if (i === gi && l > 2 * GATE + 2) {
      run(ax, az, ux, uz, 0.3, l / 2 - GATE - 0.3, yaw);
      run(ax, az, ux, uz, l / 2 + GATE + 0.3, l - 0.3, yaw);
      pillar(ax + ux * (l / 2 - GATE), az + uz * (l / 2 - GATE), yaw);
      pillar(ax + ux * (l / 2 + GATE), az + uz * (l / 2 + GATE), yaw);
    } else run(ax, az, ux, uz, 0.3, l - 0.3, yaw);
  }
  // Frame: u along the gate side, v inwards from the gate.
  const j = (gi + 1) % n;
  const gx0 = wallLine[gi * 2], gz0 = wallLine[gi * 2 + 1];
  const ux = (wallLine[j * 2] - gx0) / gl, uz = (wallLine[j * 2 + 1] - gz0) / gl;
  const ox = gx0 + ux * gl / 2, oz = gz0 + uz * gl / 2;
  let vx = -uz, vz = ux;
  if (!pointInPoly(cem.outer, ox + vx * 2, oz + vz * 2)) { vx = -vx; vz = -vz; }
  const at = (i: number, k: number): [number, number] => [ox + ux * i + vx * k, oz + uz * i + vz * k];
  let D = 0, U = 0;
  for (let i = 0; i < inner.length; i += 2) {
    const px = inner[i] - ox, pz = inner[i + 1] - oz;
    D = Math.max(D, px * vx + pz * vz);
    U = Math.max(U, Math.abs(px * ux + pz * uz));
  }
  const inside = (x: number, z: number) => pointInPoly(inner, x, z);
  const face = Math.atan2(vx, vz); // a model's front (−Z) towards the gate
  const cross = D > 26 ? D / 2 : -99;
  // The main path's end: a mausoleum; the crossing: a monument.
  let end = D - 3.5;
  while (end > 8 && !inside(...at(0, end))) end -= 1;
  if (end > 8) push(PropType.Tomb, ...at(0, end), face, 1, 0);
  if (cross > 0 && inside(...at(0, cross))) push(PropType.Tomb, ...at(0, cross), face, 1, 1);
  // Gravel: the main path from the gate, the cross path, a ring round the monument.
  const lines: number[][] = [[...at(0, -1), ...at(0, Math.max(4, end - 1.5))]];
  if (cross > 0) lines.push([...at(-U - 1, cross), ...at(U + 1, cross)]);
  const gravel = strokePolylines(lines, 1.3, 'round', 'butt');
  plan.cemPaths.push(...intersection(gravel.map((g) => g.outer), [cem.outer]));
  // Yews along the main path.
  for (let k = 5; k < end - 3; k += r.range(7, 10)) {
    for (const side of [-1, 1]) {
      const [x, z] = at(side * 2.6, k);
      if (Math.abs(k - cross) > 3 && inside(x, z) && r.chance(0.75)) push(PropType.Yew, x, z, r.range(0, 6.28), r.range(0.75, 1.05), 0);
    }
  }
  // Graves in rows facing the gate, a few family tombs and yews in between.
  for (let k = 4.5; k < D; k += 3.3) {
    if (Math.abs(k - cross) < 2.2) continue;
    for (let i = -U; i <= U; i += 2.1) {
      if (Math.abs(i) < 2.4) continue;
      const jx = r.range(-0.12, 0.12), jz = r.range(-0.15, 0.15);
      const [x, z] = at(i + jx, k + jz);
      if (!inside(x, z) || !free(x, z, 1.0)) continue;
      const roll = r.float();
      if (roll < 0.14) continue;
      const yaw = face + r.range(-0.06, 0.06);
      if (roll < 0.66) push(PropType.Gravestone, x, z, yaw, r.range(0.85, 1.15), 0);
      else if (roll < 0.8) push(PropType.Gravestone, x, z, yaw, r.range(0.85, 1.1), 1);
      else if (roll < 0.93) push(PropType.Grave, x, z, yaw, r.range(0.9, 1.1), 0);
      else if (roll < 0.975) push(PropType.Grave, x, z, yaw, r.range(0.8, 1.2), 1);
      else push(PropType.Yew, x, z, r.range(0, 6.28), r.range(0.7, 1.0), 0);
    }
  }
}

/**
 * May a kerbside bay of street `si` lie at (x, z) (along (dx, dz), its kerb side (nx, nz))? All of
 * it on the carriageway; SETBACK m clear of every other street's kerb line (the cross streets of
 * its junctions, with their corners); clear of the zebra crossings.
 */
/** Is (x, z) within `clear(street)` m of the centre line of a street other than `si`? */
function nearOtherStreet(plan: CellPlan, si: number, x: number, z: number, clear: (o: StreetSeg) => number): boolean {
  for (let k = 0; k < plan.streets.length; k++) {
    if (k === si) continue;
    const o = plan.streets[k], c = clear(o), c2 = c * c;
    const [bx0, bz0, bx1, bz1] = polyBounds(o.pts);
    if (x < bx0 - c || x > bx1 + c || z < bz0 - c || z > bz1 + c) continue;
    for (let i = 0; i + 3 < o.pts.length; i += 2) if (distSqPointSeg(x, z, o.pts[i], o.pts[i + 1], o.pts[i + 2], o.pts[i + 3]) < c2) return true;
  }
  return false;
}

function parkingCheck(plan: CellPlan): (si: number, x: number, z: number, dx: number, dz: number, nx: number, nz: number) => boolean {
  const cross = crossingsOf(plan);
  const onRoad = (x: number, z: number) => plan.carriageway.some((c) => inShape(c, x, z));
  const hl = BAY_LENGTH / 2, hw = BAY_DEPTH / 2;
  return (si, x, z, dx, dz, nx, nz) => {
    for (const [a, b] of [[hl, hw], [hl, -hw], [-hl, hw], [-hl, -hw]]) if (!onRoad(x + dx * a + nx * b, z + dz * a + nz * b)) return false;
    if (nearOtherStreet(plan, si, x, z, (o) => o.width / 2 + SETBACK + hl)) return false;
    for (const c of cross) {
      // The stripes run 1.5 m either side of the crossing's middle, across the whole carriageway.
      const ux = Math.sin(c.heading), uz = Math.cos(c.heading), along = (x - c.x) * ux + (z - c.z) * uz, across = (x - c.x) * uz - (z - c.z) * ux;
      if (Math.abs(along) < 1.5 + hl + 1 && Math.abs(across) < c.width / 2 + 1) return false;
    }
    return true;
  };
}

function placeProps(plan: CellPlan, cell: CellInfo, macro: MacroPlan, g: Grammar, r: Rng, terrain: Terrain): void {
  const P = plan.props;
  const push = (t: PropType, x: number, z: number, yaw: number, scale = 1, variant = 0) => P.push(t, x, z, yaw, scale, variant);
  const inCell = (x: number, z: number) => pointInPoly(cell.poly, x, z);
  const free = (x: number, z: number, rad: number) => {
    for (let i = 0; i < P.length; i += 6) if (Math.abs(P[i + 1] - x) < rad && Math.abs(P[i + 2] - z) < rad) return false;
    return true;
  };
  const bayOk = parkingCheck(plan);
  // Kerbside furniture and parked cars keep a driveway's mouth clear; garden trees keep off the drives and paths.
  const mouthClear = (x: number, z: number, dx: number, dz: number, clear: number) => plan.driveways.every((d) =>
    Math.abs((x - d.mx) * dx + (z - d.mz) * dz) >= DRIVE_W / 2 + clear || Math.abs((x - d.mx) * dz - (z - d.mz) * dx) > 12);
  const grounds = [...plan.driveways.map((d) => d.shape), ...plan.paths];
  const offDrives = (x: number, z: number, rad: number) => !grounds.some((g) =>
    [[0, 0], [rad, 0], [-rad, 0], [0, rad], [0, -rad]].some(([a, b]) => pointInPoly(g.outer, x + a, z + b)));
  // Along streets: trees, lamps, hydrants, bins, benches, parked cars — on both sides.
  plan.streets.forEach((s, si) => {
    if (s.cls === RoadClass.Path) return;
    const L = polylineLength(s.pts);
    if (L < 10) return;
    const pts = resample(s.pts, 2);
    const nPts = pts.length >> 1;
    const lampStep = s.cls <= RoadClass.Avenue ? 28 : 32;
    const treeStep = r.range(8, 11);
    const sr = r.fork('st', si);
    const treesHere = sr.chance(g.trees) && s.sidewalk >= TREE_PIT + 0.4 + WALK_CLEAR;
    const parking = s.cls === RoadClass.Street && plan.district !== 'downtown' ? 0.55 : s.cls === RoadClass.Avenue ? 0.3 : 0;
    for (const side of [-1, 1]) {
      let nextLamp = sr.range(4, lampStep), nextTree = sr.range(2, treeStep), nextCar = sr.range(3, 8), nextMisc = sr.range(15, 40);
      let acc = 0;
      for (let i = 1; i < nPts - 1; i++) {
        const x0 = pts[i * 2 - 2], z0 = pts[i * 2 - 1], x1 = pts[i * 2], z1 = pts[i * 2 + 1];
        const segL = Math.hypot(x1 - x0, z1 - z0);
        acc += segL;
        // Keep clear of the ends (junctions).
        if (acc < 14 || acc > L - 14) continue;
        const dx = (x1 - x0) / segL, dz = (z1 - z0) / segL;
        const nx = -dz * side, nz = dx * side;
        const yaw = Math.atan2(dx, dz);
        const curb = s.width / 2;
        // The furniture strip along the kerb (lamps, bins, tree pits); the rest of the sidewalk stays
        // clear for walking (WALK_CLEAR at least, where people walk: mid-sidewalk).
        const strip = kerbStrip(s.sidewalk);
        // (Never in the roadway or the sidewalk of a cross street, round a corner.)
        const kerbOk = (x: number, z: number) => !nearOtherStreet(plan, si, x, z, (o) => o.width / 2 + o.sidewalk + 0.5);
        if (acc >= nextLamp) {
          nextLamp += lampStep;
          const x = x1 + nx * (curb + strip), z = z1 + nz * (curb + strip);
          if (inCell(x, z) && kerbOk(x, z) && mouthClear(x, z, dx, dz, 0.6) && !terrain.isWater(x, z) && free(x, z, 1.2)) push(PropType.Lamp, x, z, Math.atan2(-nx, -nz), 1, s.cls <= RoadClass.Avenue ? 1 : 0);
        }
        if (treesHere && acc >= nextTree) {
          nextTree += treeStep * sr.range(0.85, 1.2);
          const x = x1 + nx * (curb + TREE_PIT), z = z1 + nz * (curb + TREE_PIT);
          if (inCell(x, z) && kerbOk(x, z) && mouthClear(x, z, dx, dz, 1.2) && !terrain.isWater(x, z) && free(x, z, 2.5)) push(PropType.Tree, x, z, sr.range(0, 6.28), sr.range(0.75, 1.15), sr.int(0, 5));
        }
        if (parking && acc >= nextCar) {
          nextCar += BAY_LENGTH;
          const lane = curb - BAY_DEPTH / 2 - 0.05;
          const x = x1 + nx * lane, z = z1 + nz * lane, cyaw = side > 0 ? yaw : yaw + Math.PI;
          if (inCell(x, z) && bayOk(si, x, z, dx, dz, nx, nz) && mouthClear(x, z, dx, dz, BAY_LENGTH / 2 + 0.5)) {
            const car = sr.chance(parking) && free(x, z, 2.2);
            plan.parking.push({ x, z, yaw: cyaw, street: si, side, car });
            if (car) push(PropType.KerbCar, x, z, cyaw, 1, sr.int(0, 1 << 20));
          }
        }
        if (acc >= nextMisc) {
          nextMisc += sr.range(25, 70);
          // Benches and planters only where the sidewalk is wide enough to keep its walk clear.
          const wide = s.sidewalk >= 1.6 + WALK_CLEAR;
          const kind = sr.weighted([PropType.Hydrant, PropType.Bin, PropType.Bench, PropType.Mailbox, PropType.Planter], (k) => k === PropType.Bench ? (wide ? (plan.district === 'suburban' ? 0.1 : 1) : 0) : k === PropType.Planter ? (wide ? 0.3 : 0) : 1);
          const off = kind === PropType.Bench ? 0.8 : kind === PropType.Planter ? 0.65 : strip;
          const x = x1 + nx * (curb + off), z = z1 + nz * (curb + off);
          if (inCell(x, z) && kerbOk(x, z) && mouthClear(x, z, dx, dz, 0.6) && !terrain.isWater(x, z) && free(x, z, 1.5)) push(kind, x, z, kind === PropType.Bench ? Math.atan2(-nx, -nz) : yaw, 1, sr.int(0, 3));
        }
      }
    }
    // Manholes along the centreline.
    for (let d = r.range(10, 30); d < L - 10; d += r.range(40, 70)) {
      const k = Math.min(nPts - 1, Math.round(d / 2));
      push(PropType.Manhole, pts[k * 2], pts[k * 2 + 1], 0, 1, 0);
    }
  });
  // Junction furniture: traffic lights at busy junctions, stop signs at small ones.
  for (let i = 0; i < plan.junctions.length; i += 3) {
    const x = plan.junctions[i], z = plan.junctions[i + 1];
    if (!inCell(x, z)) continue;
    push(plan.district === 'suburban' ? PropType.StopSign : PropType.TrafficLight, x, z, 0, 1, plan.junctions[i + 2]);
  }
  // Arterial nodes inside/at the cell get traffic lights (owned by the lowest cell id touching them).
  for (const eid of cell.edges) {
    const e = macro.edges[eid];
    for (const nid of [e.a, e.b]) {
      const n = macro.nodes[nid];
      if (n.edges.length < 3) continue;
      if (P.some((_, k) => k % 6 === 0 && P[k] === PropType.TrafficLight && Math.abs(P[k + 1] - n.x) < 1 && Math.abs(P[k + 2] - n.z) < 1)) continue;
      // Ownership: only if the node lies within this cell's bounds-ish and this is the first cell in edge order.
      if (macro.cells.find((c) => c.edges.includes(eid))?.id !== cell.id && !(cell.edges[0] === eid)) continue;
      push(PropType.TrafficLight, n.x, n.z, 0, 1, n.edges.length);
    }
  }
  for (const cem of plan.cemeteries) placeCemetery(cem, plan, r.fork('cem', plan.cemeteries.indexOf(cem)), push, free);
  // Parks: trees, bushes, benches, paths, fountain, playground.
  for (const pk of plan.parks) {
    const area = shapeArea(pk);
    const [x0, z0, x1, z1] = polyBounds(pk.outer);
    const nTrees = Math.round(area / r.range(90, 180));
    for (let k = 0; k < nTrees; k++) {
      const x = r.range(x0, x1), z = r.range(z0, z1);
      if (!pointInPoly(pk.outer, x, z) || terrain.isWater(x, z)) continue;
      if (!free(x, z, 3)) continue;
      push(r.chance(0.8) ? PropType.Tree : PropType.Bush, x, z, r.range(0, 6.28), r.range(0.8, 1.5), r.int(0, 5));
    }
    if (area > 2500) {
      const c = polyCentroid(pk.outer);
      if (pointInPoly(pk.outer, c[0], c[1])) push(r.chance(0.6) ? PropType.Fountain : PropType.Statue, c[0], c[1], r.range(0, 6.28), 1, r.int(0, 3));
      for (let k = 0; k < Math.min(12, area / 600); k++) {
        const x = r.range(x0, x1), z = r.range(z0, z1);
        if (pointInPoly(pk.outer, x, z) && free(x, z, 2)) push(PropType.Bench, x, z, r.range(0, 6.28), 1, 0);
      }
      if (area > 8000 && r.chance(0.6)) {
        const x = r.range(x0, x1), z = r.range(z0, z1);
        if (pointInPoly(pk.outer, x, z) && free(x, z, 8)) push(PropType.PlayGround, x, z, r.range(0, 6.28), 1, 0);
      }
    }
  }
  // Plazas: fountain/statue, benches, planters, a kiosk.
  for (const pz of plan.plazas) {
    const area = shapeArea(pz);
    const c = polyCentroid(pz.outer);
    const onWay = (x: number, z: number) => plan.approaches.some((w) => pointInPoly(w, x, z));
    if (area > 300 && pointInPoly(pz.outer, c[0], c[1]) && !onWay(c[0], c[1]) && !plan.buildings.some((b) => pointInPoly(b.poly, c[0], c[1]))) push(r.chance(0.5) ? PropType.Fountain : PropType.Statue, c[0], c[1], r.range(0, 6.28), 1, r.int(0, 3));
    const [x0, z0, x1, z1] = polyBounds(pz.outer);
    for (let k = 0; k < Math.min(10, area / 150); k++) {
      const x = r.range(x0, x1), z = r.range(z0, z1);
      if (!pointInPoly(pz.outer, x, z) || !free(x, z, 3) || onWay(x, z)) continue;
      if (plan.buildings.some((b) => pointInPoly(b.poly, x, z))) continue;
      push(r.pick([PropType.Bench, PropType.Planter, PropType.Tree, PropType.Tree, PropType.Bin]), x, z, r.range(0, 6.28), 1, r.int(0, 3));
    }
  }
  // Yards: gardens get trees and hedges.
  for (const y of plan.yards) {
    const area = shapeArea(y);
    const [x0, z0, x1, z1] = polyBounds(y.outer);
    const n = Math.round(area / r.range(140, 320));
    for (let k = 0; k < n; k++) {
      const x = r.range(x0, x1), z = r.range(z0, z1);
      if (!pointInPoly(y.outer, x, z) || !free(x, z, 3)) continue;
      if (plan.buildings.some((b) => pointInPoly(b.poly, x, z))) continue;
      push(r.chance(0.6) ? PropType.Tree : PropType.Bush, x, z, r.range(0, 6.28), r.range(0.6, 1.1), r.int(0, 5));
    }
  }
  // Suburban front gardens: a tree or bush in front of houses.
  if (plan.district === 'suburban') {
    for (const lot of plan.lots) {
      if (!r.chance(0.6)) continue;
      const fx = (lot.front[0] + lot.front[2]) / 2, fz = (lot.front[1] + lot.front[3]) / 2;
      const c = polyCentroid(lot.poly);
      const t = r.range(0.15, 0.3);
      const x = fx + (c[0] - fx) * t + r.range(-3, 3), z = fz + (c[1] - fz) * t + r.range(-3, 3);
      if (pointInPoly(lot.poly, x, z) && free(x, z, 3) && offDrives(x, z, 1.5) && !plan.buildings.some((b) => pointInPoly(b.poly, x, z))) push(r.chance(0.6) ? PropType.Tree : PropType.Bush, x, z, r.range(0, 6.28), r.range(0.7, 1.1), r.int(0, 5));
    }
  }
  void clamp; void lerp;
}

// ------------------------------------------------------------ landmark sites

/**
 * A landmark's site ground: the landmark's zones (square, lawn, car park) with holes where the
 * structure stands. Its furniture (below) keeps off the structure and inside the site.
 */
function placeLandmarkGround(plan: CellPlan, lm: Landmark, terrain: Terrain): void {
  const solids = solidFootprints(lm, landmarkParts(lm, terrain), 0.8);
  const { base, zones } = siteZones(lm);
  const lists: Record<ZoneKind, Shape[]> = { plaza: plan.plazas, park: plan.parks, paved: plan.paved };
  const zonePolys = zones.map((z) => z.poly);
  for (const s of difference([lm.site], [...zonePolys, ...solids])) if (shapeArea(s) > 20) lists[base].push(s);
  for (const z of zones) {
    const inSite = intersection([z.poly], [lm.site]);
    for (const s of difference(shapesToPolys(inSite), solids)) if (shapeArea(s) > 20) lists[z.kind].push(s);
  }
}

/** A landmark's own furniture: lamps, benches, trees, a fountain on its square, cars in its car parks. */
function placeLandmarkProps(plan: CellPlan, lm: Landmark, terrain: Terrain): void {
  const parts = landmarkParts(lm, terrain);
  const P = plan.props, r = new Rng(deriveSeed(lm.seed, 'site-props'));
  const clearR = solidFootprints(lm, parts, 1.6);
  const n0 = P.length;
  const ok = (x: number, z: number, rad: number) => {
    const [u, v] = worldToSite(lm, x, z);
    if (Math.abs(u) > lm.hu - 1.2 || Math.abs(v) > lm.hv - 1.2) return false;
    if (clearR.some((q) => pointInPoly(q, x, z))) return false;
    for (let i = n0; i < P.length; i += 6) if (Math.abs(P[i + 1] - x) < rad && Math.abs(P[i + 2] - z) < rad) return false;
    return !terrain.isWater(x, z, 1);
  };
  const put = (t: PropType, u: number, v: number, yaw: number, rad: number, scale = 1, variant = 0): boolean => {
    const [x, z] = siteToWorld(lm, u, v);
    if (!ok(x, z, rad)) return false;
    P.push(t, x, z, yaw, scale, variant);
    return true;
  };
  // World yaw facing the local direction (du, dv): props face along (sin yaw, cos yaw).
  const face = (du: number, dv: number) => {
    const c = Math.cos(lm.angle), s = Math.sin(lm.angle);
    return Math.atan2(du * c - dv * s, du * s + dv * c);
  };
  const hu = lm.hu, hv = lm.hv;
  /** Lamps along the site's edges. */
  const edgeLamps = (step: number, inset = 2) => {
    for (let u = -hu + inset; u <= hu - inset; u += step) for (const sv of [-1, 1]) put(PropType.Lamp, u, sv * (hv - inset), face(0, -sv), 1.5, 1, 0);
    for (let v = -hv + inset + step; v <= hv - inset - step; v += step) for (const su of [-1, 1]) put(PropType.Lamp, su * (hu - inset), v, face(-su, 0), 1.5, 1, 0);
  };
  /** Trees (and bushes) scattered over the free ground. */
  const L = lm.p;
  switch (lm.kind) {
    case 'townhall': {
      const front = hv - 4 - L.d - L.wingD;
      const sq = (-hv + front) / 2;
      put(r.chance(0.6) ? PropType.Fountain : PropType.Statue, 0, sq, r.range(0, 6.28), 4, 1, r.int(0, 3));
      for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; put(PropType.Bench, Math.cos(a) * 9, sq + Math.sin(a) * 7, face(-Math.cos(a), -Math.sin(a)), 1.6); }
      for (let v = -hv + 4; v < front - 2; v += 9) for (const su of [-1, 1]) put(PropType.Tree, su * (hu - 3), v, r.range(0, 6.28), 3, r.range(0.9, 1.15), 1);
      edgeLamps(15, 5);
      for (let k = 0; k < 6; k++) put(r.pick([PropType.Planter, PropType.Bin, PropType.Bench]), r.range(-hu + 6, hu - 6), r.range(-hv + 4, front - 3), 0, 3);
      break;
    }
    case 'church': {
      // The churchyard: trees and benches round the church, a few gravestones behind it.
      for (let v = -hv + 10; v < hv - 3; v += 7) for (const su of [-1, 1]) put(PropType.Tree, su * (hu - 2.5), v, r.range(0, 6.28), 3, r.range(0.85, 1.15), 3);
      for (let k = 0; k < 4; k++) put(PropType.Bench, (k % 2 ? 1 : -1) * (L.W / 2 + 3), -hv + 12 + k * 6, face(k % 2 ? -1 : 1, 0), 1.6);
      for (let k = 0; k < 14; k++) put(PropType.Gravestone, r.range(-hu + 3, hu - 3), r.range(hv - 7, hv - 2), face(0, -1), 0.8, 1, r.int(0, 3));
      break;
    }
    case 'school': {
      const fw = L.field ? L.field + 2 : 0;
      put(PropType.PlayGround, -hu + 10, hv - 9, 0, 5);
      for (let k = 0; k < 6; k++) put(PropType.Bench, r.range(-hu + 4, hu - 4 - fw), r.range(-hv + 8 + L.bd, hv - 3), r.range(0, 6.28), 1.6);
      for (let u = -hu + 4; u < hu - 4 - fw; u += 10) put(PropType.Tree, u, hv - 2, r.range(0, 6.28), 3, r.range(0.9, 1.1), 1);
      break;
    }
    case 'kindergarten': {
      put(PropType.PlayGround, 0, hv - 8, 0, 5);
      for (let u = -hu + 3; u <= hu - 3; u += 3.2) if (r.chance(0.85)) put(PropType.Hedge, u, hv - 1.5, face(1, 0), 1.4, 1, 0);
      for (let k = 0; k < 3; k++) put(PropType.Tree, r.range(-hu + 4, hu - 4), r.range(-hv + 8 + L.bd, hv - 4), r.range(0, 6.28), 3, r.range(0.8, 1.1), 2);
      break;
    }
    case 'clinic': {
      for (const su of [-1, 1]) put(PropType.Planter, su * 4, -hv + 4, 0, 1.4);
      put(PropType.Bench, -L.bw / 2 + 3, -hv + 6, face(0, 1), 1.6);
      break;
    }
    case 'fire': break;
    case 'supermarket': {
      // The car park in front: rows of cars, lamps between them.
      const v1 = hv - 4 - L.bd - 3;
      for (let u = -hu + 4; u < hu - 4; u += 2.8) for (const v of [-hv + 6, -hv + 12, -hv + 18]) if (v < v1 && r.chance(0.55)) put(PropType.ParkedCar, u, v, face(0, 1) + (r.chance(0.5) ? Math.PI : 0), 1.2, 1, r.int(0, 1 << 20));
      for (let u = -hu + 8; u < hu - 4; u += 18) put(PropType.Lamp, u, -hv + 9, 0, 1.2, 1, 1);
      break;
    }
    case 'carehome': {
      // Benches and trees in the garden behind, a lamp and a few visitors' cars on the forecourt.
      for (let k = 0; k < 6; k++) put(PropType.Bench, r.range(-hu + 4, hu - 4), r.range(hv - L.garden + 2, hv - 3), r.range(0, 6.28), 1.6);
      for (let u = -hu + 3; u <= hu - 3; u += 8) put(PropType.Tree, u, hv - 2, r.range(0, 6.28), 3, r.range(0.85, 1.15), 2);
      for (let u = -hu + 4; u < hu - 4; u += 2.8) if (r.chance(0.3)) put(PropType.ParkedCar, u, -hv + 2.8, face(0, 1) + (r.chance(0.5) ? Math.PI : 0), 1.2, 1, r.int(0, 1 << 20));
      put(PropType.Lamp, -hu + 3, -hv + 1.5, 0, 1.2, 1, 1);
      break;
    }
    case 'petrol': {
      // Lamps at the forecourt's front corners, a car or two at the pumps.
      for (const su of [-1, 1]) put(PropType.Lamp, su * (hu - 1.5), -hv + 1.5, 0, 1.2, 1, 1);
      const cv = -hv + 5 + L.cd / 2;
      for (let i = 0; i < L.islands; i++) if (r.chance(0.4)) put(PropType.ParkedCar, (i - (L.islands - 1) / 2) * (L.cw / L.islands) + 2.2, cv, face(0, 1), 1.2, 1, r.int(0, 1 << 20));
      break;
    }
    case 'sports': {
      // The car park (the site's paved zone at -u), trees along the back, benches by the clubhouse.
      if (L.park) {
        const u0 = -hu + 4, u1 = -hu + 26;
        for (let u = u0; u < u1 - 2; u += 6.2) for (let v = -hv + 6; v < hv - 6; v += 2.8) if (r.chance(0.5)) put(PropType.ParkedCar, u, v, face(1, 0) + (r.chance(0.5) ? Math.PI : 0), 1.2, 1, r.int(0, 1 << 20));
        for (let v = -hv + 8; v < hv - 8; v += 24) put(PropType.Lamp, (u0 + u1) / 2, v, 0, 2, 1, 1);
      }
      for (let u = -hu + (L.park ? 32 : 4); u <= hu - 4; u += 12) put(PropType.Tree, u, hv - 1.5, r.range(0, 6.28), 3, r.range(0.9, 1.2), 2);
      const cu = (L.park ? 16 : 0) - L.pa * 0.45, cv = -hv + 3;
      for (let k = -2; k <= 2; k++) put(k ? PropType.Bench : PropType.Bin, cu + k * 4, cv, face(0, 1), 1.6);
      break;
    }
  }
}

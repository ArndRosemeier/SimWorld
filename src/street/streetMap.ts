/**
 * The street layer's map (plan §1.1, L1): where on the ground the society's places and roads are, so a
 * person the sim says is walking from the bakery to 14 Mill Lane can be put on the sidewalk between the
 * two doors, and one it says is in Riverside Park somewhere on its lawns.
 *
 * Built once from the planned town and its place graph, in the sim worker (pure: no three, no DOM). New in
 * SimWorld; Scale's pedestrians (src/sim/Pedestrians.ts) walked routes of their own road net.
 */
import { hash3f } from '@futuremagic/core';
import { offsetPolyline, pointInPoly, polyArea, polyBounds, type Poly } from '../geom/geom2';
import type { Shape } from '../geom/clip';
import { bridgeDecksAt } from '../build/bridges';
import type { Town } from '../plan/town';
import { footprintsOf, type Footprints } from '../plan/footprints';
import { buildingRef } from '../plan/placeGraph';
import { BODY } from './clearance';
import type { PlaceGraph, PlaceId, PlaceKind } from '../sim/places';
import { CURB_H } from '../world/ground';

/** Place kinds people are seen at while they stay (everything else is indoors). */
export const OUTDOOR: ReadonlySet<PlaceKind> = new Set<PlaceKind>(['park', 'square', 'sports', 'cemetery', 'street', 'woods', 'field', 'farm']);

/** Radius (m) of the patch people use at an outdoor place with no outline of its own. */
const PATCH: Partial<Record<PlaceKind, number>> = { sports: 30, woods: 60, field: 50, farm: 20 };

/** How far (m) out of the door the doorstep is. */
const DOOR_STEP = 1.2;
/** Room (m) round a stroll's spot: in the open, not wedged between the cars of a car park. */
const SPOT_ROOM = 1.2;
/** Where to try the doorstep: [out from the facade, along it] in m, the plain step first. */
const DOOR_SHIFTS: [number, number][] = [[DOOR_STEP, 0], [DOOR_STEP, 0.8], [DOOR_STEP, -0.8], [2, 0], [2, 1.2], [2, -1.2], [DOOR_STEP, 1.6], [DOOR_STEP, -1.6]];

/** Default walking-line offset (m) for a road without one (a footpath the graph added). */
const SIDE = 0;

export class StreetMap {
  /** Edge index by node pair (`a * nodes + b`, both orders). */
  private readonly edgeOf = new Map<number, number>();
  /** The outline of each outdoor place that has one (parks, squares, cemeteries, sports grounds). */
  private readonly areas = new Map<PlaceId, Shape>();
  /** The bridge deck height at a point, null off the decks. */
  private readonly deck: (x: number, z: number) => number | null;
  /** Everything standing on the ground (props, parked cars, buildings), to keep clear of. */
  readonly fp: Footprints;
  private readonly entrances = new Map<PlaceId, { door: [number, number]; step: [number, number] }>();

  constructor(readonly town: Town, readonly graph: PlaceGraph) {
    const n = graph.nodes.length;
    graph.edges.forEach((e, i) => { this.edgeOf.set(e.a * n + e.b, i); this.edgeOf.set(e.b * n + e.a, i); });
    this.deck = bridgeDecksAt(town.macro.bridges, town.terrain);
    this.fp = footprintsOf(town.cells);
    // Outdoor places with an outline: the cell shape their centre lies in, or their public building's site.
    for (const pl of graph.places) {
      if (!OUTDOOR.has(pl.kind) || pl.kind === 'street') continue;
      let shape: Shape | null = null;
      for (const c of town.cells) {
        const list = pl.kind === 'park' ? c.parks : pl.kind === 'square' ? c.plazas : pl.kind === 'cemetery' ? c.cemeteries : null;
        shape = list?.find((s) => pointInPoly(s.outer, pl.x, pl.z)) ?? null;
        if (shape) break;
      }
      if (!shape && pl.kind === 'sports') {
        const lm = town.macro.landmarks.find((l) => l.kind === 'sports' && Math.hypot(l.x - pl.x, l.z - pl.z) < Math.max(l.hu, l.hv) * 2);
        if (lm) shape = { outer: lm.site, holes: [] };
      }
      if (shape && Math.abs(polyArea(shape.outer)) > 50) this.areas.set(pl.id, shape);
    }
  }

  /** Ground height where people stand: the sidewalk level (terrain plus the curb), a bridge deck over water. */
  groundY(x: number, z: number): number {
    return (this.deck(x, z) ?? this.town.terrain.height(x, z)) + CURB_H;
  }

  /** The road edge between two nodes, -1 if none. */
  edge(a: number, b: number): number {
    return this.edgeOf.get(a * this.graph.nodes.length + b) ?? -1;
  }

  /** An edge's centreline oriented from node `from` (x, z, …). */
  centreline(e: number, from: number): number[] {
    const E = this.graph.edges[e], A = this.graph.nodes[E.a], B = this.graph.nodes[E.b];
    const pts = E.pts ?? [A.x, A.z, B.x, B.z];
    if (from === E.a) return pts;
    const out: number[] = [];
    for (let i = pts.length - 2; i >= 0; i -= 2) out.push(pts[i], pts[i + 1]);
    return out;
  }

  /**
   * Where someone walks along edge `e` leaving node `from`: the walking line on side `sign` (+1 left of the
   * direction of travel, -1 right), moved `lane` metres further out (people do not all walk one line).
   */
  walkLine(e: number, from: number, sign: number, lane = 0): number[] {
    const E = this.graph.edges[e], side = E.side ?? SIDE;
    // Inside the walking strip, with room for the shoulders (a narrow sidewalk has one line).
    const room = Math.max(0, (E.walkWidth ?? 1.4) / 2 - BODY);
    return offsetPolyline(this.centreline(e, from), sign * Math.max(0, side + Math.max(-room, Math.min(room, lane))));
  }

  /**
   * The door of a place: where it is in its building's facade (the place's own point when that is on the facade,
   * else the facade point nearest it), so walks start and end at the wall and not in the middle of the house.
   * The place's point for places without a town building.
   */
  door(place: PlaceId): [number, number] {
    return this.entrance(place).door;
  }

  /**
   * The doorstep of a place: a step out of its door, square to the facade the door is in (so a walk leaves
   * by the front and not through the wall beside it), beside whatever stands right outside.
   */
  doorStep(place: PlaceId): [number, number] {
    return this.entrance(place).step;
  }

  private entrance(place: PlaceId): { door: [number, number]; step: [number, number] } {
    let en = this.entrances.get(place);
    if (en) return en;
    const pl = this.graph.places[place], ref = buildingRef(pl.building);
    en = { door: [pl.x, pl.z], step: [pl.x, pl.z] };
    const poly = ref && 'cell' in ref ? this.town.cells[ref.cell]?.buildings[ref.index]?.poly : undefined;
    if (poly) {
      let best = Infinity, ux = 0, uz = 0, fx = 0, fz = 0;
      for (let i = 0; i < poly.length; i += 2) {
        const ax = poly[i], az = poly[i + 1], bx = poly[(i + 2) % poly.length], bz = poly[(i + 3) % poly.length];
        const L = Math.hypot(bx - ax, bz - az);
        if (L < 1e-6) continue;
        const t = Math.max(0, Math.min(1, ((pl.x - ax) * (bx - ax) + (pl.z - az) * (bz - az)) / (L * L)));
        const d = Math.hypot(ax + (bx - ax) * t - pl.x, az + (bz - az) * t - pl.z);
        if (d < best) { best = d; ux = (bx - ax) / L; uz = (bz - az) / L; fx = ax + (bx - ax) * t; fz = az + (bz - az) * t; }
      }
      // The normal pointing out of the building (from the facade point nearest the door).
      let nx = -uz, nz = ux;
      if (pointInPoly(poly, fx + nx * 0.3, fz + nz * 0.3)) { nx = -nx; nz = -nz; }
      const [dx, dz] = best < 2 ? [pl.x, pl.z] : [fx, fz];
      en.door = [dx, dz];
      en.step = [dx + nx * DOOR_STEP, dz + nz * DOOR_STEP];
      // A mailbox or hydrant right outside: step out a little further, or to one side along the facade.
      for (const [out, side] of DOOR_SHIFTS) {
        const x = dx + nx * out + ux * side, z = dz + nz * out + uz * side;
        if (this.standable(x, z)) { en.step = [x, z]; break; }
      }
    }
    this.entrances.set(place, en);
    return en;
  }

  /** The outline of an outdoor place, if it has one. */
  area(place: PlaceId): Shape | null {
    return this.areas.get(place) ?? null;
  }

  /**
   * A spot at an outdoor place, the same for the same (who, k): inside its outline (not in a pond or a
   * hole), else in its patch around the entrance, never in water.
   */
  spot(place: PlaceId, who: number, k: number): [number, number] {
    const pl = this.graph.places[place], shape = this.areas.get(place);
    const T = this.town.terrain;
    if (shape) {
      const [x0, z0, x1, z1] = polyBounds(shape.outer);
      for (let i = 0; i < 24; i++) {
        const x = x0 + (x1 - x0) * hash3f(place, who, k, i * 2), z = z0 + (z1 - z0) * hash3f(place, who, k, i * 2 + 1);
        if (inShape(shape, x, z) && !T.isWater(x, z, 1) && this.standable(x, z, SPOT_ROOM)) return [x, z];
      }
      return [pl.x, pl.z];
    }
    const r = PATCH[pl.kind] ?? 15;
    for (let i = 0; i < 12; i++) {
      const a = hash3f(place, who, k, i * 2) * Math.PI * 2, d = Math.sqrt(hash3f(place, who, k, i * 2 + 1)) * r;
      const x = pl.x + Math.cos(a) * d, z = pl.z + Math.sin(a) * d;
      if (!T.isWater(x, z, 1) && this.standable(x, z, SPOT_ROOM)) return [x, z];
    }
    return [pl.x, pl.z];
  }

  /** Can someone stand at (x, z): clear of every prop, parked car and building by `room` m? */
  standable(x: number, z: number, room = 0.4): boolean {
    return this.fp.overlap(x, z, room) === 0 && !this.fp.insideBuilding(x, z, room);
  }
}

function inShape(s: Shape, x: number, z: number): boolean {
  return pointInPoly(s.outer, x, z) && !s.holes.some((h: Poly) => pointInPoly(h, x, z));
}

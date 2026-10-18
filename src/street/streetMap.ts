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
import type { PlaceGraph, PlaceId, PlaceKind } from '../sim/places';
import { CURB_H } from '../world/ground';

/** Place kinds people are seen at while they stay (everything else is indoors). */
export const OUTDOOR: ReadonlySet<PlaceKind> = new Set<PlaceKind>(['park', 'square', 'sports', 'cemetery', 'street', 'woods', 'field', 'farm']);

/** Radius (m) of the patch people use at an outdoor place with no outline of its own. */
const PATCH: Partial<Record<PlaceKind, number>> = { sports: 30, woods: 60, field: 50, farm: 20 };

/** Default walking-line offset (m) for a road without one (a footpath the graph added). */
const SIDE = 0;

export class StreetMap {
  /** Edge index by node pair (`a * nodes + b`, both orders). */
  private readonly edgeOf = new Map<number, number>();
  /** The outline of each outdoor place that has one (parks, squares, cemeteries, sports grounds). */
  private readonly areas = new Map<PlaceId, Shape>();
  /** The bridge deck height at a point, null off the decks. */
  private readonly deck: (x: number, z: number) => number | null;

  constructor(readonly town: Town, readonly graph: PlaceGraph) {
    const n = graph.nodes.length;
    graph.edges.forEach((e, i) => { this.edgeOf.set(e.a * n + e.b, i); this.edgeOf.set(e.b * n + e.a, i); });
    this.deck = bridgeDecksAt(town.macro.bridges, town.terrain);
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
    const side = this.graph.edges[e].side ?? SIDE;
    return offsetPolyline(this.centreline(e, from), sign * Math.max(0, side + lane));
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
        if (inShape(shape, x, z) && !T.isWater(x, z, 1)) return [x, z];
      }
      return [pl.x, pl.z];
    }
    const r = PATCH[pl.kind] ?? 15;
    for (let i = 0; i < 12; i++) {
      const a = hash3f(place, who, k, i * 2) * Math.PI * 2, d = Math.sqrt(hash3f(place, who, k, i * 2 + 1)) * r;
      const x = pl.x + Math.cos(a) * d, z = pl.z + Math.sin(a) * d;
      if (!T.isWater(x, z, 1)) return [x, z];
    }
    return [pl.x, pl.z];
  }
}

function inShape(s: Shape, x: number, z: number): boolean {
  return pointInPoly(s.outer, x, z) && !s.holes.some((h: Poly) => pointInPoly(h, x, z));
}

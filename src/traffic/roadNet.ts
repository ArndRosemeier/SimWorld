/**
 * The traffic network of the town: every road a car can use (arterials, local streets, country
 * roads, farm tracks; not the footpaths) as edges between the junction nodes of the town's road
 * lines (`townRoads`, src/plan/roads.ts), with the lane layout, the speed limit, the junction
 * rules (traffic lights at the main crossroads, give way where a minor road meets a major one)
 * and the road surface height along each edge (bridge decks included). A* routing, lane offsets.
 *
 * Ported from Scale (src/sim/RoadNet.ts): Scale rebuilds it from the streamed cells; SimWorld
 * plans the whole town at once, so it is built once from the plan. Bridge cuts stay behind.
 *
 * Pure; a function of the planned town.
 */
import { MinHeap } from '@futuremagic/core';
import type { Town } from '../plan/town';
import { LineSource, slicePolyline, townRoads, type RoadLine } from '../plan/roads';
import { RoadClass } from '../plan/types';
import { boundaryAt } from '../world/boundary';
import { bridgeDeckSurface } from '../build/bridges';
import { countryRoadSurface } from '../build/rural';

/** What a car has to do at a junction it drives into from one edge. */
export const enum Rule { Free = 0, Signal = 1, GiveWay = 2, Yield = 3 }

export interface RNode {
  x: number;
  z: number;
  edges: number[];
  /** Traffic lights. */
  signal: boolean;
  /** Where a country road leaves the map: traffic to and from the region comes and goes here. */
  exit: boolean;
}

export interface REdge {
  a: number;
  b: number;
  /** Polyline a → b. */
  pts: number[];
  /** Arc length at each vertex. */
  cum: number[];
  len: number;
  /** Carriageway width kerb to kerb (m). */
  width: number;
  sidewalk: number;
  /** Lanes per direction. */
  lanes: number;
  cls: RoadClass;
  source: LineSource;
  /** Kerbside parking strip each side (m), 0 where there is none. */
  park: number;
  /** Speed limit (km/h): what the signs say. */
  kmh: number;
  /** What a car arriving at node a (index 0) and at node b (index 1) must do there. */
  rule: [Rule, Rule];
  /** Road surface height every SURF_STEP metres from a. */
  ys: Float32Array;
  /** The town road line it is a piece of, and the arc length where it starts on it. */
  line: number;
  /** Its street (`RoadNet.streets`), -1 for unnamed tracks. */
  street: number;
  s0: number;
}

/** Spacing of the surface height samples (m). */
export const SURF_STEP = 4;
const GRID = 32;
/** Key of a square of a grid (spatial hashes of the traffic). */
export const gridKey = (i: number, j: number): number => (i + 32768) * 65536 + (j + 32768);

/** Speed limits (km/h): town main roads, town streets, lanes, country roads, country lanes, farm tracks. */
export const LIMITS = { main: 50, street: 30, lane: 20, country: 80, countryLane: 60, track: 30 } as const;

export class RoadNet {
  readonly nodes: RNode[];
  readonly edges: REdge[] = [];
  /** Street names (the place graph's street places carry the same names). */
  readonly streets: string[];
  private readonly grid = new Map<number, number[]>();

  constructor(town: Town) {
    const roads = townRoads(town);
    this.streets = roads.streets.map((st) => st.name);
    const { terrain, macro } = town;
    this.nodes = roads.nodes.map((n) => ({ x: n.x, z: n.z, edges: [], signal: false, exit: false }));
    const bridgeOf = new Map(macro.bridges.map((b) => [b.edge, b]));
    roads.lines.forEach((L, li) => {
      if (L.cls === RoadClass.Path) return;
      const surf = surfaceOf(L);
      for (let k = 0; k + 1 < L.cuts.length; k++) {
        const A = L.cuts[k], B = L.cuts[k + 1];
        if (A.node === B.node || B.s - A.s < 0.5) continue;
        const pts = slicePolyline(L, A.s, B.s);
        const cum = [0];
        for (let i = 2; i < pts.length; i += 2) cum.push(cum[cum.length - 1] + Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]));
        const len = cum[cum.length - 1];
        const n = Math.max(2, Math.ceil(len / SURF_STEP) + 1), ys = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          const s = Math.min(len, i * SURF_STEP), [x, z] = pointOn(pts, cum, s);
          ys[i] = surf ? surf(A.s + s) : terrain.height(x, z);
        }
        const [mx, mz] = pointOn(pts, cum, len / 2);
        const inTown = Math.hypot(mx, mz) < boundaryAt(macro.boundary, mx, mz) + 60;
        const id = this.edges.length;
        this.edges.push({
          a: A.node, b: B.node, pts, cum, len, width: L.width, sidewalk: L.sidewalk, lanes: Math.max(1, L.lanes), cls: L.cls, source: L.source,
          park: L.source === LineSource.Local && L.cls === RoadClass.Street ? 2 : 0,
          kmh: limitOf(L, inTown), rule: [Rule.Free, Rule.Free], ys, line: li, s0: A.s, street: L.street,
        });
        this.nodes[A.node].edges.push(id);
        this.nodes[B.node].edges.push(id);
      }
    });
    // Exits: the far ends of the country roads that run off the map (not to a farm or a site).
    roads.lines.forEach((L) => {
      if (L.source !== LineSource.Country) return;
      const r = town.rural.roads[L.ref];
      if (r.farm >= 0 || r.site >= 0) return;
      const end = this.nodes[L.cuts[L.cuts.length - 1].node];
      if (end.edges.length === 1) end.exit = true;
    });
    this.rules();
    this.edges.forEach((e, id) => {
      for (let k = 0; k + 3 < e.pts.length; k += 2) {
        const x0 = Math.min(e.pts[k], e.pts[k + 2]), x1 = Math.max(e.pts[k], e.pts[k + 2]);
        const z0 = Math.min(e.pts[k + 1], e.pts[k + 3]), z1 = Math.max(e.pts[k + 1], e.pts[k + 3]);
        for (let i = Math.floor(x0 / GRID); i <= Math.floor(x1 / GRID); i++) for (let j = Math.floor(z0 / GRID); j <= Math.floor(z1 / GRID); j++) {
          const k2 = gridKey(i, j);
          let l = this.grid.get(k2);
          if (!l) this.grid.set(k2, (l = []));
          if (l[l.length - 1] !== id) l.push(id);
        }
      }
    });

    function surfaceOf(L: RoadLine): ((s: number) => number) | null {
      if (L.source === LineSource.Arterial) {
        const br = bridgeOf.get(L.ref);
        return br ? bridgeDeckSurface(br, terrain) : null;
      }
      if (L.source === LineSource.Country || L.source === LineSource.Track) {
        const r = town.rural.roads[L.ref];
        return r.bridges.length ? countryRoadSurface(r, terrain) : null;
      }
      return null;
    }
  }

  /**
   * Junction rules. Traffic lights where three or more main roads meet at a crossroads (four ways
   * or more); elsewhere the roads of the best class at a junction are the priority road and the
   * others give way; where all are alike (two side streets crossing), everyone yields to cars
   * already in the junction.
   */
  private rules(): void {
    this.nodes.forEach((n, ni) => {
      if (n.edges.length < 3) return;
      const main = n.edges.filter((e) => this.edges[e].source === LineSource.Arterial).length;
      if (main >= 4) { n.signal = true; for (const e of n.edges) this.setRule(e, ni, Rule.Signal); return; }
      const rank = (e: number) => this.rank(this.edges[e]);
      const best = Math.min(...n.edges.map(rank));
      const top = n.edges.filter((e) => rank(e) === best).length;
      for (const e of n.edges) this.setRule(e, ni, top <= 2 && rank(e) > best ? Rule.GiveWay : top <= 2 ? Rule.Free : Rule.Yield);
    });
  }

  /** Priority rank of a road (lower goes first): main roads, country roads, streets, lanes and tracks. */
  rank(e: REdge): number {
    return e.source === LineSource.Arterial ? 0 : e.source === LineSource.Country && e.cls === RoadClass.Street ? 1 : e.cls === RoadClass.Street ? 2 : 3;
  }

  private setRule(eid: number, node: number, r: Rule): void {
    const e = this.edges[eid];
    if (e.a === node) e.rule[0] = r;
    if (e.b === node) e.rule[1] = r;
  }

  /** The rule for a car on edge e arriving at its end (fwd: at b). */
  ruleAt(e: REdge, fwd: boolean): Rule {
    return e.rule[fwd ? 1 : 0];
  }

  /** Speed limit in m/s. */
  limit(e: REdge): number {
    return e.kmh / 3.6;
  }

  /** Surface height at arc length s along an edge. */
  heightAt(e: REdge, s: number): number {
    const f = Math.max(0, Math.min(e.ys.length - 1, s / SURF_STEP)), i = Math.min(e.ys.length - 2, Math.floor(f)), t = f - i;
    return e.ys[i] + (e.ys[i + 1] - e.ys[i]) * t;
  }

  /** Nearest edge to a point: edge id, arc param s, distance, side (+1 right of a→b). */
  nearestEdge(x: number, z: number, maxR = 120, accept?: (e: REdge) => boolean): { e: number; s: number; d: number; side: number } | null {
    let best: { e: number; s: number; d: number; side: number } | null = null;
    for (let r = GRID; r <= Math.max(GRID, maxR * 2); r *= 2) {
      const i0 = Math.floor((x - r) / GRID), i1 = Math.floor((x + r) / GRID), j0 = Math.floor((z - r) / GRID), j1 = Math.floor((z + r) / GRID);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const l = this.grid.get(gridKey(i, j));
        if (!l) continue;
        for (const id of l) {
          const e = this.edges[id];
          if (accept && !accept(e)) continue;
          for (let k = 0; k + 3 < e.pts.length; k += 2) {
            const ax = e.pts[k], az = e.pts[k + 1], dx = e.pts[k + 2] - ax, dz = e.pts[k + 3] - az;
            const l2 = dx * dx + dz * dz;
            const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
            const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
            if (d <= maxR && (!best || d < best.d)) best = { e: id, s: e.cum[k >> 1] + Math.sqrt(l2) * t, d, side: dx * (z - az) - dz * (x - ax) > 0 ? 1 : -1 };
          }
        }
      }
      const b2 = best as { d: number } | null;
      if (b2 && b2.d < r) break;
    }
    return best;
  }

  /**
   * Point on an edge at arc length s with a lateral offset (positive = right of a→b, with x east
   * and z south: the right of heading (dx, dz) is (−dz, dx)). Writes into out.
   */
  lanePoint(e: REdge, s: number, offset: number, out: { x: number; z: number; dx: number; dz: number }): void {
    s = Math.max(0, Math.min(e.len, s));
    let k = 0;
    while (k < e.cum.length - 2 && e.cum[k + 1] < s) k++;
    const seg = e.cum[k + 1] - e.cum[k] || 1;
    const t = (s - e.cum[k]) / seg;
    const ax = e.pts[k * 2], az = e.pts[k * 2 + 1], bx = e.pts[k * 2 + 2], bz = e.pts[k * 2 + 3];
    const dx = (bx - ax) / seg, dz = (bz - az) / seg;
    out.x = ax + (bx - ax) * t - dz * offset;
    out.z = az + (bz - az) * t + dx * offset;
    out.dx = dx;
    out.dz = dz;
  }

  /**
   * Centre of lane `lane` (0 = the kerb lane) for driving along e (fwd: a → b), as an offset from
   * the centreline, positive right of a → b. Right-hand traffic.
   */
  laneOffset(e: REdge, fwd: boolean, lane: number): number {
    const half = e.width / 2 - e.park - 0.3;
    const lw = Math.max(Math.min(3.5, half / e.lanes), Math.min(1.4, half));
    const o = half - lw * (Math.min(lane, e.lanes - 1) + 0.5);
    return (fwd ? 1 : -1) * Math.max(0.6, o);
  }

  /** A* between two nodes, for cars (main roads preferred). Edge ids in travel order with direction flags, or null. */
  carRoute(from: number, to: number, maxNodes = 20000): { edges: number[]; fwd: boolean[] } | null {
    if (from === to) return { edges: [], fwd: [] };
    const N = this.nodes.length;
    const g = new Float64Array(N).fill(Infinity);
    const via = new Int32Array(N).fill(-1);
    const heap = new MinHeap();
    const tx = this.nodes[to].x, tz = this.nodes[to].z;
    g[from] = 0;
    heap.push(0, from);
    let expanded = 0;
    while (heap.size && expanded++ < maxNodes) {
      const u = heap.pop();
      if (u === to) break;
      const gu = g[u];
      for (const eid of this.nodes[u].edges) {
        const e = this.edges[eid];
        const v = e.a === u ? e.b : e.a;
        // Time at the speed limit, so main roads win over side streets.
        const ng = gu + e.len / this.limit(e);
        if (ng < g[v]) {
          g[v] = ng;
          via[v] = eid;
          heap.push(ng + Math.hypot(this.nodes[v].x - tx, this.nodes[v].z - tz) / (LIMITS.country / 3.6), v);
        }
      }
    }
    if (!Number.isFinite(g[to])) return null;
    const edges: number[] = [], fwd: boolean[] = [];
    let u = to;
    while (u !== from) {
      const eid = via[u];
      const e = this.edges[eid];
      edges.push(eid);
      fwd.push(e.b === u);
      u = e.a === u ? e.b : e.a;
    }
    edges.reverse();
    fwd.reverse();
    return { edges, fwd };
  }

  /**
   * The exit (a country road leaving the map) whose direction from the middle of town is nearest a
   * compass bearing (degrees, 0 north = −z, 90 east = +x); -1 without exits.
   */
  exitToward(bearing: number): number {
    let cx = 0, cz = 0;
    for (const n of this.nodes) { cx += n.x; cz += n.z; }
    cx /= Math.max(1, this.nodes.length); cz /= Math.max(1, this.nodes.length);
    let best = -1, bo = Infinity;
    this.nodes.forEach((n, i) => {
      if (!n.exit) return;
      const b = (Math.atan2(n.x - cx, -(n.z - cz)) * 180) / Math.PI;
      const off = Math.abs(((((b - bearing) % 360) + 540) % 360) - 180);
      if (off < bo) { bo = off; best = i; }
    });
    return best;
  }

  /** Node nearest to an edge param (the end you would reach first). */
  edgeEndNear(eid: number, s: number): number {
    const e = this.edges[eid];
    return s < e.len / 2 ? e.a : e.b;
  }
}

function limitOf(L: RoadLine, inTown: boolean): number {
  if (L.source === LineSource.Arterial) return LIMITS.main;
  if (L.source === LineSource.Track) return LIMITS.track;
  if (L.source === LineSource.Country) return inTown ? LIMITS.main : L.cls === RoadClass.Street ? LIMITS.country : LIMITS.countryLane;
  return L.cls === RoadClass.Street ? LIMITS.street : LIMITS.lane;
}

/** Point at arc length s on a polyline with its cumulative lengths. */
function pointOn(pts: number[], cum: number[], s: number): [number, number] {
  let k = 0;
  while (k < cum.length - 2 && cum[k + 1] < s) k++;
  const t = Math.max(0, Math.min(1, (s - cum[k]) / (cum[k + 1] - cum[k] || 1)));
  return [pts[k * 2] + (pts[k * 2 + 2] - pts[k * 2]) * t, pts[k * 2 + 1] + (pts[k * 2 + 3] - pts[k * 2 + 1]) * t];
}

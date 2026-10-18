/**
 * Travel times between places over the road network of a `PlaceGraph`. Dijkstra from a place's road node runs once
 * and is cached, so a town with a few hundred distinct entrance nodes answers every query from typed arrays.
 */
import { MinHeap } from '@futuremagic/core';
import type { ActorId } from './actors';
import type { PlaceGraph, PlaceId } from './places';

/** How someone travels. Bike, bus and train come with transit (src/sim/transit.ts). */
export type Mode = 'foot' | 'car' | 'bike' | 'bus' | 'train';

/**
 * A journey under way (`world.trips`): filled by `go`, dropped on arrival. Traffic spawns its cars from the car trips
 * and the street view its walkers from the rest; companions (children, the dog) have their own trip with `leader`
 * set to the one they travel with, so a family is one car.
 */
export interface Trip {
  who: ActorId;
  from: PlaceId;
  to: PlaceId;
  /** Clock minutes. */
  depart: number;
  arrive: number;
  mode: Mode;
  /** The traveller they go with (driver or companion), -1 when travelling on their own account. */
  leader: ActorId;
  /** The bus or train run they ride (`transitOf(world).runs`), -1 when none. */
  run: number;
}

/** Walking speed, metres per game minute (4.8 km/h). */
export const WALK_M_PER_MIN = 80;
/** Town driving speed including junctions, metres per minute (30 km/h). */
export const DRIVE_M_PER_MIN = 500;
/** Minutes to get to the car and park it. */
export const PARK_MIN = 3;
/** People with a car drive when walking would take longer than this. */
export const DRIVE_IF_WALK_OVER = 12;
/** Out of town (a place's `beyond`): driving on the open road, metres per minute (60 km/h). */
export const ROAD_M_PER_MIN = 1000;
/** Out of town by train or bus, metres per minute, plus the wait at the stop. */
export const TRANSIT_M_PER_MIN = 700;
export const TRANSIT_WAIT_MIN = 8;
/** Places closer than this (m) are reached straight across, not round by the road. */
const NEXT_DOOR = 60;
/** Detour factor when two places have no road connection (straight-line fallback). */
const OFFROAD = 1.4;

export class Travel {
  private readonly graph: PlaceGraph;
  /** CSR adjacency: neighbours of node n are adj[start[n] .. start[n+1]). */
  private readonly start: Int32Array;
  private readonly adj: Int32Array;
  private readonly cost: Float32Array;
  private readonly cache = new Map<number, Float64Array>();
  /** Per source node: the node before each node on its shortest path (-1 at the source and unreached). */
  private readonly prevs = new Map<number, Int32Array>();
  private readonly heap = new MinHeap();
  /** Does the town have a railway station (people without a car leave town by train, else by bus)? */
  private readonly station: boolean;

  constructor(graph: PlaceGraph) {
    this.graph = graph;
    this.station = graph.places.some((p) => p.kind === 'station');
    const n = graph.nodes.length;
    const deg = new Int32Array(n + 1);
    for (const e of graph.edges) { deg[e.a]++; deg[e.b]++; }
    this.start = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) this.start[i + 1] = this.start[i] + deg[i];
    this.adj = new Int32Array(this.start[n]);
    this.cost = new Float32Array(this.start[n]);
    const fill = this.start.slice(0, n);
    for (const e of graph.edges) {
      const c = e.length / Math.max(0.1, e.walk);
      this.adj[fill[e.a]] = e.b; this.cost[fill[e.a]++] = c;
      this.adj[fill[e.b]] = e.a; this.cost[fill[e.b]++] = c;
    }
  }

  /** Effective walking metres from road node `from` to every node (cached). */
  private fromNode(from: number): Float64Array {
    let d = this.cache.get(from);
    if (d) return d;
    // Float64, like the priorities: rounded to float32, a node's stored distance could come out below the
    // priority it was queued with, and the node was then skipped as stale (most of the town was unreachable).
    d = new Float64Array(this.graph.nodes.length).fill(Infinity);
    const prev = new Int32Array(this.graph.nodes.length).fill(-1);
    const heap = this.heap;
    heap.clear();
    d[from] = 0;
    heap.push(0, from);
    while (heap.size > 0) {
      const u = heap.pop();
      const du = heap.lastPriority;
      if (du > d[u]) continue;
      for (let i = this.start[u]; i < this.start[u + 1]; i++) {
        const v = this.adj[i], nd = du + this.cost[i];
        if (nd < d[v]) { d[v] = nd; prev[v] = u; heap.push(nd, v); }
      }
    }
    this.cache.set(from, d);
    this.prevs.set(from, prev);
    return d;
  }

  /** Effective walking metres between two places (entrance → road → entrance). */
  metres(a: PlaceId, b: PlaceId): number {
    if (a === b) return 0;
    const pa = this.graph.places[a], pb = this.graph.places[b];
    const straight = Math.hypot(pa.x - pb.x, pa.z - pb.z);
    if (pa.node < 0 || pb.node < 0) return straight * OFFROAD;
    const na = this.graph.nodes[pa.node], nb = this.graph.nodes[pb.node];
    const road = this.fromNode(pa.node)[pb.node];
    if (!Number.isFinite(road)) return straight * OFFROAD;
    const viaRoad = Math.hypot(pa.x - na.x, pa.z - na.z) + road + Math.hypot(pb.x - nb.x, pb.z - nb.z);
    // Only next-door places are reached straight across; further off, the straight line would run through
    // houses or over the river, and the street layer walks the roads (`roadPath`).
    return straight < NEXT_DOOR ? Math.min(viaRoad, straight * OFFROAD) : viaRoad;
  }

  /**
   * The road nodes a walk from a to b passes, in order (the shortest path over the roads). Empty when no road
   * joins them. The street layer walks it, even where `metres` takes the straight line as shorter (that line may
   * cross a river or a block of houses, which the place graph does not know about).
   */
  roadPath(a: PlaceId, b: PlaceId): number[] {
    if (a === b) return [];
    const pa = this.graph.places[a], pb = this.graph.places[b];
    if (pa.node < 0 || pb.node < 0) return [];
    const road = this.fromNode(pa.node)[pb.node];
    if (!Number.isFinite(road)) return [];
    const prev = this.prevs.get(pa.node)!, path: number[] = [];
    for (let n = pb.node; n >= 0; n = prev[n]) path.push(n);
    return path.reverse();
  }

  /** The candidate place nearest to `from` by travel time, -1 if none. The one "nearest X" helper. */
  nearest(from: PlaceId, candidates: Iterable<PlaceId>): PlaceId {
    let best = -1, bt = Infinity;
    for (const p of candidates) {
      const t = this.metres(from, p);
      if (t < bt) { bt = t; best = p; }
    }
    return best;
  }

  /** Metres off the map between a and b (one of them out of town, or both in different directions). */
  private far(a: PlaceId, b: PlaceId): number {
    return (this.graph.places[a].beyond ?? 0) + (this.graph.places[b].beyond ?? 0);
  }

  /**
   * How someone with or without a car goes from a to b: in town they drive when walking would take too long; out of
   * town they drive, or take the train (the bus when the town has no station).
   */
  mode(a: PlaceId, b: PlaceId, car = false): Mode {
    if (a === b) return 'foot';
    if (this.far(a, b) > 0) return car ? 'car' : this.station ? 'train' : 'bus';
    return car && this.metres(a, b) / WALK_M_PER_MIN > DRIVE_IF_WALK_OVER ? 'car' : 'foot';
  }

  /** Whole game minutes from a to b, walking or (with a car, when worth it) driving. At least 1 between places. */
  minutes(a: PlaceId, b: PlaceId, car = false): number {
    if (a === b) return 0;
    const m = this.metres(a, b), far = this.far(a, b);
    if (far > 0) {
      const t = car ? m / DRIVE_M_PER_MIN + far / ROAD_M_PER_MIN + PARK_MIN : m / WALK_M_PER_MIN + far / TRANSIT_M_PER_MIN + TRANSIT_WAIT_MIN;
      return Math.max(1, Math.round(t));
    }
    let t = m / WALK_M_PER_MIN;
    if (car && t > DRIVE_IF_WALK_OVER) t = Math.min(t, m / DRIVE_M_PER_MIN + PARK_MIN);
    return Math.max(1, Math.round(t));
  }
}

/**
 * Road traffic: the town's cars driving, stopping and parking.
 *
 *  - Vehicles keep to the right-hand lanes of the RoadNet, turn through junctions on curved
 *    connectors, keep their distance with the Intelligent Driver Model, stop at red lights (the
 *    phase is a pure function of time and junction), give way where a minor road meets a major
 *    one and yield to cars already in a junction where the roads are alike.
 *  - Every car has a journey: a household's car leaves the kerb where it is parked and parks again
 *    near where its driver is going (`depart`), a car from the region comes in at the edge of the
 *    map (`enter`), a car leaves the map (`leave` as its destination). Nothing drives at random:
 *    the journeys come from the society simulation (src/traffic/trips.ts).
 *  - Parked cars stand in kerbside bays (`Parking`), which the moving cars treat as part of the
 *    kerb, not the lane.
 *
 * Ported from Scale (src/sim/Traffic.ts): IDM, junction boxes, signals, look-ahead across lanes,
 * the gridlock breaker, sirens pulling traffic over. Left behind: giants, fear and fleeing,
 * wrecks and crushing, police roadblocks, the player as an obstacle, random spawning around the
 * player. New: give way rules, journeys with an end, parking, the speed limits in km/h.
 *
 * Pure (no three.js): runs on the main thread for the visible town and in headless tests.
 */
import { Rng, hash32 } from '@futuremagic/core';
import { Rule, gridKey as cellKey, type REdge, type RoadNet } from './roadNet';
import type { Parking, Spot } from './parking';

export type VKind =
  | 'sedan' | 'hatch' | 'wagon' | 'suv' | 'van' | 'pickup' | 'taxi' | 'police' | 'sports' | 'bus' | 'truck' | 'delivery' | 'shuttle'
  | 'ambulance' | 'firetruck' | 'flatbed';

/** Length and width (m) per kind (Scale's DIMS). */
export const DIMS: Record<VKind, [number, number]> = {
  sedan: [4.7, 1.85], hatch: [4.1, 1.78], wagon: [4.8, 1.85], suv: [4.8, 1.95], van: [5.2, 2.0], pickup: [5.4, 2.0],
  taxi: [4.8, 1.85], police: [4.9, 1.9], sports: [4.4, 1.9], bus: [12, 2.55], truck: [8, 2.5], delivery: [6, 2.2], shuttle: [5.0, 2.06],
  ambulance: [6, 2.2], firetruck: [8.2, 2.5], flatbed: [8.2, 2.5],
};

/** A particular car: its model and a stable key (a household's car keeps its key, so its colour, parked or driving). */
export interface Car {
  key: number;
  kind: VKind;
  variant: number;
}

type Route = { edges: number[]; fwd: boolean[] };

/** Where a journey ends. */
export type Goal =
  /** Park as near (x, z) as there is room (a place the driver is going to). */
  | { park: true; x: number; z: number }
  /** Drive off the map at an exit node (to the region). */
  | { exit: number }
  /**
   * Stop in the kerb lane by (x, z) with the hazards on for `dwell` seconds (a bus stop, the bin
   * lorry at a row of houses, the post van), then drive on to `then`.
   */
  | { halt: true; x: number; z: number; dwell: number; then: Goal; /** Not before this (`Traffic.time`): a bus early for its timetable. */ leave?: number; /** Pull into a lay-by off the lane (a bus stop), so traffic goes past. */ bay?: boolean; tag?: number };

export interface Vehicle {
  id: number;
  car: Car;
  length: number;
  width: number;
  /** Current edge, direction (a → b) and lane (0 = the kerb lane). */
  edge: number;
  fwd: boolean;
  lane: number;
  s: number;
  /** Route (edges + directions) and the index of the current edge. */
  route: { edges: number[]; fwd: boolean[] };
  ri: number;
  speed: number;
  /** This driver's top speed relative to the limit. */
  pace: number;
  /** World pose; forward is (−sin yaw, −cos yaw). Body attitude on the road: nose up +, right side up +. */
  x: number; y: number; z: number; yaw: number; pitch: number; roll: number;
  /**
   * Turning connector (quadratic Bezier) through a junction: progress 0..1, null on an edge.
   * `node` the junction, `enter` when the car drove in (who goes first), `from` the lane key it came from.
   */
  turn: { ax: number; az: number; cx: number; cz: number; bx: number; bz: number; len: number; t: number; node: number; enter: number; from: string } | null;
  /** Brake lights 0..1, indicator (−1 left, +1 right, ±2 hazards, ±3 emergency), headlights 0..1. */
  brake: number;
  indicator: number;
  headlights: number;
  /** Seconds standing at a stop or in a queue (horn, give-way patience, gridlock breaker). */
  wait: number;
  jam: number;
  goal: Goal;
  /** The spot reserved at the journey's end (null: off the street, or leaving the map). */
  spot: Spot | null;
  /** Arc length on the last edge where the car stops. */
  stopAt: number;
  /** Seconds standing at a halt (−1: not halted). */
  halted: number;
  /** Siren and flashers: ignores red lights; cars ahead pull over to the kerb. */
  siren: boolean;
  /** Pulled towards the kerb (+, yielding to a siren) or the centre line (−, overtaking), 0..1. */
  pull: number;
  alive: boolean;
}

/** Seconds a car stands in a junction box before it stops yielding to crossing cars. */
const BOX_PATIENCE = 6;
/** Seconds a car stands still before it stops yielding to cars off its own lane. */
const CROSS_PATIENCE = 15;
/** Seconds a car waits at a give-way line before it edges out anyway. */
const GIVE_WAY_PATIENCE = 20;
/** Gap (s) a driver wants before pulling out in front of a car on the priority road. */
const GAP_S = 4.5;
/** A car stuck this long (s) is taken off the road as if it had turned off somewhere (never seen: the town is small). */
const JAM_GIVE_UP = 240;
/** IDM jam distance (m): the gap a car keeps to the one ahead when standing. */
const S0 = 2.2;
/** Signal cycle (s) and its phases: A green, amber/all red, B green, all red. */
const CYCLE = 56;

export class Traffic {
  readonly vehicles: Vehicle[] = [];
  /** Seconds since start (signal phases, junction order). */
  private t = 0;
  private nextId = 1;
  private readonly laneIndex = new Map<string, Vehicle[]>();
  private readonly exitIndex = new Map<string, Vehicle[]>();
  private readonly boxIndex = new Map<number, Vehicle[]>();
  private readonly fromIndex = new Map<string, Vehicle[]>();
  private readonly cellIndex = new Map<number, Vehicle[]>();
  private readonly sirens: Vehicle[] = [];
  private readonly tmp = { x: 0, z: 0, dx: 0, dz: 0 };
  /** Speed factor for the weather (slower in rain, fog and snow); set by the weather. */
  weatherK = 1;
  /** Daylight 0 (night) … 1 (day): headlights. Set by the day cycle. */
  daylight = 1;
  /**
   * People on the carriageway (crossing, getting into a car) that cars stop for, refilled by
   * their owner each frame (the street people). Discs: x, z, r.
   */
  readonly obstacles: { x: number; z: number; r: number }[] = [];
  /** A car parked (journey done). */
  onPark?: (v: Vehicle, spot: Spot | null) => void;
  /** A car drove off the map, or gave up. */
  onGone?: (v: Vehicle, reason: 'exit' | 'stuck') => void;
  /** A vehicle has pulled up at a halt (a bus at its stop). */
  onHalt?: (v: Vehicle, halt: Extract<Goal, { halt: true }>) => void;
  onHorn?: (v: Vehicle) => void;

  constructor(readonly net: RoadNet, readonly parking: Parking) {}

  get time(): number { return this.t; }

  // ------------------------------------------------------------------ journeys

  /**
   * A car at rest pulls out and drives to its goal. Null when it cannot (not at rest, no way
   * there, no room to pull out just now): then it stays where it is.
   */
  depart(car: Car, goal: Goal): Vehicle | null {
    if (!this.parking.has(car.key)) return null;
    const spot = this.parking.spotOf(car.key);
    // Off the street (a garage, a drive): out onto the street nearest it, on its own side.
    let edge: number, s: number, side: number;
    if (spot) ({ edge, s, side } = spot);
    else {
      const at = this.parking.restAt(car.key)!;
      const ne = this.net.nearestEdge(at.x, at.z, 300);
      if (!ne) return null;
      ({ e: edge, s, side } = ne);
    }
    const e = this.net.edges[edge];
    s = Math.max(2, Math.min(e.len - 2, s));
    // Away from the kerb with the traffic on its side; if the way is the other way round, the
    // car turns in the street.
    let fwd = side > 0;
    let v = this.launch(car, edge, fwd, s, goal, (x) => this.placeFree(x));
    if (v === undefined) { fwd = !fwd; v = this.launch(car, edge, fwd, s, goal, (x) => this.placeFree(x)); }
    if (!v) return null;
    // (The new spot is reserved; the old one is free now.)
    this.parking.release(car.key);
    if (v.spot) v.spot.car = car.key;
    v.indicator = fwd === side > 0 ? -1 : 1;
    return v;
  }

  /** A car from the region comes in at an exit node and drives to its goal. */
  enter(car: Car, exit: number, goal: Goal): Vehicle | null {
    const n = this.net.nodes[exit];
    if (!n?.exit || !n.edges.length) return null;
    const edge = n.edges[0], e = this.net.edges[edge];
    const fwd = e.a === exit;
    return this.launch(car, edge, fwd, fwd ? 2 : e.len - 2, goal, (v) => this.clearAt(v, 6)) ?? null;
  }

  /** A car driving off from (edge, fwd, s) to its goal (scripted vehicles: buses, service rounds, tests). */
  place(car: Car, edge: number, fwd: boolean, s: number, goal: Goal): Vehicle | null {
    return this.launch(car, edge, fwd, s, goal, (v) => this.clearAt(v, 1)) ?? null;
  }

  /**
   * Put a car on the road with its journey: undefined when there is no way to the goal from
   * there, null when the spot is not free (`free`) just now.
   */
  private launch(car: Car, edge: number, fwd: boolean, s: number, goal: Goal, free: (v: Vehicle) => boolean): Vehicle | null | undefined {
    const j = this.journey(car.key, edge, fwd, s, goal);
    if (!j) return undefined;
    const v = this.make(car, edge, fwd, s, goal);
    v.route = j.route;
    v.spot = j.spot;
    v.stopAt = j.stopAt;
    if (!free(v)) { if (j.spot) this.parking.unreserve(j.spot, car.key); return null; }
    this.vehicles.push(v);
    return v;
  }

  /**
   * The way from (edge, fwd, s) to a goal: the route (starting with that edge), the spot reserved
   * at its end and where on the last edge the car stops. Null when there is no way.
   */
  private journey(key: number, edge: number, fwd: boolean, s: number, goal: Goal): { route: Route; spot: Spot | null; stopAt: number } | null {
    const e = this.net.edges[edge];
    const from = fwd ? e.b : e.a;
    if ('exit' in goal) {
      const r = this.net.carRoute(from, goal.exit);
      return r ? { route: { edges: [edge, ...r.edges], fwd: [fwd, ...r.fwd] }, spot: null, stopAt: NaN } : null;
    }
    // The last edge and direction: past the reserved spot with the kerb on the right, or past
    // the goal on the nearest street.
    const halt = 'halt' in goal;
    const spot = halt ? null : this.parking.reserve(key, goal.x, goal.z);
    let le: number, lf: boolean, stopAt: number;
    if (spot) { le = spot.edge; lf = spot.side > 0; stopAt = spot.s; }
    else {
      const ne = this.net.nearestEdge(goal.x, goal.z, 400);
      if (!ne) return null;
      le = ne.e; lf = ne.side > 0; stopAt = ne.s;
      // A stop has a kerb on both sides of the road: halt in whichever direction comes first.
      if (halt) lf = this.quickerWay(from, edge, fwd, s, le, stopAt);
    }
    const L = this.net.edges[le];
    // (A halt stands clear of the junctions, where cars can queue behind it.)
    const clear = halt ? Math.min(L.len / 2, junctionBack(L) + 10) : 3;
    stopAt = Math.max(clear, Math.min(L.len - clear, stopAt));
    // Already on it, and the stop lies ahead.
    if (le === edge && lf === fwd && (fwd ? stopAt > s + 3 : stopAt < s - 3)) return { route: { edges: [edge], fwd: [fwd] }, spot, stopAt };
    const r = this.net.carRoute(from, lf ? L.a : L.b);
    if (!r) { if (spot) this.parking.unreserve(spot, key); return null; }
    return { route: { edges: [edge, ...r.edges, le], fwd: [fwd, ...r.fwd, lf] }, spot, stopAt };
  }

  /** Is (edge `le`, at `stopAt`) reached sooner driving a → b than b → a, starting from node `from`? */
  private quickerWay(from: number, edge: number, fwd: boolean, s: number, le: number, stopAt: number): boolean {
    const L = this.net.edges[le];
    if (le === edge) return fwd ? stopAt > s : stopAt >= s;
    const cost = (to: number, along: number) => {
      const r = this.net.carRoute(from, to);
      return r ? r.edges.reduce((t, id) => t + this.net.edges[id].len / this.net.limit(this.net.edges[id]), 0) + along / this.net.limit(L) : Infinity;
    };
    return cost(L.a, stopAt) <= cost(L.b, L.len - stopAt);
  }

  private make(car: Car, edge: number, fwd: boolean, s: number, goal: Goal): Vehicle {
    const r = new Rng(hash32(this.nextId * 2654435761 + car.key));
    const [L, W] = DIMS[car.kind];
    const v: Vehicle = {
      id: this.nextId++, car, length: L, width: W, edge, fwd, lane: 0, s,
      route: { edges: [edge], fwd: [fwd] }, ri: 0, speed: 0, pace: r.range(0.9, 1.08),
      x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, turn: null, brake: 0, indicator: 0, headlights: 0, wait: 0, jam: 0,
      goal, spot: null, stopAt: NaN, halted: -1, siren: car.kind === 'ambulance' || car.kind === 'firetruck', pull: 0, alive: true,
    };
    this.pose(v);
    return v;
  }

  // ------------------------------------------------------------------ the frame

  update(dt: number): void {
    this.t += dt;
    if (!this.net.edges.length) return;
    this.index();
    this.resolveOverlaps();
    this.sirens.length = 0;
    for (const v of this.vehicles) if (v.siren) this.sirens.push(v);
    const lamps = this.daylight < 0.35 ? 1 : 0;
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const v = this.vehicles[i];
      v.headlights = lamps;
      this.step(v, dt);
      v.jam = v.speed < 0.3 ? v.jam + dt : Math.max(0, v.jam - dt * 2);
      if (v.alive && v.jam > JAM_GIVE_UP) {
        v.alive = false;
        if (v.spot) this.parking.unreserve(v.spot, v.car.key);
        this.onGone?.(v, 'stuck');
      }
      if (!v.alive) {
        this.vehicles[i] = this.vehicles[this.vehicles.length - 1];
        this.vehicles.pop();
      }
    }
  }

  private index(): void {
    this.laneIndex.clear();
    this.exitIndex.clear();
    this.boxIndex.clear();
    this.fromIndex.clear();
    this.cellIndex.clear();
    for (const v of this.vehicles) {
      push(this.cellIndex, cellKey(Math.floor(v.x / 16), Math.floor(v.z / 16)), v);
      if (v.turn) {
        push(this.exitIndex, this.exitKey(v), v);
        push(this.boxIndex, v.turn.node, v);
        push(this.fromIndex, v.turn.from, v);
        continue;
      }
      push(this.laneIndex, laneKey(v.edge, v.fwd, v.lane), v);
    }
    for (const l of this.laneIndex.values()) l.sort((a, b) => (a.fwd ? a.s - b.s : b.s - a.s));
  }

  /** Traffic signal for an approach: green if the edge's axis belongs to the active phase. */
  signalGreen(node: number, e: REdge, t = this.t): boolean {
    const n = this.net.nodes[node];
    if (!n.signal) return true;
    const off = ((hash32(node * 7919 + 17) % 1000) / 1000) * CYCLE;
    const ph = ((t + off) % CYCLE) / CYCLE;
    let ang = Math.atan2(e.pts[e.pts.length - 1] - e.pts[1], e.pts[e.pts.length - 2] - e.pts[0]);
    if (ang < 0) ang += Math.PI;
    const r = this.net.edges[n.edges[0]];
    let ra = Math.atan2(r.pts[r.pts.length - 1] - r.pts[1], r.pts[r.pts.length - 2] - r.pts[0]);
    if (ra < 0) ra += Math.PI;
    let d = Math.abs(ang - ra);
    d = Math.min(d, Math.PI - d);
    if (d < Math.PI / 4) return ph < 0.45;
    return ph >= 0.5 && ph < 0.95;
  }

  /** World pose from the lane position (or the junction connector). */
  private pose(v: Vehicle, dt = 0): void {
    let y: number;
    if (v.turn) {
      const T = v.turn, t = T.t, u = 1 - t;
      v.x = u * u * T.ax + 2 * u * t * T.cx + t * t * T.bx;
      v.z = u * u * T.az + 2 * u * t * T.cz + t * t * T.bz;
      const dx = 2 * u * (T.cx - T.ax) + 2 * t * (T.bx - T.cx), dz = 2 * u * (T.cz - T.az) + 2 * t * (T.bz - T.cz);
      v.yaw = Math.atan2(-dx, -dz);
      // Height: between the two edges' ends.
      const e0 = this.net.edges[v.edge], e1 = this.net.edges[v.route.edges[v.ri + 1]];
      const y0 = this.net.heightAt(e0, v.fwd ? e0.len : 0), y1 = e1 ? this.net.heightAt(e1, v.route.fwd[v.ri + 1] ? 0 : e1.len) : y0;
      y = y0 + (y1 - y0) * t;
      v.pitch += (0 - v.pitch) * Math.min(1, dt * 4);
    } else {
      const e = this.net.edges[v.edge];
      const off = this.net.laneOffset(e, v.fwd, v.lane);
      this.net.lanePoint(e, v.s, off + Math.sign(off) * v.pull * 1.7, this.tmp);
      v.x = this.tmp.x; v.z = this.tmp.z;
      const dx = v.fwd ? this.tmp.dx : -this.tmp.dx, dz = v.fwd ? this.tmp.dz : -this.tmp.dz;
      v.yaw = Math.atan2(-dx, -dz);
      y = this.net.heightAt(e, v.s);
      const hb = v.length * 0.31;
      const yF = this.net.heightAt(e, v.s + (v.fwd ? hb : -hb)), yB = this.net.heightAt(e, v.s - (v.fwd ? hb : -hb));
      const pitch = Math.atan2(yF - yB, hb * 2);
      v.pitch = dt > 0 ? v.pitch + (pitch - v.pitch) * Math.min(1, dt * 10) : pitch;
    }
    v.y = y;
    v.roll = 0;
  }

  private step(v: Vehicle, dt: number): void {
    if (v.turn) { this.stepTurn(v, dt); return; }
    const e = this.net.edges[v.edge];
    if (!e) { v.alive = false; return; }
    const along = v.fwd ? v.s : e.len - v.s;
    const remaining = e.len - along;
    const last = v.ri + 1 >= v.route.edges.length;
    // ---- leader: the next car on this lane, cars from it still in the box, anything else in the way
    let gap = Infinity, leadV = 0, passing = false;
    const lk = laneKey(v.edge, v.fwd, v.lane);
    const lane = this.laneIndex.get(lk);
    if (lane) for (const o of lane) {
      if (o === v) continue;
      const oa = v.fwd ? o.s : e.len - o.s;
      if (oa > along || (oa === along && o.id < v.id)) {
        if (v.siren && o.pull > 0.5) { if (oa - along < 30) passing = true; continue; }
        // A bus in the lay-by at its stop is off the carriageway (another bus for the stop queues behind it).
        if (o.halted >= 0 && o.pull > 0.9 && !(last && 'bay' in v.goal && v.goal.bay)) continue;
        const g = oa - along - (o.length + v.length) / 2;
        if (g < gap) { gap = g; leadV = o.speed; }
        break;
      }
    }
    const ahead = this.fromIndex.get(lk);
    if (ahead) for (const o of ahead) {
      if (!o.turn) continue;
      const g = Math.max(0, remaining - junctionBack(e)) + o.turn.t * o.turn.len - (o.length + v.length) / 2;
      if (g < gap) { gap = g; leadV = o.speed; }
    }
    const pg = this.carAhead(v, lk);
    if (pg < gap) { gap = pg; leadV = 0; }
    const og = this.obstacleAhead(v, 6 + v.speed * 2.5);
    if (og < gap) { gap = og; leadV = 0; }
    const node = v.fwd ? e.b : e.a;
    const hasNext = !last;
    // ---- the junction ahead
    if (remaining < 50 && hasNext) {
      const stopLine = remaining - junctionBack(e) - v.length / 2 - 1.5;
      let mustStop = false;
      const rule = this.net.ruleAt(e, v.fwd);
      if (rule === Rule.Signal) mustStop = !v.siren && !this.signalGreen(node, e);
      else if (rule === Rule.GiveWay && !v.siren) mustStop = !this.clearToEnter(v, node, e) && v.wait < GIVE_WAY_PATIENCE;
      else if (rule === Rule.Yield && !v.siren) mustStop = this.junctionBusy(node, v);
      // Don't block the box: only drive in when the street it turns into has room for the car.
      if (!mustStop && this.boxIndex.get(node)?.some((o) => o.jam > 1)) mustStop = true;
      if (!mustStop) {
        const ni = v.route.edges[v.ri + 1], ne = this.net.edges[ni];
        if (ne && this.entryRoom(ni, v.route.fwd[v.ri + 1], Math.min(v.lane, ne.lanes - 1), v) < Math.min(v.length + 2, Math.max(0, ne.len - 2 * junctionBack(ne)))) mustStop = true;
      }
      // A give-way line is a stop for a moment: the car creeps up to it, then looks.
      if (mustStop && stopLine > -1 && stopLine < gap) { gap = Math.max(0, stopLine); leadV = 0; }
    }
    // ---- the end of the journey
    if (last) {
      if ('exit' in v.goal) {
        if (remaining < 3) { v.alive = false; this.onGone?.(v, 'exit'); return; }
      } else {
        // The stop as a standing obstacle just beyond it (IDM keeps s0 to a leader).
        const dStop = v.fwd ? v.stopAt - v.s : v.s - v.stopAt;
        if (dStop + S0 - 0.2 < gap) { gap = Math.max(0, dStop + S0 - 0.2); leadV = 0; }
        if (dStop < 0.8 && v.speed < 1.5) {
          if ('halt' in v.goal) { this.haltNow(v, dt); return; }
          this.parkNow(v);
          return;
        }
        v.indicator = dStop < 40 ? 1 : 0;
      }
    }
    // ---- yield to a siren behind: slow down and pull over
    let yieldTo = false;
    if (!v.siren) for (const sv of this.sirens) {
      if (sv.edge !== v.edge || sv.fwd !== v.fwd || sv.turn) continue;
      const sa = v.fwd ? sv.s : e.len - sv.s;
      if (sa < along && along - sa < 55) { yieldTo = true; break; }
    }
    const pullTo = yieldTo ? 1 : v.siren && passing ? -1 : 0;
    v.pull += (pullTo - v.pull) * Math.min(1, dt * 1.6);
    // ---- IDM
    const a0 = v.siren ? 2.6 : 1.8, b0 = 3.5, T = 1.3, s0 = S0;
    const vmax = this.net.limit(e) * v.pace * (v.siren ? 1.5 : this.weatherK) * (remaining < 25 && hasNext ? 0.7 : 1) * (yieldTo ? 0.3 : 1);
    const sStar = s0 + Math.max(0, v.speed * T + (v.speed * (v.speed - leadV)) / (2 * Math.sqrt(a0 * b0)));
    let acc = a0 * (1 - Math.pow(v.speed / Math.max(0.1, vmax), 4) - (gap < Infinity ? (sStar / Math.max(0.1, gap)) ** 2 : 0));
    acc = Math.max(-9, Math.min(a0, acc));
    v.brake = acc < -0.5 ? Math.min(1, -acc / 4) : v.speed < 0.2 ? 0.6 : 0;
    v.speed = Math.max(0, v.speed + acc * dt);
    if (v.speed < 0.1) {
      v.wait += dt;
      if (v.wait > 25 && og === Infinity && Math.floor(v.wait / 25) !== Math.floor((v.wait - dt) / 25)) this.onHorn?.(v);
    } else v.wait = 0;
    // ---- advance
    const ds = v.speed * dt;
    v.s += v.fwd ? ds : -ds;
    const remainingNow = v.fwd ? e.len - v.s : v.s;
    if (hasNext && remainingNow <= junctionBack(e)) this.beginTurn(v);
    else if (!hasNext) v.s = Math.max(0, Math.min(e.len, v.s));
    // Indicators before turning.
    if (hasNext && remaining < 30 && !v.turn) {
      const ne = this.net.edges[v.route.edges[v.ri + 1]];
      const di = travelDir(e, v.fwd, true), dn = travelDir(ne, v.route.fwd[v.ri + 1], false);
      const cross = di[0] * dn[1] - di[1] * dn[0];
      // x east, z south: a positive cross product turns to the right.
      v.indicator = Math.abs(cross) > 0.4 ? (cross > 0 ? 1 : -1) : 0;
    }
    this.pose(v, dt);
  }

  private stepTurn(v: Vehicle, dt: number): void {
    const T = v.turn!;
    let target = Math.min(this.net.limit(this.net.edges[v.edge]) * v.pace, 7);
    const og = Math.min(this.obstacleAhead(v, 10), this.boxGap(v));
    if (og < Infinity) target = Math.min(target, Math.sqrt(12 * Math.max(0, og - 0.3)));
    if (og <= 0.3) { v.speed = 0; v.brake = 1; }
    else if (target < v.speed - 0.5) { v.speed = Math.max(target, v.speed - 9 * dt); v.brake = 1; }
    else { v.speed += (target - v.speed) * Math.min(1, dt * 1.5); v.brake = 0; }
    T.t += (v.speed * dt) / T.len;
    if (T.t >= 1) {
      v.turn = null;
      v.ri++;
      v.edge = v.route.edges[v.ri];
      v.fwd = v.route.fwd[v.ri];
      const e = this.net.edges[v.edge];
      if (!e) { v.alive = false; return; }
      v.lane = Math.min(v.lane, e.lanes - 1);
      v.s = v.fwd ? junctionBack(e) : e.len - junctionBack(e);
      v.indicator = 0;
    }
    this.pose(v, dt);
  }

  private beginTurn(v: Vehicle): void {
    const e = this.net.edges[v.edge];
    const ne = this.net.edges[v.route.edges[v.ri + 1]];
    const nf = v.route.fwd[v.ri + 1];
    const a = { x: 0, z: 0, dx: 0, dz: 0 }, b = { x: 0, z: 0, dx: 0, dz: 0 };
    const back = junctionBack(ne);
    this.net.lanePoint(e, v.s, this.net.laneOffset(e, v.fwd, v.lane), a);
    const lane = Math.min(v.lane, ne.lanes - 1);
    this.net.lanePoint(ne, nf ? back : ne.len - back, this.net.laneOffset(ne, nf, lane), b);
    const node = v.fwd ? e.b : e.a;
    const n = this.net.nodes[node];
    // Control point: the node centre pulled towards the midpoint (a smooth curve).
    const cx = (n.x * 2 + a.x + b.x) / 4, cz = (n.z * 2 + a.z + b.z) / 4;
    const len = Math.max(1, Math.hypot(cx - a.x, cz - a.z) + Math.hypot(b.x - cx, b.z - cz));
    v.turn = { ax: a.x, az: a.z, cx, cz, bx: b.x, bz: b.z, len, t: 0, node, enter: this.t, from: laneKey(v.edge, v.fwd, v.lane) };
  }

  /** Standing at a halt: hazards on until the dwell is up, then on to the next goal. */
  private haltNow(v: Vehicle, dt: number): void {
    const g = v.goal as Extract<Goal, { halt: true }>;
    if (v.halted < 0) { v.halted = 0; this.onHalt?.(v, g); }
    v.speed = 0; v.brake = 0.6; v.indicator = 2; v.jam = 0;
    v.halted += dt;
    if (g.bay) v.pull += (1 - v.pull) * Math.min(1, dt * 1.6);
    this.pose(v, dt);
    if (v.halted < g.dwell || (g.leave !== undefined && this.t < g.leave)) return;
    // Out of the lay-by only when nothing is coming along the lane.
    if (g.bay) { v.indicator = -1; if (!this.bayFree(v)) return; v.pull = 0.85; }
    const j = this.journey(v.car.key, v.edge, v.fwd, v.s, g.then);
    // No way on from here (never in a connected town): stand until the gridlock breaker takes it.
    if (!j) return;
    v.goal = g.then; v.route = j.route; v.ri = 0; v.spot = j.spot; v.stopAt = j.stopAt; v.halted = -1; v.indicator = 0;
  }

  /** At its stop: into its spot (or off the street at the goal). */
  private parkNow(v: Vehicle): void {
    const g = v.goal as { x: number; z: number };
    this.parking.arrive(v.car.key, v.spot, g.x, g.z);
    v.alive = false;
    this.onPark?.(v, v.spot);
  }

  // ------------------------------------------------------------------ who goes first

  /**
   * May a car at a give-way line pull out into the junction? Not while a car on a priority road
   * is in the box or would reach it within GAP_S seconds.
   */
  private clearToEnter(v: Vehicle, node: number, e: REdge): boolean {
    if (this.junctionBusy(node, v)) return false;
    const myRank = this.net.rank(e);
    for (const eid of this.net.nodes[node].edges) {
      const o = this.net.edges[eid];
      if (o === e || this.net.rank(o) >= myRank) continue;
      // Cars on that edge heading into this node.
      const towards = o.b === node;
      for (let lane = 0; lane < o.lanes; lane++) {
        const l = this.laneIndex.get(laneKey(eid, towards, lane));
        if (!l?.length) continue;
        // The nearest to the node is the last in the sorted list.
        const c = l[l.length - 1];
        const dist = towards ? o.len - c.s : c.s;
        if (dist < 12 || dist < c.speed * GAP_S) return false;
      }
    }
    return true;
  }

  private junctionBusy(node: number, self: Vehicle): boolean {
    for (const o of this.boxIndex.get(node) ?? []) if (o !== self) return true;
    return false;
  }

  /**
   * Gap (m) to a car physically ahead in this car's path that the lane lists do not show. Of two
   * cars in each other's way the lower id goes first; after CROSS_PATIENCE s standing a car stops
   * looking (a cycle of three or more must not lock up).
   */
  private carAhead(v: Vehicle, lk: string): number {
    if (v.siren || v.jam > CROSS_PATIENCE) return Infinity;
    const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw);
    const reach = v.length + 6 + v.speed * 1.5;
    const cx = v.x + fx * reach * 0.5, cz = v.z + fz * reach * 0.5;
    const i0 = Math.floor((cx - reach) / 16), i1 = Math.floor((cx + reach) / 16), j0 = Math.floor((cz - reach) / 16), j1 = Math.floor((cz + reach) / 16);
    let best = Infinity;
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const l = this.cellIndex.get(cellKey(i, j));
      if (l) for (const o of l) {
        if (o === v || (o.turn ? o.turn.from === lk : o.edge === v.edge && o.fwd === v.fwd && o.lane === v.lane)) continue;
        if (Math.cos(o.yaw - v.yaw) < -0.3) continue;
        const g = pathGap(v, o);
        if (g >= best || (v.id < o.id && pathGap(o, v) < Infinity)) continue;
        best = g;
      }
    }
    return best;
  }

  private exitKey(v: Vehicle): string {
    const ne = this.net.edges[v.route.edges[v.ri + 1]];
    return laneKey(v.route.edges[v.ri + 1], v.route.fwd[v.ri + 1], ne ? Math.min(v.lane, ne.lanes - 1) : 0);
  }

  /** Free length (m) of a lane behind where cars come out of the junction. */
  private entryRoom(ei: number, fwd: boolean, lane: number, self: Vehicle): number {
    const e = this.net.edges[ei];
    const entry = junctionBack(e);
    let room = e.len - entry;
    const l = this.laneIndex.get(laneKey(ei, fwd, lane));
    if (l) for (const o of l) {
      if (o === self) continue;
      room = (fwd ? o.s : e.len - o.s) - o.length / 2 - entry;
      break;
    }
    const box = this.exitIndex.get(laneKey(ei, fwd, lane));
    if (box) for (const o of box) if (o !== self) room -= o.length + 2;
    return room;
  }

  /** Gap (m) ahead of a car in a junction box (see Scale's boxGap). */
  private boxGap(v: Vehicle): number {
    const T = v.turn!;
    const left = (1 - T.t) * T.len;
    let gap = Infinity;
    const ei = v.route.edges[v.ri + 1], ne = this.net.edges[ei];
    if (!ne) return gap;
    const k = this.exitKey(v);
    const l = this.laneIndex.get(k);
    if (l?.length) {
      const o = l[0], nf = v.route.fwd[v.ri + 1];
      gap = left + (nf ? o.s : ne.len - o.s) - junctionBack(ne) - (o.length + v.length) / 2;
    }
    for (const o of this.boxIndex.get(T.node) ?? []) {
      if (o === v || !o.turn) continue;
      if (this.exitKey(o) === k) {
        const oLeft = (1 - o.turn.t) * o.turn.len;
        if (oLeft < left || (oLeft === left && o.id < v.id)) gap = Math.min(gap, left - oLeft - (o.length + v.length) / 2);
        continue;
      }
      if (v.jam > BOX_PATIENCE) continue;
      const g = pathGap(v, o);
      if (g === Infinity) continue;
      const first = o.turn.enter < T.enter || (o.turn.enter === T.enter && o.id < v.id);
      if (first || pathGap(o, v) === Infinity) gap = Math.min(gap, g);
    }
    return gap;
  }

  /** Gap (m, from the front bumper) to the nearest obstacle (a person on the road) in the lane corridor ahead. */
  private obstacleAhead(v: Vehicle, look: number): number {
    if (!this.obstacles.length) return Infinity;
    const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw);
    const reach = look + v.length;
    let best = Infinity;
    for (const o of this.obstacles) {
      const dx = o.x - v.x, dz = o.z - v.z;
      if (dx > reach || dx < -reach || dz > reach || dz < -reach) continue;
      const along = dx * fx + dz * fz;
      if (along < -v.length * 0.25 || along > look + v.length / 2 + o.r) continue;
      if (Math.abs(dx * -fz + dz * fx) > v.width / 2 + o.r + 0.35) continue;
      best = Math.min(best, along - v.length / 2 - o.r - 0.6);
    }
    return best;
  }

  /** May a person step onto the road at (x, z)? Not while a car close by is coming towards them. */
  safeToCross(x: number, z: number): boolean {
    for (const v of this.near(x, z, 30)) {
      const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw);
      if ((x - v.x) * fx + (z - v.z) * fz > 0 && v.speed > 1.5) return false;
    }
    return true;
  }

  /** Safety net: cars of a lane never stay inside each other; the rear one is set back. */
  private resolveOverlaps(): void {
    for (const l of this.laneIndex.values()) {
      for (let i = l.length - 2; i >= 0; i--) {
        const a = l[i], b = l[i + 1];
        if (Math.abs(a.pull) > 0.5 || Math.abs(b.pull) > 0.5) continue;
        const e = this.net.edges[a.edge];
        const over = (a.length + b.length) / 2 + 0.3 - (a.fwd ? b.s - a.s : a.s - b.s);
        if (over <= 0.3) continue;
        a.s = a.fwd ? Math.max(0, a.s - over) : Math.min(e.len, a.s + over);
        a.speed = Math.min(a.speed, b.speed);
      }
    }
  }

  /** Is the spot of a (new) car free of other cars (r: extra clearance in m)? */
  private clearAt(v: Vehicle, r: number): boolean {
    for (const o of this.vehicles) {
      const R = (v.length + o.length) / 2 + r;
      if (Math.abs(o.x - v.x) < R && Math.abs(o.z - v.z) < R && Math.hypot(o.x - v.x, o.z - v.z) < R) return false;
    }
    return true;
  }

  /** A car pulling out waits for the cars coming along its lane. */
  private placeFree(v: Vehicle): boolean {
    for (const o of this.vehicles) {
      if (o === v || o.turn || o.edge !== v.edge || o.fwd !== v.fwd) continue;
      const d = v.fwd ? v.s - o.s : o.s - v.s; // o behind v: positive
      if (d > -(v.length + o.length) / 2 - 2 && d < (v.length + o.length) / 2 + 4 + o.speed * 3) return false;
    }
    return true;
  }

  /** May a bus pull out of a lay-by: nobody alongside in the lane, nothing moving up close behind? */
  private bayFree(v: Vehicle): boolean {
    for (const o of this.vehicles) {
      if (o === v || o.turn || o.edge !== v.edge || o.fwd !== v.fwd || (o.halted >= 0 && o.pull > 0.5)) continue;
      const d = v.fwd ? v.s - o.s : o.s - v.s; // o behind v: positive
      const L = (v.length + o.length) / 2;
      if (Math.abs(d) < L + 1 || (d > 0 && o.speed > 0.5 && d < L + 4 + o.speed * 3)) return false;
    }
    return true;
  }

  near(x: number, z: number, r: number): Vehicle[] {
    return this.vehicles.filter((v) => Math.hypot(v.x - x, v.z - z) < r + v.length / 2);
  }
}

const laneKey = (edge: number, fwd: boolean, lane: number) => `${edge}:${fwd ? 1 : 0}:${lane}`;

function push<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const l = m.get(k);
  if (l) l.push(v); else m.set(k, [v]);
}

/** Unit direction of travel along e (fwd: a → b) where it leaves its first node (end: arrives at its last). */
function travelDir(e: REdge, fwd: boolean, end: boolean): [number, number] {
  const p = e.pts, n = p.length;
  // The edge's last segment when arriving forwards or leaving backwards, else its first; a → b, turned for b → a.
  const i = end === fwd ? n - 4 : 0;
  const k = fwd ? 1 : -1, dx = (p[i + 2] - p[i]) * k, dz = (p[i + 3] - p[i + 1]) * k;
  const l = Math.hypot(dx, dz) || 1;
  return [dx / l, dz / l];
}

type CarBox = { x: number; z: number; yaw: number; length: number; width: number };

/** Gap (m, from the front bumper) from car a to car b when b is in a's way; Infinity otherwise. */
export function pathGap(a: CarBox & { speed: number }, b: CarBox): number {
  const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw);
  const dx = b.x - a.x, dz = b.z - a.z;
  const c = Math.abs(Math.cos(b.yaw - a.yaw)), s = Math.abs(Math.sin(b.yaw - a.yaw));
  const hAlong = (c * b.length) / 2 + (s * b.width) / 2, hLat = (s * b.length) / 2 + (c * b.width) / 2;
  const along = dx * fx + dz * fz;
  if (along <= 0 || along > a.length / 2 + hAlong + 3 + a.speed * 1.5) return Infinity;
  if (Math.abs(dx * -fz + dz * fx) > a.width / 2 + hLat + 0.2) return Infinity;
  return along - a.length / 2 - hAlong;
}

/** Distance from an edge end at which the junction box begins. */
export function junctionBack(e: REdge): number {
  return Math.min(e.len * 0.3, e.width * 0.55 + 2.5);
}

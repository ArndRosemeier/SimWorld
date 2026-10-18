/**
 * The traffic as the main thread sees it: the sim worker runs the town's traffic next to the world
 * (`TrafficFeed`: the world's car trips, rounds and visitors every game minute, the cars driven a little ahead
 * of the game clock) and sends, with every street update, where each moving vehicle is at a few
 * moments (`TrafficMsg`) and, when it changed, where the cars stand parked. The vehicle view places
 * the moving ones between those moments (`vehiclePose`), like the people on their tracks.
 *
 * New in SimWorld. Pure (no three.js): runs in the sim worker and in headless tests.
 */
import { hash32, smoothstep } from '@futuremagic/core';
import { VEHICLE_KINDS, paintColor } from '../build/vehicles';
import { sunPosition } from '../sim/calendar';
import type { Town } from '../plan/town';
import { PropType } from '../plan/cell';
import { Footprints } from '../plan/footprints';
import type { World } from '../sim/world';
import { rulesOf } from '../sim/politics';
import { dayOf } from '../sim/time';
import { TownTraffic } from './townTraffic';
import { carPlace, carTripsSince } from './trips';

/** Floats per vehicle and moment in `TrafficMsg.poses`: x, y, z, yaw. */
export const POSE_STRIDE = 4;
/** Ints per vehicle in `TrafficMsg.cars` and `parkedCars`: key, kind (index in VEHICLE_KINDS), variant. */
export const CAR_STRIDE = 3;
/** Floats per vehicle in `TrafficMsg.state`: headlights, brake, indicator (−1 left, +1 right, ±2 hazards, ±3 siren), engine running. */
export const STATE_STRIDE = 4;
/** Floats per parked car in `TrafficMsg.parked`: x, y, z, yaw, then its paint (sRGB). */
export const PARKED_STRIDE = 7;

/** The vehicles, as sent with a street update. */
export interface TrafficMsg {
  /** The moments (game clock minutes, ascending) the poses are for. */
  times: Float64Array;
  /** Moving vehicles: their cars (CAR_STRIDE each) … */
  cars: Int32Array;
  /** … each one's pose at every moment (vehicle-major: times.length × POSE_STRIDE floats per vehicle) … */
  poses: Float32Array;
  /** … its lights now (STATE_STRIDE) … */
  state: Float32Array;
  /** … and its paint (sRGB, 3 each). */
  paint: Float32Array;
  /** Parked cars, when they changed since the last message (else null): PARKED_STRIDE each, and their cars. */
  parked: Float32Array | null;
  parkedCars: Int32Array | null;
}

/** Moments recorded per update (the stretch the cars are run ahead is cut into this many steps). */
const SAMPLES = 5;
/** Longest step the cars are run in (s). */
const MAX_STEP = 0.25;
/** The cars run ahead of the game clock by this many update gaps (so the view never runs out of poses). */
const AHEAD = 2;
/** Minutes a car takes to drive out of town (a trip to the region under way longer than this is gone at load). */
const OUT_OF_TOWN = 5;
/** Rounds that came on to the map this long before the town was loaded (min) still start. */
const LATE = 30;
/** Visitors who came this long before the town was loaded (min) may still be in town. */
const STAYS = 240;

/** The town's traffic driven by a world, recorded for the view (the sim worker's). */
export class TrafficFeed {
  readonly town: TownTraffic;
  /** The game clock (minutes) at Traffic time 0. */
  private readonly t0: number;
  /** The world clock whose trips and rounds were handed over last. */
  private fed: number;
  /** The game clock of the last update. */
  private last: number;
  /** Recorded moments: game clock minutes and every vehicle's pose then (by vehicle id). */
  private readonly hist: { t: number; poses: Map<number, [number, number, number, number]> }[] = [];
  private parkedSig = -1;
  /**
   * The cars standing in the kerbside bays as footprints (src/plan/footprints.ts: three circles each, kind
   * `PropType.KerbCar`), for whoever must keep clear of them (people on foot); remade when they change.
   */
  standing = new Footprints();

  /** `step`: the longest step the cars are run in (s; coarser in tests). */
  constructor(town: Town, private readonly world: World, private readonly step = MAX_STEP) {
    this.town = new TownTraffic(town, world.graph.places, world.seed, world);
    // The trips under way when the town is loaded set off now, from where they began (a few minutes late), so the
    // roads are not empty at the start; every other car stands where `carPlace` says (out of town: on its way to the
    // region for longer than it takes to leave town).
    const under = carTripsSince(world, -Infinity).filter((t) => t.toRegion === null || t.depart > world.clock - OUT_OF_TOWN);
    const from = new Map(under.filter((t) => t.fromRegion === null).map((t) => [t.household, t.from]));
    this.town.placeCars(world.households, (h) => from.get(h) ?? carPlace(world, h));
    this.t0 = world.clock;
    this.town.obey(rulesOf(world), dayOf(world.clock));
    this.fed = this.last = world.clock;
    this.town.anchor(world.clock);
    this.town.trips(under, world.clock);
    // The rounds that came on to the map in the last half hour too (the buses and vans already in town).
    this.town.rounds(world, world.clock - LATE, world.clock);
    // The visitors in town now (the longest stay is four hours): parked, or on their way in.
    this.town.visitors(world, world.clock - STAYS, world.clock);
    this.record();
  }

  /** Game clock minutes at Traffic time `t` (s). */
  private clockAt(t: number): number {
    return this.t0 + t / 60;
  }

  /**
   * Catch up with the world (ticked to the whole minute of `clock`): the new game minutes' car
   * trips, rounds and visitors, then the cars run to a little past `clock`, recording where they are.
   */
  run(clock: number): void {
    const w = this.world;
    if (w.clock > this.fed) {
      this.town.obey(rulesOf(w), dayOf(w.clock));
      this.town.trips(carTripsSince(w, this.fed), w.clock);
      this.town.rounds(w, this.fed, w.clock);
      this.town.visitors(w, this.fed, w.clock);
      this.fed = w.clock;
    }
    const sun = sunPosition(w, clock).elevation;
    this.town.traffic.daylight = smoothstep(-0.1, 0.05, sun);
    const gap = Math.max(0.2, (clock - this.last) * 60);
    this.last = clock;
    const target = (clock - this.t0) * 60 + Math.min(60, gap * AHEAD);
    const span = target - this.town.traffic.time;
    if (span > 0) {
      const n = Math.max(1, Math.ceil(span / this.step / SAMPLES)) * SAMPLES, dt = span / n;
      for (let k = 1; k <= n; k++) {
        this.town.update(dt);
        if (k % (n / SAMPLES) === 0) this.record();
      }
    }
    // Keep the moments from the last one before `clock` on.
    let keep = 0;
    while (keep + 1 < this.hist.length && this.hist[keep + 1].t <= clock) keep++;
    this.hist.splice(0, keep);
  }

  private record(): void {
    const poses = new Map<number, [number, number, number, number]>();
    for (const v of this.town.traffic.vehicles) poses.set(v.id, [v.x, v.y, v.z, v.yaw]);
    this.hist.push({ t: this.clockAt(this.town.traffic.time), poses });
  }

  /** What the view needs now: every vehicle on the road at the recorded moments, and the parked cars when they changed. */
  message(): TrafficMsg {
    const vs = this.town.traffic.vehicles, K = this.hist.length;
    const times = Float64Array.from(this.hist, (h) => h.t);
    const cars = new Int32Array(vs.length * CAR_STRIDE), poses = new Float32Array(vs.length * K * POSE_STRIDE), state = new Float32Array(vs.length * STATE_STRIDE), paint = new Float32Array(vs.length * 3);
    vs.forEach((v, i) => {
      cars.set([v.car.key, VEHICLE_KINDS.indexOf(v.car.kind), v.car.variant], i * CAR_STRIDE);
      // Before it came on the road it stands where it first was (pulling out of its bay).
      let p = this.hist.find((h) => h.poses.has(v.id))?.poses.get(v.id) ?? [v.x, v.y, v.z, v.yaw];
      for (let k = 0; k < K; k++) {
        p = this.hist[k].poses.get(v.id) ?? p;
        poses.set(p, (i * K + k) * POSE_STRIDE);
      }
      state.set([v.headlights, v.brake, v.indicator, 1], i * STATE_STRIDE);
      paint.set(paintColor(v.car.kind, v.car.key), i * 3);
    });
    const spots = [...this.town.parking.occupied()];
    let sig = spots.length;
    for (const s of spots) sig ^= hash32(s.id * 65599 + s.car);
    let parked: Float32Array | null = null, parkedCars: Int32Array | null = null;
    if (sig !== this.parkedSig) {
      this.parkedSig = sig;
      this.standing = new Footprints();
      for (const s of spots) for (const d of [-1.4, 0, 1.4]) this.standing.circle(s.x + Math.sin(s.yaw) * d, s.z + Math.cos(s.yaw) * d, 1.0, PropType.KerbCar);
      parked = new Float32Array(spots.length * PARKED_STRIDE);
      parkedCars = new Int32Array(spots.length * CAR_STRIDE);
      spots.forEach((s, i) => {
        const car = this.town.carOf(s.car);
        parked!.set([s.x, s.y, s.z, s.yaw, ...paintColor(car.kind, car.key)], i * PARKED_STRIDE);
        parkedCars!.set([car.key, VEHICLE_KINDS.indexOf(car.kind), car.variant], i * CAR_STRIDE);
      });
    }
    return { times, cars, poses, state, paint, parked, parkedCars };
  }
}

/** The buffers of a message, to transfer. */
export const trafficTransfers = (m: TrafficMsg): ArrayBuffer[] =>
  [m.times, m.cars, m.poses, m.state, m.paint, ...(m.parked ? [m.parked, m.parkedCars!] : [])].map((a) => a.buffer as ArrayBuffer);

/** Moving vehicle `i`'s pose at game clock `clock`, between the recorded moments (held at the ends), into `out` (x, y, z, yaw). */
export function vehiclePose(m: TrafficMsg, i: number, clock: number, out: Float32Array | number[], o = 0): void {
  const T = m.times, K = T.length, P = m.poses, base = i * K * POSE_STRIDE;
  let k = 0;
  while (k + 1 < K && T[k + 1] <= clock) k++;
  const a = base + k * POSE_STRIDE, b = k + 1 < K ? a + POSE_STRIDE : a;
  const f = b === a ? 0 : Math.min(1, Math.max(0, (clock - T[k]) / (T[k + 1] - T[k])));
  for (let c = 0; c < 3; c++) out[o + c] = P[a + c] + (P[b + c] - P[a + c]) * f;
  let dy = P[b + 3] - P[a + 3];
  dy -= Math.round(dy / (2 * Math.PI)) * 2 * Math.PI;
  out[o + 3] = P[a + 3] + dy * f;
}

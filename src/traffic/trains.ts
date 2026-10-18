/**
 * The trains on the railway past the town, as the timetable runs them (src/sim/transit.ts): a
 * train for each run, coming along the line, standing at the station for its minute, and going on
 * towards the town its line leads to. Every train passes the station (a train to the city came
 * from the other end of a through line; on a branch line it waits at the platform before it
 * leaves and after it comes in). Where it is follows from the clock alone: up to speed and down
 * again at a steady rate, at line speed between. Trains keep to the right-hand track.
 *
 * Also the level crossings: closed from a little before a train reaches one until it is past.
 *
 * New in SimWorld. Pure (no three.js): runs in the sim worker beside the road traffic.
 */
import { deriveSeed, hash32 } from '@futuremagic/core';
import { closestOnPolyline, resample } from '../geom/geom2';
import { RAIL_TRACK, railSurface } from '../build/rural';
import { drawnGround } from '../build/drawnGround';
import type { Town } from '../plan/town';
import type { Railway } from '../plan/types';
import { RAIL_HW } from '../plan/rail';
import { COMPASS, regionPlaces } from '../sim/region';
import { DWELL, runsOnDay, transitOf, type Run } from '../sim/transit';
import { MINUTES_PER_DAY, dayOf } from '../sim/time';
import type { World } from '../sim/world';

/** Keys of train cars start here (eight per run). */
export const TRAIN_KEY = 1 << 28;
/** Is this vehicle key a train car's? */
export const isTrainKey = (key: number): boolean => key >= TRAIN_KEY && key < TRAIN_KEY + (1 << 23);
/** Length of a train car over its couplings (m), and its bogie centres from its middle. */
export const TRAIN_CAR = 20.5, BOGIE = 7;
/** Line speed (m/s, 120 km/h), and how fast a train speeds up and slows down (m/s²). */
const VMAX = 120 / 3.6, ACC = 0.7;
/** Minutes a train waits at the platform at the end of a branch line, before leaving and after coming in. */
const LAYOVER = 4;
/** A crossing closes this many seconds before a train reaches it (at least CLOSE_M ahead), and opens when it is CLEAR_M past. */
const CLOSE_S = 28, CLOSE_M = 60, CLEAR_M = 12;
/** Cars stop this far before the track bed at a closed crossing (m). */
const STOP_M = 3;
/** A barrier post stands this far off the road's edge; its arm stops this short of the road's middle (m). */
const POST_OUT = 0.8, ARM_SHORT = 0.3;
/** A barrier post stands this far down in the ground (no gap under it on a slope). */
const POST_SINK = 0.05;

/**
 * A level-crossing barrier post: where it stands (x, y, z), which way its arm points when down (yaw: the arm along
 * the model's −Z, the cars it stops coming along +X towards the railway) and the arm's length.
 */
export interface CrossingPost { x: number; y: number; z: number; yaw: number; arm: number }

/** One car of a train at a moment: its key, model (0 a cab car, 1 a middle car), pose and brakes. */
/** A train car at a moment: where (on its bogies' rail heights), facing yaw, pitched (nose up +) along a gradient. */
export interface TrainCar { key: number; variant: number; x: number; y: number; z: number; yaw: number; pitch: number; brake: number }

/** A train at a moment: the arc length of its middle along the line, which way it goes (±1), its speed (m/s). */
interface TrainAt { run: Run; s: number; dir: number; speed: number; brake: number; cars: number }

export class Trains {
  /** The line (5 m points), its arc lengths and length. */
  private readonly pts: number[];
  private readonly cum: number[] = [0];
  readonly length: number;
  /** Arc length of the station's platform. */
  readonly station: number;
  /**
   * The level crossings: arc length along the line, where the road crosses, and the road's stop lines each side
   * (discs across the road, facing the railway: `Traffic.barriers` while it is closed).
   */
  readonly crossings: { s: number; x: number; z: number; road: number; stops: { x: number; z: number; r: number; fx: number; fz: number }[]; posts: CrossingPost[] }[];
  private readonly height: (s: number) => number;
  /** Which end of the line (-1: s = 0, +1: s = length) a line's trains leave by, by line id; 0 where none. */
  private readonly ends = new Map<number, number>();
  private readonly runs: Run[];
  /** A branch line: it ends at the station. */
  private readonly branch: boolean;

  constructor(private readonly world: World, town: Town) {
    const rail = town.macro.rail as Railway;
    this.pts = resample(rail.pts, 5);
    for (let i = 2; i < this.pts.length; i += 2) this.cum.push(this.cum[this.cum.length - 1] + Math.hypot(this.pts[i] - this.pts[i - 2], this.pts[i + 1] - this.pts[i - 1]));
    this.length = this.cum[this.cum.length - 1];
    this.station = closestOnPolyline(this.pts, rail.sx, rail.sz).s;
    this.height = railSurface(rail, town.terrain);
    this.crossings = town.rural.crossings.map((c) => {
      const q = closestOnPolyline(this.pts, c.x, c.z), R = town.rural.roads[c.road], P = R.pts, k = closestOnPolyline(P, c.x, c.z).seg * 2;
      const l = Math.hypot(P[k + 2] - P[k], P[k + 3] - P[k + 1]) || 1, dx = (P[k + 2] - P[k]) / l, dz = (P[k + 3] - P[k + 1]) / l;
      const j = q.seg * 2, ll = Math.hypot(this.pts[j + 2] - this.pts[j], this.pts[j + 3] - this.pts[j + 1]) || 1;
      // (An oblique crossing is longer along the road.)
      const sin = Math.abs((dx * (this.pts[j + 3] - this.pts[j + 1]) - dz * (this.pts[j + 2] - this.pts[j])) / ll);
      const d = (RAIL_HW + STOP_M) / Math.max(0.35, sin);
      const stops = [1, -1].map((side) => ({ x: c.x + side * dx * d, z: c.z + side * dz * d, r: R.hw, fx: -side * dx, fz: -side * dz }));
      // A barrier post at each stop line on the kerb to the right of the cars coming up to it, its arm across their side
      // of the road (to the middle).
      const ground = drawnGround(town);
      const posts = stops.map((st) => {
        const rx = -st.fz, rz = st.fx, out = R.hw + POST_OUT;
        const x = st.x + rx * out, z = st.z + rz * out;
        return { x, y: ground.heightAt(x, z) - POST_SINK, z, yaw: Math.atan2(rx, rz), arm: out - ARM_SHORT };
      });
      return { s: q.s, x: c.x, z: c.z, road: c.road, stops, posts };
    });
    const T = transitOf(world);
    const places = regionPlaces(world);
    // A branch line has one end: the far one (the line runs from the edge of the world to the station).
    this.branch = rail.terminus;
    const far = this.station > this.length / 2 ? -1 : 1;
    for (const line of T.lines) {
      if (line.mode !== 'train') continue;
      if (this.branch) { this.ends.set(line.id, far); continue; }
      // The end in the direction of the town the line leads to (its compass bearing from the station).
      const to = T.runs.find((r) => r.line === line.id)?.stops.map((i) => T.stops[i]).find((st) => st.region);
      const place = places.find((p) => p.name === to?.region);
      const bearing = ((place ? COMPASS.indexOf(place.dir) : 0) * 45 * Math.PI) / 180;
      const want = [Math.sin(bearing), -Math.cos(bearing)];
      const n = this.pts.length;
      const toward = (x: number, z: number) => (x - rail.sx) * want[0] + (z - rail.sz) * want[1];
      this.ends.set(line.id, toward(this.pts[n - 2], this.pts[n - 1]) >= toward(this.pts[0], this.pts[1]) ? 1 : -1);
    }
    this.runs = T.runs.filter((r) => this.ends.has(r.line));
  }

  /** Every train on the line at game clock `clock` (minutes). */
  private under(clock: number): TrainAt[] {
    const out: TrainAt[] = [];
    const T = transitOf(this.world), day0 = dayOf(clock) * MINUTES_PER_DAY;
    for (const run of this.runs) {
      const end = this.ends.get(run.line)!, branch = this.branch;
      const outbound = T.stops[run.stops[0]].place >= 0;
      for (const day of [day0, day0 - MINUTES_PER_DAY]) {
        // At the station from `arrive` to `leave` (clock minutes).
        const atStation = day + (outbound ? run.times[0] : run.times[run.times.length - 1]);
        let arrive = outbound ? atStation - DWELL : atStation, leave = outbound ? atStation : atStation + DWELL;
        if (branch) { if (outbound) arrive -= LAYOVER; else leave += LAYOVER; }
        // Off the line long before or after (a few kilometres at line speed either side).
        if (clock < arrive - 15 || clock > leave + 15 || !runsOnDay(this.world, run, day)) continue;
        // Comes in from the other end (outbound) or from its own (inbound); goes on to its own end or the other.
        const dirOut = outbound ? end : -end, dirIn = outbound ? -end : end;
        const cars = 2 + (hash32(deriveSeed(run.id, 'cars')) % 3);
        let s: number, dir: number, speed: number, brake = 0;
        if (clock < arrive) {
          // Coming in: it would come from the branch's end of the world only if there were one (a branch train appears at the platform).
          if (branch && outbound) continue;
          const [d, v] = run1((arrive - clock) * 60);
          s = this.station + dirIn * d; dir = -dirIn; speed = v; brake = v < VMAX - 0.1 ? 0.7 : 0;
        } else if (clock <= leave) {
          s = this.station; dir = outbound ? dirOut : -dirIn; speed = 0; brake = 1;
        } else {
          if (branch && !outbound) continue;
          const [d, v] = run1((clock - leave) * 60);
          s = this.station + dirOut * d; dir = dirOut; speed = v;
        }
        // On the map (the whole train).
        const half = (cars * TRAIN_CAR) / 2;
        if (s - half < 0 || s + half > this.length) continue;
        out.push({ run, s, dir, speed, brake, cars });
      }
    }
    return out;
  }

  /** Every car of every train on the line at game clock `clock`. */
  cars(clock: number): TrainCar[] {
    const out: TrainCar[] = [];
    for (const t of this.under(clock)) {
      for (let k = 0; k < t.cars; k++) {
        // Car 0 leads; the last one is a cab car facing back.
        const sc = t.s + t.dir * TRAIN_CAR * ((t.cars - 1) / 2 - k);
        const [fx, fz, fy] = this.trackPoint(sc + t.dir * BOGIE, t.dir), [bx, bz, by] = this.trackPoint(sc - t.dir * BOGIE, t.dir);
        let yaw = Math.atan2(-(fx - bx), -(fz - bz));
        const cab = k === 0 || k === t.cars - 1;
        let pitch = Math.atan2(fy - by, Math.hypot(fx - bx, fz - bz) || 1);
        if (k === t.cars - 1 && k > 0) { yaw += Math.PI; pitch = -pitch; }
        out.push({ key: TRAIN_KEY + (t.run.id % (1 << 20)) * 8 + k, variant: cab ? 0 : 1, x: (fx + bx) / 2, y: (fy + by) / 2, z: (fz + bz) / 2, yaw, pitch, brake: t.brake });
      }
    }
    return out;
  }

  /** Is level crossing `i` closed at game clock `clock` (a train near, coming, or on it)? */
  closed(clock: number): boolean[] {
    const trains = this.under(clock);
    return this.crossings.map((c) => trains.some((t) => {
      const half = (t.cars * TRAIN_CAR) / 2;
      // How far ahead of the train's front the crossing is (negative: behind it).
      const ahead = (c.s - t.s) * t.dir - half;
      return ahead > -2 * half - CLEAR_M && ahead < Math.max(CLOSE_M, t.speed * CLOSE_S);
    }));
  }

  /** The right-hand track's centre at arc length s for a train going `dir`: x, z, rail-head height. */
  private trackPoint(s: number, dir: number): [number, number, number] {
    s = Math.max(0, Math.min(this.length, s));
    let i = 0, lo = 0, hi = this.cum.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.cum[m] <= s) lo = m; else hi = m; }
    i = lo;
    const P = this.pts, L = this.cum[i + 1] - this.cum[i] || 1, f = (s - this.cum[i]) / L;
    const dx = (P[i * 2 + 2] - P[i * 2]) / L, dz = (P[i * 2 + 3] - P[i * 2 + 1]) / L;
    // Travel direction, and its right (x east, z south: right of (fx, fz) is (−fz, fx)).
    const fx = dx * dir, fz = dz * dir;
    return [P[i * 2] + dx * L * f - fz * RAIL_TRACK, P[i * 2 + 1] + dz * L * f + fx * RAIL_TRACK, this.height(s)];
  }
}

/** Distance (m) and speed (m/s) `t` seconds after leaving a stand (or before reaching one): speeding up, then line speed. */
function run1(t: number): [number, number] {
  const tUp = VMAX / ACC;
  return t < tUp ? [0.5 * ACC * t * t, ACC * t] : [0.5 * ACC * tUp * tUp + VMAX * (t - tUp), VMAX];
}

/**
 * The street's traffic sounds, heard where the camera is: a car rushing past, a bus's brakes
 * hissing as it pulls up, the siren of a police car or an ambulance on a call, a horn from a driver
 * kept waiting, an engine ticking over beside the listener. Once a frame from the vehicles of the
 * latest street update (`TrafficMsg`, src/traffic/feed.ts), placed between their recorded moments
 * like the view places them; every sound through the town's audio (`TownAudio.play` / `.loop`).
 * The trains' sounds are the rail view's (src/render/railView.ts).
 *
 * New in SimWorld. Pure (no three.js, no Web Audio: the audio is handed in), so tests can listen.
 */
import { VEHICLE_KINDS } from '../build/vehicles';
import { CAR_STRIDE, HORN_STRIDE, STATE_STRIDE, vehiclePose, type TrafficMsg } from './feed';
import { isTrainKey } from './trains';

/** What the street sounds play through (`TownAudio`). */
export interface StreetAudio {
  play(id: string, x: number, y: number, z: number, gain?: number, pitch?: number, refDist?: number): void;
  loop(id: string, refDist?: number): { set(x: number, y: number, z: number, gain: number, rate?: number): void; stop(): void } | null;
}
type Loop = NonNullable<ReturnType<StreetAudio['loop']>>;

/** A vehicle passes the listener within PASS_AT (m) going at least PASS_SPEED (m/s); again once it was PASS_RESET away. */
const PASS_AT = 18, PASS_SPEED = 5, PASS_RESET = 35;
/** At most one rush past per this many seconds (a stream of cars on a main road is not a wall of noise). */
const PASS_GAP = 0.35;
/** Sirens are heard this far (m); horns this far. */
const SIREN_AT = 600, HORN_AT = 250;
/** A bus pulling up within this distance (m) hisses its brakes. */
const BRAKES_AT = 80;
/** An engine standing (a car at the lights, a bus at its stop) is heard ticking over this near (m). */
const IDLE_AT = 14;
/** The speed is measured over this stretch of game time (min: half a second). */
const SPEED_SPAN = 0.5 / 60;
/** Horns more than this late (min) are dropped (the street update came late). */
const HORN_LATE = 0.2;
const BUS = VEHICLE_KINDS.indexOf('bus'), SHUTTLE = VEHICLE_KINDS.indexOf('shuttle');

export class StreetSounds {
  private msg: TrafficMsg | null = null;
  /** Horns to come (HORN_STRIDE each), in the order sounded. */
  private horns: number[] = [];
  /** Vehicles (by key) that have rushed past and not yet gone away again; buses standing (their brakes hissed). */
  private readonly passed = new Set<number>();
  private readonly stood = new Set<number>();
  private sirens = new Map<number, Loop>();
  private idle: Loop | null = null;
  private time = 0;
  private lastPass = -Infinity;
  private readonly p = new Float32Array(4);
  private readonly q = new Float32Array(4);

  /** Once a frame (`dt` real seconds), with the listener at (x, y, z) and the game clock. */
  listen(dt: number, x: number, y: number, z: number, clock: number, m: TrafficMsg | null, audio: StreetAudio): void {
    this.time += dt;
    if (m !== this.msg) {
      this.msg = m;
      for (const h of m?.horns ?? []) this.horns.push(h);
    }
    this.sound(x, y, z, clock, audio);
    // The horns whose moment has come.
    let k = 0;
    for (; k < this.horns.length; k += HORN_STRIDE) {
      const [t, hx, hy, hz, long] = this.horns.slice(k, k + HORN_STRIDE);
      if (t > clock) break;
      if (clock - t < HORN_LATE && Math.hypot(hx - x, hy - y, hz - z) < HORN_AT) audio.play(long ? 'car_horn_long' : 'car_horn_short', hx, hy, hz, 1, 1, 12);
    }
    this.horns.splice(0, k);
  }

  private sound(x: number, y: number, z: number, clock: number, audio: StreetAudio): void {
    const m = this.msg;
    const n = m ? m.cars.length / CAR_STRIDE : 0, p = this.p, q = this.q;
    const sirens = new Map<number, Loop>(), here = new Set<number>();
    let idle: { d: number; x: number; y: number; z: number } | null = null;
    for (let i = 0; i < n; i++) {
      const key = m!.cars[i * CAR_STRIDE];
      if (isTrainKey(key)) continue;
      here.add(key);
      vehiclePose(m!, i, clock, p);
      vehiclePose(m!, i, clock - SPEED_SPAN, q);
      const speed = Math.hypot(p[0] - q[0], p[2] - q[2]) / (SPEED_SPAN * 60);
      const d = Math.hypot(p[0] - x, p[1] - y, p[2] - z);
      const kind = m!.cars[i * CAR_STRIDE + 1], ind = m!.state[i * STATE_STRIDE + 2];
      // A rush past, pitched a little by the car (and up with its speed).
      if (d < PASS_AT && speed > PASS_SPEED && !this.passed.has(key) && this.time - this.lastPass > PASS_GAP) {
        this.passed.add(key);
        this.lastPass = this.time;
        audio.play('car_passby', p[0], p[1] + 0.5, p[2], Math.min(1, speed / 14), 0.9 + (key % 7) * 0.03 + speed / 200, 8);
      } else if (d > PASS_RESET) this.passed.delete(key);
      // A bus coming to a stop hisses its brakes.
      if ((kind === BUS || kind === SHUTTLE) && speed < 0.3) {
        if (!this.stood.has(key) && d < BRAKES_AT) audio.play('bus_airbrake', p[0], p[1] + 0.5, p[2], 1, 1, 10);
        this.stood.add(key);
      } else if (speed > 2) this.stood.delete(key);
      // Sirens while on the way to a call.
      if (ind === 3 && d < SIREN_AT) {
        const l = this.sirens.get(key) ?? audio.loop('ambulance_siren', 40);
        if (l) {
          l.set(p[0], p[1] + 1.5, p[2], 1, 1);
          sirens.set(key, l);
        }
      }
      if (speed < 0.3 && d < IDLE_AT && (!idle || d < idle.d)) idle = { d, x: p[0], y: p[1] + 0.4, z: p[2] };
    }
    for (const [key, l] of this.sirens) if (!sirens.has(key)) l.stop();
    this.sirens = sirens;
    for (const key of this.passed) if (!here.has(key)) this.passed.delete(key);
    for (const key of this.stood) if (!here.has(key)) this.stood.delete(key);
    // The nearest standing engine ticks over.
    if (idle) {
      this.idle ??= audio.loop('car_idle', 4);
      this.idle?.set(idle.x, idle.y, idle.z, 0.8);
    } else if (this.idle) {
      this.idle.stop();
      this.idle = null;
    }
  }
}

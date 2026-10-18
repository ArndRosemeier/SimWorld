/**
 * The main thread's side of the sim worker (src/workers/sim.worker.ts): the game clock, and the street around
 * the camera as the worker reports it: who is out of doors there and the track each walks (src/street).
 *
 * Game time is real time (D3): one game minute per real minute, times `rate` (1 in play; more for a look at
 * a day in fast motion, `?speed=`). The clock runs here; the worker is asked a few times a second to catch up
 * and to say what changed on the street.
 */
import { WorkerPool } from '../workers/pool';
import simWorkerUrl from '../workers/sim.worker.ts?worker&url';
import type { ActorInfo, FromSim, HeightGrid, ToSim } from '../workers/simProtocol';
import type { TownSettings } from '../world/settings';
import { sample } from '../street/tracks';

/** Real milliseconds between street updates (the plan's L1 rate, ~5 Hz). */
const UPDATE_MS = 200;
/** How far around the camera the worker reports people (m). */
export const STREET_RADIUS = 260;

/** Someone out of doors near the camera. */
export interface Walker {
  readonly id: number;
  info: ActorInfo;
  keys: Float64Array;
  hideAfter: number;
  activity: number;
  doing: string;
}

export class SimClient {
  /** People out of doors around the camera, by actor id. */
  readonly walkers = new Map<number, Walker>();
  /** Clock (game minutes) at real time `base`. */
  private clock0 = 0;
  private base = 0;
  private busy = false;
  private last = 0;
  private readonly infos = new Map<number, ActorInfo>();

  private constructor(private readonly pool: WorkerPool<ToSim, FromSim>, readonly rate: number, readonly ground: HeightGrid, readonly people: number) {}

  /** Start the worker: it plans the town, makes the world and runs it to `clock`. */
  static async start(settings: TownSettings, clock: number, rate: number): Promise<SimClient> {
    const pool = new WorkerPool<ToSim, FromSim>(simWorkerUrl, 1);
    const [ready] = await pool.start(() => ({ type: 'init', settings, clock }));
    if (ready.type !== 'ready') throw new Error(ready.type === 'error' ? ready.message : 'the sim worker did not start');
    const c = new SimClient(pool, rate, ready.ground, ready.people);
    c.clock0 = ready.clock;
    c.base = performance.now();
    return c;
  }

  /** The game clock now (game minutes since day 0, fractional). */
  get clock(): number {
    return this.clock0 + ((performance.now() - this.base) / 60000) * this.rate;
  }

  /** Ground height (sidewalk level) at (x, z), bilinear from the worker's grid. */
  groundAt(x: number, z: number): number {
    const g = this.ground;
    const fx = Math.min(g.n - 1.001, Math.max(0, (x - g.x0) / g.step)), fz = Math.min(g.n - 1.001, Math.max(0, (z - g.z0) / g.step));
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const h = g.h, n = g.n;
    return (h[j * n + i] * (1 - u) + h[j * n + i + 1] * u) * (1 - v) + (h[(j + 1) * n + i] * (1 - u) + h[(j + 1) * n + i + 1] * u) * v;
  }

  /** Where a walker is at `clock` (x, y, z), into `out`. */
  where(w: Walker, clock: number, out: [number, number, number]): [number, number, number] {
    return sample(w.keys, clock, out);
  }

  /** Call every frame: asks the worker for the street around (x, z) when the last answer is old enough. */
  update(x: number, z: number): void {
    const now = performance.now();
    if (this.busy || now - this.last < UPDATE_MS) return;
    this.busy = true;
    this.last = now;
    this.pool.run<Extract<FromSim, { type: 'street' }>>({ type: 'update', clock: this.clock, x, z, r: STREET_RADIUS }, 0).then((m) => {
      for (const i of m.info) this.infos.set(i.id, i);
      for (const id of m.gone) this.walkers.delete(id);
      for (const t of m.tracks) {
        const info = this.infos.get(t.id);
        if (!info) continue;
        const w = this.walkers.get(t.id);
        if (w) Object.assign(w, { keys: t.keys, hideAfter: t.hideAfter, activity: t.activity, doing: t.doing });
        else this.walkers.set(t.id, { id: t.id, info, keys: t.keys, hideAfter: t.hideAfter, activity: t.activity, doing: t.doing });
      }
    }).catch((e) => console.error('sim worker', e)).finally(() => { this.busy = false; });
  }
}

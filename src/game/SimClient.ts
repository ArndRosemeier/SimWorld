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
import type { CivilDate } from '../sim/calendar';
import type { SimView, TownFace } from '../sim/view';
import type { TownSettings } from '../world/settings';
import { sample } from '../street/tracks';

/** Real milliseconds between street updates (the plan's L1 rate, ~5 Hz). */
const UPDATE_MS = 200;
/** How far around the camera the worker reports people (m). */
export const STREET_RADIUS = 260;

/**
 * When play begins: today (the real date; the calendar puts its week on the clock, day 0 its Monday), today's
 * weekday as the game day, at `time` ("HH:MM") or else the time of day now. The game is where the wall clock
 * enters (plan, "town realism"); the sim only ever gets these numbers.
 */
export function playStart(time: string | null): { start: CivilDate; startDay: number; clock: number } {
  const now = new Date();
  const startDay = (now.getDay() + 6) % 7;
  const m = time && /^\d{1,2}:\d{2}$/.test(time) ? Number(time.split(':')[0]) * 60 + Number(time.split(':')[1]) : now.getHours() * 60 + now.getMinutes();
  // The world is made at 06:00 of its first day; earlier times are the next morning.
  return { start: { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() }, startDay, clock: startDay * 1440 + (m >= 360 ? m : m + 1440) };
}

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

  private constructor(private readonly pool: WorkerPool<ToSim, FromSim>, readonly rate: number, readonly ground: HeightGrid, readonly people: number, view: SimView) {
    this.view = view;
    this.town = view.town!;
  }

  /** The sim's latest view snapshot (src/sim/view.ts): every view reads the sim from here. */
  view: SimView;
  /** The town's face as of today (the latest `view.town`): what each place is now, its looks, the council's rules. */
  town: TownFace;

  /**
   * Start the worker: it plans the town, makes the world (play beginning on the real date `start`, game day
   * `startDay`) and runs it to `clock`.
   */
  static async boot(settings: TownSettings, start: CivilDate, startDay: number, clock: number, rate: number): Promise<SimClient> {
    const pool = new WorkerPool<ToSim, FromSim>(simWorkerUrl, 1);
    const [ready] = await pool.start(() => ({ type: 'init', settings, start, startDay, clock }));
    if (ready.type !== 'ready') throw new Error(ready.type === 'error' ? ready.message : 'the sim worker did not start');
    const c = new SimClient(pool, rate, ready.ground, ready.people, ready.view);
    c.clock0 = ready.clock;
    c.base = performance.now();
    return c;
  }

  /** The game clock now (game minutes since day 0, fractional). */
  get clock(): number {
    return this.clock0 + ((performance.now() - this.base) / 60000) * this.rate;
  }

  /** Ground height (sidewalk level) at (x, z), bilinear from the worker's grid. */
  standHeight(x: number, z: number): number {
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
  poll(x: number, z: number): void {
    const now = performance.now();
    if (this.busy || now - this.last < UPDATE_MS) return;
    this.busy = true;
    this.last = now;
    this.pool.run<Extract<FromSim, { type: 'street' }>>({ type: 'update', clock: this.clock, x, z, r: STREET_RADIUS }, 0).then((m) => {
      if (m.view) { this.view = m.view; if (m.view.town) this.town = m.view.town; }
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

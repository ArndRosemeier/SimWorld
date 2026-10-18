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
import type { ActorInfo, FromSim, HeightGrid, PlayerOp, PlayerReply, ToSim } from '../workers/simProtocol';
import type { PlayerStatus } from '../sim/player';
import type { ChatRequest, ChatResponse } from '../chat/ops';
import { DEFAULT_LATITUDE, daysOf, epochFor, weekdayOfDays, type CivilDate } from '../sim/calendar';
import type { SimView, TownFace } from '../sim/view';
import type { TrafficMsg } from '../traffic/feed';
import type { WindowSlots } from '../street/windows';
import type { TownSettings } from '../world/settings';
import { sample } from '../street/tracks';
import { dropSave, readSave, storeSave } from '../persist/saves';

/** Real milliseconds between street updates (the plan's L1 rate, ~5 Hz). */
const UPDATE_MS = 200;
/** Real milliseconds between autosaves. */
const AUTOSAVE_MS = 5 * 60_000;
/** How far around the camera the worker reports people (m). */
export const STREET_RADIUS = 260;

/**
 * When play begins: today (the real date; the calendar puts its week on the clock, day 0 its Monday), today's
 * weekday as the game day, at `time` ("HH:MM") or else the time of day now. `date` ("YYYY-MM-DD") starts on
 * another day instead, for a look at another season. The game is where the wall clock enters (plan, "town
 * realism"); the sim only ever gets these numbers.
 */
export function playStart(time: string | null, date: string | null = null): { start: CivilDate; startDay: number; clock: number } {
  const now = new Date();
  const dm = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(date ?? '');
  const start = dm ? { year: +dm[1], month: +dm[2], day: +dm[3] } : { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
  const startDay = weekdayOfDays(daysOf(start.year, start.month, start.day));
  const m = time && /^\d{1,2}:\d{2}$/.test(time) ? Number(time.split(':')[0]) * 60 + Number(time.split(':')[1]) : now.getHours() * 60 + now.getMinutes();
  // The world is made at 06:00 of its first day; earlier times are the next morning.
  return { start, startDay, clock: startDay * 1440 + (m >= 360 ? m : m + 1440) };
}

/**
 * The world as the sky and the sound read it (the calendar and the weather): the sim's seed, epoch and latitude,
 * its clock (`sim.clock`, set each frame once the sim runs), and the region once the town knows it. Before the
 * sim is up it stands on the start of play.
 */
export interface ScreenWorld { readonly seed: number; epoch: number; readonly latitude: number; clock: number; region: { region: { coastal?: boolean } } | null }

export function screenWorld(seed: number, play: ReturnType<typeof playStart>): ScreenWorld {
  return { seed, epoch: epochFor(play.start, play.startDay), latitude: DEFAULT_LATITUDE, clock: play.clock, region: null };
}

/** Put `w` on the running sim: its epoch (from the view's date) and its clock now. */
export function followSim(w: ScreenWorld, sim: SimClient): void {
  w.epoch = sim.view.date.days - Math.floor(sim.view.clock / 1440);
  w.clock = sim.clock;
}

/** The store key of a town's save: one save per town (its settings). */
const saveKey = (s: TownSettings): string => `town:${s.seed}:${s.size}`;

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
  /** The street update under way (a skip waits for it, then holds the next ones off). */
  private inflight: Promise<unknown> = Promise.resolve();
  private last = 0;
  private readonly infos = new Map<number, ActorInfo>();

  private constructor(private readonly pool: WorkerPool<ToSim, FromSim>, readonly rate: number, readonly ground: HeightGrid, readonly people: number, view: SimView, private readonly key: string, readonly windows: WindowSlots) {
    this.view = view;
    this.town = view.town!;
  }

  /** The vehicles from the latest street update (src/traffic/feed.ts): the moving ones, and the parked ones as last sent. */
  traffic: TrafficMsg | null = null;
  /** The parked cars as last sent (they come only when they changed; poses PARKED_STRIDE each). */
  parked: { poses: Float32Array; cars: Int32Array } | null = null;

  /** The sim's latest view snapshot (src/sim/view.ts): every view reads the sim from here. */
  view: SimView;
  /** Called with each new view snapshot (views that redraw per game minute, such as the lit windows). */
  onView: ((v: SimView) => void) | null = null;
  /** The town's face as of today (the latest `view.town`): what each place is now, its looks, the council's rules. */
  town: TownFace;

  /**
   * Start the worker: it plans the town, makes the world (play beginning on the real date `start`, game day
   * `startDay`) and runs it to `clock`.
   */
  static async boot(settings: TownSettings, start: CivilDate, startDay: number, clock: number, rate: number, opts: { resume?: boolean } = {}): Promise<SimClient> {
    const key = saveKey(settings);
    const save = opts.resume ? await readSave(key) : null;
    const pool = new WorkerPool<ToSim, FromSim>(simWorkerUrl, 1);
    const [ready] = await pool.start(() => ({ type: 'init', settings, start, startDay, clock, save: save?.bytes ?? null }));
    if (ready.type !== 'ready') throw new Error(ready.type === 'error' ? ready.message : 'the sim worker did not start');
    const c = new SimClient(pool, rate, ready.ground, ready.people, ready.view, key, ready.windows);
    c.restart(ready.clock);
    if (save && !ready.resumed) void dropSave(key); // it no longer fits this build or town
    return c;
  }

  /**
   * Save the world now, under this town's key (one save per town: a new one replaces it). Resolves to whether it
   * was stored. `boot(..., { resume: true })` plays on from it.
   */
  async saveNow(): Promise<boolean> {
    const m = await this.pool.run<Extract<FromSim, { type: 'saved' }>>({ type: 'save' }, 0);
    return storeSave(this.key, m.bytes, m.clock);
  }

  /** Save when the tab is hidden (closing, switching away) and every `AUTOSAVE_MS` of play. */
  keepSaved(): void {
    let last = performance.now();
    const save = (): void => { last = performance.now(); void this.saveNow(); };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(); });
    setInterval(() => { if (performance.now() - last >= AUTOSAVE_MS) save(); }, AUTOSAVE_MS / 4);
  }

  /** The time skip: `days` whole days on, the same time of day. Everyone out of doors is drawn afresh. */
  async skip(days: number): Promise<void> {
    await this.inflight;
    this.busy = true;
    try {
      const m = await this.pool.run<Extract<FromSim, { type: 'skipped' }>>({ type: 'skip', days }, 0);
      this.view = m.view; this.onView?.(m.view);
      if (m.view.town) this.town = m.view.town;
      this.walkers.clear();
      this.restart(m.clock);
    } finally {
      this.busy = false;
    }
  }

  /** The player's person as of the worker's last answer (src/sim/player.ts), null while nobody is picked. */
  player: PlayerStatus | null = null;

  /** A player request (cards, become, autopilot, actions, go, digest); updates `player`. */
  async ask(op: PlayerOp): Promise<PlayerReply> {
    const r = await this.pool.run<PlayerReply>({ type: 'player', op }, 0);
    this.player = r.status;
    return r;
  }

  /** The game clock reads `clock` now. */
  private restart(clock: number): void {
    this.clock0 = clock;
    this.base = performance.now();
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

  /** One step of a conversation (src/chat/ops.ts), answered by the worker against the live world, ahead of street updates. */
  async chat<K extends ChatRequest['op']>(req: Extract<ChatRequest, { op: K }>): Promise<Extract<ChatResponse, { op: K }>> {
    const m = await this.pool.run<Extract<FromSim, { type: 'chat' }>>({ type: 'chat', req }, -1);
    return m.res as Extract<ChatResponse, { op: K }>;
  }

  /** Call every frame: asks the worker for the street around (x, z) when the last answer is old enough. */
  poll(x: number, z: number): void {
    const now = performance.now();
    if (this.busy || now - this.last < UPDATE_MS) return;
    this.busy = true;
    this.last = now;
    this.inflight = this.pool.run<Extract<FromSim, { type: 'street' }>>({ type: 'update', clock: this.clock, x, z, r: STREET_RADIUS }, 0).then((m) => {
      if (m.view) { this.view = m.view; if (m.view.town) this.town = m.view.town; this.onView?.(m.view); }
      this.player = m.player;
      this.traffic = m.traffic;
      if (m.traffic.parked) this.parked = { poses: m.traffic.parked, cars: m.traffic.parkedCars! };
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

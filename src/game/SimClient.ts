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
import { heightOnGrid, onGrid } from '../physics/solids';
import type { ActorInfo, FromSim, HeightGrid, PlayerOp, PlayerReply, ToSim } from '../workers/simProtocol';
import type { PlayerStatus } from '../sim/player';
import type { ChatRequest, ChatResponse } from '../chat/ops';
import { DEFAULT_LATITUDE, daysOf, epochFor, weekdayOfDays, type CivilDate } from '../sim/calendar';
import type { SimView, TownFace } from '../sim/view';
import type { TrafficMsg } from '../traffic/feed';
import type { WindowSlots } from '../street/windows';
import type { StopBoard } from '../street/stops';
import type { TownSettings } from '../world/settings';
import { sample } from '../street/tracks';
import { MINUTES_PER_DAY } from '../sim/time';
import type { Said } from '../street/talk';
import { dropSave, packSave, readSave, storeSave, unpackSave } from '../persist/saves';

/** Real milliseconds between street updates (the plan's L1 rate, ~5 Hz). */
const UPDATE_MS = 200;
/** Real milliseconds between autosaves. */
const AUTOSAVE_MS = 5 * 60_000;
/** The game minutes the town runs per step while catching up with a look ahead (each a moment of work in the sim worker). */
const LOOK_STEP = 60;
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
  w.clock = sim.shownClock;
}

/** The store key of a town's save: one save per town (its settings). */
const saveKey = (s: TownSettings): string => `town:${s.seed}:${s.size}`;

/** A save file's bytes from `url`, as `saveWorld` made them. */
async function fetchSave(url: string): Promise<Uint8Array | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return await unpackSave(new Uint8Array(await r.arrayBuffer()));
  } catch (e) {
    console.warn(`save not fetched from ${url}`, e);
    return null;
  }
}

/** Someone out of doors near the camera. */
export interface Walker {
  readonly id: number;
  info: ActorInfo;
  keys: Float64Array;
  hideAfter: number;
  activity: number;
  /** When they sit (Track.rests). */
  rests: Float64Array;
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

  private constructor(private readonly pool: WorkerPool<ToSim, FromSim>, readonly rate: number, readonly ground: HeightGrid, /** How far from the centre either way the world is walkable (m). */ readonly world: number, readonly people: number, view: SimView, private readonly key: string, readonly windows: WindowSlots, /** The bus stops and their timetables (src/street/stops.ts). */ readonly stops: StopBoard[]) {
    this.view = view;
    this.town = view.town!;
  }

  /** The vehicles from the latest street update (src/traffic/feed.ts): the moving ones, and the parked ones as last sent. */
  traffic: TrafficMsg | null = null;
  /** The parked cars as last sent (they come only when they changed; poses PARKED_STRIDE each). */
  parked: { poses: Float32Array; cars: Int32Array } | null = null;
  /** The level crossings' barrier posts as sent once (src/traffic/feed.ts `POST_STRIDE` each). */
  crossingPosts: Float32Array | null = null;

  /** The sim's latest view snapshot (src/sim/view.ts): every view reads the sim from here. */
  view: SimView;
  /** Called with the talk the player can hear, as it comes with each street update (src/street/talk.ts; the speech bubbles). */
  onTalk: ((said: Said[]) => void) | null = null;
  /** Called after a time skip (what was being said is over). */
  onSkip: (() => void) | null = null;
  /** Called with each new view snapshot (views that redraw per game minute, such as the lit windows). */
  onView: ((v: SimView) => void) | null = null;
  /** The town's face as of today (the latest `view.town`): what each place is now, its looks, the council's rules. */
  town: TownFace;

  /**
   * Start the worker: it plans the town, makes the world (play beginning on the real date `start`, game day
   * `startDay`) and runs it to `clock`. `until` runs it to that world clock instead (history included: a report's
   * repro link, src/game/report.ts); `saveUrl` plays on from a save file fetched from there (a report's save).
   */
  static async boot(settings: TownSettings, start: CivilDate, startDay: number, clock: number, rate: number, opts: { resume?: boolean; until?: number; saveUrl?: string } = {}): Promise<SimClient> {
    const key = saveKey(settings);
    const save = opts.saveUrl ? { bytes: await fetchSave(opts.saveUrl) } : opts.resume ? await readSave(key) : null;
    const pool = new WorkerPool<ToSim, FromSim>(simWorkerUrl, 1);
    const [ready] = await pool.start(() => ({ type: 'init', settings, start, startDay, clock, until: opts.until, save: save?.bytes ?? null }));
    if (ready.type !== 'ready') throw new Error(ready.type === 'error' ? ready.message : 'the sim worker did not start');
    const c = new SimClient(pool, rate, ready.ground, ready.world, ready.people, ready.view, key, ready.windows, ready.stops);
    c.restart(ready.clock);
    c.resumed = ready.resumed;
    if (save && !ready.resumed && !opts.saveUrl) void dropSave(key); // it no longer fits this build or town
    if (opts.saveUrl && !ready.resumed) console.warn(`the save from ${opts.saveUrl} does not fit this build or town: playing a fresh one`);
    return c;
  }

  /** Whether play went on from a save (then seed, start and clock alone do not give this world). */
  resumed = false;
  /** Days skipped with the day-long time skips so far (their chronicle is not the live tick: no repro from the clock). */
  skipped = 0;

  /** The world as save bytes, gzipped (a save file). */
  async saveFile(): Promise<Uint8Array> {
    return packSave((await this.saveBytes()).bytes);
  }

  /**
   * Save the world now, under this town's key (one save per town: a new one replaces it). Resolves to whether it
   * was stored. `boot(..., { resume: true })` plays on from it.
   */
  async saveNow(): Promise<boolean> {
    const m = await this.saveBytes();
    return storeSave(this.key, m.bytes, m.clock);
  }

  private saveBytes(): Promise<Extract<FromSim, { type: 'saved' }>> {
    return this.pool.run<Extract<FromSim, { type: 'saved' }>>({ type: 'save' }, 0);
  }

  /** Save when the tab is hidden (closing, switching away) and every `AUTOSAVE_MS` of play. */
  keepSaved(): void {
    let last = performance.now();
    // Never the town as looked ahead in the picker (that is not where play is).
    const save = (): void => { last = performance.now(); if (this.autosave && !this.look) void this.saveNow(); };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(); });
    setInterval(() => { if (performance.now() - last >= AUTOSAVE_MS) save(); }, AUTOSAVE_MS / 4);
  }

  /** False stops `keepSaved` (e.g. while the page reloads to play on from the save: leaving must not replace it). */
  autosave = true;

  /**
   * The time skip, `minutes` on: hours as lived, a day or more as whole days to the same time of day (the sim
   * worker's skip). Everyone out of doors is drawn afresh.
   */
  async skip(minutes: number): Promise<void> {
    await this.skipTo(this.clock + minutes);
    // (Under a day the skip is the live tick, as in play: the clock alone still repeats it.)
    if (minutes >= MINUTES_PER_DAY) this.skipped += Math.round(minutes / MINUTES_PER_DAY);
  }

  /** Run the world to game clock `to` (from the world as marked, with `fromMark`); everyone out of doors is drawn afresh. */
  private async skipTo(to: number, fromMark = false): Promise<void> {
    await this.inflight;
    this.busy = true;
    try {
      const m = await this.pool.run<Extract<FromSim, { type: 'skipped' }>>({ type: 'skip', to, fromMark }, 0);
      this.view = m.view; this.onView?.(m.view);
      if (m.view.town) this.town = m.view.town;
      this.walkers.clear();
      this.onSkip?.();
      this.restart(m.clock);
    } finally {
      this.busy = false;
    }
  }

  /**
   * The picker's look ahead (its start slider): the world as it was when it began (kept in the sim worker), the
   * real time then, and the clock wanted now; null while not looking ahead.
   */
  private look: { from: number; real: number; want: number; running: Promise<void> | null } | null = null;

  /** Game clock now as if nobody looked ahead (the picker's "now"). */
  get nowClock(): number {
    const L = this.look;
    return L ? L.from + ((performance.now() - L.real) / 60000) * this.rate : this.clock;
  }

  /** The clock the screen shows: while the town catches up with a look ahead, the time it is catching up to (the sky goes there at once). */
  get shownClock(): number {
    const L = this.look;
    return L?.running ? L.want + ((performance.now() - L.real) / 60000) * this.rate : this.clock;
  }

  /** Is the town still catching up with a look ahead? */
  get catchingUp(): boolean {
    return !!this.look?.running;
  }

  /**
   * Look `minutes` ahead of now (the picker's slider): the town runs on to then a game hour at a time, so it can be
   * watched catching up; back from the world as it was when the looking began when the time is earlier than where
   * it got to. Resolves once it is there (a later call takes over the same run).
   */
  async lookAhead(minutes: number): Promise<void> {
    if (!this.look) {
      await this.inflight;
      const m = await this.pool.run<Extract<FromSim, { type: 'marked' }>>({ type: 'mark', on: true }, 0);
      this.look ??= { from: m.clock, real: performance.now(), want: m.clock, running: null };
    }
    const L = this.look;
    L.want = L.from + minutes;
    L.running ??= this.catchUp(L).finally(() => { L.running = null; });
    return L.running;
  }

  private async catchUp(L: NonNullable<SimClient['look']>): Promise<void> {
    for (;;) {
      if (this.look !== L) return;
      const elapsed = ((performance.now() - L.real) / 60000) * this.rate, want = L.want + elapsed, at = this.clock;
      if (Math.abs(want - at) < 1) return;
      if (want < at - 1) await this.skipTo(Math.min(want, L.from + elapsed + LOOK_STEP), true);
      else await this.skipTo(Math.min(want, at + LOOK_STEP));
    }
  }

  /**
   * Stop looking ahead: `keep` stays at the time looked at (play starts there); else back to now, as if nobody had
   * looked.
   */
  async endLook(keep: boolean): Promise<void> {
    const L = this.look;
    if (!L) return;
    if (!keep) { L.want = L.from; await (L.running ??= this.catchUp(L).finally(() => { L.running = null; })); }
    else await L.running;
    this.look = null;
    await this.pool.run<Extract<FromSim, { type: 'marked' }>>({ type: 'mark', on: false }, 0);
  }

  /** The player's person as of the worker's last answer (src/sim/player.ts), null while nobody is picked. */
  player: PlayerStatus | null = null;

  /** A player request (cards, become, autopilot, actions, go, digest); updates `player`. */
  async ask(op: PlayerOp): Promise<PlayerReply> {
    const r = await this.pool.run<PlayerReply>({ type: 'player', op }, 0);
    this.player = r.status;
    if (r.info) this.infos.set(r.info.id, r.info);
    return r;
  }

  /** An actor's looks and name, once the worker has sent them (null before). */
  infoOf(id: number): ActorInfo | null {
    return this.infos.get(id) ?? null;
  }

  /** Who is inside building `building` (a `Place.building` code) now, and whether its street doors open from outside (src/street/inside.ts). */
  async inside(building: number): Promise<Pick<Extract<FromSim, { type: 'inside' }>, 'people' | 'access'>> {
    const r = await this.pool.run<Extract<FromSim, { type: 'inside' }>>({ type: 'inside', building }, 0);
    return { people: r.people, access: r.access };
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

  /** The ground round the player's body (the `near` op's, src/game/standing.ts), finer to have than the town's grid out in the fields. */
  groundNear: HeightGrid | null = null;

  /** Ground height (sidewalk level) at (x, z) as the physics world has it (src/physics/solids.ts `heightOnGrid`): the ground round the body where it reaches, else the town's grid. */
  standHeight(x: number, z: number): number {
    const g = this.groundNear && onGrid(this.groundNear, x, z) ? this.groundNear : this.ground;
    return heightOnGrid(g, x, z);
  }

  /** Is (x, z) in the walkable world, `margin` metres inside its edge? */
  inWorld(x: number, z: number, margin = 0): boolean {
    return Math.max(Math.abs(x), Math.abs(z)) <= this.world - margin;
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
      if (m.talk.length) this.onTalk?.(m.talk);
      this.traffic = m.traffic;
      if (m.traffic.parked) this.parked = { poses: m.traffic.parked, cars: m.traffic.parkedCars! };
      if (m.traffic.posts) this.crossingPosts = m.traffic.posts;
      for (const i of m.info) this.infos.set(i.id, i);
      for (const id of m.gone) this.walkers.delete(id);
      for (const t of m.tracks) {
        const info = this.infos.get(t.id);
        if (!info) continue;
        const w = this.walkers.get(t.id);
        if (w) Object.assign(w, { keys: t.keys, hideAfter: t.hideAfter, activity: t.activity, rests: t.rests, doing: t.doing });
        else this.walkers.set(t.id, { id: t.id, info, keys: t.keys, hideAfter: t.hideAfter, activity: t.activity, rests: t.rests, doing: t.doing });
      }
    }).catch((e) => console.error('sim worker', e)).finally(() => { this.busy = false; });
  }
}

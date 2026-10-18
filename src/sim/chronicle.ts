/**
 * The chronicle (plan R4, §2.4): the coarse model for the time skip and for the town's history before the game
 * starts. It advances whole days at a time. Life events come from `passDays` (the same hazards as live play,
 * scaled to the step); routines become contact pools (household, workplace, school, favourite places, street,
 * people one knows), and conversations are sampled from them through the live `encounter`, so relationships grow and
 * news spreads, distorts and is forgotten as in live play, only coarser. No LLM. Afterwards everyone is at home at
 * midnight and decides afresh.
 *
 * `digest` tells one person's side of a stretch of time: only what they lived through or heard about.
 */
import type { Rng } from '@futuremagic/core';
import { A, type ActorId } from './actors';
import { encounter } from './encounters';
import { factText, SOURCE_WITNESSED } from './knowledge';
import { HABIT_COUNT, T_EXTRA } from './people';
import { KINDS } from './placeKinds';
import type { PlaceId } from './places';
import { NEED_COUNT } from './species';
import { MINUTES_PER_DAY } from './time';
import { firstName, isPerson, jobOf, passDays, tickRng, traitOf, type World } from './world';

export interface ChronicleOptions {
  /** Days per step (default: 1 for skips up to two weeks, else 7). Coarser steps are faster and blurrier. */
  step?: number;
  /** Conversations sampled per person per day of a step (default 1.5; each step samples at most `maxTalks`, default 5). */
  talksPerDay?: number;
  maxTalks?: number;
}

/** Advance the world `days` days in the coarse model. The clock moves to midnight first, then whole days. */
export function chronicle(world: World, days: number, opts: ChronicleOptions = {}): void {
  const step = Math.max(1, Math.floor(opts.step ?? (days <= 14 ? 1 : 7)));
  const talks = opts.talksPerDay ?? 1.5, maxTalks = opts.maxTalks ?? 5;
  // Finish the current day (whatever it held happens off-screen).
  if (world.clock % MINUTES_PER_DAY !== 0) {
    world.clock = (Math.floor(world.clock / MINUTES_PER_DAY) + 1) * MINUTES_PER_DAY;
    passDays(world, 1);
    days--;
  }
  while (days > 0) {
    const d = Math.min(step, days);
    world.clock += d * MINUTES_PER_DAY;
    passDays(world, d);
    converse(world, d, talks, maxTalks);
    days -= d;
  }
  settleAtHome(world);
}

/** Days of history for `years` years (whole weeks). */
export const historyDays = (years: number): number => Math.round((years * 365) / 7) * 7;

/**
 * The town's past before play (plan §2.4): `years` of chronicle, coarse far back and finer toward the present, so old
 * events have left kin, exes, grudges and secrets, and recent ones are still talked about. Whole weeks, so the
 * weekday is kept.
 */
export function history(world: World, years: number): void {
  const total = historyDays(years);
  const recent = Math.min(total, 28), year = Math.min(total - recent, 336);
  // Far back only the life events matter: what was said then is long forgotten.
  chronicle(world, total - recent - year, { step: 56, talksPerDay: 0 });
  chronicle(world, year, { step: 28 });
  chronicle(world, recent, { step: 7 });
}

// ---- contact pools ---------------------------------------------------------------------------------------

interface Pools {
  /** Place → people who are regularly there (staff, pupils, regulars). */
  at: Map<PlaceId, ActorId[]>;
  /** Street place → residents. */
  street: Map<PlaceId, ActorId[]>;
}

function pools(world: World): Pools {
  const at = new Map<PlaceId, ActorId[]>(), street = new Map<PlaceId, ActorId[]>();
  const file = (m: Map<PlaceId, ActorId[]>, k: PlaceId, id: ActorId) => { if (k < 0) return; const l = m.get(k); if (l) l.push(id); else m.set(k, [id]); };
  const pc = world.people.cols, a = world.actors.cols;
  for (let id = 0; id < world.actors.count; id++) {
    if (!isPerson(world, id)) continue;
    const p = a.row[id];
    file(at, jobOf(world, id)?.place ?? -1, id);
    file(at, pc.school[p], id);
    for (let h = 0; h < HABIT_COUNT; h++) file(at, pc.habits[p * HABIT_COUNT + h], id);
    file(street, world.streetOf[a.home[id]], id);
  }
  return { at, street };
}

const pick = (l: readonly ActorId[] | undefined, rng: Rng) => (l && l.length > 1 ? l[rng.int(0, l.length - 1)] : -1);

/** Where `x` meets someone this time, and whom. */
function partner(world: World, x: ActorId, pl: Pools, rng: Rng): [PlaceId, ActorId] {
  const a = world.actors.cols, pc = world.people.cols, p = a.row[x];
  const roll = rng.float();
  if (roll < 0.3) {
    const hh = world.households[pc.household[p]];
    return [a.home[x], pick(hh?.members, rng)];
  }
  if (roll < 0.6) {
    const place = jobOf(world, x)?.place ?? pc.school[p];
    if (place >= 0) return [place, pick(pl.at.get(place), rng)];
  }
  if (roll < 0.75) {
    const h = pc.habits[p * HABIT_COUNT + rng.int(0, HABIT_COUNT - 1)];
    if (h >= 0) return [h, pick(pl.at.get(h), rng)];
  }
  if (roll < 0.85) {
    const st = world.streetOf[a.home[x]];
    return [st, pick(pl.street.get(st), rng)];
  }
  // Someone they know, the better known the likelier (best of two).
  const r1 = world.relations.anyKnown(x, rng);
  if (r1 < 0) return [-1, -1];
  const c = world.relations.t.cols;
  const r2 = world.relations.anyKnown(x, rng);
  const r = c.familiarity[r1] >= c.familiarity[r2] ? r1 : r2;
  return [a.home[c.to[r]], c.to[r]];
}

/** Conversations a person starts per day in live play (measured: about 14, so 28 counting both sides). */
const LIVE_TALKS_PER_DAY = 14;

function converse(world: World, days: number, perDay: number, max: number): void {
  const rng = tickRng(world, 'chronicle');
  const pl = pools(world);
  world.encounters.length = 0;
  for (let x = 0; x < world.actors.count; x++) {
    if (!isPerson(world, x)) continue;
    const n = Math.min(max, Math.round(days * perDay * (0.5 + traitOf(world, x, T_EXTRA))));
    // Each sampled conversation stands for several live ones, so it is likelier to carry news.
    const stands = Math.max(1, (days * LIVE_TALKS_PER_DAY) / Math.max(1, n));
    for (let k = 0; k < n; k++) {
      const [place, y] = partner(world, x, pl, rng);
      if (y < 0 || y === x || !isPerson(world, y)) continue;
      const kind = place >= 0 ? world.graph.places[place].kind : 'house';
      encounter(world, place, x, y, (0.6 + KINDS[kind].chat * 10 + (world.relations.isFamily(x, y) ? 0.5 : 0)) * stands, rng);
    }
    world.encounters.length = 0;
  }
}

/** After a skip: everyone at home, rested enough, deciding afresh. */
function settleAtHome(world: World): void {
  const a = world.actors.cols;
  for (let id = 0; id < world.actors.count; id++) {
    if (!a.alive[id]) continue;
    a.place[id] = a.home[id]; a.dest[id] = -1; a.with[id] = -1;
    a.activity[id] = A.sleep; a.until[id] = world.clock;
    for (let n = 0; n < NEED_COUNT; n++) a.needs[id * NEED_COUNT + n] = Math.max(a.needs[id * NEED_COUNT + n], 0.7);
  }
  world.encounters.length = 0;
  world.trips.length = 0;
}

// ---- the digest ------------------------------------------------------------------------------------------

export interface DigestItem {
  time: number;
  /** One line from the person's point of view. */
  text: string;
  /** Lived through it (a memory) or heard about it (a belief). */
  kind: 'lived' | 'heard';
  importance: number;
}

/**
 * What `id` would tell you about the time since `since` (plan R4: the skip digest from the character's point of
 * view): their own memories first, then the news they picked up, most important first. Nothing they don't know.
 */
export function digest(world: World, id: ActorId, since: number, max = 20): DigestItem[] {
  const out: DigestItem[] = [];
  const seen = new Set<number>();
  const lines = new Set<string>();
  const k = world.knowledge, c = k.beliefs.cols;
  // Stories someone told them are told as heard (with who told them), not as the memory of hearing it.
  const told = new Set<number>();
  for (const r of k.byHolder[id] ?? []) if (c.heardAt[r] >= since && c.source[r] >= 0) told.add(k.facts[c.fact[r]].root);
  for (const m of world.memory.byPerson[id] ?? []) {
    if (m.time < since) continue;
    if (m.fact >= 0) {
      const root = world.knowledge.facts[m.fact].root;
      if (told.has(root)) continue;
      if (seen.has(root) && lines.has(m.summary)) continue;
      seen.add(root);
    }
    if (lines.has(m.summary)) continue;
    lines.add(m.summary);
    out.push({ time: m.time, text: m.summary, kind: 'lived', importance: m.importance });
  }
  for (const r of k.byHolder[id] ?? []) {
    if (c.heardAt[r] < since) continue;
    const f = k.facts[c.fact[r]];
    // What happened to them they lived, not heard; their memories tell it.
    if (seen.has(f.root) || (c.source[r] === SOURCE_WITNESSED && (f.subject === id || f.object === id))) continue;
    seen.add(f.root);
    const src = c.source[r];
    const from = src >= 0 ? ` (${firstName(world, src)} told me)` : '';
    out.push({ time: c.heardAt[r], text: factText(world, f) + from, kind: 'heard', importance: c.salience[r] * c.confidence[r] });
  }
  return out.sort((x, y) => y.importance - x.importance || x.time - y.time).slice(0, max);
}

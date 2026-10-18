/**
 * Clubs, congregations and the council (town-realism §1.5 and §4, plan track F): the town's social fabric outside work.
 * A group has members, office holders, a place it meets, weekly or monthly meetings in the town agenda
 * (src/sim/agenda.ts, `addRecurring`, members as the guest list) and one big day a year (the produce show, the
 * Christmas concert, the fire brigade's open day) that anyone can come to and that the town talks about.
 *
 * Membership follows personality, age and values, with friends pulling friends in; it churns month by month (people
 * drift off, newcomers join, the youth club loses its eighteen-year-olds). Office holders are elected at the annual
 * general meeting; some offices go with a job (the coach, the priest, the mayor). A club whose members dwindle
 * folds, and a club the town lacks may be founded. The council's seats are filled here at the start; elections and
 * issues are src/sim/politics.ts.
 *
 * In live play members meet because the schedule offers them their club evening. The chronicle samples meeting
 * conversations instead (`clubEvenings`), so in the time skip club friends still become friends.
 *
 * Plain data, so it saves and crosses to the worker as is. A group's `members` array is the guest list of its
 * meetings in the agenda, so it is only ever changed in place.
 */
import { hashCombine, hashToFloat, type Rng } from '@futuremagic/core';
import { A, MALE, type ActorId } from './actors';
import { addOccasion, addRecurring, type Appeal, type OccasionKind } from './agenda';
import { dateOf, formatDate, gameDayOf, monthKey, weekdayOfDays } from './calendar';
import { encounter } from './encounters';
import { addFact, broadcast, witness, type FactTopic } from './knowledge';
import { closeTo } from './life';
import { remember } from './memory';
import { T_CONSC, T_EXTRA, V_AMBITION, V_FAITH } from './people';
import { popcount, type DayMask, type PlaceId, type PlaceKind } from './places';
import { dayOf, MINUTES_PER_DAY } from './time';
import { ageOf, isPerson, placesOf, tickRng, traitOf, valueOf, weighed, type Weights, type World } from './world';

export const GROUP_KINDS = [
  'football', 'choir', 'firebrigade', 'rifle', 'allotment', 'churchgroup', 'youth', 'books', 'running', 'cards', 'history',
  'congregation', 'council',
] as const;
export type GroupKind = (typeof GROUP_KINDS)[number];

export interface Office {
  title: string;
  holder: ActorId;
}

export interface Group {
  id: number;
  kind: GroupKind;
  name: string;
  /** Where it meets. */
  place: PlaceId;
  /** Changed in place only: the same array is the guest list of its meetings. */
  members: ActorId[];
  /** Game day each member joined, parallel to `members`. */
  since: number[];
  offices: Office[];
  /** Game day it was founded (before day 0 for the town's old clubs). */
  founded: number;
  /** Folded: no members, no meetings (kept so old news still points somewhere). */
  folded: boolean;
}

/** A big day under way or to come: what happens when it is held. */
interface Pending { group: number; occasion: number; start: number }

export interface Groups {
  list: Group[];
  pending: Pending[];
  /** Calendar month (year × 12 + month − 1) of the last monthly review. */
  month: number;
}

export const newGroups = (): Groups => ({ list: [], pending: [], month: -1 });

// ---- what each kind of group is --------------------------------------------------------------------------

interface Meet {
  kind: OccasionKind;
  days: DayMask;
  /** Hours from midnight. */
  from: number;
  to: number;
  /** Months it runs in (bit month − 1). */
  months?: number;
  nth?: number;
  /** How strongly members are drawn. */
  pull: number;
  /** Also open to the public with this pull (spectators at a match, the public gallery of the council). */
  open?: number;
}

interface BigDay {
  name: string;
  month: number;
  /** Held on the first Saturday on or after this day of the month. */
  after: number;
  from: number;
  to: number;
  pull: number;
  appeal: Appeal;
  /** Venue kind if not the group's own place. */
  at?: PlaceKind;
  /** The result people talk about afterwards; {subject} is a member picked by skill and luck. */
  prize?: string;
  /** A result without a winner ("finished third in the league"); one line per outcome, picked at random. */
  result?: string[];
}

interface Spec {
  name: string;
  venue: PlaceKind[];
  ages: [number, number];
  /** Members per inhabitant when the town has the people for it. */
  perHead: number;
  /** Below this the club cannot run (and is not founded). */
  min: number;
  /** Appeal to one person, about 0..1.5 before taste. */
  like: Liking;
  offices: string[];
  /** Offices that go with a job at the group's place (office → job role). */
  jobs?: Record<string, string>;
  meets: Meet[];
  big?: BigDay;
  topic: FactTopic;
}

const months = (...m: number[]): number => m.reduce((s, k) => s | (1 << (k - 1)), 0);
/** The football season and the choir's year: all but June and July. */
const NOT_SUMMER = months(1, 2, 3, 4, 5, 8, 9, 10, 11, 12);
const GROWING = months(4, 5, 6, 7, 8, 9, 10);
const MON = 1, TUE = 2, WED = 4, THU = 8, FRI = 16, SAT = 32, SUN = 64;

/**
 * Who a kind of group appeals to: `base` plus weights on traits and values, then a factor by age band (the first
 * band whose upper age is reached), by sex, and by home (people in flats have no garden).
 */
interface Liking extends Weights {
  base?: number;
  ages?: [number, number][];
  men?: number;
  women?: number;
  /** Factor for people living in a flat, and for everyone else. */
  flat?: [number, number];
}

function liking(world: World, id: ActorId, age: number, l: Liking): number {
  let x = (l.base ?? 0) + weighed(world, id, l);
  if (l.ages) x *= l.ages.find(([upTo]) => age <= upTo)?.[1] ?? 1;
  x *= world.actors.cols.sex[id] === MALE ? l.men ?? 1 : l.women ?? 1;
  if (l.flat) x *= world.graph.places[world.actors.cols.home[id]]?.kind === 'apartments' ? l.flat[0] : l.flat[1];
  return Math.max(0, x);
}

const SPECS: Record<GroupKind, Spec> = {
  football: {
    name: 'the football club', venue: ['sports'], ages: [6, 45], perHead: 0.045, min: 14, topic: 'event',
    like: { base: 0.3, extra: 1, ages: [[17, 1.3], [31, 1], [120, 0.5]], women: 0.4 },
    offices: ['chair', 'treasurer', 'secretary', 'coach'], jobs: { coach: 'coach' },
    meets: [
      { kind: 'club', days: TUE | THU, from: 18, to: 19.5, months: NOT_SUMMER, pull: 1.6 },
      { kind: 'match', days: SAT, from: 15, to: 17, months: NOT_SUMMER, pull: 2, open: 0.25 },
    ],
    big: { name: 'last home match of the season', month: 5, after: 15, from: 15, to: 19, pull: 0.6, appeal: 'all',
      result: ['finished top of the league and won promotion', 'finished second in the league', 'finished mid-table in the league', 'finished mid-table in the league', 'only just avoided relegation', 'were relegated'] },
  },
  choir: {
    name: 'the town choir', venue: ['church', 'school'], ages: [16, 90], perHead: 0.017, min: 10, topic: 'event',
    like: { base: 0.2, open: 0.5, agree: 0.5, ages: [[39, 0.7], [120, 1.2]], men: 0.6 },
    offices: ['chair', 'treasurer', 'conductor'],
    meets: [{ kind: 'club', days: TUE, from: 19.5, to: 21, months: NOT_SUMMER, pull: 1.6 }],
    big: { name: 'Christmas concert', month: 12, after: 9, from: 18, to: 20, pull: 0.5, appeal: 'all', at: 'church' },
  },
  firebrigade: {
    name: 'the volunteer fire brigade', venue: ['fire'], ages: [17, 62], perHead: 0.016, min: 10, topic: 'event',
    like: { base: 0.2, consc: 0.5, loyal: 0.6, ages: [[49, 1], [120, 0.6]], women: 0.5 },
    offices: ['chief', 'deputy chief', 'treasurer'], jobs: { chief: 'firefighter' },
    meets: [{ kind: 'club', days: WED, from: 19, to: 21, pull: 1.4 }],
    big: { name: 'open day', month: 7, after: 1, from: 10, to: 17, pull: 0.7, appeal: 'all' },
  },
  rifle: {
    name: 'the rifle club', venue: ['sports', 'field'], ages: [16, 80], perHead: 0.012, min: 8, topic: 'event',
    like: { base: 0.7, loyal: 0.6, open: -0.5, women: 0.4 },
    offices: ['chair', 'treasurer', 'range officer'],
    meets: [{ kind: 'club', days: FRI, from: 19, to: 21.5, pull: 1.3 }],
    big: { name: 'summer shoot and barbecue', month: 7, after: 15, from: 11, to: 20, pull: 0.4, appeal: 'adults', prize: '{subject} won the rifle club\'s summer shoot' },
  },
  allotment: {
    name: 'the community garden club', venue: ['park', 'field'], ages: [25, 90], perHead: 0.012, min: 8, topic: 'event',
    like: { base: 0.2, consc: 1, ages: [[49, 0.7], [120, 1.3]], flat: [1.6, 0.5] },
    offices: ['chair', 'treasurer', 'secretary'],
    meets: [{ kind: 'club', days: SAT, from: 9, to: 12, months: GROWING, pull: 1 }],
    big: { name: 'produce show', month: 9, after: 1, from: 11, to: 16, pull: 0.4, appeal: 'adults', prize: '{subject} won best in show at the community garden club\'s produce show' },
  },
  churchgroup: {
    name: 'the church coffee circle', venue: ['church'], ages: [55, 99], perHead: 0.01, min: 6, topic: 'event',
    like: { base: -0.9, faith: 1.8, agree: 0.5 },
    offices: ['organiser'],
    meets: [{ kind: 'club', days: WED, from: 15, to: 17, pull: 1.5 }],
    big: { name: 'rummage sale', month: 11, after: 1, from: 10, to: 14, pull: 0.35, appeal: 'adults' },
  },
  youth: {
    name: 'the youth club', venue: ['school', 'townhall', 'church'], ages: [12, 17], perHead: 0.016, min: 8, topic: 'event',
    like: { base: 0.3, extra: 1 },
    offices: ['youth leader'], jobs: { 'youth leader': 'teacher' },
    meets: [{ kind: 'club', days: FRI, from: 18, to: 21, pull: 1.4 }],
    big: { name: 'disco', month: 2, after: 1, from: 19, to: 22, pull: 0.5, appeal: 'children' },
  },
  books: {
    name: 'the book club', venue: ['library', 'cafe'], ages: [22, 90], perHead: 0.006, min: 5, topic: 'event',
    like: { open: 1.4, men: 0.5 },
    offices: ['organiser'],
    meets: [{ kind: 'club', days: THU, from: 19.5, to: 21.5, nth: -1, pull: 2 }],
  },
  running: {
    name: 'the running club', venue: ['park', 'sports'], ages: [16, 65], perHead: 0.012, min: 6, topic: 'event',
    like: { base: 0.2, consc: 1, neuro: -0.4, ages: [[49, 1], [120, 0.6]] },
    offices: ['organiser'],
    meets: [{ kind: 'club', days: WED, from: 18.5, to: 19.5, pull: 1.2 }, { kind: 'club', days: SUN, from: 9, to: 10.5, pull: 1.2 }],
    big: { name: 'fun run', month: 5, after: 1, from: 10, to: 12, pull: 0.4, appeal: 'all', prize: '{subject} won the fun run' },
  },
  cards: {
    name: 'the card club', venue: ['pub'], ages: [45, 95], perHead: 0.007, min: 6, topic: 'event',
    like: { base: 0.7, extra: 0.5, open: -0.5, ages: [[59, 0.8], [120, 1.3]] },
    offices: ['organiser'],
    meets: [{ kind: 'club', days: MON, from: 19.5, to: 22.5, pull: 1.8 }],
    big: { name: 'winter tournament', month: 1, after: 15, from: 14, to: 20, pull: 0.15, appeal: 'adults', prize: '{subject} won the card club\'s winter tournament' },
  },
  history: {
    name: 'the local history society', venue: ['library', 'townhall'], ages: [40, 95], perHead: 0.008, min: 6, topic: 'event',
    like: { open: 0.7, loyal: 0.5, ages: [[54, 0.6], [120, 1.3]] },
    offices: ['chair', 'secretary'],
    meets: [{ kind: 'club', days: TUE, from: 19.5, to: 21, nth: 2, pull: 2 }],
    big: { name: 'exhibition on the town\'s past', month: 10, after: 1, from: 11, to: 17, pull: 0.25, appeal: 'adults' },
  },
  congregation: {
    name: 'the congregation', venue: ['church'], ages: [0, 120], perHead: 0, min: 5, topic: 'event',
    like: { faith: 1 },
    offices: ['priest', 'church elder', 'treasurer'], jobs: { priest: 'priest' },
    meets: [],
    big: { name: 'church fair', month: 7, after: 1, from: 12, to: 17, pull: 0.5, appeal: 'all' },
  },
  council: {
    name: 'the town council', venue: ['townhall'], ages: [21, 85], perHead: 0, min: 5, topic: 'politics',
    like: { ambition: 0.8, extra: 0.4, consc: 0.3, ages: [[34, 0.6], [120, 1.2]] },
    offices: ['mayor', 'deputy mayor'], jobs: { mayor: 'mayor' },
    meets: [{ kind: 'meeting', days: MON, from: 19, to: 21.5, nth: 1, months: months(1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12), pull: 3, open: 0.04 }],
  },
};

/** Clubs (not the congregation or the council) one person belongs to at most. */
const CLUB_CAP = 3;
/** Faith above which someone belongs to a congregation. */
const FAITHFUL = 0.68;

export const groupName = (kind: GroupKind): string => SPECS[kind].name;

/** A seat count for the council: 7 for a village, 11 for 1,500 people, at most 15. */
export const councilSeats = (people: number): number => Math.min(15, 7 + 2 * Math.floor(people / 600));

/** Personal taste for a kind of group, fixed for life: 0.2..1.4. */
const taste = (world: World, id: ActorId, kind: GroupKind) =>
  0.2 + 1.2 * hashToFloat(hashCombine(hashCombine(world.seed, id * 31 + 7), GROUP_KINDS.indexOf(kind)));

function fitOf(world: World, id: ActorId, kind: GroupKind): number {
  if (!isPerson(world, id)) return 0;
  const s = SPECS[kind], age = ageOf(world, id);
  if (age < s.ages[0] || age > s.ages[1]) return 0;
  return liking(world, id, age, s.like) * taste(world, id, kind);
}

const isClub = (g: Group) => g.kind !== 'congregation' && g.kind !== 'council';

// ---- reading --------------------------------------------------------------------------------------------

/** The groups `id` belongs to, with the office they hold there (null if none). For views and the NPC card. */
export function groupsOf(world: World, id: ActorId): { group: Group; office: string | null }[] {
  const out: { group: Group; office: string | null }[] = [];
  for (const g of world.groups.list) {
    if (g.folded || !g.members.includes(id)) continue;
    out.push({ group: g, office: g.offices.find((o) => o.holder === id)?.title ?? null });
  }
  return out;
}

/** The town's groups of a kind that are running. */
export const groupsOfKind = (world: World, kind: GroupKind): Group[] => world.groups.list.filter((g) => g.kind === kind && !g.folded);

// ---- founding --------------------------------------------------------------------------------------------

/** People alive and in town, by actor id. */
function people(world: World): ActorId[] {
  const out: ActorId[] = [];
  for (let id = 0; id < world.actors.count; id++) if (isPerson(world, id) && world.actors.cols.alive[id]) out.push(id);
  return out;
}

/**
 * The town's groups at the start (`createWorld` calls it once, before the history): every club the town has the
 * people and a place for, a congregation per church, the council. Members have belonged for years.
 */
export function foundGroups(world: World, rng: Rng): void {
  const everyone = people(world);
  const clubs = new Map<ActorId, number>();
  const day = dayOf(world.clock);
  for (const kind of GROUP_KINDS) {
    if (kind === 'congregation') {
      for (const church of placesOf(world, ['church'])) {
        const g = newGroup(world, kind, church, day - rng.int(36500, 73000), `the congregation of ${world.graph.places[church].name}`);
        for (const id of everyone) if (nearestChurch(world, id) === church && belongs(world, id)) join(world, g, id, day - rng.int(0, ageOf(world, id) * 365), true);
        elect(world, g, rng, true, false);
      }
      continue;
    }
    const s = SPECS[kind];
    const place = venueFor(world, kind);
    if (place < 0) continue;
    if (kind === 'council') {
      const g = newGroup(world, kind, place, day - rng.int(36500, 73000));
      const seats = councilSeats(everyone.length);
      const ranked = everyone.map((id) => ({ id, w: fitOf(world, id, kind) * rng.range(0.6, 1.4) })).filter((x) => x.w > 0).sort((x, y) => y.w - x.w);
      for (const { id } of ranked.slice(0, seats)) join(world, g, id, day - rng.int(0, 12 * 365), true);
      elect(world, g, rng, true, false);
      continue;
    }
    const target = Math.round(s.perHead * everyone.length);
    if (target < s.min) continue;
    const g = newGroup(world, kind, place, day - rng.int(3650, 36500));
    const pool = everyone.map((id) => ({ id, w: fitOf(world, id, kind) })).filter((x) => x.w > 0.15);
    for (let k = 0; k < target && pool.length > 0; k++) {
      const pick = rng.weighted(pool, (x) => x.w * x.w);
      pool.splice(pool.indexOf(pick), 1);
      if ((clubs.get(pick.id) ?? 0) >= CLUB_CAP) { k--; continue; }
      clubs.set(pick.id, (clubs.get(pick.id) ?? 0) + 1);
      const years = Math.max(0, ageOf(world, pick.id) - s.ages[0]);
      join(world, g, pick.id, day - rng.int(0, Math.min(years, 25) * 365), true);
    }
    elect(world, g, rng, true, false);
  }
}

function venueFor(world: World, kind: GroupKind): PlaceId {
  for (const k of SPECS[kind].venue) { const l = placesOf(world, [k]); if (l.length) return l[0]; }
  return -1;
}

function nearestChurch(world: World, id: ActorId): PlaceId {
  return world.travel.nearest(world.actors.cols.home[id], placesOf(world, ['church']));
}

/** Faithful adults, and children of a faithful parent at home. */
function belongs(world: World, id: ActorId): boolean {
  if (ageOf(world, id) >= 16) return valueOf(world, id, V_FAITH) >= FAITHFUL;
  const hh = world.households[world.people.cols.household[world.actors.cols.row[id]]];
  return !!hh && hh.members.some((m) => m !== id && ageOf(world, m) >= 18 && valueOf(world, m, V_FAITH) >= FAITHFUL);
}

function newGroup(world: World, kind: GroupKind, place: PlaceId, founded: number, name = SPECS[kind].name): Group {
  const g: Group = {
    id: world.groups.list.length, kind, name, place, members: [], since: [], founded, folded: false,
    offices: SPECS[kind].offices.map((title) => ({ title, holder: -1 })),
  };
  world.groups.list.push(g);
  for (const m of SPECS[kind].meets) {
    const r = { kind: m.kind, name: `${name}${m.kind === 'match' ? '\'s home match' : m.kind === 'meeting' ? ' meeting' : ''}`, place, start: m.from * 60, end: m.to * 60, days: m.days, nth: m.nth, months: m.months, activity: activityFor(kind) };
    addRecurring(world, { ...r, pull: m.pull, appeal: 'all', guests: g.members });
    if (m.open) addRecurring(world, { ...r, pull: m.open, appeal: 'adults', guests: null, activity: A.socialize });
  }
  return g;
}

function activityFor(kind: GroupKind): number {
  switch (kind) {
    case 'football': case 'running': case 'firebrigade': return A.exercise;
    case 'allotment': return A.leisure;
    case 'council': return A.work;
    default: return A.socialize;
  }
}

function join(world: World, g: Group, id: ActorId, day: number, quiet = false): void {
  if (g.members.includes(id)) return;
  g.members.push(id);
  g.since.push(day);
  if (!quiet) remember(world, id, { who: [], summary: `I joined ${g.name}`, importance: 0.35, emotion: 'joy' });
}

/** The council after an election (src/sim/politics.ts): exactly `ids`, changed in place; those re-elected keep their join day. */
export function seat(world: World, g: Group, ids: readonly ActorId[]): void {
  const day = dayOf(world.clock);
  for (let k = g.members.length - 1; k >= 0; k--) if (!ids.includes(g.members[k])) leave(g, k);
  for (const id of ids) join(world, g, id, day, true);
}

function leave(g: Group, k: number): void {
  const id = g.members[k];
  g.members.splice(k, 1);
  g.since.splice(k, 1);
  for (const o of g.offices) if (o.holder === id) o.holder = -1;
}

// ---- the slow process ------------------------------------------------------------------------------------

/**
 * Daily (from `passDays`): big days just held get their results; at each new calendar month members come and go,
 * clubs hold their annual general meeting, big days are announced, clubs fold or are founded.
 */
export function groupsDay(world: World): void {
  const now = world.clock;
  const gs = world.groups;
  const key = monthKey(world, now);
  if (gs.month < 0) gs.month = key;
  // The dead and those who left town are off the lists at once (the lists are the guest lists of meetings).
  const alive = world.actors.cols.alive;
  for (const g of gs.list) for (let k = g.members.length - 1; k >= 0; k--) if (!alive[g.members[k]]) leave(g, k);
  for (let k = gs.pending.length - 1; k >= 0; k--) {
    const p = gs.pending[k];
    if (p.start >= now) continue;
    gs.pending.splice(k, 1);
    held(world, world.groups.list[p.group], tickRng(world, 'groups', 'held', p.group));
  }
  for (let m = gs.month + 1; m <= key; m++) monthly(world, (m % 12) + 1, tickRng(world, 'groups', m));
  gs.month = key;
}

function monthly(world: World, month: number, rng: Rng): void {
  const everyone = people(world);
  const clubs = new Map<ActorId, number>();
  for (const g of world.groups.list) if (!g.folded && isClub(g)) for (const id of g.members) clubs.set(id, (clubs.get(id) ?? 0) + 1);
  for (const g of world.groups.list) {
    if (g.folded) continue;
    if (isClub(g) && g.members.length < Math.max(3, SPECS[g.kind].min / 2)) { fold(world, g); continue; }
    churn(world, g, everyone, clubs, rng);
    syncJobs(world, g);
    elect(world, g, rng, month === agmMonth(world, g));
    const big = SPECS[g.kind].big;
    if (big && big.month === (month % 12) + 1) announce(world, g, big, rng);
  }
  found(world, everyone, clubs, rng);
}

/** Each group's AGM month, fixed by seed (the council's is its January meeting). */
const agmMonth = (world: World, g: Group) => (g.kind === 'council' ? 1 : 1 + (hashCombine(world.seed, g.id * 97 + 13) % 12));

/** Members drift off or die; others join, pulled in by friends who are members. */
function churn(world: World, g: Group, everyone: ActorId[], clubs: Map<ActorId, number>, rng: Rng): void {
  const s = SPECS[g.kind];
  const a = world.actors.cols;
  const day = dayOf(world.clock);
  for (let k = g.members.length - 1; k >= 0; k--) {
    const id = g.members[k];
    if (!a.alive[id]) { leave(g, k); continue; }
    if (g.kind === 'council') continue; // seats change at elections
    const age = ageOf(world, id);
    if (g.kind === 'congregation') {
      if (!belongs(world, id) && rng.chance(0.08)) leave(g, k);
      continue;
    }
    // Outgrown it (the youth club at 18, playing football at 50), or lost interest: about one in eight a year.
    const fit = fitOf(world, id, g.kind);
    const out = age > s.ages[1] + (g.kind === 'youth' ? 0 : 5) ? 0.5 : 0.006 + 0.012 * Math.max(0, 1.2 - fit);
    if (rng.chance(out)) {
      leave(g, k);
      clubs.set(id, Math.max(0, (clubs.get(id) ?? 1) - 1));
    }
  }
  if (g.kind === 'council') return;
  if (g.kind === 'congregation') {
    for (let n = 0; n < 40; n++) {
      const id = everyone[rng.int(0, everyone.length - 1)];
      if (nearestChurch(world, id) === g.place && belongs(world, id) && !g.members.includes(id)) join(world, g, id, day, ageOf(world, id) < 16);
    }
    return;
  }
  // Newcomers: a sample of the town, the best fit joins, likelier with a friend already in.
  const want = Math.round(s.perHead * everyone.length) - g.members.length;
  const tries = Math.max(1, Math.round(want * 0.25 + rng.float()));
  if (want <= 0 && !rng.chance(0.15)) return;
  for (let n = 0; n < tries; n++) {
    let best = -1, bw = 0.3;
    for (let k = 0; k < 24; k++) {
      const id = everyone[rng.int(0, everyone.length - 1)];
      if ((clubs.get(id) ?? 0) >= CLUB_CAP || g.members.includes(id)) continue;
      const w = fitOf(world, id, g.kind) * (friendIn(world, id, g) ? 2 : 1) * rng.range(0.5, 1);
      if (w > bw) { bw = w; best = id; }
    }
    if (best < 0) continue;
    join(world, g, best, day);
    clubs.set(best, (clubs.get(best) ?? 0) + 1);
  }
}

function friendIn(world: World, id: ActorId, g: Group): boolean {
  const rel = world.relations;
  for (const r of rel.known(id)) if (rel.t.cols.affection[r] > 0.4 && g.members.includes(rel.t.cols.to[r])) return true;
  return false;
}

/** Offices that go with a job are held by whoever has the job, who is a member by that (the priest, the mayor). */
function syncJobs(world: World, g: Group): void {
  const jobs = SPECS[g.kind].jobs;
  if (!jobs) return;
  for (const o of g.offices) {
    const role = jobs[o.title];
    if (!role) continue;
    const j = world.jobs.find((x) => x.role === role && x.holder >= 0 && (x.place === g.place || g.kind === 'firebrigade'));
    const holder = j ? j.holder : -1;
    if (holder >= 0 && !g.members.includes(holder)) join(world, g, holder, dayOf(world.clock), true);
    o.holder = holder >= 0 ? holder : o.holder;
  }
}

/**
 * Offices are filled by the members with standing (conscientious, ambitious, long in the club). At the annual
 * general meeting (`agm`) most holders stand again and are re-elected; in between only an empty office is filled.
 * New office holders are club news, except at the town's start.
 */
function elect(world: World, g: Group, rng: Rng, agm: boolean, news = true): void {
  syncJobs(world, g);
  const jobs = SPECS[g.kind].jobs ?? {};
  const day = dayOf(world.clock);
  for (const o of g.offices) {
    if (jobs[o.title]) continue; // goes with the job, never elected
    const k = g.members.indexOf(o.holder);
    if (k >= 0 && (!agm || (ageOf(world, o.holder) < 78 && rng.chance(0.85)))) continue;
    const taken = new Set(g.offices.map((x) => x.holder));
    let best = -1, bw = -1;
    for (let i = 0; i < g.members.length; i++) {
      const id = g.members[i];
      if (taken.has(id) || ageOf(world, id) < 18) continue;
      const years = (day - g.since[i]) / 365;
      const w = traitOf(world, id, T_CONSC) + valueOf(world, id, V_AMBITION) * 0.7 + traitOf(world, id, T_EXTRA) * 0.3 + Math.min(years, 20) / 20 + rng.float() * 0.4;
      if (w > bw) { bw = w; best = id; }
    }
    if (best < 0 || best === o.holder) continue;
    o.holder = best;
    if (!news) continue;
    const fact = addFact(world, { topic: SPECS[g.kind].topic, text: `{subject} is the new ${o.title} of ${g.name}`, subject: best, place: g.place, magnitude: g.kind === 'council' ? 0.45 : 0.25 });
    witness(world, fact, g.members);
    broadcast(world, fact, 0.04);
    remember(world, best, { who: [], summary: `I was elected ${o.title} of ${g.name}`, importance: 0.55, emotion: 'joy', fact });
  }
}

/** A month ahead: put the big day in the agenda for its Saturday and tell the town about it. */
function announce(world: World, g: Group, big: BigDay, rng: Rng): void {
  const date = dateOf(world, world.clock);
  let day = gameDayOf(world, date.year + (big.month < date.month ? 1 : 0), big.month, big.after);
  while (weekdayOfDays(world.epoch + day) !== 5) day++;
  const at = day * MINUTES_PER_DAY;
  if (at <= world.clock) return;
  const place = big.at ? (placesOf(world, [big.at])[0] ?? g.place) : g.place;
  const o = addOccasion(world, {
    kind: 'club', name: `${g.name}'s ${big.name}`, place, start: at + big.from * 60, end: at + big.to * 60, pull: big.pull,
    appeal: big.appeal, guests: null, activity: A.socialize, about: [],
  });
  world.groups.pending.push({ group: g.id, occasion: o.id, start: o.start });
  const fact = addFact(world, { topic: 'event', text: `${g.name} is holding its ${big.name} on ${formatDate(dateOf(world, at))}`, place, magnitude: 0.2 });
  witness(world, fact, g.members);
  broadcast(world, fact, 0.2 + rng.float() * 0.1);
}

/** After the big day: the winner, or the season's result, is news; members remember the day. */
function held(world: World, g: Group, rng: Rng): void {
  const big = SPECS[g.kind].big;
  if (!big || g.folded) return;
  let fact = -1;
  if (big.prize) {
    const adults = g.members.filter((id) => ageOf(world, id) >= 14);
    if (adults.length) {
      const winner = rng.weighted(adults, (id) => 0.3 + traitOf(world, id, T_CONSC));
      fact = addFact(world, { topic: 'event', text: big.prize, subject: winner, place: g.place, magnitude: 0.3 });
      remember(world, winner, { who: [], summary: big.prize.replace('{subject}', 'I'), importance: 0.6, emotion: 'joy', fact });
    }
  } else if (big.result) {
    const line = big.result[rng.int(0, big.result.length - 1)];
    fact = addFact(world, { topic: 'event', text: `${g.name} ${line}`, place: g.place, magnitude: 0.3 });
  }
  if (fact >= 0) { witness(world, fact, g.members); broadcast(world, fact, 0.1); }
  for (const id of g.members) if (rng.chance(0.3)) remember(world, id, { who: [], summary: `${g.name}'s ${big.name}`, importance: 0.3, emotion: 'joy' });
}

/** Too few members to carry on: the club folds, and that is news. */
function fold(world: World, g: Group): void {
  g.folded = true;
  const fact = addFact(world, { topic: 'event', text: `${g.name} has folded for lack of members`, place: g.place, magnitude: 0.4 });
  witness(world, fact, [...g.members, ...closeTo(world, ...g.members)]);
  broadcast(world, fact, 0.15);
  g.members.splice(0);
  g.since.splice(0);
  for (const o of g.offices) o.holder = -1;
}

/**
 * Now and then someone starts a club the town lacks, when there are people for it and a place to meet: the
 * founder (ambitious, a good fit) and a handful of friends and keen people.
 */
function found(world: World, everyone: ActorId[], clubs: Map<ActorId, number>, rng: Rng): void {
  if (!rng.chance(0.03)) return;
  const lacking = GROUP_KINDS.filter((k) => k !== 'congregation' && k !== 'council' && groupsOfKind(world, k).length === 0
    && Math.round(SPECS[k].perHead * everyone.length) >= SPECS[k].min && venueFor(world, k) >= 0);
  if (lacking.length === 0) return;
  const kind = lacking[rng.int(0, lacking.length - 1)];
  let founder = -1, bw = 0;
  for (let k = 0; k < 60; k++) {
    const id = everyone[rng.int(0, everyone.length - 1)];
    if ((clubs.get(id) ?? 0) >= CLUB_CAP || ageOf(world, id) < 20) continue;
    const w = fitOf(world, id, kind) * (0.3 + valueOf(world, id, V_AMBITION));
    if (w > bw) { bw = w; founder = id; }
  }
  if (founder < 0) return;
  const day = dayOf(world.clock);
  const g = newGroup(world, kind, venueFor(world, kind), day);
  join(world, g, founder, day);
  g.offices[0].holder = founder;
  const fact = addFact(world, { topic: 'event', text: `{subject} is starting ${g.name}`, subject: founder, place: g.place, magnitude: 0.3 });
  witness(world, fact, closeTo(world, founder));
  broadcast(world, fact, 0.2);
  remember(world, founder, { who: [], summary: `I started ${g.name}`, importance: 0.7, emotion: 'joy', fact });
}

// ---- the chronicle's club evenings -----------------------------------------------------------------------

/** Meetings a week, on average (the n-th weekday of the month counts a quarter, seasons pro rata). */
function perWeek(kind: GroupKind): number {
  let n = 0;
  for (const m of SPECS[kind].meets) {
    const days = popcount(m.days);
    const share = m.months === undefined ? 1 : popcount(m.months) / 12;
    n += days * share * (m.nth === undefined ? 1 : 0.23);
  }
  return n;
}

/**
 * The coarse model's stand-in for club evenings over `days` (src/sim/chronicle.ts): a couple of sampled meetings
 * per group, where the members who come talk with one another through the live `encounter`, so club friends become
 * friends and club news spreads in the time skip too.
 */
export function clubEvenings(world: World, days: number): void {
  const rng = tickRng(world, 'clubs');
  for (const g of world.groups.list) {
    if (g.folded || g.members.length < 2) continue;
    const meetings = (perWeek(g.kind) * days) / 7;
    if (meetings <= 0) continue;
    const sampled = Math.min(2, Math.max(1, Math.round(meetings)));
    if (meetings < 1 && !rng.chance(meetings)) continue;
    const stands = Math.max(1, meetings / sampled);
    for (let s = 0; s < sampled; s++) {
      const there = g.members.filter((id) => world.actors.cols.alive[id] && rng.chance(0.65));
      for (const x of there) {
        const y = there[rng.int(0, there.length - 1)];
        if (y === x) continue;
        encounter(world, g.place, x, y, 1.2 * stands, rng);
      }
      world.encounters.length = 0;
    }
  }
}

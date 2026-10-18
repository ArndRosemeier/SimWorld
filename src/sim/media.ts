/**
 * The town's own media (town-realism track H, plan §2.2 "Broadcast"): the weekly local paper, the notice boards and
 * the posters on lamp posts and shop windows. Everything printed or pinned up comes from something that happened in
 * the sim (a death and its funeral, a shop closing, a burglary, a pet that went missing, the festival next week), and
 * the people who read it come to know it: the paper and the posters are broadcast channels of the knowledge network,
 * with real readers (subscribers, the newsagent's and the café's regulars, people who pass a board), not a share
 * of the town drawn at random.
 *
 * The words are procedural (no LLM). The shape of an item (what happened, its headline, a line of copy) follows
 * Scale's city news (src/game/news/headlines.ts), with its superhero and crime-wave content left behind.
 *
 * Plain data on `world.media`, so it saves and crosses to the worker as is. `mediaDay` runs in `passDays`, so the
 * live tick, the chronicle and the town's history all print the same paper.
 */
import { clamp, hash3i, hashCombine, hashToFloat } from '@futuremagic/core';
import { ACTOR_PERSON, FEMALE, type ActorId } from './actors';
import { agendaOn, type Occasion, type OccasionKind } from './agenda';
import { dateOf, dayAndMonth, formatDate, weekdayName } from './calendar';
import type { BizEvent } from './economy';
import { regularsOf } from './economy';
import { addFact, broadcast, factText, type FactTopic } from './knowledge';
import { partnerOf, type LifeEvent } from './life';
import { capitalize } from './profile';
import type { PlaceId, PlaceKind } from './places';
import { HABIT_COUNT } from './people';
import { SPECIES } from './species';
import { dayOf, hhmm, MINUTES_PER_DAY, weekdayOf } from './time';
import { ageOf, firstName, isPerson, nameOf, placesOf, tickRng, type World } from './world';

/** Where the town's notice boards stand: inside or by the door of these places, and one on the square. */
export const BOARD_KINDS: readonly PlaceKind[] = ['townhall', 'library', 'church', 'supermarket', 'post', 'newsagent', 'square'];

export type Section = 'front' | 'town' | 'business' | 'police' | 'family' | 'whatson';

/** One item in an edition. */
export interface Story {
  section: Section;
  headline: string;
  /** A line or two of copy; '' for a bare listing. */
  text: string;
  /** The fact readers come to know. */
  fact: number;
  place: PlaceId;
  /** How big a story it is (the front page is the biggest). */
  weight: number;
}

export interface Edition {
  /** Issue number, from 1. */
  no: number;
  /** Game day it came out. */
  day: number;
  /** "Thursday 22 October 2026", as on the masthead. */
  dated: string;
  /** The front-page story first, then the rest by section. */
  stories: Story[];
}

export type NoticeKind = 'event' | 'funeral' | 'lostPet' | 'opening' | 'closing';

/** A poster or a notice: on boards, on the lamp posts of a street, in a shop window (the places in `at`). */
export interface Notice {
  id: number;
  kind: NoticeKind;
  /** The big line ("LOST CAT", "Summer Festival"). */
  title: string;
  lines: string[];
  /** What a reader comes to know. */
  fact: number;
  /** Board places, street places (lamp posts) and shop places (the window). */
  at: PlaceId[];
  /** Game days it hangs (until the end of `until`). */
  from: number;
  until: number;
  /** Who or what it is about (the pet, the dead, the shop's owner), -1 if none. */
  about: ActorId;
}

export interface Media {
  /** The last few editions, oldest first. */
  editions: Edition[];
  notices: Notice[];
  nextNotice: number;
  /** How far the paper has read the sim's records (indices into facts, life events, business events). */
  seen: { fact: number; event: number; biz: number; bizPosted: number };
  /** An occasion (`occasionKey`) → the fact of it being on, and the day it ends (dropped after). */
  occasions: Record<string, [number, number]>;
}

export const newMedia = (): Media => ({ editions: [], notices: [], nextNotice: 0, seen: { fact: 0, event: 0, biz: 0, bizPosted: 0 }, occasions: {} });

const KEEP_EDITIONS = 8;
/** At most this many news stories an edition (the What's on listing comes on top). */
const MAX_STORIES = 12;
/** Notices for coming occasions go up this many days ahead. */
const POST_AHEAD = 14;
/** Chance a passer-by reads a given notice on a given day. */
const NOTICE_READ = 0.1;

/** Occasions with posters and a line in What's on; the routine ones (market) only get the line. */
const POSTED: readonly OccasionKind[] = ['festival', 'christmasMarket', 'newYear', 'match', 'club', 'meeting'];
const LISTED: readonly OccasionKind[] = [...POSTED, 'market', 'halloween'];
/** Town-wide occasions: on every board, and posters along the centre's streets. */
const TOWN_WIDE: readonly OccasionKind[] = ['festival', 'christmasMarket', 'newYear'];
/** Fact topics the paper picks up from anywhere in the sim (a council vote, a public event). */
const PICKED_UP: readonly FactTopic[] = ['politics', 'event'];


/** The paper's name: "The Ashford Courier". */
export function paperName(world: World): string {
  const town = world.region?.region.town ?? 'Town';
  const titles = ['Courier', 'Gazette', 'Herald', 'Post', 'Chronicle', 'Advertiser'];
  return `The ${town} ${titles[hashCombine(world.seed, 0x9a7e) % titles.length]}`;
}

/** The weekday the paper comes out (Thursday or Friday, by town). */
export const paperDay = (world: World): number => 3 + (hashCombine(world.seed, 0x9a9) % 2);

/** The newest edition, or null before the first one. */
export const latestEdition = (world: World): Edition | null => world.media.editions.at(-1) ?? null;

/** The notices up at a place today (a board, a street's lamp posts, a shop window). */
export const noticesAt = (world: World, place: PlaceId): Notice[] => world.media.notices.filter((n) => n.at.includes(place));

/** What the main thread gets of the media (in `SimView`): the paper's name, the newest edition, the notices up. */
export interface MediaView { paper: string; edition: Edition | null; notices: Notice[] }

export const mediaView = (world: World): MediaView => ({ paper: paperName(world), edition: latestEdition(world), notices: world.media.notices });

/** The town's notice boards. */
export const boardsOf = (world: World): PlaceId[] => placesOf(world, BOARD_KINDS);

// ---- the day --------------------------------------------------------------------------------------------------

/**
 * The media over the `days` ending now (at midnight; once a day live, in steps in the chronicle): new notices go
 * up, old ones come down, passers-by read what hangs on their way, and on paper day the paper comes out.
 */
export function mediaDay(world: World, days: number): void {
  const day = dayOf(world.clock);
  const m = world.media;
  m.notices = m.notices.filter((n) => n.until >= day);
  for (const [k, [, end]] of Object.entries(m.occasions)) if (end < day) delete m.occasions[k];
  postOccasions(world, day);
  postBusiness(world, day);
  readNotices(world, days);
  const pd = paperDay(world);
  for (let d = day - Math.min(days, 7) + 1; d <= day; d++) {
    if (weekdayOf(d * MINUTES_PER_DAY) === pd) { publish(world, day); break; }
  }
}

/**
 * A new world's paper: the issue that came out on the last paper day before play (What's on from today), so there is
 * one to read from the first minute. `createWorld` calls it when no history printed one. Nobody learns from it: the
 * town read it before play began (its news already lives in what people know).
 */
export function lastEdition(world: World): void {
  const today = dayOf(world.clock);
  publish(world, today - ((weekdayOf(world.clock) - paperDay(world) + 7) % 7), today, false);
}

/** Pin up a notice (lost pets come through here too). Returns it. */
export function postNotice(world: World, n: Omit<Notice, 'id'>): Notice {
  const full = { ...n, id: world.media.nextNotice++ };
  world.media.notices.push(full);
  return full;
}

/** The `k` boards nearest to `place` (by travel time). */
export function nearestBoards(world: World, place: PlaceId, k: number): PlaceId[] {
  return boardsOf(world).map((b) => [b, world.travel.minutes(place, b)] as const).sort((a, b) => a[1] - b[1] || a[0] - b[0]).slice(0, k).map(([b]) => b);
}

// ---- occasions: posters and What's on -------------------------------------------------------------------------

const occasionKey = (o: Occasion) => `${o.kind}:${o.place}:${o.start}`;

/** "Saturday 12 July". */
const dayText = (world: World, clock: number) => dayAndMonth(dateOf(world, clock));

/** The fact of an occasion being on (made once per occasion, shared by the poster and the paper). */
function occasionFact(world: World, o: Occasion): number {
  const key = occasionKey(o);
  const known = world.media.occasions[key];
  if (known) return known[0];
  const where = o.place >= 0 ? ' at {place}' : '';
  const fact = addFact(world, {
    topic: 'event', text: `${o.name} is on${where} on ${dayText(world, o.start)} at ${hhmm(o.start)}`, place: o.place, time: o.start,
    magnitude: TOWN_WIDE.includes(o.kind) ? 0.5 : 0.3,
  });
  world.media.occasions[key] = [fact, dayOf(o.end)];
  return fact;
}

/** Occasions of `kinds` in the `n` days from `day`, each once (a funeral lists on its own day only). */
function coming(world: World, day: number, n: number, kinds: readonly OccasionKind[]): Occasion[] {
  const out: Occasion[] = [];
  for (let d = day; d < day + n; d++) for (const o of agendaOn(world, d)) if (kinds.includes(o.kind) && dayOf(o.start) === d) out.push(o);
  return out;
}

function postOccasions(world: World, day: number): void {
  const m = world.media, places = world.graph.places;
  for (const o of coming(world, day, POST_AHEAD, [...POSTED, 'funeral'])) {
    if (m.occasions[occasionKey(o)]) continue;
    const fact = occasionFact(world, o);
    const venue = o.place >= 0 ? places[o.place] : null;
    const when = `${dayText(world, o.start)}, ${hhmm(o.start)}`;
    if (o.kind === 'funeral') {
      const dead = o.about[0] ?? -1;
      if (dead < 0 || !venue) continue;
      const born = dateOf(world, world.actors.cols.birth[dead] * MINUTES_PER_DAY).year;
      postNotice(world, {
        kind: 'funeral', title: `In loving memory of ${nameOf(world, dead)}`, lines: [`${born} – ${dateOf(world, world.clock).year}`, `Funeral service ${when}`, venue.name],
        fact, at: [...new Set([o.place, ...placesOf(world, ['church'])])], from: day, until: dayOf(o.start), about: dead,
      });
      continue;
    }
    const at = new Set<PlaceId>();
    if (o.place >= 0) at.add(o.place);
    if (TOWN_WIDE.includes(o.kind)) {
      for (const b of boardsOf(world)) { at.add(b); if (world.streetOf[b] >= 0) at.add(world.streetOf[b]); }
      if (o.place >= 0 && world.streetOf[o.place] >= 0) at.add(world.streetOf[o.place]);
    } else {
      for (const b of nearestBoards(world, Math.max(0, o.place), 2)) at.add(b);
      if (o.kind === 'meeting') for (const t of placesOf(world, ['townhall'])) at.add(t);
    }
    postNotice(world, { kind: 'event', title: capitalize(o.name.replace(/^the /, '')), lines: [when, venue?.name ?? 'in every street'], fact, at: [...at], from: day, until: dayOf(o.start), about: -1 });
  }
}

// ---- shop windows -------------------------------------------------------------------------------------------

function postBusiness(world: World, day: number): void {
  const m = world.media, ev = world.economy.events;
  for (let i = m.seen.bizPosted; i < ev.length; i++) {
    const e = ev[i];
    if (e.kind === 'opened') postNotice(world, { kind: 'opening', title: 'Grand opening', lines: [e.name, 'Now open. Come and say hello!'], fact: e.fact, at: [e.place], from: e.day, until: e.day + 14, about: e.who });
    if (e.kind === 'closed') postNotice(world, { kind: 'closing', title: 'Closed', lines: [e.name, 'Thank you to all our customers.'], fact: e.fact, at: [e.place], from: e.day, until: e.day + 45, about: e.who });
  }
  m.seen.bizPosted = ev.length;
  void day;
}

// ---- reading notices ---------------------------------------------------------------------------------------

/**
 * Who passes each street: the people who live on it, work on it, or have a favourite place on it (people 8 and up).
 * A notice on a board, a lamp post or in a window is seen by the passers of its street.
 */
function passersByStreet(world: World): Map<PlaceId, ActorId[]> {
  const a = world.actors.cols, pc = world.people.cols, out = new Map<PlaceId, ActorId[]>();
  const seen = new Set<PlaceId>();
  for (let id = 0; id < world.actors.count; id++) {
    if (!isPerson(world, id) || !a.alive[id] || ageOf(world, id) < 8) continue;
    const r = a.row[id];
    seen.clear();
    const pass = (p: PlaceId) => {
      const s = p >= 0 ? world.streetOf[p] : -1;
      if (s < 0 || seen.has(s)) return;
      seen.add(s);
      const l = out.get(s);
      if (l) l.push(id); else out.set(s, [id]);
    };
    pass(a.home[id]);
    const job = pc.job[r];
    if (job >= 0) pass(world.jobs[job].place);
    for (let k = 0; k < HABIT_COUNT; k++) pass(pc.habits[r * HABIT_COUNT + k]);
  }
  return out;
}

function readNotices(world: World, days: number): void {
  const notices = world.media.notices;
  if (!notices.length) return;
  const passers = passersByStreet(world);
  const p = 1 - Math.pow(1 - NOTICE_READ, Math.min(days, 14));
  for (const n of notices) {
    if (n.fact < 0) continue;
    const rng = tickRng(world, 'notice', n.id);
    const who = new Set<ActorId>();
    for (const at of n.at) for (const id of passers.get(world.streetOf[at]) ?? []) who.add(id);
    const readers = [...who].filter(() => rng.chance(p));
    if (readers.length) broadcast(world, n.fact, readers);
  }
}

// ---- the paper ----------------------------------------------------------------------------------------------

/**
 * Who reads the paper: subscribing households (more likely the older they are) and the regulars of the newsagent
 * and the café, who read it there. Everyone 14 and up in a subscribing household.
 */
export function paperReaders(world: World): ActorId[] {
  const out = new Set<ActorId>();
  for (const hh of world.households) {
    if (!hh.members.length) continue;
    const eldest = Math.max(...hh.members.map((x) => ageOf(world, x)));
    const share = 0.25 + 0.5 * clamp((eldest - 25) / 50, 0, 1);
    if (hashToFloat(hash3i(world.seed, hh.id, 0x7a9e, 0)) >= share) continue;
    for (const x of hh.members) if (ageOf(world, x) >= 14) out.add(x);
  }
  for (const p of placesOf(world, ['newsagent', 'cafe'])) for (const id of regularsOf(world, p)) out.add(id);
  return [...out];
}

function publish(world: World, day: number, from = day, read = true): void {
  const m = world.media, stories: Story[] = [], used = new Set<number>();
  const take = (s: Story | null) => { if (s && s.fact >= 0 && !used.has(s.fact)) { used.add(s.fact); stories.push(s); } };
  const ev = world.life.events;
  for (let i = m.seen.event; i < ev.length; i++) take(lifeStory(world, ev[i]));
  m.seen.event = ev.length;
  const biz = world.economy.events;
  for (let i = m.seen.biz; i < biz.length; i++) take(bizStory(world, biz[i]));
  m.seen.biz = biz.length;
  // Anything else public and big enough that happened in town: not standing knowledge (region lore), not off the map.
  const facts = world.knowledge.facts, ours = new Set(Object.values(m.occasions).map(([f]) => f));
  const standing = new Set(world.knowledge.standing.map((s) => s.fact));
  const places = world.graph.places;
  for (let i = m.seen.fact; i < facts.length; i++) {
    const f = facts[i];
    if (f.parent >= 0 || f.secret || !f.truth || f.originator >= 0 || f.magnitude < 0.5 || ours.has(f.id) || standing.has(f.id) || !PICKED_UP.includes(f.topic)) continue;
    if (f.place >= 0 && places[f.place].kind === 'away') continue;
    take({ section: 'town', headline: capitalize(factText(world, f)), text: f.topic === 'politics' ? councilLine(world, day) : '', fact: f.id, place: f.place, weight: f.magnitude });
  }
  m.seen.fact = facts.length;
  stories.sort((a, b) => b.weight - a.weight || a.fact - b.fact);
  const news = stories.slice(0, MAX_STORIES);
  if (news.length) news[0] = { ...news[0], section: 'front' };
  const listing = coming(world, from, 7, LISTED).map((o): Story => ({
    section: 'whatson', headline: `${weekdayName(weekdayOf(o.start)).slice(0, 3)} ${hhmm(o.start)}: ${capitalize(o.name.replace(/^the /, ''))}`,
    text: o.place >= 0 ? world.graph.places[o.place].name : 'all over town', fact: occasionFact(world, o), place: o.place, weight: 0,
  }));
  const edition: Edition = { no: (m.editions.at(-1)?.no ?? 0) + 1, day, dated: formatDate(dateOf(world, day * MINUTES_PER_DAY)), stories: [...news, ...listing] };
  m.editions.push(edition);
  if (m.editions.length > KEEP_EDITIONS) m.editions.splice(0, m.editions.length - KEEP_EDITIONS);
  // Readers come to know what they read: the front page nearly always, the rest by chance.
  if (!read) return;
  const readers = paperReaders(world);
  for (const s of edition.stories) {
    const rng = tickRng(world, 'paper', s.fact);
    const p = s.section === 'front' ? 0.9 : s.section === 'whatson' ? 0.35 : 0.55;
    const who = readers.filter(() => rng.chance(p));
    if (who.length) broadcast(world, s.fact, who);
  }
}

/** "The council meets next on Tuesday 3 November at 19:00 at the Town Hall." ('' when no meeting is on the agenda.) */
function councilLine(world: World, day: number): string {
  const halls = placesOf(world, ['townhall']);
  const next = coming(world, day, 35, ['meeting']).find((o) => halls.includes(o.place));
  return next ? `The council meets next on ${dayText(world, next.start)} at ${hhmm(next.start)} at ${world.graph.places[next.place].name}.` : '';
}

function streetName(world: World, place: PlaceId): string {
  return place >= 0 ? world.graph.places[place].street : '';
}

/** The paper's item for a life event, or null if the paper does not print it (romance, illness and the like). */
function lifeStory(world: World, e: LifeEvent): Story | null {
  if (e.fact < 0 || world.knowledge.facts[e.fact].secret) return null;
  const a = world.actors.cols, places = world.graph.places;
  const person = (id: ActorId) => id >= 0 && a.kind[id] === ACTOR_PERSON;
  const on = weekdayName(weekdayOf(e.day * MINUTES_PER_DAY));
  const at = (p: PlaceId) => (p >= 0 ? places[p].name : 'town');
  const item = (section: Section, headline: string, text: string, weight: number): Story => ({ section, headline, text, fact: e.fact, place: e.place, weight });
  switch (e.kind) {
    case 'death': {
      if (!person(e.who)) return null;
      const age = ageOf(world, e.who);
      const funeral = funeralOf(world, e.who);
      const rite = funeral && funeral.place >= 0 ? ` The funeral is at ${places[funeral.place].name} on ${dayText(world, funeral.start)} at ${hhmm(funeral.start)}.` : '';
      const home = streetName(world, e.place);
      return item('family', `${nameOf(world, e.who)}, ${age}`, `${home ? `Of ${home}, d` : 'D'}ied on ${on}.${rite}`, age < 60 ? 0.8 : 0.35);
    }
    case 'birth': {
      if (!person(e.who) || !person(e.other)) return null;
      const dad = partnerOf(world, e.other);
      const parents = dad >= 0 ? `${firstName(world, e.other)} and ${nameOf(world, dad)}` : nameOf(world, e.other);
      return item('family', `Born: ${nameOf(world, e.who)}`, `A ${a.sex[e.who] === FEMALE ? 'daughter' : 'son'} for ${parents}.`, 0.3);
    }
    case 'marriage':
      return item('family', `${nameOf(world, e.who)} and ${nameOf(world, e.other)} wed`, `The couple were married on ${on}.`, 0.45);
    case 'engagement':
      return item('family', `Engaged: ${nameOf(world, e.who)} and ${nameOf(world, e.other)}`, '', 0.25);
    case 'retired':
      return e.place >= 0 ? item('business', `${nameOf(world, e.who)} retires from ${at(e.place)}`, '', 0.3) : null;
    case 'theft': return item('police', `Shoplifting at ${at(e.place)}`, 'Police ask anyone who saw anything to come forward.', 0.5);
    case 'burglary': return item('police', `Burglary on ${streetName(world, e.place) || 'a quiet street'}`, `A home was broken into on ${on}. Police ask neighbours to keep an eye out.`, 0.6);
    case 'vandalism': return item('police', `Graffiti at ${at(e.place)}`, 'Police are looking into it.', 0.4);
    case 'fight': return item('police', `Scuffle at ${at(e.place)}`, '', 0.4);
    case 'petLost': {
      const species = SPECIES[a.species[e.who]].name;
      return item('town', `Have you seen ${firstName(world, e.who)}?`, `${person(e.other) ? `${nameOf(world, e.other)}'s` : 'A'} ${species} has been missing from ${streetName(world, e.place) || 'home'} since ${on}.`, 0.35);
    }
    case 'petFound':
      return item('town', `${firstName(world, e.who)} is home`, person(e.other) ? `Found by ${nameOf(world, e.other)}.` : '', 0.2);
    default:
      return null;
  }
}

/** The funeral of `dead` still to come, if one is planned. */
function funeralOf(world: World, dead: ActorId): Occasion | undefined {
  for (const o of world.agenda.once) if (o.kind === 'funeral' && o.about.includes(dead)) return o;
  return undefined;
}

function bizStory(world: World, e: BizEvent): Story | null {
  if (e.fact < 0) return null;
  const item = (headline: string, text: string, weight: number): Story => ({ section: 'business', headline, text, fact: e.fact, place: e.place, weight });
  const st = streetName(world, e.place);
  if (e.kind === 'opened') return item(`${e.name} opens on ${st}`, e.who >= 0 && isPerson(world, e.who) ? `Run by ${nameOf(world, e.who)}.` : '', 0.6);
  if (e.kind === 'closed') return item(`${e.name} closes its doors`, `The ${st} shop has shut for good.`, 0.7);
  return null;
}

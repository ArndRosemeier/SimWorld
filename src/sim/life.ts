/**
 * Life events (plan §1.3, R4, D3): the slow processes of a town, run once per game day by `tick` (live) and by the
 * chronicle (time skip, town history). Birthdays and school transitions, illness and recovery, deaths, romance
 * (dating, moving in, marriage, break-ups, affairs), pregnancy and birth, jobs (hiring, firing, changing, retiring),
 * leaving home, households moving in and away, pets, and rare crime.
 *
 * Game time is real time (D3), so the hazards are real-world yearly rates turned into daily chances, shaped by age,
 * health, personality and relationships. Every event is recorded in `world.life.events` and, where people would talk
 * about it, becomes a fact known first to those who were there; gossip carries it from there.
 */
import { clamp, hashCombine, type Rng } from '@futuremagic/core';
import { A, ACTOR_ANIMAL, ACTOR_PERSON, EMOTION_COUNT, FEMALE, MALE, type ActorId } from './actors';
import { intend } from './intentions';
import { addFact, broadcast, witness } from './knowledge';
import { remember } from './memory';
import { EMOTIONS, type Emotion } from './mind/proposal';
import { PET_NAMES } from './names';
import { T_AGREE, T_CONSC, T_EXTRA, T_NEURO, T_OPEN, V_HONEST, V_LOYAL, type Household, type Job } from './people';
import type { PlaceId, PlaceKind } from './places';
import { isHome } from './placeKinds';
import { bond, bondBit, FAMILY_MASK, liking, unbond } from './relations';
import { SPECIES, speciesId } from './species';
import { addHousehold, adoptPet, fitRoutine, newAnimal, newPerson, settle, type HouseholdType } from './synth';
import { regionDestination, type RegionPlace } from './region';
import { DAYS_PER_YEAR, MINUTES_PER_DAY } from './time';
import { ageOf, commute, householdOf, isPerson, jobOf, nameOf, placesOf, tickRng, traitOf, valueOf, type World } from './world';

export const LIFE_EVENTS = [
  'birthday', 'schoolStart', 'schoolEnd', 'illness', 'recovery', 'death', 'dating', 'moveIn', 'marriage', 'breakup',
  'divorce', 'affair', 'pregnancy', 'birth', 'hired', 'fired', 'quit', 'retired', 'leftHome', 'arrived', 'departed',
  'petAdopted', 'theft', 'burglary', 'vandalism', 'fight',
] as const;
export type LifeEventKind = (typeof LIFE_EVENTS)[number];

export interface LifeEvent {
  /** Game day. */
  day: number;
  kind: LifeEventKind;
  /** The person (or animal) it happened to; -1 if unknown (an unsolved theft). */
  who: ActorId;
  /** The other party (partner, mother, victim, employer's place is `place`), -1 if none. */
  other: ActorId;
  place: PlaceId;
  /** The fact people tell each other about it, -1 if nobody talks about it. */
  fact: number;
}

export interface Pregnancy { father: ActorId; due: number; announced: boolean }

export interface Life {
  events: LifeEvent[];
  /** Derived each `lifeDay`: actor → living partner or -1 (not saved). */
  partner?: Int32Array;
  /** Expecting mothers. */
  pregnant: Map<ActorId, Pregnancy>;
  /** Couples (`coupleKey`) → day they got together. */
  together: Map<number, number>;
}

export const newLife = (): Life => ({ events: [], pregnant: new Map(), together: new Map() });

/** Who moves to a small town: mostly young people and families (work, a cheaper house, a garden). */
const NEWCOMERS_HOUSE: [HouseholdType, number][] = [['coupleYoung', 0.25], ['family', 0.55], ['singleParent', 0.05], ['coupleMid', 0.1], ['multiGen', 0.05]];
const NEWCOMERS_FLAT: [HouseholdType, number][] = [['singleYoung', 0.4], ['coupleYoung', 0.3], ['family', 0.1], ['singleParent', 0.05], ['singleMid', 0.1], ['flatshare', 0.05]];

const PARTNERS = bondBit('partner') | bondBit('spouse');
const SPOUSE = bondBit('spouse');
const CHILD = bondBit('child');
const PARENT = bondBit('parent');
const NO_ROMANCE = FAMILY_MASK | bondBit('ex');
const KEY = 1 << 22;
const coupleKey = (a: ActorId, b: ActorId) => Math.min(a, b) * KEY + Math.max(a, b);

/** Days the current `lifeDay` call covers (1 live; more for the chronicle's coarse steps). Set only inside `lifeDay`. */
let step = 1;

/** Chance that something happening `perYear` times a year (a hazard rate) happens within the current step. */
export const happens = (perYear: number, days = step) => 1 - Math.exp(-perYear * days / DAYS_PER_YEAR);

/** Hazard of dying per year at `age` in full health (Gompertz fit to Western life tables, plus infancy). */
export const mortality = (age: number) => -Math.log(1 - Math.min(0.5, 0.00003 * Math.exp(0.095 * age) + (age < 1 ? 0.004 : 0)));

/** Births per year for a partnered woman of `age` (Western age-specific fertility, raised for living with a partner). */
const fertility = (age: number) => (age < 18 || age > 45 ? 0 : [0.07, 0.14, 0.22, 0.2, 0.1, 0.025][Math.min(5, Math.floor((age - 18) / 5))]);

/**
 * Life events for the `days` up to now: once per game day at midnight (live), or per coarse chronicle step, with the
 * hazards scaled to the step. Deterministic per (seed, day).
 */
export function lifeDay(world: World, days = 1): void {
  step = days;
  const day = Math.floor(world.clock / MINUTES_PER_DAY);
  const rng = tickRng(world, 'life');
  world.life.partner = partners(world);
  birthdays(world, day, rng.fork('age'));
  health(world, rng.fork('health'));
  deaths(world, day, rng.fork('death'));
  romance(world, day, rng.fork('romance'));
  births(world, day, rng.fork('birth'));
  work(world, day, rng.fork('work'));
  homes(world, day, rng.fork('homes'));
  pets(world, day, rng.fork('pets'));
  crime(world, day, rng.fork('crime'));
}

// ---- shared helpers --------------------------------------------------------------------------------------

const personRow = (world: World, id: ActorId) => world.actors.cols.row[id];

/** Living people A has a `mask` bond to. */
export function bonded(world: World, id: ActorId, mask: number): ActorId[] {
  const rel = world.relations, c = rel.t.cols, out: ActorId[] = [];
  for (const r of rel.known(id)) if (c.bonds[r] & mask && world.actors.cols.alive[c.to[r]]) out.push(c.to[r]);
  return out;
}

/** The living partner or spouse, -1 if single. */
export function partnerOf(world: World, id: ActorId): ActorId {
  const cache = world.life.partner;
  if (cache && id < cache.length) return cache[id];
  return bonded(world, id, PARTNERS).find((x) => world.actors.cols.kind[x] === ACTOR_PERSON) ?? -1;
}

/** Everyone's living partner in one pass over the relations (rebuilt each `lifeDay`, kept current by its events). */
function partners(world: World): Int32Array {
  const out = new Int32Array(world.actors.count).fill(-1);
  const c = world.relations.t.cols, a = world.actors.cols;
  for (let r = 0; r < world.relations.t.count; r++) {
    const from = c.from[r], to = c.to[r];
    if (from >= 0 && c.bonds[r] & PARTNERS && a.alive[from] && a.alive[to] && a.kind[to] === ACTOR_PERSON) out[from] = to;
  }
  return out;
}

function setPartners(world: World, x: ActorId, y: ActorId, together: boolean): void {
  const cache = world.life.partner;
  if (!cache) return;
  if (x < cache.length) cache[x] = together ? y : -1;
  if (y < cache.length) cache[y] = together ? x : -1;
}

function log(world: World, day: number, kind: LifeEventKind, who: ActorId, other: ActorId, place: PlaceId, fact = -1): void {
  world.life.events.push({ day, kind, who, other, place, fact });
}

/** A story that starts with the people who were there. */
function news(world: World, knowers: readonly ActorId[], f: { topic: string; text: string; subject?: ActorId; object?: ActorId; place?: PlaceId; magnitude: number; secret?: boolean }): number {
  const fact = addFact(world, f);
  witness(world, fact, knowers);
  return fact;
}

function feel(world: World, id: ActorId, e: Emotion, amount: number): void {
  const k = id * EMOTION_COUNT + EMOTIONS.indexOf(e);
  const em = world.actors.cols.emotions;
  em[k] = Math.max(em[k], clamp(amount, 0, 1));
}

/** People who would hear first: the household and the family. */
function closeTo(world: World, ...ids: ActorId[]): ActorId[] {
  const out = new Set<ActorId>();
  for (const id of ids) {
    if (id < 0) continue;
    out.add(id);
    for (const m of householdOf(world, id)?.members ?? []) out.add(m);
    for (const x of bonded(world, id, FAMILY_MASK)) out.add(x);
  }
  return [...out];
}


function shiftAffection(world: World, a: ActorId, b: ActorId, to: number): void {
  const c = world.relations.t.cols;
  for (const [x, y] of [[a, b], [b, a]]) c.affection[world.relations.ensure(x, y)] = to;
}

/** Free dwelling units: one entry per unit not occupied by a household with members. */
export function vacantHomes(world: World): PlaceId[] {
  const used = new Map<PlaceId, number>();
  for (const h of world.households) if (h.members.length > 0) used.set(h.home, (used.get(h.home) ?? 0) + 1);
  const out: PlaceId[] = [];
  for (const p of world.graph.places) if (isHome(p.kind) && p.kind !== 'farmhouse') for (let k = used.get(p.id) ?? 0; k < p.homes; k++) out.push(p.id);
  return out;
}

/** Move a person into another household (moving in together, a child taken in by kin). */
export function moveInto(world: World, id: ActorId, to: Household, rng: Rng): void {
  const from = householdOf(world, id);
  if (from === to) return;
  if (from) from.members.splice(from.members.indexOf(id), 1);
  to.members.push(id);
  world.people.cols.household[personRow(world, id)] = to.id;
  world.actors.cols.home[id] = to.home;
  for (const m of to.members) if (m !== id && !world.relations.isFamily(id, m)) bond(world.relations, id, m, 'housemate', { familiarity: 0.6, affection: 0.2, trust: 0.5 });
  settle(world, id, rng);
}

/** A new household of `ids` at a free home (leaving the parents, a break-up). */
function newHome(world: World, ids: ActorId[], home: PlaceId, rng: Rng): Household {
  const hh: Household = { id: world.households.length, home, surname: world.people.last[personRow(world, ids[0])], members: [], animals: [], car: rng.chance(0.6) };
  world.households.push(hh);
  for (const id of ids) moveInto(world, id, hh, rng.fork('move', id));
  return hh;
}

/**
 * An actor leaves the simulation: dies, or moves out of town. Their job falls vacant, the household closes ranks,
 * children left without an adult go to kin, and anyone tagging along is released. Relationships and beliefs about
 * them stay: the town remembers.
 */
export function leaveTown(world: World, id: ActorId, rng: Rng): void {
  const a = world.actors.cols;
  if (!a.alive[id]) return;
  a.alive[id] = 0; a.place[id] = -1; a.dest[id] = -1; a.with[id] = -1; a.activity[id] = A.idle;
  world.intentions[id] = [];
  // Followers (children, the dog) are always from the same household.
  const own = householdOf(world, id);
  for (const f of own ? [...own.members, ...own.animals] : []) if (a.with[f] === id) { a.with[f] = -1; a.until[f] = world.clock; }
  if (a.kind[id] === ACTOR_ANIMAL) {
    const h = world.animals.cols.household[a.row[id]];
    if (h >= 0) { const l = world.households[h].animals; const k = l.indexOf(id); if (k >= 0) l.splice(k, 1); }
    return;
  }
  const partner = partnerOf(world, id);
  if (partner >= 0) setPartners(world, id, partner, false);
  const pc = world.people.cols, p = a.row[id];
  if (pc.job[p] >= 0) { world.jobs[pc.job[p]].holder = -1; pc.job[p] = -1; }
  world.life.pregnant.delete(id);
  const hh = householdOf(world, id);
  if (!hh) return;
  hh.members.splice(hh.members.indexOf(id), 1);
  const adults = hh.members.filter((m) => ageOf(world, m) >= 18);
  for (const an of hh.animals) {
    const ar = a.row[an];
    if (world.animals.cols.keeper[ar] === id) world.animals.cols.keeper[ar] = adults.length ? adults[0] : -1;
  }
  if (adults.length > 0) return;
  // Children with nobody to look after them go to kin (grandparents first), or leave town with social services.
  for (const child of hh.members.slice()) {
    const kin = [...bonded(world, child, bondBit('grandparent')), ...bonded(world, child, bondBit('sibling') | bondBit('relative'))]
      .filter((k) => a.kind[k] === ACTOR_PERSON && ageOf(world, k) >= 21 && householdOf(world, k) !== hh);
    if (kin.length > 0) moveInto(world, child, householdOf(world, kin[0])!, rng.fork('kin', child));
    else { log(world, Math.floor(world.clock / MINUTES_PER_DAY), 'departed', child, -1, hh.home); leaveTown(world, child, rng); }
  }
  if (hh.members.length === 0) for (const an of hh.animals.slice()) leaveTown(world, an, rng);
}

// ---- ageing, health and death ----------------------------------------------------------------------------

function birthdays(world: World, day: number, rng: Rng): void {
  const a = world.actors.cols;
  for (let id = 0; id < world.actors.count; id++) {
    if (!a.alive[id] || a.kind[id] !== ACTOR_PERSON || day <= a.birth[id]) continue;
    const age = Math.floor((day - a.birth[id]) / 365);
    if (age === Math.floor((day - step - a.birth[id]) / 365)) continue;
    if (age === 3 || age === 6 || age === 18) {
      settle(world, id, rng.fork('settle', id));
      if (age === 6) log(world, day, 'schoolStart', id, -1, world.people.cols.school[a.row[id]]);
      if (age === 18) log(world, day, 'schoolEnd', id, -1, -1);
    }
    if (age === 67) retire(world, day, id, rng);
    if (age % 10 === 0 || age === 16 || age === 18 || age === 21) remember(world, id, { who: householdOf(world, id)?.members.filter((m) => m !== id) ?? [], summary: `I turned ${age}`, importance: 0.5, emotion: 'joy' });
  }
}

function health(world: World, rng: Rng): void {
  const a = world.actors.cols, pc = world.people.cols;
  for (let id = 0; id < world.actors.count; id++) {
    if (!a.alive[id] || a.kind[id] !== ACTOR_PERSON) continue;
    const age = ageOf(world, id);
    if (a.health[id] < 1) {
      // Recovery: quick for the young, slow for the old.
      const before = a.health[id];
      a.health[id] = Math.min(1, before + Math.max(0.03, 0.09 - age * 0.0007) * step);
      if (a.health[id] >= 0.97) {
        a.health[id] = 1;
        if (before < 0.2) log(world, Math.floor(world.clock / MINUTES_PER_DAY), 'recovery', id, -1, -1);
      }
      continue;
    }
    // A cold or flu one to two times a year; something serious rarely, more often with age.
    if (!rng.chance(happens(1.2 + Math.max(0, age - 50) / 25))) continue;
    const severity = Math.pow(rng.float(), 4 - Math.min(2, Math.max(0, age - 50) / 20));
    a.health[id] = 1 - severity * 0.9;
    const p = a.row[id];
    if (severity > 0.15) pc.leaveUntil[p] = Math.max(pc.leaveUntil[p], world.clock + Math.ceil(1 + severity * 20) * MINUTES_PER_DAY);
    if (severity > 0.45) intend(world, id, { kind: 'seeDoctor', at: world.clock + 480, until: world.clock + 3 * 1440, priority: 65, reason: 'feeling ill' });
    if (severity > 0.9) {
      const day = Math.floor(world.clock / MINUTES_PER_DAY);
      const fact = news(world, closeTo(world, id), { topic: 'health', text: '{subject} is seriously ill', subject: id, magnitude: 0.7 });
      remember(world, id, { who: [], summary: 'I was seriously ill', importance: 0.8, emotion: 'fear', fact });
      log(world, day, 'illness', id, -1, -1, fact);
      feel(world, id, 'fear', 0.5);
    }
  }
}

function deaths(world: World, day: number, rng: Rng): void {
  const a = world.actors.cols;
  const n = world.actors.count;
  for (let id = 0; id < n; id++) {
    if (!a.alive[id]) continue;
    const sp = SPECIES[a.species[id]];
    const age = (day - a.birth[id]) / DAYS_PER_YEAR;
    const q = a.kind[id] === ACTOR_PERSON ? mortality(age) * (1 + 4 * (1 - a.health[id])) : Math.min(3, 0.002 * Math.exp(6 * age / sp.lifespan));
    if (!rng.chance(happens(q))) continue;
    if (a.kind[id] === ACTOR_PERSON) personDies(world, day, id, rng);
    else animalDies(world, day, id, rng);
  }
}

function personDies(world: World, day: number, id: ActorId, rng: Rng): void {
  const mourners = closeTo(world, id).filter((m) => m !== id);
  const age = ageOf(world, id);
  const fact = news(world, mourners, { topic: 'family', text: '{subject} died', subject: id, magnitude: age >= 75 ? 0.6 : 0.85 });
  broadcast(world, fact, 0.04); // the notice in the paper
  for (const m of mourners) {
    const close = Math.max(0.2, liking(world.relations, m, id));
    feel(world, m, 'sadness', 0.4 + close * 0.6);
    remember(world, m, { who: [id], summary: `${nameOf(world, id)} died`, importance: 0.6 + close * 0.4, emotion: 'sadness', fact });
  }
  log(world, day, 'death', id, -1, world.actors.cols.home[id], fact);
  leaveTown(world, id, rng.fork('leave', id));
}

const PETS = ['dog', 'cat'];

function animalDies(world: World, day: number, id: ActorId, rng: Rng): void {
  const a = world.actors.cols, ac = world.animals.cols, r = a.row[id];
  const species = SPECIES[a.species[id]].name;
  const h = ac.household[r];
  const home = a.home[id];
  let fact = -1;
  if (h >= 0 && PETS.includes(species)) {
    const hh = world.households[h];
    const owner = ac.keeper[r] >= 0 ? ac.keeper[r] : hh.members[0] ?? -1;
    fact = news(world, hh.members, { topic: 'family', text: `{object}'s ${species} {subject} died`, subject: id, object: owner, magnitude: 0.3 });
    for (const m of hh.members) {
      feel(world, m, 'sadness', 0.3 + Math.max(0, liking(world.relations, m, id)) * 0.5);
      remember(world, m, { who: [id], summary: `our ${species} ${nameOf(world, id)} died`, importance: 0.5, emotion: 'sadness', fact });
    }
  }
  log(world, day, 'death', id, -1, home, fact);
  leaveTown(world, id, rng.fork('leave', id));
  // Farms raise young stock and wild populations hold steady: a young one takes the place of the old.
  if (!PETS.includes(species) || h < 0) {
    const young = newAnimal(world, { species, home, household: h, keeper: ac.keeper[r], name: h >= 0 && species !== 'chicken' ? PET_NAMES[rng.int(0, PET_NAMES.length - 1)] : species, birth: day - rng.int(20, 200) }, rng.fork('young', id));
    if (h >= 0) world.households[h].animals.push(young);
  }
}

// ---- romance and family ----------------------------------------------------------------------------------

/** Who `id` could fall for: sex by orientation (about 1 in 20 are attracted to the same sex), similar age, single. */
function attracted(world: World, id: ActorId, other: ActorId): boolean {
  const a = world.actors.cols;
  const same = (hashCombine(world.seed ^ 0x0e1e, id) >>> 0) % 20 === 0;
  if ((a.sex[other] === a.sex[id]) !== same) return false;
  const age = ageOf(world, id), o = ageOf(world, other);
  return o >= 18 && Math.abs(age - o) <= Math.max(5, age * 0.2) && partnerOf(world, other) < 0;
}

function romance(world: World, day: number, rng: Rng): void {
  const rel = world.relations, c = rel.t.cols;
  for (let id = 0; id < world.actors.count; id++) {
    if (!isPerson(world, id)) continue;
    const age = ageOf(world, id);
    if (age < 18) continue;
    const partner = partnerOf(world, id);
    if (partner < 0) {
      // Falling for someone they know and like, who likes them back.
      if (age > 80 || !rng.chance(happens(1 + traitOf(world, id, T_EXTRA)))) continue;
      let best = -1, bestScore = 0.5;
      for (const r of rel.known(id)) {
        const o = c.to[r];
        if (!isPerson(world, o) || c.bonds[r] & NO_ROMANCE || c.familiarity[r] < 0.15 || !attracted(world, id, o) || !attracted(world, o, id)) continue;
        const score = c.affection[r] + liking(world.relations, o, id) + rng.float() * 0.3;
        if (score > bestScore) { bestScore = score; best = o; }
      }
      // Or someone new: introduced by friends, met at a party, online.
      for (let k = 0; best < 0 && k < 6; k++) {
        const o = rng.int(0, world.actors.count - 1);
        if (o !== id && isPerson(world, o) && !world.relations.isFamily(id, o) && attracted(world, id, o) && attracted(world, o, id) && rng.chance(0.4)) best = o;
      }
      if (best >= 0) startDating(world, day, id, best);
      continue;
    }
    if (partner < id) continue; // each couple once
    couple(world, day, id, partner, rng);
    // An affair: rare, likelier with low loyalty, a secret only the two share.
    if (rng.chance(happens(0.02 * (1.5 - valueOf(world, id, V_LOYAL)) * (1.5 - traitOf(world, id, T_AGREE))))) affair(world, day, id, partner, rng);
  }
}

function startDating(world: World, day: number, x: ActorId, y: ActorId): void {
  bond(world.relations, x, y, 'partner', { familiarity: 0.7, trust: 0.6 });
  for (const [p, q] of [[x, y], [y, x]]) world.relations.t.cols.affection[world.relations.row(p, q)] = clamp(liking(world.relations, p, q) + 0.3, 0, 1);
  world.life.together.set(coupleKey(x, y), day);
  setPartners(world, x, y, true);
  const fact = news(world, [x, y], { topic: 'romance', text: '{subject} is going out with {object}', subject: x, object: y, magnitude: 0.55 });
  for (const [p, q] of [[x, y], [y, x]]) {
    feel(world, p, 'joy', 0.7);
    remember(world, p, { who: [q], summary: `${nameOf(world, q)} and I got together`, importance: 0.8, emotion: 'joy', fact });
  }
  log(world, day, 'dating', x, y, -1, fact);
}

function couple(world: World, day: number, x: ActorId, y: ActorId, rng: Rng): void {
  const rel = world.relations;
  const key = coupleKey(x, y);
  const since = world.life.together.get(key) ?? day - 3650; // couples from synthesis have been together for years
  const married = (rel.t.cols.bonds[rel.row(x, y)] & SPOUSE) !== 0;
  const hx = householdOf(world, x), hy = householdOf(world, y);
  const together = hx !== null && hx === hy;
  // Break-ups: neuroticism, low agreeableness and cooling affection; marriages last far longer.
  const strain = clamp(1 + traitOf(world, x, T_NEURO) + traitOf(world, y, T_NEURO) - traitOf(world, x, T_AGREE) - traitOf(world, y, T_AGREE) - liking(world.relations, x, y) - liking(world.relations, y, x), 0.2, 3);
  if (rng.chance(happens((married ? 0.02 : day - since < 365 ? 0.35 : 0.12) * strain))) { breakUp(world, day, x, y, married, together, rng); return; }
  if (!together && day - since > 120 && rng.chance(happens(0.5))) moveIn(world, day, x, y, rng);
  else if (together && !married && day - since > 365 && Math.min(ageOf(world, x), ageOf(world, y)) >= 20 && rng.chance(happens(0.08))) marry(world, day, x, y);
}

/** Does `id` run their own household (not living with their parents)? */
const ownsHome = (world: World, id: ActorId) => !householdOf(world, id)?.members.some((m) => world.relations.has(id, m, 'parent'));

function moveIn(world: World, day: number, x: ActorId, y: ActorId, rng: Rng): void {
  const hx = householdOf(world, x)!, hy = householdOf(world, y)!;
  let into: Household | null = null, movers: ActorId[] = [];
  const kidsOf = (p: ActorId, hh: Household) => hh.members.filter((m) => world.relations.has(p, m, 'child') && ageOf(world, m) < 18);
  if (ownsHome(world, y) && (!ownsHome(world, x) || hx.members.length <= hy.members.length)) { into = hy; movers = [x, ...kidsOf(x, hx)]; }
  else if (ownsHome(world, x)) { into = hx; movers = [y, ...kidsOf(y, hy)]; }
  else {
    const free = vacantHomes(world);
    if (free.length === 0) return;
    into = newHome(world, [x, y], free[rng.int(0, free.length - 1)], rng);
  }
  for (const m of movers) moveInto(world, m, into, rng.fork('move', m));
  const fact = news(world, closeTo(world, x, y), { topic: 'romance', text: '{subject} moved in with {object}', subject: movers[0] ?? x, object: movers[0] === x ? y : x, place: into.home, magnitude: 0.4 });
  for (const [p, q] of [[x, y], [y, x]]) remember(world, p, { who: [q], summary: `${nameOf(world, q)} and I moved in together`, importance: 0.8, emotion: 'joy', fact });
  log(world, day, 'moveIn', x, y, into.home, fact);
}

function marry(world: World, day: number, x: ActorId, y: ActorId): void {
  bond(world.relations, x, y, 'spouse');
  const guests = closeTo(world, x, y);
  for (const f of [...bonded(world, x, bondBit('friend')), ...bonded(world, y, bondBit('friend'))]) if (!guests.includes(f)) guests.push(f);
  const fact = news(world, guests, { topic: 'family', text: '{subject} and {object} got married', subject: x, object: y, magnitude: 0.6 });
  for (const g of guests) {
    feel(world, g, 'joy', g === x || g === y ? 0.9 : 0.4);
    remember(world, g, { who: [x, y], summary: g === x || g === y ? `I married ${nameOf(world, g === x ? y : x)}` : `${nameOf(world, x)} and ${nameOf(world, y)} got married`, importance: g === x || g === y ? 1 : 0.5, emotion: 'joy', fact });
  }
  log(world, day, 'marriage', x, y, -1, fact);
}

function breakUp(world: World, day: number, x: ActorId, y: ActorId, married: boolean, together: boolean, rng: Rng): void {
  const rel = world.relations;
  unbond(rel, x, y, 'partner');
  unbond(rel, x, y, 'spouse');
  bond(rel, x, y, 'ex');
  shiftAffection(world, x, y, rng.range(-0.6, 0.2));
  world.life.together.delete(coupleKey(x, y));
  setPartners(world, x, y, false);
  const fact = news(world, closeTo(world, x, y), { topic: 'romance', text: married ? '{subject} and {object} are getting divorced' : '{subject} and {object} split up', subject: x, object: y, magnitude: married ? 0.75 : 0.5 });
  for (const [p, q] of [[x, y], [y, x]]) {
    feel(world, p, rng.chance(0.5) ? 'sadness' : 'anger', 0.6);
    remember(world, p, { who: [q], summary: `${nameOf(world, q)} and I split up`, importance: 0.9, emotion: 'sadness', fact });
  }
  log(world, day, married ? 'divorce' : 'breakup', x, y, -1, fact);
  if (!together) return;
  // One of them moves out: whoever did not run the household, to a free home, or out of town.
  const hh = householdOf(world, x)!;
  const leaver = hh.members[0] === x ? y : x;
  const free = vacantHomes(world);
  if (free.length > 0) newHome(world, [leaver], free[rng.int(0, free.length - 1)], rng.fork('out', leaver));
  else { log(world, day, 'departed', leaver, -1, -1); leaveTown(world, leaver, rng.fork('leave', leaver)); }
}

function affair(world: World, day: number, x: ActorId, partner: ActorId, rng: Rng): void {
  const rel = world.relations, c = rel.t.cols;
  const options = rel.known(x).filter((r) => {
    const o = c.to[r];
    return o !== partner && isPerson(world, o) && !(c.bonds[r] & NO_ROMANCE) && c.affection[r] > 0.3 && c.familiarity[r] > 0.3 && ageOf(world, o) >= 18 && attracted(world, x, o);
  });
  if (options.length === 0) return;
  const lover = c.to[options[rng.int(0, options.length - 1)]];
  shiftAffection(world, x, lover, 0.7);
  const fact = news(world, [x, lover], { topic: 'romance', text: '{subject} is having an affair with {object}', subject: x, object: lover, magnitude: 0.9, secret: true });
  log(world, day, 'affair', x, lover, -1, fact);
}

function births(world: World, day: number, rng: Rng): void {
  const a = world.actors.cols;
  for (const [mother, preg] of [...world.life.pregnant]) {
    if (!preg.announced && preg.due - day <= 186) {
      preg.announced = true;
      news(world, closeTo(world, mother, preg.father), { topic: 'family', text: '{subject} is expecting a baby', subject: mother, magnitude: 0.5 });
    }
    if (preg.due <= day) { world.life.pregnant.delete(mother); birth(world, day, mother, preg.father, rng.fork('baby', mother)); }
  }
  for (let id = 0; id < world.actors.count; id++) {
    if (!isPerson(world, id) || a.sex[id] !== FEMALE || world.life.pregnant.has(id)) continue;
    const f = fertility(ageOf(world, id));
    if (f === 0) continue;
    const partner = partnerOf(world, id);
    if (partner < 0 || a.sex[partner] !== MALE || householdOf(world, partner) !== householdOf(world, id)) continue;
    const kids = bonded(world, id, CHILD);
    if (kids.some((k) => ageOf(world, k) < 1)) continue;
    if (!rng.chance(happens(f * [1.1, 0.9, 0.35, 0.12, 0.05][Math.min(4, kids.length)]))) continue;
    world.life.pregnant.set(id, { father: partner, due: day + rng.int(260, 285), announced: false });
    const fact = news(world, [id, partner], { topic: 'family', text: '{subject} is pregnant', subject: id, magnitude: 0.5, secret: true });
    for (const p of [id, partner]) remember(world, p, { who: [p === id ? partner : id], summary: p === id ? 'I found out I am pregnant' : `${nameOf(world, id)} is pregnant`, importance: 0.9, emotion: 'joy', fact });
    log(world, day, 'pregnancy', id, partner, -1, fact);
  }
}

function birth(world: World, day: number, mother: ActorId, father: ActorId, rng: Rng): void {
  const hh = householdOf(world, mother);
  if (!hh) return;
  const rel = world.relations, a = world.actors.cols;
  const married = father >= 0 && rel.has(mother, father, 'spouse');
  // Married parents usually share the name; otherwise either parent's.
  const namer = father < 0 || !a.alive[father] ? mother : married || rng.chance(0.5) ? father : mother;
  const last = world.people.last[a.row[namer]];
  const baby = newPerson(world, { birth: day, sex: rng.chance(0.51) ? MALE : FEMALE, last, home: hh.home, household: hh.id, parents: [mother, father] }, rng);
  hh.members.push(baby);
  const warm = { familiarity: 1, affection: 0.9, trust: 0.9 };
  for (const p of [mother, father]) {
    if (p < 0 || !a.alive[p]) continue;
    for (const sib of bonded(world, p, CHILD)) if (sib !== baby) bond(rel, baby, sib, 'sibling', { familiarity: 0.8, affection: 0.6, trust: 0.7 });
    for (const gp of bonded(world, p, PARENT)) bond(rel, gp, baby, 'grandchild', { familiarity: 0.7, affection: 0.8, trust: 0.8 });
    bond(rel, p, baby, 'child', warm);
  }
  for (const m of hh.members) if (m !== baby && !rel.isFamily(baby, m)) bond(rel, m, baby, 'housemate', { familiarity: 0.8, affection: 0.4, trust: 0.6 });
  settle(world, baby, rng.fork('settle'));
  const pc = world.people.cols;
  pc.leaveUntil[a.row[mother]] = Math.max(pc.leaveUntil[a.row[mother]], world.clock + 98 * MINUTES_PER_DAY);
  if (father >= 0 && a.alive[father]) pc.leaveUntil[a.row[father]] = Math.max(pc.leaveUntil[a.row[father]], world.clock + 14 * MINUTES_PER_DAY);
  const family = closeTo(world, mother, father);
  const fact = news(world, family, { topic: 'family', text: '{subject} had a baby', subject: mother, object: baby, magnitude: 0.6 });
  for (const m of family) {
    if (m === baby) continue;
    feel(world, m, 'joy', m === mother || m === father ? 0.9 : 0.5);
    remember(world, m, { who: [mother, baby], summary: `${nameOf(world, mother)} had a baby, ${world.people.first[a.row[baby]]}`, importance: m === mother || m === father ? 1 : 0.5, emotion: 'joy', fact });
  }
  log(world, day, 'birth', baby, mother, hh.home, fact);
}

// ---- work ------------------------------------------------------------------------------------------------

function vacate(world: World, id: ActorId): Job | null {
  const job = jobOf(world, id);
  if (!job) return null;
  job.holder = -1;
  world.people.cols.job[personRow(world, id)] = -1;
  fitRoutine(world, id, tickRng(world, 'routine', id));
  return job;
}

function colleaguesOf(world: World, place: PlaceId, except: ActorId): ActorId[] {
  return world.jobs.filter((j) => j.place === place && j.holder >= 0 && j.holder !== except).map((j) => j.holder);
}

function retire(world: World, day: number, id: ActorId, rng: Rng): void {
  const job = vacate(world, id);
  if (!job) return;
  const fact = news(world, [...closeTo(world, id), ...colleaguesOf(world, job.place, id)], { topic: 'job', text: '{subject} retired from {place}', subject: id, place: job.place, magnitude: 0.35 });
  remember(world, id, { who: [], summary: `I retired from ${world.graph.places[job.place].name}`, importance: 0.8, emotion: rng.chance(0.7) ? 'joy' : 'sadness', fact });
  log(world, day, 'retired', id, -1, job.place, fact);
}

function hire(world: World, day: number, id: ActorId, job: Job, rng: Rng): void {
  const pc = world.people.cols, p = personRow(world, id);
  job.holder = id;
  pc.job[p] = job.id;
  pc.school[p] = -1;
  fitRoutine(world, id, rng);
  world.actors.cols.until[id] = world.clock;
  const staff = colleaguesOf(world, job.place, id);
  for (let k = 0; k < Math.min(4, staff.length); k++) bond(world.relations, id, staff[rng.int(0, staff.length - 1)], 'colleague', { familiarity: 0.3, affection: 0.1, trust: 0.4 });
  const fact = news(world, closeTo(world, id), { topic: 'job', text: '{subject} got a job at {place}', subject: id, place: job.place, magnitude: 0.35 });
  remember(world, id, { who: [], summary: `I started work at ${world.graph.places[job.place].name} as ${job.role}`, importance: 0.8, emotion: 'joy', fact });
  log(world, day, 'hired', id, -1, job.place, fact);
}

function work(world: World, day: number, rng: Rng): void {
  const a = world.actors.cols, pc = world.people.cols;
  for (let id = 0; id < world.actors.count; id++) {
    const job = isPerson(world, id) ? jobOf(world, id) : null;
    if (!job) continue;
    // Let go (rarely, likelier for the careless) or moving on to something else.
    if (rng.chance(happens(0.02 * (1.6 - traitOf(world, id, T_CONSC))))) {
      vacate(world, id);
      const fact = news(world, [...closeTo(world, id), ...colleaguesOf(world, job.place, id)], { topic: 'job', text: '{subject} lost their job at {place}', subject: id, place: job.place, magnitude: 0.6 });
      feel(world, id, 'sadness', 0.6);
      remember(world, id, { who: [], summary: `I lost my job at ${world.graph.places[job.place].name}`, importance: 0.9, emotion: 'sadness', fact });
      log(world, day, 'fired', id, -1, job.place, fact);
    } else if (rng.chance(happens(0.05 * (0.5 + traitOf(world, id, T_OPEN))))) {
      const options = world.jobs.filter((j) => j.holder < 0 && j.place !== job.place && ageOf(world, id) >= j.minAge);
      if (options.length === 0) continue;
      const next = options[rng.int(0, options.length - 1)];
      vacate(world, id);
      log(world, day, 'quit', id, -1, job.place);
      hire(world, day, id, next, rng.fork('hire', id));
    }
  }
  // Vacancies fill in about three weeks, from the people in town without work.
  const open = world.jobs.filter((j) => j.holder < 0 && rng.chance(happens(18)));
  if (open.length === 0) return;
  const seekers: ActorId[] = [];
  for (let id = 0; id < world.actors.count; id++) {
    if (!isPerson(world, id)) continue;
    const p = a.row[id], age = ageOf(world, id);
    if (pc.job[p] < 0 && age >= 17 && age < 67 && pc.school[p] < 0 && !world.life.pregnant.has(id)) seekers.push(id);
  }
  rng.shuffle(seekers);
  for (const job of open) {
    let best = -1, bestScore = -Infinity;
    // Whoever applies: the first few dozen suitable people in a shuffled list.
    for (let k = 0, tries = 0; k < seekers.length && tries < 30; k++) {
      const id = seekers[k];
      if (pc.job[a.row[id]] >= 0 || ageOf(world, id) < job.minAge) continue;
      tries++;
      const score = -commute(world, id, job.place) * 0.3 + traitOf(world, id, T_CONSC) * 5 + rng.float() * 5;
      if (score > bestScore) { bestScore = score; best = id; }
    }
    if (best >= 0) hire(world, day, best, job, rng.fork('hire', best));
  }
}

// ---- homes: leaving home, moving in and away ---------------------------------------------------------------

function homes(world: World, day: number, rng: Rng): void {
  let free = vacantHomes(world);
  const take = (prefer: 'apartments' | null) => {
    if (free.length === 0) return -1;
    const flats = prefer ? free.filter((h) => world.graph.places[h].kind === prefer) : [];
    const home = (flats.length ? flats : free)[rng.int(0, (flats.length ? flats : free).length - 1)];
    free.splice(free.indexOf(home), 1);
    return home;
  };
  // Grown-up children leave their parents, into a flat in town or off to the city.
  for (let id = 0; id < world.actors.count; id++) {
    if (!isPerson(world, id)) continue;
    const age = ageOf(world, id);
    if (age < 19 || age > 40 || !rng.chance(happens(age < 23 ? 0.15 : 0.3)) || ownsHome(world, id)) continue;
    const partner = partnerOf(world, id);
    if (partner >= 0 && householdOf(world, partner) !== householdOf(world, id)) continue;
    const old = householdOf(world, id)!;
    const home = rng.chance(0.8) ? take('apartments') : -1;
    if (home >= 0) {
      newHome(world, partner >= 0 ? [id, partner] : [id], home, rng.fork('home', id));
      const fact = news(world, closeTo(world, id), { topic: 'family', text: '{subject} moved out of their parents\' place', subject: id, place: home, magnitude: 0.3 });
      remember(world, id, { who: [], summary: `I moved out of my parents' place into ${world.graph.places[home].name}`, importance: 0.8, emotion: 'joy', fact });
      log(world, day, 'leftHome', id, -1, home, fact);
    } else {
      const fact = news(world, old.members, { topic: 'family', text: `{subject} moved away to ${regionDestination(world, rng.fork('dest', id), ageOf(world, id) < 23 ? 'university' : undefined)?.name ?? 'the city'}`, subject: id, magnitude: 0.4 });
      log(world, day, 'departed', id, -1, -1, fact);
      leaveTown(world, id, rng.fork('leave', id));
    }
  }
  // Old people living alone move in with their children, or into a care home out of town, and free the house.
  for (const hh of world.households) {
    if (hh.members.length !== 1 || world.graph.places[hh.home].kind === 'farmhouse') continue;
    const id = hh.members[0], age = ageOf(world, id);
    if (age < 78 || !rng.chance(happens(0.04 + (age - 78) * 0.012))) continue;
    const kids = bonded(world, id, CHILD).filter((k) => world.actors.cols.kind[k] === ACTOR_PERSON && ageOf(world, k) >= 25 && householdOf(world, k) !== null);
    if (kids.length > 0 && rng.chance(0.4)) {
      const to = householdOf(world, kids[0])!;
      for (const an of hh.animals.slice()) leaveTown(world, an, rng.fork('leave', an));
      moveInto(world, id, to, rng.fork('move', id));
      const fact = news(world, closeTo(world, id), { topic: 'family', text: '{subject} moved in with {object}', subject: id, object: kids[0], place: to.home, magnitude: 0.3 });
      log(world, day, 'moveIn', id, kids[0], to.home, fact);
    } else {
      const fact = news(world, closeTo(world, id), { topic: 'family', text: `{subject} moved into a care home${where(regionDestination(world, rng.fork('dest', id), 'hospital'))}`, subject: id, magnitude: 0.4 });
      log(world, day, 'departed', id, -1, -1, fact);
      leaveTown(world, id, rng.fork('leave', id));
    }
  }
  // Whole households move away now and then.
  for (const hh of world.households) {
    if (hh.members.length === 0 || world.graph.places[hh.home].kind === 'farmhouse' || !rng.chance(happens(0.02))) continue;
    const head = hh.members[0];
    const street = world.streetOf[hh.home];
    const neighbours = world.households.filter((o) => o !== hh && o.members.length && world.streetOf[o.home] === street).flatMap((o) => o.members.slice(0, 1));
    const fact = news(world, [...closeTo(world, head), ...neighbours], { topic: 'family', text: `{subject} and family are moving away${where(regionDestination(world, rng.fork('dest', head)), ' to ')}`, subject: head, place: hh.home, magnitude: 0.45 });
    for (const m of hh.members.slice()) { log(world, day, 'departed', m, head, hh.home, fact); leaveTown(world, m, rng.fork('leave', m)); }
    for (const an of hh.animals.slice()) leaveTown(world, an, rng.fork('leave', an));
  }
  // Newcomers take free homes (a few weeks on the market each).
  free = vacantHomes(world);
  for (const home of free) {
    if (!rng.chance(happens(12))) continue;
    const hh = addHousehold(world, home, rng.fork('newcomers', home, day), rng.weighted(world.graph.places[home].kind === 'apartments' ? NEWCOMERS_FLAT : NEWCOMERS_HOUSE, (t) => t[1])[0]);
    for (const m of hh.members) {
      settle(world, m, rng.fork('settle', m));
      world.people.cols.money[personRow(world, m)] = rng.range(200, 3000);
    }
    if (rng.chance(0.3)) newPet(world, day, hh, rng.fork('pet', hh.id), false);
    const street = world.streetOf[home];
    const neighbours = world.households.filter((o) => o !== hh && o.members.length && world.streetOf[o.home] === street).flatMap((o) => o.members.slice(0, 1));
    // Where they come from: the villages and towns around, or further away.
    const from = rng.chance(0.6) ? regionDestination(world, rng.fork('from', home, day)) : null;
    if (world.region) for (const m of hh.members) if (ageOf(world, m) >= 18) world.region.origin.set(m, from?.name ?? '');
    const fact = news(world, neighbours, { topic: 'place', text: `new people moved into {place}: {subject} and family${where(from, ' from ')}`, subject: hh.members[0], place: home, magnitude: 0.35 });
    for (const m of hh.members) {
      remember(world, m, { who: hh.members.filter((o) => o !== m), summary: `we moved to town, into ${world.graph.places[home].name}`, importance: 0.8, emotion: 'joy', fact });
      log(world, day, 'arrived', m, hh.members[0], home, fact);
    }
  }
}

/** " in Marwick" (or " to ", " from "), or nothing without a region. */
const where = (p: RegionPlace | null, word = ' in ') => (p ? word + p.name : '');

// ---- pets ------------------------------------------------------------------------------------------------

function newPet(world: World, day: number, hh: Household, rng: Rng, tell = true): void {
  const flat = world.graph.places[hh.home].kind === 'apartments';
  const species = rng.chance(flat ? 0.3 : 0.55) ? 'dog' : 'cat';
  const pet = adoptPet(world, hh, species, rng, day - rng.int(60, 700));
  const fact = tell ? news(world, hh.members, { topic: 'family', text: `{subject} got a ${species}`, subject: hh.members[0], magnitude: 0.2 }) : -1;
  for (const m of hh.members) remember(world, m, { who: [pet], summary: `we got a ${species}, ${nameOf(world, pet)}`, importance: 0.5, emotion: 'joy', fact });
  log(world, day, 'petAdopted', pet, hh.members[0], hh.home, fact);
}

function pets(world: World, day: number, rng: Rng): void {
  const dog = speciesId('dog'), cat = speciesId('cat');
  for (const hh of world.households) {
    if (hh.members.length === 0 || hh.animals.some((an) => world.actors.cols.species[an] === dog || world.actors.cols.species[an] === cat)) continue;
    if (!hh.members.some((m) => ageOf(world, m) >= 18) || !rng.chance(happens(0.04))) continue;
    newPet(world, day, hh, rng.fork('adopt', hh.id));
  }
}

// ---- crime (rare, D10) -----------------------------------------------------------------------------------

/** Per 1,000 inhabitants per year. */
const CRIME_RATES = { theft: 10, burglary: 3, vandalism: 5, fight: 4 } as const;

function crime(world: World, day: number, rng: Rng): void {
  let people = 0;
  for (let id = 0; id < world.actors.count; id++) if (isPerson(world, id)) people++;
  let suspects: Suspects | null = null;
  for (const kind of Object.keys(CRIME_RATES) as (keyof typeof CRIME_RATES)[]) {
    // Several can happen within one coarse step.
    for (let i = poisson(CRIME_RATES[kind] * people / 1000 * step / DAYS_PER_YEAR, rng); i > 0; i--) {
      suspects ??= likelyCulprits(world);
      const r = rng.fork(kind, i);
      if (suspects.ids.length > 0) commit(world, day, kind, suspects.ids[pickWeighted(suspects.weights, suspects.total, r)], r);
    }
  }
}

interface Suspects { ids: ActorId[]; weights: number[]; total: number }

/** Who might do it: young, careless of honesty and of others; men more often. */
function likelyCulprits(world: World): Suspects {
  const ids: ActorId[] = [], weights: number[] = [];
  let total = 0;
  for (let id = 0; id < world.actors.count; id++) {
    if (!isPerson(world, id)) continue;
    const age = ageOf(world, id);
    if (age < 14 || age > 65) continue;
    const w = Math.pow(1 - valueOf(world, id, V_HONEST), 3) * Math.pow(1 - traitOf(world, id, T_AGREE), 2) * (world.actors.cols.sex[id] === MALE ? 1.6 : 1) * (age <= 30 ? 2 : 1);
    ids.push(id); weights.push(w); total += w;
  }
  return { ids, weights, total };
}

function pickWeighted(weights: number[], total: number, rng: Rng): number {
  let x = rng.float() * total;
  for (let i = 0; i < weights.length; i++) if ((x -= weights[i]) < 0) return i;
  return weights.length - 1;
}

/** How many times something with mean `mean` happens (Knuth; small means only). */
function poisson(mean: number, rng: Rng): number {
  const limit = Math.exp(-mean);
  let k = 0;
  for (let p = rng.float(); p > limit; p *= rng.float()) k++;
  return k;
}

function commit(world: World, day: number, kind: keyof typeof CRIME_RATES, offender: ActorId, r: Rng): void {
  if (kind === 'fight') fight(world, day, offender, r);
  else if (kind === 'burglary') burglary(world, day, offender, r);
  else {
    const kinds: PlaceKind[] = kind === 'theft' ? ['supermarket', 'shop', 'grocer', 'pharmacy', 'bakery'] : ['station', 'park', 'school', 'square', 'sports'];
    const places = placesOf(world, kinds);
    if (places.length === 0) return;
    const place = places[r.int(0, places.length - 1)];
    const staff = colleaguesOf(world, place, -1);
    const text = kind === 'theft' ? 'someone stole from {place}' : 'someone sprayed graffiti at {place}';
    const fact = news(world, staff, { topic: 'crime', text, place, magnitude: 0.5 });
    if (kind === 'vandalism') broadcast(world, fact, 0.03);
    const secret = news(world, [offender], { topic: 'crime', text: kind === 'theft' ? '{subject} stole from {place}' : '{subject} sprayed graffiti at {place}', subject: offender, place, magnitude: 0.8, secret: true });
    remember(world, offender, { who: [], summary: kind === 'theft' ? `I stole something from ${world.graph.places[place].name}` : `I sprayed graffiti at ${world.graph.places[place].name}`, importance: 0.6, emotion: 'fear', fact: secret });
    log(world, day, kind, -1, offender, place, fact);
  }
}


function burglary(world: World, day: number, offender: ActorId, rng: Rng): void {
  const victims = world.households.filter((h) => h.members.length > 0 && !h.members.includes(offender));
  if (victims.length === 0) return;
  const hh = victims[rng.int(0, victims.length - 1)];
  const head = hh.members[0];
  const fact = news(world, hh.members, { topic: 'crime', text: 'someone broke into {object}\'s house', object: head, place: hh.home, magnitude: 0.75 });
  const secret = news(world, [offender], { topic: 'crime', text: '{subject} broke into {object}\'s house', subject: offender, object: head, place: hh.home, magnitude: 0.9, secret: true });
  for (const m of hh.members) { feel(world, m, 'fear', 0.5); feel(world, m, 'anger', 0.5); }
  intend(world, head, { kind: 'callPolice', at: world.clock + 420, priority: 70, fact, reason: 'our house was broken into' });
  for (const m of hh.members) remember(world, m, { who: [], summary: 'our house was broken into', importance: 0.8, emotion: 'fear', fact });
  remember(world, offender, { who: [head], summary: `I broke into ${nameOf(world, head)}'s house`, importance: 0.7, emotion: 'fear', fact: secret });
  log(world, day, 'burglary', -1, head, hh.home, fact);
}

function fight(world: World, day: number, x: ActorId, rng: Rng): void {
  const known = world.relations.known(x).map((r) => world.relations.t.cols.to[r]).filter((o) => isPerson(world, o) && ageOf(world, o) >= 16 && !world.relations.isFamily(x, o));
  if (known.length === 0) return;
  const y = rng.weighted(known, (o) => 1 + Math.max(0, -liking(world.relations, x, o)) * 5);
  const pubs = placesOf(world, ['pub']);
  const place = pubs.length ? pubs[rng.int(0, pubs.length - 1)] : world.actors.cols.home[x];
  shiftAffection(world, x, y, -0.7);
  const there = [x, y, ...colleaguesOf(world, place, -1)];
  const fact = news(world, there, { topic: 'event', text: '{subject} got into a fight with {object} at {place}', subject: x, object: y, place, magnitude: 0.7 });
  for (const p of [x, y]) {
    feel(world, p, 'anger', 0.8);
    remember(world, p, { who: [p === x ? y : x], summary: `got into a fight with ${nameOf(world, p === x ? y : x)} at ${world.graph.places[place].name}`, importance: 0.8, emotion: 'anger', fact });
  }
  log(world, day, 'fight', x, y, place, fact);
}


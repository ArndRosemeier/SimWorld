/**
 * The society world (plan §1, L0): the single source of truth for every inhabitant, and `tick`, which advances it
 * one game minute at a time. Pure data, no DOM, no three: it runs in the sim worker and in headless tests.
 *
 * Determinism: every random draw comes from `tickRng(world, ...)`, a stream derived from (seed, clock, purpose),
 * so a saved world resumes exactly without storing generator state.
 */
import { Rng, deriveSeed } from '@futuremagic/core';
import type { ActorId, ActorTable } from './actors';
import type { Agenda } from './agenda';
import type { Offsite } from './offsite';
import { pruneAgenda } from './agenda';
import type { AnimalTable } from './animals';
import type { Intention } from './intentions';
import type { Knowledge } from './knowledge';
import type { Economy } from './economy';
import type { Life } from './life';
import type { Memories } from './memory';
import type { MindLedger } from './mind/apply';
import type { Household, Job, PersonTable } from './people';
import type { Place, PlaceGraph, PlaceId } from './places';
import { PLACE_KINDS, type PlaceKind } from './places';
import { KINDS, type Service } from './placeKinds';
import { ACTOR_PERSON } from './actors';
import type { Relations } from './relations';
import type { RegionKnowledge } from './region';
import { Travel, type Trip } from './travel';
import { MINUTES_PER_DAY } from './time';
import { updateNeeds, updateMoods } from './needs';
import { decideAll, arrive } from './schedule';
import { runEncounters, type Encounter } from './encounters';
import { forget } from './knowledge';
import { fadeRelations } from './relations';
import { lifeDay } from './life';
import { economyDay } from './economy';

export interface World {
  readonly seed: number;
  /** Game minutes since day 0 (a Monday) 00:00. */
  clock: number;
  /** Days from 1970-01-01 to game day 0: game days are real dates (src/sim/calendar.ts). */
  readonly epoch: number;
  /** The town's latitude in degrees (day length by date). */
  readonly latitude: number;
  /** Places off the map: where commuters work, the secondary school (src/sim/offsite.ts). */
  readonly offsite: Offsite;
  readonly graph: PlaceGraph;
  readonly travel: Travel;
  /** Place → index into PLACE_KINDS, for hot loops. */
  readonly kindOf: Uint8Array;
  /** Place → the street place on its street (where people walk past), -1 if none. */
  readonly streetOf: Int32Array;
  readonly actors: ActorTable;
  readonly people: PersonTable;
  readonly animals: AnimalTable;
  readonly households: Household[];
  readonly jobs: Job[];
  readonly relations: Relations;
  readonly knowledge: Knowledge;
  readonly memory: Memories;
  /** Intention stack per actor (sparse). */
  readonly intentions: Intention[][];
  /** Encounters of the last tick (who met whom where, and what was told). Read by views and the chatter engine. */
  readonly encounters: Encounter[];
  /** What is on in town (src/sim/agenda.ts). */
  readonly agenda: Agenda;
  /** Journeys under way (src/sim/travel.ts): filled by `go`, dropped on arrival. */
  readonly trips: Trip[];
  /** Per-conversation clamps and the decision log of `applyProposal`. */
  readonly mind: MindLedger;
  /** Life events so far, pregnancies, couples (src/sim/life.ts). */
  readonly life: Life;
  /** The country around the town and people's ties to it; null when the world was made without one. */
  region: RegionKnowledge | null;
  /** Household budgets, business ledgers, openings and closures (src/sim/economy.ts). */
  readonly economy: Economy;
}

/** The fixed parts of a world for a place graph (the population comes from `synthesize`, src/sim/synth.ts). */
export function placeIndex(graph: PlaceGraph): { travel: Travel; kindOf: Uint8Array; streetOf: Int32Array } {
  const n = graph.places.length;
  const kindOf = new Uint8Array(n);
  const streetOf = new Int32Array(n).fill(-1);
  const streets = new Map<string, PlaceId>();
  for (const p of graph.places) {
    kindOf[p.id] = PLACE_KINDS.indexOf(p.kind);
    if (p.kind === 'street') streets.set(p.street, p.id);
  }
  for (const p of graph.places) streetOf[p.id] = streets.get(p.street) ?? -1;
  return { travel: new Travel(graph), kindOf, streetOf };
}

/** A random stream for one purpose at the current minute (see the determinism note above). */
export function tickRng(world: World, ...parts: (string | number)[]): Rng {
  return new Rng(deriveSeed(world.seed, world.clock, ...parts));
}

/** Advance the world by `minutes` game minutes, one tick per minute (live mode). */
export function tick(world: World, minutes = 1): void {
  for (let m = 0; m < minutes; m++) {
    world.clock++;
    if (world.clock % MINUTES_PER_DAY === 0) passDays(world, 1);
    updateNeeds(world, 1);
    if (world.clock % 60 === 0) updateMoods(world);
    arrive(world);
    decideAll(world);
    runEncounters(world);
  }
}

/**
 * The slow processes over `days` ending now (at midnight): life events, forgetting, relationship drift, and the
 * weekly clear-out of forgotten faces. Once a day in live play; in coarse steps from the chronicle.
 */
export function passDays(world: World, days: number): void {
  lifeDay(world, days);
  economyDay(world, days);
  pruneAgenda(world, world.clock);
  forget(world, days);
  fadeRelations(world.relations, world.clock, days);
  const day = world.clock / MINUTES_PER_DAY;
  if (Math.floor(day / 7) !== Math.floor((day - days) / 7)) world.relations.prune(world.clock);
}

/** Age in whole years. */
export function ageOf(world: World, id: ActorId): number {
  return Math.floor((world.clock / MINUTES_PER_DAY - world.actors.cols.birth[id]) / 365);
}

/** "Mara Keller", or the pet's name. */
export function nameOf(world: World, id: ActorId): string {
  const a = world.actors.cols;
  const r = a.row[id];
  return a.kind[id] === 0 ? `${world.people.first[r]} ${world.people.last[r]}` : world.animals.name[r];
}

/** First name of a person (an animal's name). */
export const firstName = (world: World, id: ActorId): string =>
  world.actors.cols.kind[id] === 0 ? world.people.first[world.actors.cols.row[id]] : nameOf(world, id);

// ---- lookups shared by the sim systems ---------------------------------------------------------------------

/** A living person (not an animal, not dead or moved away). */
export const isPerson = (world: World, id: ActorId): boolean =>
  id >= 0 && id < world.actors.count && world.actors.cols.kind[id] === ACTOR_PERSON && world.actors.cols.alive[id] === 1;

/** Big Five trait `t` (T_*) of a person. */
export const traitOf = (world: World, id: ActorId, t: number): number => world.people.cols.traits[world.actors.cols.row[id] * 5 + t];

/** Value `v` (V_*) of a person. */
export const valueOf = (world: World, id: ActorId, v: number): number => world.people.cols.values[world.actors.cols.row[id] * 4 + v];

/** The household a person or animal belongs to, or null (wildlife). */
export function householdOf(world: World, id: ActorId): Household | null {
  const a = world.actors.cols;
  const hh = a.kind[id] === ACTOR_PERSON ? world.people.cols.household[a.row[id]] : world.animals.cols.household[a.row[id]];
  return hh >= 0 ? world.households[hh] : null;
}

/** The journey an actor is on now (`world.trips`; the latest one), or undefined when they are not travelling. */
export function tripOf(world: World, id: ActorId): Trip | undefined {
  const t = world.trips;
  for (let i = t.length - 1; i >= 0; i--) if (t[i].who === id) return t[i];
  return undefined;
}

/** A person's job, or null. */
export function jobOf(world: World, id: ActorId): Job | null {
  const j = world.people.cols.job[world.actors.cols.row[id]];
  return j >= 0 ? world.jobs[j] : null;
}

/** Can this person drive (household car, licence age)? */
export function hasCar(world: World, id: ActorId): boolean {
  const a = world.actors.cols;
  if (a.kind[id] !== ACTOR_PERSON) return false;
  const hh = world.people.cols.household[a.row[id]];
  const age = ageOf(world, id);
  return hh >= 0 && world.households[hh].car && age >= 18 && age < 85;
}

/** Minutes from home to `place`, by car if the person has one. */
export const commute = (world: World, id: ActorId, place: PlaceId): number => world.travel.minutes(world.actors.cols.home[id], place, hasCar(world, id));

const placeCache = new WeakMap<World, Map<string, PlaceId[]>>();
function cachedPlaces(world: World, key: string, pick: (kind: PlaceKind) => boolean): PlaceId[] {
  let m = placeCache.get(world);
  if (!m) { m = new Map(); placeCache.set(world, m); }
  let l = m.get(key);
  if (!l) { l = world.graph.places.filter((p) => pick(p.kind)).map((p) => p.id); m.set(key, l); }
  return l;
}

/** Places offering `service` (cached; the place graph is fixed). */
export const placesWith = (world: World, service: Service): PlaceId[] => cachedPlaces(world, 's:' + service, (k) => KINDS[k].services.includes(service));

/** Places of these kinds (cached). */
export const placesOf = (world: World, kinds: readonly PlaceKind[]): PlaceId[] => cachedPlaces(world, 'k:' + kinds.join(','), (k) => kinds.includes(k));

/**
 * Change what a place is: a closed shop becomes a vacant unit, a vacant unit a florist (src/sim/economy.ts). The one
 * way to change a place's kind, so the per-kind lookups stay right.
 */
export function setPlaceKind(world: World, place: PlaceId, kind: PlaceKind, patch: Partial<Pick<Place, 'name' | 'hours' | 'staff' | 'capacity'>>): void {
  const p = world.graph.places[place];
  p.kind = kind;
  Object.assign(p, patch);
  world.kindOf[place] = PLACE_KINDS.indexOf(kind);
  placeCache.delete(world);
}

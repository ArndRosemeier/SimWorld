/**
 * Encounters (plan §1.1 L0, §2.2): who meets whom, per place, per tick. Co-presence at a place makes conversations
 * at a rate set by the place (pubs and bakery queues are gossip hubs, streets are not) and by who is there (people
 * talk to people they know). A conversation grows the relationship, feeds the social need and may pass news either
 * way. Intentions to meet, tell or give someone something are fulfilled here when the two are in the same place.
 *
 * `world.encounters` holds the last tick's encounters: the views show them and the chatter engine voices them
 * (what was told is in `fact`).
 */
import { clamp } from '@futuremagic/core';
import type { Rng } from '@futuremagic/core';
import { A, ACTOR_PERSON, type ActorId } from './actors';
import { fulfil } from './actions';
import { avoids } from './intentions';
import { addFact, exchange, factText, witness } from './knowledge';
import { remember } from './memory';
import { T_AGREE } from './people';
import { KINDS } from './placeKinds';
import { PLACE_KINDS, type PlaceId } from './places';
import { liking, meet, notice } from './relations';
import { NEED_COUNT, N_SOCIAL } from './species';
import { tickRng, traitOf, type World } from './world';

export interface Encounter {
  place: PlaceId;
  a: ActorId;
  b: ActorId;
  /** talk: a conversation; snub: one avoids the other; animal: a person and an animal. */
  kind: 'talk' | 'snub' | 'animal';
  /** Fact a told b (-1 none). */
  told: number;
  /** Fact b told a (-1 none). */
  toldBack: number;
}

/** The last tick's encounters (read-only view; refilled every tick). */
export const encounters = (world: World): readonly Encounter[] => world.encounters;

// Presence buffers, reused across ticks.
const buffers = new WeakMap<World, { count: Int32Array; start: Int32Array; ids: Int32Array }>();

/** Group actors by place (counting sort). Returns per-place start offsets into `ids`. */
export function presence(world: World): { count: Int32Array; start: Int32Array; ids: Int32Array } {
  const places = world.graph.places.length;
  let b = buffers.get(world);
  if (!b || b.ids.length < world.actors.count) {
    b = { count: new Int32Array(places), start: new Int32Array(places + 1), ids: new Int32Array(world.actors.capacity) };
    buffers.set(world, b);
  }
  const a = world.actors.cols;
  b.count.fill(0);
  for (let id = 0; id < world.actors.count; id++) if (a.alive[id] && a.place[id] >= 0) b.count[a.place[id]]++;
  b.start[0] = 0;
  for (let p = 0; p < places; p++) b.start[p + 1] = b.start[p] + b.count[p];
  const fill = b.start.slice(0, places);
  for (let id = 0; id < world.actors.count; id++) if (a.alive[id] && a.place[id] >= 0) b.ids[fill[a.place[id]]++] = id;
  return b;
}

/** Who is at `place` right now (fresh scan; for queries, not hot loops). */
export function presentAt(world: World, place: PlaceId): ActorId[] {
  const a = world.actors.cols;
  const out: ActorId[] = [];
  for (let id = 0; id < world.actors.count; id++) if (a.alive[id] && a.place[id] === place) out.push(id);
  return out;
}

const available = (world: World, id: ActorId) => world.actors.cols.activity[id] !== A.sleep;

export function runEncounters(world: World): void {
  world.encounters.length = 0;
  const { count, start, ids } = presence(world);
  const rng = tickRng(world, 'encounters');
  const a = world.actors.cols;
  const rel = world.relations;
  for (let place = 0; place < count.length; place++) {
    const n = count[place];
    if (n < 2) continue;
    const kind = PLACE_KINDS[world.kindOf[place]];
    const chat = KINDS[kind].chat;
    const expected = n * chat;
    const conversations = Math.floor(expected) + (rng.float() < expected - Math.floor(expected) ? 1 : 0);
    const s = start[place];
    for (let k = 0; k < conversations; k++) {
      const x = ids[s + rng.int(0, n - 1)];
      if (!available(world, x)) continue;
      // People talk to people they know: best of three random others.
      let y = -1, ys = -Infinity;
      for (let t = 0; t < 3; t++) {
        const c = ids[s + rng.int(0, n - 1)];
        if (c === x || !available(world, c)) continue;
        const r = rel.row(x, c);
        const sc = (r >= 0 ? rel.t.cols.familiarity[r] + (rel.isFamily(x, c) ? 0.3 : 0) : 0) + rng.float() * 0.3;
        if (sc > ys) { ys = sc; y = c; }
      }
      if (y < 0) continue;
      const hub = 0.6 + chat * 10 + (kind === 'house' || kind === 'apartments' || kind === 'farmhouse' ? (rel.isFamily(x, y) ? 0.5 : 0) : 0);
      encounter(world, place, x, y, hub, rng);
    }
  }
  // Meetings people intended: the two are in the same place.
  for (let id = 0; id < world.intentions.length; id++) {
    const stack = world.intentions[id];
    if (!stack || stack.length === 0 || a.place[id] < 0 || a.dest[id] >= 0 || !available(world, id)) continue;
    for (const i of stack.slice()) {
      if ((i.kind !== 'meet' && i.kind !== 'tell' && i.kind !== 'give') || i.person < 0 || i.at > world.clock) continue;
      if (a.place[i.person] !== a.place[id] || a.dest[i.person] >= 0 || !available(world, i.person)) continue;
      const e = encounter(world, a.place[id], id, i.person, 1, rng, true);
      fulfil(world, id, i, e);
    }
  }
}

/**
 * Two actors at one place interact: they get to know each other, may share news, family news becomes a memory, bad
 * blood can flare up. Returns the encounter record. Live encounters and the chronicle both come through here.
 */
export function encounter(world: World, place: PlaceId, x: ActorId, y: ActorId, hub: number, rng: Rng, forced = false): Encounter {
  const a = world.actors.cols;
  const e: Encounter = { place, a: x, b: y, kind: 'talk', told: -1, toldBack: -1 };
  world.encounters.push(e);
  const px = a.kind[x] === ACTOR_PERSON, py = a.kind[y] === ACTOR_PERSON;
  if (!px || !py) {
    e.kind = 'animal';
    if (px || py) animalMeeting(world, place, px ? x : y, px ? y : x, rng);
    return e;
  }
  if (!forced && (avoids(world, x, y, -1) || avoids(world, y, x, -1))) {
    // The one who avoids the other leaves.
    e.kind = 'snub';
    const leaver = avoids(world, x, y, -1) ? x : y;
    a.until[leaver] = world.clock;
    return e;
  }
  const rel = world.relations;
  const warmth = clamp((traitOf(world, x, T_AGREE) + traitOf(world, y, T_AGREE)) / 2 - 0.5 + (a.mood[x] + a.mood[y]) / 4 + (liking(rel, x, y) + liking(rel, y, x)) * 0.25, -1, 1);
  meet(rel, x, y, world.clock, rng.int(3, 15), warmth);
  a.needs[x * NEED_COUNT + N_SOCIAL] = Math.min(1, a.needs[x * NEED_COUNT + N_SOCIAL] + 0.06);
  a.needs[y * NEED_COUNT + N_SOCIAL] = Math.min(1, a.needs[y * NEED_COUNT + N_SOCIAL] + 0.06);
  e.told = exchange(world, x, y, hub, rng);
  e.toldBack = exchange(world, y, x, hub, rng);
  for (const [teller, listener, f] of [[x, y, e.told], [y, x, e.toldBack]] as const) {
    if (f < 0) continue;
    const fact = world.knowledge.facts[f];
    // News about family is remembered as a moment, not just a belief.
    if ((fact.subject >= 0 && rel.isFamily(listener, fact.subject)) || fact.object === listener) {
      remember(world, listener, { who: [teller, fact.subject].filter((w) => w >= 0), summary: `heard from ${world.people.first[a.row[teller]]} that ${factText(world, fact)}`, importance: 0.6, fact: f });
    }
  }
  // Bad blood at a busy place can flare up into something the town talks about.
  if (warmth < -0.35 && liking(rel, x, y) < -0.4 && rng.chance(0.03)) {
    const f = addFact(world, { topic: 'event', subject: x, object: y, place, magnitude: 0.6, text: 'there was a shouting match between {subject} and {object} at {place}' });
    witness(world, f, nearby(world, place, 20));
    a.emotions[x * 6 + 2] = Math.min(1, a.emotions[x * 6 + 2] + 0.5);
    a.emotions[y * 6 + 2] = Math.min(1, a.emotions[y * 6 + 2] + 0.5);
  }
  return e;
}

/** A person and an animal: they get to know each other; a nervous animal may scare (or rarely bite) a stranger. */
function animalMeeting(world: World, place: PlaceId, person: ActorId, animal: ActorId, rng: Rng): void {
  const rel = world.relations;
  notice(rel, person, animal, world.clock);
  notice(rel, animal, person, world.clock);
  const temper = world.animals.cols.temperament[world.actors.cols.row[animal]];
  const r = rel.row(animal, person);
  const stranger = rel.t.cols.familiarity[r] < 0.2;
  if (!stranger || temper < 0.7) return;
  const fr = rel.ensure(person, animal);
  rel.t.cols.fear[fr] = Math.min(1, rel.t.cols.fear[fr] + 0.1);
  const keeper = world.animals.cols.keeper[world.actors.cols.row[animal]];
  if (temper > 0.85 && keeper >= 0 && rng.chance(0.01)) {
    const f = addFact(world, { topic: 'event', subject: keeper, object: person, place, magnitude: 0.7, text: "{subject}'s dog bit {object} at {place}" });
    witness(world, f, [person, ...nearby(world, place, 10)]);
    world.actors.cols.emotions[person * 6 + 3] = 0.8;
    remember(world, person, { who: [keeper, animal], summary: `${world.animals.name[world.actors.cols.row[animal]]} bit me`, importance: 0.8, emotion: 'fear', fact: f });
  }
}

/** Up to `max` awake people at a place (witnesses). */
function nearby(world: World, place: PlaceId, max: number): ActorId[] {
  const a = world.actors.cols;
  const out: ActorId[] = [];
  for (let id = 0; id < world.actors.count && out.length < max; id++) {
    if (a.place[id] === place && a.kind[id] === ACTOR_PERSON && a.activity[id] !== A.sleep) out.push(id);
  }
  return out;
}

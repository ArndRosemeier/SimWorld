/**
 * The knowledge network (plan §2): facts, beliefs, spread at encounters, distortion and forgetting.
 *
 * A Fact is an immutable event or state. Retellings can mutate a detail, which creates a *variant* fact linked to
 * the same story (`root`). A Belief is one person's version of one story: which variant they hold, how sure they are,
 * who told them, and how much it is on their mind (salience). Each person holds at most one version of a story, so
 * hearing a competing version either converts them or makes them doubt.
 *
 * The LLM may only speak from a person's beliefs (plan §2.3), so this table is also the epistemic firewall.
 */
import { clamp } from '@futuremagic/core';
import type { ActorId } from './actors';
import { T_AGREE, T_CONSC, T_EXTRA, T_OPEN } from './people';
import type { PlaceId } from './places';
import { Columns, f32, i32, u8, u16 } from './table';
import { isPerson, nameOf, tickRng, traitOf, type World } from './world';

/** Fact topics (closed set) and how newsworthy each is by default. */
export const FACT_TOPICS = ['job', 'romance', 'family', 'health', 'crime', 'politics', 'business', 'place', 'opinion', 'event', 'other'] as const;
export type FactTopic = (typeof FACT_TOPICS)[number];
const NEWSWORTHY: Record<FactTopic, number> = {
  job: 0.6, romance: 0.8, family: 0.7, health: 0.7, crime: 0.9, politics: 0.6, business: 0.4, place: 0.4, opinion: 0.5, event: 0.6, other: 0.4,
};

export interface Fact {
  id: number;
  topic: FactTopic;
  /** The person the story is about, -1 if none. */
  subject: ActorId;
  /** A second person (who did it to whom), -1 if none. */
  object: ActorId;
  place: PlaceId;
  /** Clock minute it happened. */
  time: number;
  /** How big a deal, 0..1 (embellishment raises it). */
  magnitude: number;
  /**
   * Plain-English template with `{subject}`, `{object}`, `{place}` slots ("{subject} lost their job at {place}").
   * Rendered by `factText`; the procedural text engine realises it properly for chatter.
   */
  text: string;
  secret: boolean;
  /** The story this is a version of (the original fact's id; equals `id` for originals). */
  root: number;
  /** The fact this variant was mutated from, -1 for originals. */
  parent: number;
  /** Who started it: -1 for world events, an actor for claims, lies and opinions. */
  originator: ActorId;
  /** True for what actually happened; false for distorted variants and lies. */
  truth: boolean;
}

/** Where a belief came from: an actor id, or one of these. */
export const SOURCE_WITNESSED = -1;
export const SOURCE_BROADCAST = -2;

const F_PROMISED = 1; // told under "don't tell anyone"

const BELIEF_COLUMNS = {
  holder: i32(-1),
  fact: i32(-1),
  confidence: f32(),
  source: i32(SOURCE_WITNESSED),
  heardAt: i32(),
  salience: f32(),
  flags: u8(),
  told: u16(),
} as const;

/** Beliefs held per person before the least salient are dropped. */
export const BELIEF_CAP = 300;
/** Below this salience a belief is forgotten at the nightly sweep. */
const FORGET_BELOW = 0.04;

/** Story keys: root * STORY + holder. */
const STORY = 1 << 22;

export interface Knowledge {
  facts: Fact[];
  beliefs: Columns<typeof BELIEF_COLUMNS>;
  /** Free belief rows (forgotten), reused before growing. */
  free: number[];
  /** (root, holder) → belief row. */
  byStory: Map<number, number>;
  /** Belief rows per holder. */
  byHolder: number[][];
}

export const newKnowledge = (): Knowledge => ({ facts: [], beliefs: new Columns(BELIEF_COLUMNS, 4096), free: [], byStory: new Map(), byHolder: [] });

/** What a caller supplies for a new fact; `topic` outside FACT_TOPICS becomes 'other'. */
export type NewFact = { topic: string; text: string } & Partial<Pick<Fact, 'subject' | 'object' | 'place' | 'time' | 'magnitude' | 'secret' | 'originator' | 'truth'>>;

/** Record a new world event or claim (an original story). Returns its id. */
export function addFact(world: World, f: NewFact): number {
  const k = world.knowledge;
  const id = k.facts.length;
  const topic = (FACT_TOPICS as readonly string[]).includes(f.topic) ? (f.topic as FactTopic) : 'other';
  k.facts.push({
    id, topic, subject: f.subject ?? -1, object: f.object ?? -1, place: f.place ?? -1, time: f.time ?? world.clock,
    magnitude: clamp(f.magnitude ?? 0.5, 0, 1), text: f.text, secret: f.secret ?? false, root: id, parent: -1,
    originator: f.originator ?? -1, truth: f.truth ?? true,
  });
  return id;
}

/** "Jonas Keller lost their job at Elm Street Garage". */
export function factText(world: World, fact: Fact): string {
  return fact.text
    .replace(/\{subject\}/g, fact.subject >= 0 ? nameOf(world, fact.subject) : 'someone')
    .replace(/\{object\}/g, fact.object >= 0 ? nameOf(world, fact.object) : 'someone')
    .replace(/\{place\}/g, fact.place >= 0 ? world.graph.places[fact.place].name : 'somewhere');
}


/** How much a story matters to `holder`: newsworthiness, size, and whether it is about someone they know. */
function salienceFor(world: World, holder: ActorId, fact: Fact): number {
  let relevance = 0.35;
  for (const who of [fact.subject, fact.object]) {
    if (who < 0) continue;
    if (who === holder) { relevance = 1; break; }
    const r = world.relations.row(holder, who);
    if (r >= 0) relevance = Math.max(relevance, 0.4 + 0.6 * world.relations.t.cols.familiarity[r]);
  }
  return clamp(NEWSWORTHY[fact.topic] * (0.5 + fact.magnitude) * relevance, 0, 1);
}

/** The belief row `holder` has about the story of `fact`, or -1. */
export function beliefAbout(world: World, holder: ActorId, fact: number): number {
  return world.knowledge.byStory.get(world.knowledge.facts[fact].root * STORY + holder) ?? -1;
}

function newBelief(world: World, holder: ActorId, fact: Fact, confidence: number, source: ActorId): number {
  const k = world.knowledge;
  const b = k.beliefs;
  const r = k.free.length > 0 ? k.free.pop()! : b.add();
  b.clear(r);
  const c = b.cols;
  c.holder[r] = holder; c.fact[r] = fact.id; c.confidence[r] = confidence; c.source[r] = source;
  c.heardAt[r] = world.clock; c.salience[r] = salienceFor(world, holder, fact);
  k.byStory.set(fact.root * STORY + holder, r);
  const list = (k.byHolder[holder] ??= []);
  list.push(r);
  if (list.length > BELIEF_CAP) dropLeastSalient(world, holder);
  return r;
}

function dropBelief(world: World, r: number): void {
  const k = world.knowledge, c = k.beliefs.cols;
  const holder = c.holder[r];
  k.byStory.delete(k.facts[c.fact[r]].root * STORY + holder);
  const list = k.byHolder[holder];
  const i = list.indexOf(r);
  if (i >= 0) { list[i] = list[list.length - 1]; list.pop(); }
  c.holder[r] = -1;
  k.free.push(r);
}

function dropLeastSalient(world: World, holder: ActorId): void {
  const c = world.knowledge.beliefs.cols;
  let worst = -1, ws = Infinity;
  for (const r of world.knowledge.byHolder[holder]) if (c.salience[r] < ws) { ws = c.salience[r]; worst = r; }
  if (worst >= 0) dropBelief(world, worst);
}

/** People saw it happen: full confidence, high salience. Animals are skipped (no beliefs). */
export function witness(world: World, fact: number, holders: readonly ActorId[]): void {
  const f = world.knowledge.facts[fact];
  for (const h of holders) {
    if (!isPerson(world, h)) continue;
    const r = beliefAbout(world, h, fact);
    if (r >= 0) {
      const c = world.knowledge.beliefs.cols;
      c.fact[r] = fact; c.confidence[r] = 1; c.source[r] = SOURCE_WITNESSED;
      c.salience[r] = Math.max(c.salience[r], salienceFor(world, h, f));
    } else newBelief(world, h, f, 1, SOURCE_WITNESSED);
  }
}

/** A newspaper item, the notice board: a low-salience belief for a share of the adults. */
export function broadcast(world: World, fact: number, reach: number): void {
  const f = world.knowledge.facts[fact];
  const rng = tickRng(world, 'broadcast', fact);
  for (let id = 0; id < world.actors.count; id++) {
    if (!isPerson(world, id) || !rng.chance(reach) || beliefAbout(world, id, fact) >= 0) continue;
    const r = newBelief(world, id, f, 0.7, SOURCE_BROADCAST);
    world.knowledge.beliefs.cols.salience[r] *= 0.5;
  }
}

/**
 * `listener` hears the teller's version of a story. Confidence is the teller's × trust in the teller ×
 * plausibility. A competing version held more strongly is kept (with a little doubt); a stronger new one
 * replaces it. Returns the listener's belief row.
 */
function hear(world: World, teller: ActorId, listener: ActorId, fact: Fact, tellerConfidence: number, promised: boolean): number {
  const rel = world.relations;
  const tr = rel.row(listener, teller);
  const trust = tr >= 0 ? rel.t.cols.trust[tr] : 0.3;
  const plausibility = 1 - 0.5 * Math.max(0, fact.magnitude - 0.7);
  const r = believe(world, listener, fact.id, tellerConfidence * (0.35 + 0.65 * trust) * plausibility, teller, trust);
  const c = world.knowledge.beliefs.cols;
  if (promised) c.flags[r] |= F_PROMISED;
  c.salience[r] = Math.max(c.salience[r], salienceFor(world, listener, fact) * 0.9);
  return r;
}

/**
 * `holder` takes on a version of a story with `confidence`, from `source`. Same version: more sure. A competing
 * version held more strongly is kept (with a little doubt, more the more the source is trusted); a clearly stronger
 * new one replaces it. Returns the belief row. Used by retelling and by `applyProposal` for claims.
 */
export function believe(world: World, holder: ActorId, fact: number, confidence: number, source: ActorId, trust = 0.5): number {
  const f = world.knowledge.facts[fact];
  const conf = clamp(confidence, 0.05, 0.98);
  const c = world.knowledge.beliefs.cols;
  let r = beliefAbout(world, holder, fact);
  if (r < 0) r = newBelief(world, holder, f, conf, source);
  else if (c.fact[r] === fact) c.confidence[r] = clamp(c.confidence[r] + (1 - c.confidence[r]) * conf * 0.3, 0, 1);
  else if (conf > c.confidence[r] * 1.15) { c.fact[r] = fact; c.confidence[r] = conf; c.source[r] = source; c.heardAt[r] = world.clock; }
  else c.confidence[r] = Math.max(0.05, c.confidence[r] - 0.05 * trust);
  return r;
}

/**
 * Retelling may change a detail (plan §2.2 distortion): usually it grows in the telling, sometimes the wrong person
 * or place gets attached. Careless, imaginative tellers distort more. Returns the fact actually told.
 */
function maybeDistort(world: World, teller: ActorId, fact: Fact, roll: () => number): Fact {
  const p = 0.05 * (1.5 - traitOf(world, teller, T_CONSC)) * (0.5 + traitOf(world, teller, T_OPEN));
  if (roll() >= p) return fact;
  const v: Fact = { ...fact, id: world.knowledge.facts.length, parent: fact.id, truth: false, originator: fact.originator };
  const kind = roll();
  if (kind < 0.6 || (fact.subject < 0 && fact.place < 0)) v.magnitude = clamp(fact.magnitude + 0.15, 0, 1);
  else if (kind < 0.8 && fact.subject >= 0 && fact.text.includes('{subject}')) {
    // Pin it on someone the teller knows who is "the type": another person they know.
    const known = world.relations.known(teller);
    if (known.length === 0) return fact;
    const other = world.relations.t.cols.to[known[Math.floor(roll() * known.length)]];
    if (other === fact.subject || !isPerson(world, other)) return fact;
    v.subject = other;
  } else if (fact.place >= 0 && fact.text.includes('{place}')) {
    const same = world.graph.places.filter((p) => p.kind === world.graph.places[fact.place].kind && p.id !== fact.place);
    if (same.length === 0) return fact;
    v.place = same[Math.floor(roll() * same.length)].id;
  } else return fact;
  world.knowledge.facts.push(v);
  return v;
}

/**
 * Teller passes their version of a story to listener, now. Used by conversations (`exchange`), 'tell' intentions and
 * `applyProposal`. Secrets travel with "don't tell anyone". Returns the fact told (a variant if it got distorted),
 * or -1 if the teller has no belief about it.
 */
export function tell(world: World, teller: ActorId, listener: ActorId, fact: number): number {
  const r = beliefAbout(world, teller, fact);
  if (r < 0 || !isPerson(world, listener)) return -1;
  const c = world.knowledge.beliefs.cols;
  const rng = tickRng(world, 'tell', teller, listener);
  const held = world.knowledge.facts[c.fact[r]];
  const told = maybeDistort(world, teller, held, () => rng.float());
  hear(world, teller, listener, told, c.confidence[r], held.secret);
  c.told[r] = Math.min(65535, c.told[r] + 1);
  c.salience[r] *= 0.92; // old news to the teller, a little more each time
  return told.id;
}

/**
 * One side of a conversation may share news (plan §2.2): the most salient story the listener has not heard, if the
 * teller is in the mood. Chance ∝ salience × extraversion × closeness × the place's gossip weight. Secrets need high
 * trust, and a promised secret needs more (and a less agreeable, less conscientious teller). Returns the fact told
 * or -1.
 */
export function exchange(world: World, teller: ActorId, listener: ActorId, hub: number, roll: () => number): number {
  const k = world.knowledge;
  const list = k.byHolder[teller];
  if (!list || list.length === 0) return -1;
  const c = k.beliefs.cols;
  const rel = world.relations;
  const rr = rel.row(teller, listener);
  const familiarity = rr >= 0 ? rel.t.cols.familiarity[rr] : 0;
  const trust = rr >= 0 ? rel.t.cols.trust[rr] : 0.3;
  let best = -1, bestScore = 0;
  for (const r of list) {
    const f = k.facts[c.fact[r]];
    if (f.subject === listener) continue; // you don't gossip to someone about themselves
    const lr = k.byStory.get(f.root * STORY + listener);
    if (lr !== undefined && c.fact[lr] === f.id) continue; // they already have this version
    if (f.secret) {
      const need = c.flags[r] & F_PROMISED ? 0.85 + 0.15 * (traitOf(world, teller, T_AGREE) + traitOf(world, teller, T_CONSC)) / 2 : 0.7;
      if (trust < need) continue;
    }
    const s = c.salience[r] * c.confidence[r] * (0.75 + 0.5 * roll());
    if (s > bestScore) { bestScore = s; best = r; }
  }
  if (best < 0) return -1;
  const p = clamp(bestScore * (0.3 + traitOf(world, teller, T_EXTRA)) * (0.4 + familiarity) * hub, 0, 0.9);
  if (roll() >= p) return -1;
  return tell(world, teller, listener, c.fact[best]);
}

/** Nightly: salience fades (slower for what touches the holder), the faint is forgotten. */
export function forget(world: World): void {
  const k = world.knowledge, c = k.beliefs.cols;
  for (let r = 0; r < k.beliefs.count; r++) {
    const holder = c.holder[r];
    if (holder < 0) continue;
    const f = k.facts[c.fact[r]];
    const personal = f.subject === holder || f.object === holder || c.source[r] === SOURCE_WITNESSED;
    c.salience[r] *= personal ? 0.97 : 0.85;
    if (c.salience[r] < FORGET_BELOW && f.subject !== holder) dropBelief(world, r);
  }
}

export interface BeliefView {
  fact: Fact;
  /** The fact rendered for this world ("Jonas Keller lost their job at Elm Street Garage"). */
  text: string;
  confidence: number;
  /** Actor who told them, or SOURCE_WITNESSED / SOURCE_BROADCAST. */
  source: ActorId;
  heardAt: number;
  salience: number;
  /** They were told "don't tell anyone". */
  promised: boolean;
}

/** What `id` believes, most salient first. Only this goes into an NPC's prompt (the epistemic firewall). */
export function beliefsOf(world: World, id: ActorId): BeliefView[] {
  const k = world.knowledge, c = k.beliefs.cols;
  return (k.byHolder[id] ?? [])
    .map((r) => ({
      fact: k.facts[c.fact[r]], text: factText(world, k.facts[c.fact[r]]), confidence: c.confidence[r], source: c.source[r],
      heardAt: c.heardAt[r], salience: c.salience[r], promised: (c.flags[r] & F_PROMISED) !== 0,
    }))
    .sort((a, b) => b.salience - a.salience);
}

/** How many people hold any version of a story, and how many hold the true one (rumour-reach metrics). */
export function reach(world: World, root: number): { any: number; truth: number } {
  const k = world.knowledge, c = k.beliefs.cols;
  let any = 0, truth = 0;
  for (let r = 0; r < k.beliefs.count; r++) {
    if (c.holder[r] < 0) continue;
    const f = k.facts[c.fact[r]];
    if (f.root !== root) continue;
    any++;
    if (f.truth) truth++;
  }
  return { any, truth };
}

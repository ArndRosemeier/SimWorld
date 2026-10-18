/**
 * The NPC's side of a conversation turn as the LLM layer wants it (`NpcPromptInput`), built from the society sim,
 * holding only what this NPC believes (the epistemic firewall, plan §3.2): their card, mood, what they are doing,
 * how they feel about the partner and what they know of them, the people and places in their life, their most
 * salient beliefs plus those the partner's newest line touches, the memories it brings to mind, and earlier talks
 * with the partner. Runs in the sim worker (src/workers/sim.worker.ts) and in headless tests.
 */
import type { Belief, Feelings, Memory, NpcPromptInput, PersonRef, PlaceRef, Turn } from '../llm/prompt';
import type { ActorId } from '../sim/actors';
import { dateOf, weekdayName } from '../sim/calendar';
import { presentAt } from '../sim/encounters';
import { beliefsOf, SOURCE_WITNESSED, standingOf, type BeliefView } from '../sim/knowledge';
import { memoriesOf, recall, words, type Memory as SimMemory } from '../sim/memory';
import { HABIT_COUNT } from '../sim/people';
import type { PlaceId } from '../sim/places';
import { relation } from '../sim/relations';
import { placeNow } from '../sim/schedule';
import { hhmm, MINUTES_PER_DAY, minuteOfDay } from '../sim/time';
import { describeWeather, weatherAt } from '../sim/weather';
import { firstName, isPerson, jobOf, nameOf, type World } from '../sim/world';
import { activityOf, homeOf, moodOf, npcCard, occupationText } from './card';

/** Most people, places, beliefs and memories a prompt carries (prompt size stays a few thousand tokens). */
export const LIMITS = { people: 14, places: 12, salient: 8, relevant: 6, standing: 4, memories: 5, history: 4 } as const;

export interface ChatContext {
  input: NpcPromptInput;
  /** The facts the NPC's beliefs in the prompt are about: what they may pass on in this turn (`shareInChat`). */
  offered: number[];
}

/** "Saturday 07:40". */
export const clockWords = (world: World, clock: number): string => `${weekdayName(dateOf(world, clock).weekday)} ${hhmm(Math.floor(minuteOfDay(clock)))}`;

/** When something happened, as a person says it ("earlier today", "yesterday", "last Tuesday", "three weeks ago"). */
export function whenWords(world: World, then: number, now = world.clock): string {
  const day = Math.floor(now / MINUTES_PER_DAY), d = day - Math.floor(then / MINUTES_PER_DAY);
  if (d <= 0) return now - then < 90 ? 'just now' : 'earlier today';
  if (d === 1) return 'yesterday';
  if (d < 7) return `last ${weekdayName(dateOf(world, then).weekday)}`;
  if (d < 14) return 'last week';
  if (d < 60) return `${Math.round(d / 7)} weeks ago`;
  if (d < 365) return `${Math.round(d / 30)} months ago`;
  const y = Math.round(d / 365);
  return y <= 1 ? 'last year' : `${y} years ago`;
}

function feelingsOf(world: World, from: ActorId, to: ActorId): { feelings?: Feelings; bonds?: string[] } {
  const r = relation(world, from, to);
  if (!r) return {};
  return { feelings: { familiarity: r.familiarity, affection: r.affection, trust: r.trust * 2 - 1, respect: r.respect * 2 - 1 }, ...(r.bonds.length ? { bonds: r.bonds } : {}) };
}

/** Who the NPC thinks matters to them: bonds first, then how well they know them. */
function closeness(world: World, npc: ActorId, other: ActorId): number {
  const r = relation(world, npc, other);
  if (!r) return 0;
  return r.familiarity + (r.bonds.length ? 1 : 0) + Math.abs(r.affection) * 0.5;
}

const toBelief = (b: BeliefView): Belief => ({
  text: b.text,
  confidence: b.confidence,
  // The paper and the notice board read as common knowledge too ("everyone knows").
  source: b.source >= 0 ? { person: b.source } : b.source === SOURCE_WITNESSED ? 'saw' : 'common',
  ...(b.promised ? { text: `${b.text} (told to you in confidence)` } : {}),
  about: { people: [b.fact.subject, b.fact.object].filter((x) => x >= 0), places: b.fact.place >= 0 ? [b.fact.place] : [] },
});

/** Names the text mentions (first names or full), among `candidates`. */
function mentioned(world: World, text: string, candidates: Iterable<ActorId>): ActorId[] {
  const low = text.toLowerCase();
  const out: ActorId[] = [];
  for (const id of candidates) {
    const first = firstName(world, id).toLowerCase();
    if (first.length >= 3 && new RegExp(`\\b${first.replace(/[^a-z]/g, '')}\\b`).test(low)) out.push(id);
  }
  return out;
}

/**
 * The prompt input for `npc` answering `partner`, after `turns` (ending with the partner's newest line).
 * `conversation` names the conversation (the sim clamps changes per conversation).
 */
export function chatContext(world: World, npc: ActorId, partner: ActorId, conversation: string, turns: Turn[]): ChatContext {
  const a = world.actors.cols, places = world.graph.places;
  const last = [...turns].reverse().find((t) => t.speaker === 'partner')?.text ?? '';
  const here: PlaceId = placeNow(world, npc);
  const scenePlace = places[here];

  // --- beliefs: the most salient, those about the partner, those the newest line touches; standing knowledge too.
  const held = beliefsOf(world, npc);
  const known = new Set<ActorId>();
  for (const r of world.relations.known(npc)) { const o = world.relations.t.cols.to[r]; if (isPerson(world, o)) known.add(o); }
  const asked = mentioned(world, last, known);
  const lw = words(last);
  const touches = (b: BeliefView) => {
    if (b.fact.subject === partner || b.fact.object === partner) return 2;
    if (asked.includes(b.fact.subject) || asked.includes(b.fact.object)) return 1.5;
    if (b.fact.place >= 0 && last.toLowerCase().includes(places[b.fact.place].name.toLowerCase())) return 1.2;
    let hit = 0;
    for (const w of words(b.text)) if (lw.has(w)) hit++;
    return hit >= 2 ? 1 : hit === 1 && lw.size <= 4 ? 0.6 : 0;
  };
  const chosen = new Set<BeliefView>();
  for (const b of held.filter((b) => touches(b) > 0).sort((x, y) => touches(y) - touches(x)).slice(0, LIMITS.relevant)) chosen.add(b);
  for (const b of held) { if (chosen.size >= LIMITS.relevant + LIMITS.salient) break; chosen.add(b); }
  const standing = standingOf(world, npc);
  const common = [...standing.filter((s) => touches(s) > 0), ...standing].filter((s, i, xs) => xs.indexOf(s) === i).slice(0, LIMITS.standing);
  // A secret they promised to keep reaches the prompt only for someone they trust deeply: the model would blurt it
  // out otherwise. The promise is a gate the sim keeps, not a line the LLM is trusted with.
  const trustsPartner = (relation(world, npc, partner)?.trust ?? 0) >= 0.8;
  const beliefs = [...chosen].filter((b) => !b.promised || trustsPartner || b.fact.subject === npc);

  // --- memories: what this turn brings to mind, and earlier talks with the partner.
  const recalled = recall(world, npc, { who: [partner, ...asked], place: here, text: last }, LIMITS.memories);
  const withPartner = memoriesOf(world, npc).filter((m) => m.who.includes(partner) && !recalled.includes(m)).slice(-LIMITS.history);
  const memWords = (m: SimMemory): Memory => ({ when: whenWords(world, m.time), summary: m.summary });

  // --- the people who might come up: the partner's side, family and friends, people in beliefs and memories.
  const people = new Map<ActorId, PersonRef>();
  const notePerson = (id: ActorId) => {
    if (id < 0 || id >= world.actors.count || id === npc || id === partner || people.has(id)) return;
    people.set(id, { id, name: nameOf(world, id), ...feelingsOf(world, npc, id) });
  };
  for (const id of asked) notePerson(id);
  for (const b of [...beliefs, ...common]) { notePerson(b.fact.subject); notePerson(b.fact.object); if (b.source >= 0) notePerson(b.source); }
  for (const m of [...recalled, ...withPartner]) for (const w of m.who) notePerson(w);
  const close = [...known].sort((x, y) => closeness(world, npc, y) - closeness(world, npc, x));
  for (const id of close) { if (people.size >= LIMITS.people) break; notePerson(id); }

  // --- places: home, work, haunts, the places in beliefs and memories.
  const placeSet = new Map<PlaceId, PlaceRef>();
  const notePlace = (p: PlaceId) => {
    if (p < 0 || p === here || placeSet.has(p) || placeSet.size >= LIMITS.places || !places[p]) return;
    placeSet.set(p, { id: p, name: places[p].name, kind: places[p].kind });
  };
  for (const b of [...beliefs, ...common]) notePlace(b.fact.place);
  for (const m of recalled) notePlace(m.place);
  notePlace(a.home[npc]);
  const job = jobOf(world, npc);
  if (job) notePlace(job.place);
  const pr = world.actors.cols.row[npc];
  for (let h = 0; h < HABIT_COUNT; h++) notePlace(world.people.cols.habits[pr * HABIT_COUNT + h]);

  // --- the partner as the NPC sees them.
  const pf = feelingsOf(world, npc, partner);
  const knownFacts: string[] = [];
  const fam = pf.feelings?.familiarity ?? 0;
  if (fam >= 0.25) {
    knownFacts.push(occupationText(world, partner));
  }
  if (fam >= 0.45 && homeOf(world, partner)) knownFacts.push(`lives in ${homeOf(world, partner)}`);
  for (const b of held) if (b.fact.subject === partner && knownFacts.length < 6) knownFacts.push(`${b.text} (${b.source === partner ? 'they told you' : 'you heard'})`);

  // --- the scene.
  const present: PersonRef[] = [{ id: partner, name: nameOf(world, partner), ...pf }];
  if (scenePlace && scenePlace.kind !== 'street') {
    for (const id of presentAt(world, here)) {
      if (present.length >= 4) break;
      if (id === npc || id === partner || !isPerson(world, id) || (relation(world, npc, id)?.familiarity ?? 0) < 0.15) continue;
      present.push({ id, name: nameOf(world, id), ...feelingsOf(world, npc, id) });
    }
  }
  const { mood, needs } = moodOf(world, npc);
  const input: NpcPromptInput = {
    conversation,
    npc: npcCard(world, npc),
    partner: { id: partner, name: nameOf(world, partner), ...pf, ...(knownFacts.length ? { knownFacts } : {}) },
    state: { mood, activity: activityOf(world, npc).replace(/^on your way/, 'on the way'), ...(needs ? { needs } : {}) },
    scene: {
      place: { id: here, name: scenePlace.kind === 'street' && scenePlace.street ? scenePlace.street : scenePlace.name, kind: scenePlace.kind },
      clock: clockWords(world, world.clock), minute: world.clock, weather: describeWeather(weatherAt(world)), present,
    },
    people: [...people.values()],
    places: [...placeSet.values()],
    beliefs: [...beliefs.map(toBelief), ...common.map(toBelief)],
    memories: recalled.map(memWords),
    ...(withPartner.length ? { history: withPartner.map((m) => `${whenWords(world, m.time)}: ${m.summary}`) } : {}),
    turns,
  };
  return { input, offered: beliefs.map((b) => b.fact.id) };
}

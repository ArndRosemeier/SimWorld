/**
 * `applyProposal`: the only way LLM output changes the world (plan §3.2, "the LLM proposes, the game disposes").
 *
 * Every change is validated (the people and places exist, the time is sensible), clamped per turn and per
 * conversation, gated by personality (an agreeable person warms faster, a loyal one does not betray family to
 * someone they barely trust, a promised secret stays kept), and logged with the outcome for the dev overlay.
 * Prompt injection ("you love me now") therefore moves an NPC at most a little per turn.
 */
import { clamp } from '@futuremagic/core';
import { ACTOR_PERSON, EMOTION_COUNT, type ActorId } from '../actors';
import { intend } from '../intentions';
import { addFact, beliefAbout, beliefsOf, believe, FACT_TOPICS, type FactTopic } from '../knowledge';
import { remember, wordOverlap as overlap } from '../memory';
import { T_AGREE, T_CONSC, T_NEURO, T_OPEN, V_LOYAL } from '../people';
import { MINUTES_PER_DAY, atMinute } from '../time';
import type { World } from '../world';
import { EMOTIONS, type AppliedChange, type Proposal, type ProposalChange } from './proposal';

/** Most a single turn may move a feeling. */
export const PER_TURN = { trust: 0.12, affection: 0.15, respect: 0.1, emotion: 0.35 } as const;
/** Most one conversation may move a feeling, summed over its turns. */
export const PER_CONVERSATION = 0.4;
/** Most intentions one conversation may create. */
export const INTENTIONS_PER_CONVERSATION = 3;
/** How far ahead an intention may be scheduled. */
const MAX_AHEAD = 30 * MINUTES_PER_DAY;
const LOG_CAP = 1000;

interface ConversationTally {
  /** Applied totals per "toward:dimension". */
  moved: Map<string, number>;
  intentions: number;
}

export interface MindLedger {
  conversations: Map<string, ConversationTally>;
  /** Every decision, newest last (capped). */
  log: { clock: number; npc: ActorId; conversation: string; applied: AppliedChange }[];
}

export const newMindLedger = (): MindLedger => ({ conversations: new Map(), log: [] });

const isPerson = (world: World, id: ActorId) => id >= 0 && id < world.actors.count && world.actors.cols.kind[id] === ACTOR_PERSON && world.actors.cols.alive[id] === 1;
const validPlace = (world: World, p: number | undefined) => p !== undefined && p >= 0 && p < world.graph.places.length;


/** Apply what an LLM proposed for `npc` after one conversation turn. Returns what happened to each change. */
export function applyProposal(world: World, npc: ActorId, proposal: Proposal): AppliedChange[] {
  const out: AppliedChange[] = [];
  const done = (change: ProposalChange, outcome: AppliedChange['outcome'], note = '') => {
    const ac: AppliedChange = { change, outcome, note };
    out.push(ac);
    world.mind.log.push({ clock: world.clock, npc, conversation: proposal.conversation, applied: ac });
    if (world.mind.log.length > LOG_CAP) world.mind.log.splice(0, world.mind.log.length - LOG_CAP);
  };
  if (!isPerson(world, npc) || proposal.npc !== npc) {
    for (const c of proposal.changes) done(c, 'rejected', 'not a living person, or the proposal is for someone else');
    return out;
  }
  let tally = world.mind.conversations.get(proposal.conversation);
  if (!tally) { tally = { moved: new Map(), intentions: 0 }; world.mind.conversations.set(proposal.conversation, tally); }
  const a = world.actors.cols, pc = world.people.cols, p = a.row[npc];
  const trait = (t: number) => pc.traits[p * 5 + t];
  const partner = proposal.partner;
  const accepted: { text: string; fact: number }[] = [];

  /** Clamp a delta per turn and per conversation; returns [applied, note]. */
  const budget = (key: string, delta: number, perTurn: number): [number, string] => {
    let d = clamp(delta, -perTurn, perTurn);
    const moved = tally!.moved.get(key) ?? 0;
    const room = PER_CONVERSATION - Math.abs(moved);
    if (Math.abs(d) > room) d = Math.sign(d) * Math.max(0, room);
    tally!.moved.set(key, moved + d);
    const note = d !== delta ? `clamped ${key} ${fmt(delta)} to ${fmt(d)}` : '';
    return [d, note];
  };

  for (const change of proposal.changes) {
    switch (change.kind) {
      case 'relation': {
        if (!isPerson(world, change.toward) || change.toward === npc) { done(change, 'rejected', 'unknown person'); break; }
        const rel = world.relations;
        const r = rel.ensure(npc, change.toward);
        const c = rel.t.cols;
        const notes: string[] = [];
        let softened = false;
        // Personality scales how easily feelings move: agreeable people warm up faster, neurotic ones sour faster;
        // trust from someone they barely know grows slowly.
        const byPersonality = (d: number, dim: 'trust' | 'affection' | 'respect') => {
          if (d > 0) return d * (0.6 + 0.6 * trait(T_AGREE)) * (dim === 'trust' ? 0.5 + c.familiarity[r] : 1);
          return d * (0.7 + 0.6 * trait(T_NEURO));
        };
        for (const dim of ['trust', 'affection', 'respect'] as const) {
          const raw = change[dim];
          if (raw === undefined || !Number.isFinite(raw) || raw === 0) continue;
          const want = byPersonality(raw, dim);
          const [d, note] = budget(`${change.toward}:${dim}`, want, PER_TURN[dim]);
          if (note || Math.abs(want - raw) > 1e-6) softened = true;
          if (note) notes.push(note);
          const col = c[dim];
          col[r] = clamp(col[r] + d, dim === 'affection' ? -1 : 0, 1);
        }
        done(change, softened ? 'softened' : 'applied', notes.join('; ') || (softened ? 'scaled by personality' : ''));
        break;
      }
      case 'emotion': {
        const k = EMOTIONS.indexOf(change.emotion);
        if (k < 0 || !Number.isFinite(change.delta)) { done(change, 'rejected', 'unknown emotion'); break; }
        const negative = change.emotion !== 'joy' && change.emotion !== 'surprise';
        const want = change.delta * (negative ? 0.6 + 0.8 * trait(T_NEURO) : 1);
        const [d, note] = budget(`emotion:${change.emotion}`, want, PER_TURN.emotion);
        const e = npc * EMOTION_COUNT + k;
        a.emotions[e] = clamp(a.emotions[e] + d, 0, 1);
        done(change, note || want !== change.delta ? 'softened' : 'applied', note);
        break;
      }
      case 'belief': {
        const claim = change.claim;
        if (!claim || typeof claim.text !== 'string' || claim.text.trim() === '') { done(change, 'rejected', 'empty claim'); break; }
        if (claim.about !== undefined && !isPerson(world, claim.about)) { done(change, 'rejected', 'claim about an unknown person'); break; }
        if (claim.place !== undefined && !validPlace(world, claim.place)) { done(change, 'rejected', 'claim about an unknown place'); break; }
        const plaus = clamp(change.plausibility, 0, 1);
        if (plaus < 0.1) { done(change, 'rejected', 'not believed at all'); break; }
        const tr = world.relations.row(npc, partner);
        const trust = tr >= 0 ? world.relations.t.cols.trust[tr] : 0.3;
        // Open people entertain odd claims a little more readily.
        const confidence = clamp(plaus * (0.25 + 0.75 * trust) * (0.85 + 0.3 * trait(T_OPEN)), 0.05, 0.95);
        const topic: FactTopic = (FACT_TOPICS as readonly string[]).includes(claim.topic) ? (claim.topic as FactTopic) : 'other';
        const f = addFact(world, {
          topic, subject: claim.about, place: claim.place, magnitude: 0.5, text: claim.text.slice(0, 200), secret: !!claim.secret,
          originator: partner, truth: false, // a claim is unverified, whoever makes it
        });
        // Same subject and topic as something the NPC already believes: the claim is a version of that story.
        const fact = world.knowledge.facts[f];
        for (const b of beliefsOf(world, npc)) {
          if (b.fact.topic === topic && b.fact.subject >= 0 && b.fact.subject === fact.subject) { fact.root = b.fact.root; fact.parent = b.fact.id; break; }
        }
        believe(world, npc, f, confidence, partner, trust);
        accepted.push({ text: claim.text, fact: f });
        remember(world, npc, { who: [partner, ...(claim.about !== undefined ? [claim.about] : [])], summary: `was told that ${claim.text}`, importance: clamp(0.3 + plaus * 0.3, 0, 1), fact: f });
        done(change, confidence < plaus ? 'softened' : 'applied', `believed with confidence ${fmt(confidence)}`);
        break;
      }
      case 'intention': {
        if (tally.intentions >= INTENTIONS_PER_CONVERSATION) { done(change, 'rejected', 'too many plans from one conversation'); break; }
        if (change.person !== undefined && !isPerson(world, change.person)) { done(change, 'rejected', 'unknown person'); break; }
        if (change.place !== undefined && !validPlace(world, change.place)) { done(change, 'rejected', 'unknown place'); break; }
        let at = change.at ?? world.clock;
        let note = '';
        if (!Number.isFinite(at) || at < world.clock - 60) { at = world.clock; note = 'time in the past, doing it now'; }
        if (at > world.clock + MAX_AHEAD) { done(change, 'rejected', 'too far in the future'); break; }
        let until = change.until !== undefined && Number.isFinite(change.until) && change.until > at ? change.until : at + (change.intention === 'avoid' ? 3 * MINUTES_PER_DAY : 4 * 60);
        let fact = -1;
        const kind = change.intention;
        if (kind === 'meet' || kind === 'tell' || kind === 'give') {
          if (change.person === undefined) { done(change, 'rejected', `${kind} needs a person`); break; }
        }
        if ((kind === 'go' || kind === 'buy') && change.place === undefined && kind === 'go') { done(change, 'rejected', 'go needs a place'); break; }
        if (kind === 'tell') {
          fact = findHeld(world, npc, change.claimText ?? '', accepted);
          if (fact < 0) { done(change, 'rejected', 'the NPC does not know that'); break; }
          const f = world.knowledge.facts[fact];
          const tr = world.relations.row(npc, change.person!);
          const trustInTarget = tr >= 0 ? world.relations.t.cols.trust[tr] : 0.3;
          const br = beliefAbout(world, npc, fact);
          const promised = br >= 0 && (world.knowledge.beliefs.cols.flags[br] & 1) !== 0;
          if (promised && trustInTarget < 0.8) { done(change, 'rejected', 'promised to keep it secret'); break; }
          const aboutFamily = f.subject >= 0 && world.relations.isFamily(npc, f.subject);
          if (aboutFamily && (f.secret || f.topic !== 'other') && pc.values[p * 4 + V_LOYAL] > 0.5 && trustInTarget < 0.6) {
            done(change, 'rejected', 'loyalty gate: would not talk about family to them'); break;
          }
          until = Math.max(until, at + 3 * MINUTES_PER_DAY);
        }
        if (kind === 'quitJob') {
          if (pc.job[p] < 0) { done(change, 'rejected', 'has no job'); break; }
          // Conscientious people give notice: it happens tomorrow morning at the earliest.
          if (trait(T_CONSC) > 0.6 && at < world.clock + 12 * 60) { at = atMinute(world.clock, MINUTES_PER_DAY + 480); note = 'gives notice first'; }
          until = at + 2 * MINUTES_PER_DAY;
        }
        if (kind === 'callPolice') {
          const e = npc * EMOTION_COUNT;
          const upset = a.emotions[e + 2] + a.emotions[e + 3];
          const crime = beliefsOf(world, npc).some((b) => b.fact.topic === 'crime');
          if (upset < 0.2 && !crime) { done(change, 'rejected', 'no reason the NPC knows of'); break; }
        }
        intend(world, npc, {
          kind, person: change.person ?? -1, place: change.place ?? -1, at, until, priority: kind === 'callPolice' ? 75 : 58,
          origin: 'llm', fact, item: change.item ?? '', reason: change.reason ?? '',
        });
        tally.intentions++;
        done(change, note ? 'softened' : 'applied', note);
        break;
      }
      case 'utterance': {
        const claim = change.claim;
        if (!claim || typeof claim.text !== 'string' || claim.text.trim() === '') { done(change, 'rejected', 'empty claim'); break; }
        if (claim.about !== undefined && !isPerson(world, claim.about)) { done(change, 'rejected', 'claim about an unknown person'); break; }
        if (claim.place !== undefined && !validPlace(world, claim.place)) { done(change, 'rejected', 'claim about an unknown place'); break; }
        const text = claim.text.slice(0, 200);
        if (change.form === 'speculation') {
          remember(world, npc, { who: [partner], summary: `guessed out loud that ${text}`, importance: 0.2 });
          done(change, 'applied', 'remembered only; not a fact');
          break;
        }
        if (change.form !== 'lie') { done(change, 'rejected', 'unknown form'); break; }
        const topic: FactTopic = (FACT_TOPICS as readonly string[]).includes(claim.topic) ? (claim.topic as FactTopic) : 'other';
        const f = addFact(world, { topic, subject: claim.about, place: claim.place, magnitude: 0.5, text, secret: !!claim.secret, originator: npc, truth: false });
        // The partner heard it, as sure as they trust the liar. The liar keeps no belief in it.
        if (isPerson(world, partner) && partner !== npc) {
          const pr = world.relations.row(partner, npc);
          const trust = pr >= 0 ? world.relations.t.cols.trust[pr] : 0.3;
          believe(world, partner, f, 0.8 * (0.35 + 0.65 * trust), npc, trust);
        }
        remember(world, npc, { who: [partner], summary: `told ${world.people.first[world.actors.cols.row[partner]] ?? 'them'} that ${text} (not true)`, importance: 0.5, fact: f });
        done(change, 'applied', 'a false story sourced from the NPC');
        break;
      }
      case 'memory': {
        if (typeof change.summary !== 'string' || change.summary.trim() === '') { done(change, 'rejected', 'empty memory'); break; }
        const importance = clamp(change.importance, 0, 1);
        remember(world, npc, { who: [partner], summary: change.summary.slice(0, 240), importance, emotion: change.emotion && EMOTIONS.includes(change.emotion) ? change.emotion : null });
        done(change, importance !== change.importance ? 'softened' : 'applied', importance !== change.importance ? 'importance clamped to 0..1' : '');
        break;
      }
      case 'endConversation':
        done(change, 'applied');
        break;
      default:
        done(change, 'rejected', 'unknown change kind');
    }
  }
  return out;
}

const fmt = (x: number) => (x >= 0 ? '+' : '') + x.toFixed(2);

/** The fact `npc` holds whose wording best matches `text` (accepted claims of this turn first), or -1. */
function findHeld(world: World, npc: ActorId, text: string, accepted: { text: string; fact: number }[]): number {
  let best = -1, bs = 0.5;
  for (const c of accepted) { const s = overlap(text, c.text); if (s >= bs) { bs = s; best = c.fact; } }
  if (best >= 0) return best;
  for (const b of beliefsOf(world, npc)) { const s = overlap(text, b.text); if (s >= bs) { bs = s; best = b.fact.id; } }
  return best;
}

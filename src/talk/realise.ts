/**
 * Surface realisation (plan §4.1 steps 3 and 4): a story as one person would tell it to another, and any line in a
 * person's voice.
 *
 * `say` is the seam for "this person tells that person this fact": opener by tone, hedge by how sure they are and
 * where they had it from ("apparently", "I saw it myself", "Marta told me"), the story itself with referring
 * expressions for this listener ("your sister", "the baker at Maple Bakery", "he"), and an embellishing tag from a
 * gossip. `voiced` puts any line in the speaker's voice: fillers, a pet phrase, contractions, dialect.
 */
import { Rng } from '@futuremagic/core';
import type { ActorId } from '../sim/actors';
import { beliefAbout, isAbout, SOURCE_BROADCAST, SOURCE_COMMON, SOURCE_WITNESSED, type Fact } from '../sim/knowledge';
import { tickRng, type World } from '../sim/world';
import { ACTS, phrasesFor, type ActName } from './acts';
import { phrasings, type Tone } from './facts';
import { bare, contract, decap, fillSlots, finish, pick, uncontract, type PickContext, type TalkMemory } from './grammar';
import { Discourse, namesOf, objectForm, pronoun, realiseSlots, refer } from './refer';
import { FILLERS, inDialect, voiceOf, type Voice } from './voice';

/** One phrase of an act in this voice (anti-repetition through the context's memory); '' when `keep` rejects them all. */
export function phrase(act: ActName, voice: Voice, ctx: PickContext, keep?: (s: string) => boolean): string {
  let bank = phrasesFor(ACTS[act], voice);
  if (keep) bank = bank.filter(keep);
  return pick(bank, ctx, act);
}

/** "Bloody hell", "Goodness", "Oh my God": an exclamation in this voice. */
function exclamation(voice: Voice, rng: Rng): string {
  const l = voice.swear > 0.55 ? ['Bloody hell', 'Christ', 'Blimey', 'Bloody hell'] : voice.group === 'teen' || voice.group === 'young' ? ['Oh my God', 'Wow', 'Whoa'] : voice.group === 'child' ? ['Wow', 'Whoa'] : ['Goodness', 'Good grief', 'Gosh', 'Oh my'];
  return l[rng.int(0, l.length - 1)];
}

/**
 * A line in the speaker's voice: the generic slots ({wow}), sometimes a filler in front (only when `names` is given,
 * so a name at the start keeps its capital) or the pet phrase at the end of a longer statement (more for the talkative
 * and the nervous), contractions unless formal, the town's dialect, and the polish.
 */
export function voiced(text: string, voice: Voice, ctx: PickContext, opts: VoicedOptions = {}): string {
  const rng = ctx.rng;
  let s = text.replace(/\{wow\}/g, () => exclamation(voice, rng));
  if (opts.names && !/^[(…]/.test(s)) {
    const p = 0.12 + 0.25 * (1 - voice.formality) * voice.verbosity + 0.3 * Math.max(0, voice.nerves - 0.6);
    if (rng.float() < p) {
      const pool = voice.nerves > 0.7 && rng.float() < 0.5 ? FILLERS.nervous : FILLERS[voice.group];
      const f = pool[rng.int(0, pool.length - 1)];
      if (!s.toLowerCase().startsWith(f.toLowerCase().replace(/,$/, ''))) s = `${f} ${decap(s, opts.names)}`;
    }
  }
  if (opts.pet !== false && voice.pet && s.split(' ').length >= 8 && rng.float() < 0.06 + 0.12 * voice.verbosity) {
    // At the end of the last statement, not after a question.
    if (/\.$/.test(s)) s = `${bare(s)}, ${voice.pet}.`;
  }
  s = voice.formality > 0.72 ? uncontract(s) : voice.formality < 0.62 || rng.float() < 0.5 ? contract(s) : s;
  return finish(inDialect(s, voice.dialect));
}

export interface VoicedOptions {
  /** Allow a filler in front ("Well, …"); the world's names, which keep their capital after it. */
  names?: ReadonlySet<string>;
  /** Allow the pet phrase (default true). */
  pet?: boolean;
}

export interface SayOptions {
  /** The random stream (default: the speaker and listener's stream this minute). */
  rng?: Rng;
  memory?: TalkMemory | null;
  /** The conversation so far (for pronouns); a fresh one by default. */
  discourse?: Discourse;
  /** How sure the speaker is and where they had it from (default: their belief about the fact). */
  confidence?: number;
  source?: ActorId;
  /** Whether to open with "Have you heard?" and the like (default true). */
  opener?: boolean;
}

/** The story itself as a clause for this listener, no hedge: "your brother lost his job at Maple Bakery". */
export function clause(world: World, fact: Fact, d: Discourse, ctx: PickContext, voice: Voice | null): string {
  const ph = phrasings(fact);
  return realiseSlots(world, pick(ph.lines, ctx, `fact:${ph.lines[0]}`), fact.subject, fact.object, fact.place, d, voice);
}

/** The tone of a fact (what reactions and openers fit). */
export const toneOf = (fact: Fact): Tone => phrasings(fact).tone;

/**
 * `speaker` tells `listener` the story `fact`, as one or a few sentences in the speaker's voice: the overheard text
 * of a belief passing (plan §4: "the text you overhear is the belief being transmitted").
 */
export function say(world: World, fact: Fact | number, speaker: ActorId, listener: ActorId, opts: SayOptions = {}): string {
  const f = typeof fact === 'number' ? world.knowledge.facts[fact] : fact;
  const rng = opts.rng ?? tickRng(world, 'say', speaker, listener, f.id);
  const d = opts.discourse ?? new Discourse(speaker, listener, rng);
  d.topicPlace = f.place;
  const ctx: PickContext = { rng, memory: opts.memory ?? null, speaker };
  const voice = voiceOf(world, speaker);
  const r = beliefAbout(world, speaker, f.id);
  const cols = world.knowledge.beliefs.cols;
  const confidence = opts.confidence ?? (r >= 0 ? cols.confidence[r] : 0.6);
  const source = opts.source ?? (r >= 0 ? cols.source[r] : SOURCE_WITNESSED);
  const tone = toneOf(f);
  const self = isAbout(f, speaker);
  const parts: string[] = [];

  // Opener.
  const wantOpener = opts.opener !== false && rng.float() < 0.35 + 0.45 * voice.verbosity + (f.secret ? 0.5 : 0);
  if (wantOpener) {
    const act: ActName = f.secret && !self ? 'news.open.secret' : self ? 'news.open.self'
      : tone === 'scandal' || tone === 'crime' ? (voice.gossip > 0.45 ? 'news.open.scandal' : 'news.open')
        : tone === 'tragic' || tone === 'sad' ? 'news.open.sad' : tone === 'good' ? 'news.open.good' : 'news.open';
    const canName = f.subject >= 0 && f.subject !== speaker && f.subject !== listener;
    let o = phrase(act, voice, ctx, (s) => canName || !s.includes('{who}'));
    if (o.includes('{who}')) o = o.replace('{who}', refer(world, f.subject, d, 'subj', voice));
    parts.push(o);
  }

  // The story, hedged.
  let body = clause(world, f, d, ctx, voice);
  let after = '', hedged = false;
  if (!self) {
    if (source === SOURCE_WITNESSED) { if (rng.float() < 0.5) after = phrase('hedge.witnessed', voice, ctx); }
    else if (source === SOURCE_BROADCAST) { if (rng.float() < 0.6) after = phrase('hedge.broadcast', voice, ctx); }
    else if (source !== SOURCE_COMMON) {
      const unsure = confidence < 0.4 || voice.nerves > 0.75;
      if (unsure || (confidence < 0.75 && rng.float() < 0.6)) { body = `${phrase(unsure ? 'hedge.unsure.pre' : 'hedge.mid.pre', voice, ctx)} ${body}`; hedged = true; }
      if (source >= 0 && source !== listener && rng.float() < 0.3 + 0.4 * voice.verbosity) {
        const np = refer(world, source, d, 'subj', voice);
        after = fillSlots(phrase('hedge.told', voice, ctx), { src: np, src_o: objectForm(np) });
      } else if (unsure && rng.float() < 0.5) after = phrase('hedge.unsure.post', voice, ctx);
    }
  }
  parts.push(`${body}.`);
  if (after) parts.push(after);
  // A story that grew in the telling sounds bigger; a gossip makes any big story bigger.
  const grown = f.parent >= 0 && f.magnitude > world.knowledge.facts[f.root].magnitude + 0.05;
  const juicy = tone !== 'news' && tone !== 'event' && tone !== 'politics' && tone !== 'good';
  if (!self && juicy && ((grown && rng.float() < 0.75) || (f.magnitude >= 0.8 && voice.gossip > 0.6 && rng.float() < 0.4))) parts.push(phrase('tag.embellish', voice, ctx));
  return voiced(parts.join(' '), voice, ctx, { names: !wantOpener && !hedged ? namesOf(world) : undefined });
}

/** The pronoun for someone already mentioned ("He's", "She's"), for replies about them. */
export const proOf = (world: World, who: ActorId): string => pronoun(world, who, 'subj');

export { Discourse };

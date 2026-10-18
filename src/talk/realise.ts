/**
 * Surface realisation (plan §4.1 steps 3 and 4): a story as one person would tell it to another, and any line in a
 * person's voice.
 *
 * `say` is the seam for "this person tells that person this fact": opener by tone, hedge by how sure they are and
 * where they had it from ("apparently", "I saw it myself", "Marta told me"), the story itself with referring
 * expressions for this listener ("your sister", "the baker at Maple Bakery", "he"), and an embellishing tag from a
 * gossip. `voiced` puts any line in the speaker's voice: fillers, a pet phrase, contractions.
 */
import { Rng } from '@futuremagic/core';
import type { ActorId } from '../sim/actors';
import { beliefAbout, isAbout, SOURCE_BROADCAST, SOURCE_COMMON, SOURCE_WITNESSED, type Fact } from '../sim/knowledge';
import { tickRng, type World } from '../sim/world';
import { ACTS, phrasesFor, type ActName } from './acts';
import { isSeeable, phrasings, type Tone } from './facts';
import { bare, capital, contract, decap, fillSlots, finish, pick, uncontract, type PickContext, type TalkMemory } from './grammar';
import { Discourse, isFamilyTie, namesOf, objectForm, pronoun, realiseSlots, refer, reflexive, tie } from './refer';
import { FILLERS, voiceOf, type Voice } from './voice';

/** Hedges that say the source is nobody in particular (not before "my sister told me"). */
const VAGUE_SOURCE = /^(people|someone|somebody|they|word|from what)/i;

/** One phrase of an act in this voice (anti-repetition through the context's memory); '' when `keep` rejects them all. */
export function phrase(act: ActName, voice: Voice, ctx: PickContext, keep?: (s: string) => boolean): string {
  let bank = phrasesFor(ACTS[act], voice);
  if (keep) bank = bank.filter(keep);
  return pick(bank, ctx, act);
}

/** "Damn", "Goodness", "Oh my God": an exclamation in this voice. */
function exclamation(voice: Voice, rng: Rng): string {
  const l = voice.swear > 0.55 ? ['Damn', 'Christ', 'Hell', 'Jesus'] : voice.group === 'teen' || voice.group === 'young' ? ['Oh my God', 'Wow', 'Whoa'] : voice.group === 'child' ? ['Wow', 'Whoa'] : ['Goodness', 'Good grief', 'Gosh', 'Oh my'];
  return l[rng.int(0, l.length - 1)];
}

/**
 * A line in the speaker's voice: the generic slots ({wow}), sometimes a filler in front (only when `names` is given,
 * so a name at the start keeps its capital) or the pet phrase at the end of a statement of opinion (only when `pet`
 * is true: the caller knows what the line means), contractions unless formal, and the polish.
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
  if (opts.pet === true && voice.pet && s.split(' ').length >= 3 && rng.float() < 0.08 + 0.12 * voice.verbosity) {
    // At the end of the last statement, not after a question.
    if (/\.$/.test(s)) s = `${bare(s)}, ${voice.pet}.`;
  }
  s = voice.formality > 0.72 ? uncontract(s) : voice.formality < 0.62 || rng.float() < 0.5 ? contract(s) : s;
  return finish(s);
}

export interface VoicedOptions {
  /** Allow a filler in front ("Well, …"); the world's names, which keep their capital after it. */
  names?: ReadonlySet<string>;
  /** The line is an opinion that may end in the speaker's pet phrase ("…, if you ask me"); default false. */
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
  /** Filled in: whether the line said where the story came from ("Marta told me", "I saw it myself"). */
  said?: { source: boolean };
  /** Whether to open with "Have you heard?" and the like (default true), or the opener act to use. */
  opener?: boolean | ActName;
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
  const ctx: PickContext = { rng, memory: opts.memory ?? null, speaker, listener };
  const voice = voiceOf(world, speaker);
  const r = beliefAbout(world, speaker, f.id);
  const cols = world.knowledge.beliefs.cols;
  const confidence = opts.confidence ?? (r >= 0 ? cols.confidence[r] : 0.6);
  const source = opts.source ?? (r >= 0 ? cols.source[r] : SOURCE_WITNESSED);
  const tone = toneOf(f);
  const self = isAbout(f, speaker);
  const parts: string[] = [];
  // News about the teller's own family needs no "apparently".
  const kin = f.subject >= 0 ? tie(world, speaker, f.subject) : null;
  const own = self || (!!kin && isFamilyTie(kin));

  // Opener.
  const forced = typeof opts.opener === 'string' ? opts.opener : null;
  // Most stories are just told; an opener ("Have you heard?") is for the talkative, for big news and for secrets.
  const wantOpener = forced !== null || (opts.opener !== false && rng.float() < 0.05 + 0.25 * voice.verbosity + 0.2 * f.magnitude + (f.secret ? 0.5 : 0));
  if (wantOpener) {
    const act: ActName = forced ?? (f.secret && !self ? 'news.open.secret' : self ? 'news.open.self'
      : tone === 'crime' ? 'news.open.crime'
        : tone === 'scandal' ? (voice.gossip > 0.45 ? 'news.open.scandal' : 'news.open')
          : tone === 'tragic' || tone === 'sad' ? 'news.open.sad' : tone === 'good' ? 'news.open.good' : 'news.open');
    // ("Did you hear about my mum?" is no way to break one's own news.)
    const canName = f.subject >= 0 && f.subject !== speaker && f.subject !== listener && !own;
    let o = phrase(act, voice, ctx, (s) => canName || !s.includes('{who}'));
    if (o.includes('{who}')) o = o.replace('{who}', refer(world, f.subject, d, 'subj', voice));
    parts.push(o);
  }

  // The story, hedged.
  d.ownRomance = /going out with|moved in with|got engaged|got married/.test(f.text) && (f.subject === speaker || f.object === speaker);
  d.jobStory = f.topic === 'job';
  let body = clause(world, f, d, ctx, voice);
  d.ownRomance = false;
  d.jobStory = false;
  // No hedge that starts like the opener ("I don't know if you've heard. I don't know if it's true, but…").
  const opened = parts.join(' ').toLowerCase();
  const unlike = (s: string) => !opened || !opened.includes(s.toLowerCase().split(' ').slice(0, 3).join(' '));
  let after = '', hedged = false, sourced = false, doubted = false;
  if (!own) {
    // "I saw it myself" fits a fight or a break-in, not someone's holiday.
    if (source === SOURCE_WITNESSED) { if (isSeeable(tone) && rng.float() < 0.4) { after = phrase('hedge.witnessed', voice, ctx); sourced = true; } }
    else if (source === SOURCE_BROADCAST) { if (rng.float() < 0.4) { after = phrase('hedge.broadcast', voice, ctx); sourced = true; } }
    else if (source !== SOURCE_COMMON) {
      const unsure = confidence < 0.4 || voice.nerves > 0.8;
      // Who told them is decided first: "Someone said … My sister told me" says two things.
      const named = source >= 0 && source !== listener && rng.float() < 0.15 + 0.3 * voice.verbosity;
      const pre: ActName = named ? 'hedge.mid.pre' : unsure ? 'hedge.unsure.pre' : 'hedge.mid.pre';
      const keepPre = (s: string) => unlike(s) && (!named || !VAGUE_SOURCE.test(s));
      if (unsure || (confidence < 0.7 && rng.float() < 0.4)) {
        const h = phrase(pre, voice, ctx, keepPre);
        if (h) { body = `${h} ${body}`; hedged = true; }
      }
      if (named && isAbout(f, source)) {
        // Told by the very person the story is about: "She told me herself", never their full name again.
        const pro = pronoun(world, source, 'subj');
        after = fillSlots(phrase('hedge.told.self', voice, ctx), { Pro: capital(pro), pro_obj: pronoun(world, source, 'obj'), self: reflexive(world, source) });
        sourced = true;
      } else if (named) {
        const np = refer(world, source, d, 'subj', voice);
        after = fillSlots(phrase('hedge.told', voice, ctx), { src: np, src_o: objectForm(np) });
        sourced = true;
      } else if (unsure && !hedged && rng.float() < 0.5) { after = phrase('hedge.unsure.post', voice, ctx); doubted = true; }
    }
  }
  // After an opener that runs on ("Speaking of news,"), the story continues the sentence.
  if (parts.length && /,$/.test(parts[parts.length - 1])) parts[parts.length - 1] += ` ${decap(body, namesOf(world))}.`;
  else parts.push(`${body}.`);
  if (after) parts.push(after);
  if (opts.said) opts.said.source = sourced;
  // A scandal that grew in the telling, or one a gossip relishes, gets a tag ("And that's not even the half of it").
  const grown = f.parent >= 0 && f.magnitude > world.knowledge.facts[f.root].magnitude + 0.05;
  if (!own && !doubted && !after && tone === 'scandal' && voice.group !== 'child' && ((grown && rng.float() < 0.5) || (voice.gossip > 0.65 && rng.float() < 0.25))) parts.push(phrase('tag.embellish', voice, ctx));
  // News is never tagged with a pet phrase ("…passed away, if you ask me").
  return voiced(parts.join(' '), voice, ctx, { names: !wantOpener && !hedged ? namesOf(world) : undefined });
}

/** The pronoun for someone already mentioned ("He's", "She's"), for replies about them. */
export const proOf = (world: World, who: ActorId): string => pronoun(world, who, 'subj');

export { Discourse };

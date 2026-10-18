/**
 * The small grammar under the chatter engine (plan §4.1 steps 3 and 5): phrase picking with anti-repetition,
 * inline alternatives, slot filling and the last polish of a sentence (capitals, "a"/"an", contractions).
 *
 * Phrase syntax (used by every bank in src/talk):
 *  - `[a|b|c]` picks one alternative (an empty one is allowed: `[really |]`). Not nested.
 *  - `{name}` is a slot filled by the caller (`fillSlots`); `{S:has}`-style slots are grammar slots (src/talk/refer.ts).
 */
import type { Rng } from '@futuremagic/core';

/**
 * Which phrasings were used lately, per speaker and overall, so the same person does not say the same thing twice in
 * a row and the street does not sound like a loop. Plain data, kept by whoever calls the engine (the sim worker),
 * never in the World: it is presentation state, not something the town remembers.
 */
export class TalkMemory {
  private readonly bySpeaker = new Map<number, string[]>();
  private readonly recent: string[] = [];

  constructor(readonly perSpeaker = 24, readonly overall = 96) {}

  used(speaker: number, key: string): boolean {
    return this.recent.includes(key) || (this.bySpeaker.get(speaker)?.includes(key) ?? false);
  }

  note(speaker: number, key: string): void {
    let l = this.bySpeaker.get(speaker);
    if (!l) this.bySpeaker.set(speaker, (l = []));
    l.push(key);
    if (l.length > this.perSpeaker) l.shift();
    this.recent.push(key);
    if (this.recent.length > this.overall) this.recent.shift();
    // Forget speakers once there are many (the street moves on).
    if (this.bySpeaker.size > 4096) this.bySpeaker.delete(this.bySpeaker.keys().next().value!);
  }
}

/** What a pick needs: the random stream, the memory (optional) and who is speaking. */
export interface PickContext {
  rng: Rng;
  memory: TalkMemory | null;
  speaker: number;
}

/**
 * One phrase of `bank`, avoiding what this speaker or the street said lately (a few tries, then anything).
 * `id` names the bank in the memory.
 */
export function pick(bank: readonly string[], ctx: PickContext, id: string): string {
  if (bank.length === 0) return '';
  let i = ctx.rng.int(0, bank.length - 1);
  if (ctx.memory) {
    for (let t = 0; t < 6 && ctx.memory.used(ctx.speaker, `${id}#${i}`); t++) i = ctx.rng.int(0, bank.length - 1);
    ctx.memory.note(ctx.speaker, `${id}#${i}`);
  }
  return expand(bank[i], ctx.rng);
}

/** Resolve `[a|b|c]` alternatives. */
export function expand(text: string, rng: Rng): string {
  return text.replace(/\[([^[\]]*)\]/g, (_, body: string) => {
    const alts = body.split('|');
    return alts[rng.int(0, alts.length - 1)];
  });
}

/** Fill `{name}` slots from `vars`; a slot with no value is left for a later pass. */
export function fillSlots(text: string, vars: Readonly<Record<string, string | undefined>>): string {
  return text.replace(/\{([^{}]+)\}/g, (m, k: string) => vars[k] ?? m);
}

const CONTRACTIONS: readonly [RegExp, string][] = [
  [/\bI am\b(?![.,!?]|$)/g, "I'm"],
  [/\b(you|we|they) are\b(?![.,!?]|$)/gi, "$1're"],
  [/\b(he|she|it|that|there|what|who|where) is\b(?![.,!?]|$)/gi, "$1's"],
  [/\b(I|you|we|they) have\b(?= (?:been|got|had|done|seen|heard|lost|found|landed|moved|gone|left|finally|just|never|always|to)\b)/gi, "$1've"],
  [/\b(he|she|it|that|there|who) has\b(?= (?:been|got|had|done|seen|heard|lost|found|landed|moved|gone|left|finally|just|never|always)\b)/gi, "$1's"],
  [/\b(I|you|he|she|we|they) will\b/gi, "$1'll"],
  [/\b(I|you|he|she|we|they) would\b/gi, "$1'd"],
  [/\bis not\b/g, "isn't"], [/\bare not\b/g, "aren't"], [/\bwas not\b/g, "wasn't"], [/\bwere not\b/g, "weren't"],
  [/\bdo not\b/g, "don't"], [/\bdoes not\b/g, "doesn't"], [/\bdid not\b/g, "didn't"],
  [/\bhave not\b/g, "haven't"], [/\bhas not\b/g, "hasn't"], [/\bcannot\b/g, "can't"], [/\bwill not\b/g, "won't"],
  [/\bcould not\b/g, "couldn't"], [/\bwould not\b/g, "wouldn't"], [/\blet us\b/g, "let's"],
];

/** Casual speech: "I am" → "I'm", "do not" → "don't" (not at the end of a clause: "I know who he is."). */
export function contract(text: string): string {
  let s = text;
  for (const [re, to] of CONTRACTIONS) s = s.replace(re, to);
  return s;
}

/** Formal speech undoes the casual contractions the banks are written with. */
export function uncontract(text: string): string {
  return text
    .replace(/\bdon't\b/g, 'do not').replace(/\bcan't\b/g, 'cannot').replace(/\bwon't\b/g, 'will not')
    .replace(/\bisn't\b/g, 'is not').replace(/\bdidn't\b/g, 'did not').replace(/\bI'm\b/g, 'I am');
}

/** Words that take "an" although they start with a consonant letter, and "a" although they start with a vowel. */
const AN_EXCEPTIONS = /^(hour|honest|heir)/i;
const A_EXCEPTIONS = /^(uni|use|usu|one|eu|ewe|u\b)/i;

/** The last polish: spaces, "a"/"an", capitals at sentence starts, one end mark. */
export function finish(text: string): string {
  let s = text
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/,+/g, ',')
    .replace(/([.!?]),/g, '$1')
    .replace(/,([.!?])/g, '$1')
    .replace(/([,;:])(?=[^\s\d])/g, '$1 ')
    .replace(/\.\.(?!\.)/g, '.')
    .trim();
  s = s.replace(/\b([Aa])n? (\w+)/g, (_m, a: string, w: string) => {
    const vowel = /^[aeiou]/i.test(w);
    const an = (vowel && !A_EXCEPTIONS.test(w)) || AN_EXCEPTIONS.test(w);
    return `${a}${an ? 'n' : ''} ${w}`;
  });
  s = s.replace(/(^|[.!?]\s+)([a-z])/g, (_, p: string, c: string) => p + c.toUpperCase());
  if (!/[.!?…)"]$/.test(s)) s += '.';
  return s;
}

/** The first letter in upper case. */
export const capital = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** "The nearest hospital…" → "the nearest hospital…" (only for ordinary words, never a name). */
export function lowerStart(s: string): string {
  const w = s.split(/\s/, 1)[0];
  return /^(The|A|An|In|On|At|Older|Getting|Many|People|Houses|Downstream|Some|Most|There|It|Every|Each|When|If|Our)$/.test(w) ? s[0].toLowerCase() + s.slice(1) : s;
}

/**
 * "Have you heard?" → "have you heard?" after a filler. Names (`names`: the world's people and places) and "I" keep
 * their capital.
 */
export function decap(s: string, names: ReadonlySet<string>): string {
  const w = /^[A-Za-z]+/.exec(s)?.[0] ?? '';
  if (!w || w === 'I' || names.has(w) || /^[A-Z]{2}/.test(w)) return s;
  return s[0].toLowerCase() + s.slice(1);
}

/** A sentence without its end mark ("He left." → "He left"), to build on. */
export const bare = (s: string): string => s.replace(/[.!?]+$/, '');

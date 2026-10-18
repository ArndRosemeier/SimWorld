/**
 * Voice (plan §4.1 step 4): each person's idiolect, from their traits, age and background. Stable for a person
 * (hashes of the world seed and the id, no random stream), so Mrs Keller always sounds like Mrs Keller.
 *
 * - verbosity: the talkative say more (extraversion, openness).
 * - formality: age and conscientiousness; teenagers are the least formal.
 * - warmth: agreeableness (sympathy, kind reactions).
 * - gossip: extraversion and low conscientiousness (relish for a juicy story).
 * - sceptic: conscientious or disagreeable people doubt what they hear.
 * - nerves: neuroticism (hesitations, worry).
 * - swear: mild swearing; the disagreeable and careless, never children.
 *
 * One dialect for everyone: region-neutral English (Arnd, 2026-10-18: the world is invented and only western
 * adjacent, nothing may identify a region). `DIALECT_MARKED` lists the words that would, for the tests to catch.
 */
import { hash3i, hashToFloat } from '@futuremagic/core';
import type { ActorId } from '../sim/actors';
import { T_AGREE, T_CONSC, T_EXTRA, T_NEURO, T_OPEN } from '../sim/people';
import { ageOf, traitOf, type World } from '../sim/world';

export type AgeGroup = 'child' | 'teen' | 'young' | 'adult' | 'old';

export interface Voice {
  id: ActorId;
  age: number;
  group: AgeGroup;
  sex: number;
  verbosity: number;
  formality: number;
  warmth: number;
  gossip: number;
  sceptic: number;
  nerves: number;
  swear: number;
  /** A phrase this person keeps using ("if you ask me"), or null; said after an opinion, never after news. */
  pet: string | null;
}

export const ageGroup = (age: number): AgeGroup => (age < 13 ? 'child' : age < 20 ? 'teen' : age < 35 ? 'young' : age < 68 ? 'adult' : 'old');

/**
 * Pet phrases by age group (about a third of the people have one). Each is a tag that fits the end of an opinion
 * ("Prices keep going up, if you ask me"): nothing that changes what a sentence means ("…, in my day").
 */
const PET: Record<AgeGroup, readonly string[]> = {
  child: [],
  teen: ['for real', 'no joke', 'seriously'],
  young: ['for real', 'no joke', 'if you ask me', 'I swear'],
  adult: ['if you ask me', 'I must say', 'I tell you', 'you know'],
  old: ['if you ask me', 'I must say', 'I tell you', 'I can tell you'],
};

/**
 * Words that mark a region's English ("mom", "mum", "vacation", "fall", "Alright?", "y'all"): none of them may be
 * said in town. The tests run every bank, every story phrasing and a day of talk against it.
 */
export const DIALECT_MARKED: readonly RegExp[] = [
  /\b(mom|moms|mommy|momma|mum|mums|mummy)\b/i, /\bvacation\b/i, /\bholiday\b/, /\b(the|this|in|last|next) fall\b/i, /\bautumn\b/,
  /\by'all\b/i, /\beh\?/i, /^Alright\?/, /\b(mate|buddy|bloody|blimey|knackered|cheers|ta|innit|reckon|gotten|y'know)\b/i,
  /\b(queue|fortnight|poorly|gran|grandad|flatmate|the flats|apartments?|sidewalk|pavement|petrol|candy|sweets|rubbish|garbage|trash)\b/i,
  /\b(courting|fella|lads|folks|awesome|brilliant|proper|sorted|cuppa|hiya|oi|cosy|cozy|realise|realize)\b/i,
];

/** The first word or phrase of `text` that marks a region's English, or null. */
export function dialectMarked(text: string): string | null {
  for (const re of DIALECT_MARKED) { const m = re.exec(text); if (m) return m[0]; }
  return null;
}

/** The voice of a person (cheap; call it per line). */
export function voiceOf(world: World, id: ActorId): Voice {
  const age = ageOf(world, id);
  const group = ageGroup(age);
  const o = traitOf(world, id, T_OPEN), c = traitOf(world, id, T_CONSC), e = traitOf(world, id, T_EXTRA);
  const a = traitOf(world, id, T_AGREE), n = traitOf(world, id, T_NEURO);
  const quirk = (k: number) => hashToFloat(hash3i(world.seed, id, k, 0x7a1c));
  const ageF = group === 'child' ? 0.15 : group === 'teen' ? 0 : Math.min(1, age / 80);
  const pets = PET[group];
  return {
    id, age, group, sex: world.actors.cols.sex[id],
    verbosity: clamp01(0.65 * e + 0.25 * o + 0.2 * (quirk(1) - 0.5)),
    formality: clamp01(0.5 * ageF + 0.35 * c + 0.15 * (1 - e) + 0.15 * (quirk(2) - 0.5) - (group === 'teen' ? 0.15 : 0)),
    warmth: a,
    gossip: clamp01(0.55 * e + 0.35 * (1 - c) + 0.1 * quirk(3)),
    sceptic: clamp01(0.4 * c + 0.4 * (1 - a) + 0.2 * o),
    nerves: n,
    swear: group === 'child' ? 0 : clamp01((1 - a) * (1 - c) * 2.2 * (group === 'old' ? 0.5 : group === 'teen' ? 1.2 : 1) + 0.15 * (quirk(4) - 0.5)),
    pet: pets.length && quirk(5) < 0.35 ? pets[Math.floor(quirk(6) * pets.length)] : null,
  };
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Hesitations and openers by age group (and nerves): "Well,", "Like,", "Er,". */
export const FILLERS: Record<AgeGroup | 'nervous', readonly string[]> = {
  child: ['Um,', 'Hey,'],
  teen: ['Like,', 'So,', 'Okay, so', 'Wait,'],
  young: ['So,', 'Well,', 'Okay,'],
  adult: ['Well,', 'You know,', 'Now,', 'So,', 'Oh,'],
  old: ['Well,', 'Oh,', 'Now,', 'Well, now,'],
  nervous: ['Um,', 'Er,', 'I mean,', 'Well, um,'],
};

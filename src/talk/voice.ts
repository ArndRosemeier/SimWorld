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
 */
import { hash3i, hashToFloat } from '@futuremagic/core';
import type { ActorId } from '../sim/actors';
import { T_AGREE, T_CONSC, T_EXTRA, T_NEURO, T_OPEN } from '../sim/people';
import { ageOf, traitOf, type World } from '../sim/world';

export type AgeGroup = 'child' | 'teen' | 'young' | 'adult' | 'old';
export type Dialect = 'uk' | 'us';

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
  /** A phrase this person keeps using ("mark my words"), or null. */
  pet: string | null;
  dialect: Dialect;
}

export const ageGroup = (age: number): AgeGroup => (age < 13 ? 'child' : age < 20 ? 'teen' : age < 35 ? 'young' : age < 68 ? 'adult' : 'old');

/** Pet phrases by age group; about half the people have one. */
const PET: Record<AgeGroup, readonly string[]> = {
  child: ['for real', 'I promise', 'cross my heart', 'it is true'],
  teen: ['literally', 'no joke', 'for real', 'honestly', 'I swear', 'no lie', 'like, seriously'],
  young: ['to be fair', 'honestly', 'no joke', 'I swear', 'if you ask me', 'at the end of the day', 'to be honest'],
  adult: ['mark my words', 'if you ask me', 'at the end of the day', 'to be fair', 'and that is the truth', 'you know what I mean', 'between you and me', 'as it happens', 'to be honest'],
  old: ['mark my words', 'in my day', 'bless them', 'as sure as eggs is eggs', 'mind you', 'heaven knows', 'if you ask me', 'as it were'],
};

/** The dialect of the town. One register since D27 (no British/American switch); the dialect machinery goes with the talk clean-up. */
export const dialectOf = (_world: World): Dialect => 'uk';

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
    pet: quirk(5) < 0.5 ? pets[Math.floor(quirk(6) * pets.length)] : null,
    dialect: dialectOf(world),
  };
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Hesitations and openers by age group (and nerves): "Well,", "Like,", "Er,". */
export const FILLERS: Record<AgeGroup | 'nervous', readonly string[]> = {
  child: ['Um,', 'Hey,', 'Guess what,'],
  teen: ['Like,', 'So,', 'Okay so', 'Honestly,', 'Wait,'],
  young: ['So,', 'Well,', 'Honestly,', 'Okay,', 'Right,'],
  adult: ['Well,', 'You know,', 'Now,', 'Right,', 'So,'],
  old: ['Well,', 'Oh,', 'Now then,', 'I must say,', 'Well now,'],
  nervous: ['Um,', 'Er,', 'I mean,', 'Well, um,'],
};

/** Words that differ between British and American English, as said in town. */
const US: readonly [RegExp, string][] = [
  [/\bmum\b/g, 'mom'], [/\bMum\b/g, 'Mom'], [/\bgran\b/g, 'grandma'], [/\bgrandad\b/g, 'grandpa'],
  [/\bqueue\b/g, 'line'], [/\bshattered\b/g, 'beat'], [/\bflatmate\b/g, 'roommate'], [/\bBloody hell\b/g, 'Holy crap'],
  [/\bbloody\b/g, 'damn'], [/\bBlimey\b/g, 'Wow'], [/\bcheers\b/g, 'thanks'], [/\bCheers\b/g, 'Thanks'],
  [/\bthe sack\b/g, 'fired'], [/\bnicking\b/g, 'stealing'], [/\bmate\b/g, 'buddy'],
  [/\bholiday\b/g, 'vacation'], [/\bautumn\b/g, 'fall'], [/\bpub\b/g, 'bar'], [/\brubbish\b/g, 'garbage'],
  [/\bfortnight\b/g, 'two weeks'], [/\bpoorly\b/g, 'sick'], [/\bjumper\b/g, 'sweater'], [/\bbrolly\b/g, 'umbrella'],
  [/\b([Rr])umour\b/g, '$1umor'], [/\bneighbour/g, 'neighbor'], [/\bcolour/g, 'color'], [/\bfavourite\b/g, 'favorite'],
  [/\bKnackered\b/g, 'Beat'], [/\bknackered\b/g, 'beat'], [/\b, ta\b/g, ', thanks'], [/\bta\.$/g, 'thanks.'],
];

/** British phrasing (the banks are written in it) → the town's dialect. */
export function inDialect(text: string, dialect: Dialect): string {
  if (dialect === 'uk') return text;
  let s = text;
  for (const [re, to] of US) s = s.replace(re, to);
  return s;
}

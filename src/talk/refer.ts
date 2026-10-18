/**
 * Referring expressions (plan §4.1 step 3): how a speaker names a person to this listener. "you" and "I"; family by
 * the tie ("my sister", "your dad"); a first name between people who both know them; a description for someone the
 * listener does not know ("Anna Keller, the baker", "old Mr Brandt", "the Kellers' little girl"); "he" or "she" once
 * established in the conversation. Places the same way ("our place", "the Crown").
 *
 * Grammar slots (`realiseSlots`): `{S}` the subject, `{S:obj}`, `{S:poss}` ("his", "your", "Anna's"),
 * `{S:is}` / `{S:was}` / `{S:has}` / `{S:s}` (agreement: "I am", "you are", "she is"; "live{S:s}"),
 * `{S:family}` ("the Kellers", "my family"), `{S:kid}` ("boy"/"girl"); the same for `{O}`; `{S&O}` the pair
 * ("Tom and I", "you and Anna", "Tom and Anna") with plural agreement; `{P}` the place.
 */
import type { Rng } from '@futuremagic/core';
import { ACTOR_PERSON, FEMALE, type ActorId } from '../sim/actors';
import type { PlaceId } from '../sim/places';
import { BONDS, FAMILY_MASK, bondBit, type Bond } from '../sim/relations';
import { regionPlaces } from '../sim/region';
import { ageOf, firstName, householdOf, jobOf, nameOf, type World } from '../sim/world';
import { expand } from './grammar';
import type { Voice } from './voice';

export type Case = 'subj' | 'obj' | 'poss';
type Person = 'first' | 'second' | 'third' | 'plural';

/** One conversation's state of reference: who is who, and who has been mentioned (for pronouns). */
export class Discourse {
  /** Who was last mentioned, per sex (a "he" or a "she" points there). */
  private readonly last = new Map<number, ActorId>();
  private readonly said = new Set<ActorId>();

  /** The place the story at hand is about (people are not described by their job there). */
  topicPlace: PlaceId = -1;

  constructor(public speaker: ActorId, public listener: ActorId, readonly rng: Rng) {}

  /** The other one speaks now. Mentions carry over ("he" is still Tom). */
  turn(): void { [this.speaker, this.listener] = [this.listener, this.speaker]; }

  mentioned(who: ActorId): boolean { return this.said.has(who); }

  /** Was `who` the last person of their sex mentioned (so a pronoun is clear)? */
  clear(world: World, who: ActorId): boolean { return this.said.has(who) && this.last.get(world.actors.cols.sex[who]) === who; }

  mention(world: World, who: ActorId): void {
    this.said.add(who);
    this.last.set(world.actors.cols.sex[who], who);
  }
}

const female = (world: World, who: ActorId) => world.actors.cols.sex[who] === FEMALE;
const isPersonActor = (world: World, who: ActorId) => world.actors.cols.kind[who] === ACTOR_PERSON;

/** "he"/"him"/"his", "she"/"her"/"her". */
export function pronoun(world: World, who: ActorId, c: Case): string {
  if (!isPersonActor(world, who)) return c === 'poss' ? 'its' : 'it';
  if (female(world, who)) return c === 'subj' ? 'she' : 'her';
  return c === 'subj' ? 'he' : c === 'obj' ? 'him' : 'his';
}

const possessive = (np: string): string => (np.endsWith('s') ? `${np}'` : `${np}'s`);

/** The object form of a subject noun phrase ("he" → "him", "I" → "me"; names stay). */
export const objectForm = (np: string): string => ({ he: 'him', she: 'her', I: 'me', they: 'them', we: 'us' })[np] ?? np;

/** What `who` is to `of` (the closest family tie first), or null. */
export function tie(world: World, of: ActorId, who: ActorId): Bond | null {
  const r = world.relations.row(of, who);
  if (r < 0) return null;
  const b = world.relations.t.cols.bonds[r];
  if (!b) return null;
  for (const bond of ['spouse', 'partner', 'child', 'parent', 'sibling', 'grandchild', 'grandparent', 'relative', 'ex', 'housemate', 'friend', 'colleague', 'neighbour'] as const) if (b & bondBit(bond)) return bond;
  return BONDS.find((x) => (b & bondBit(x)) !== 0) ?? null;
}

export const isFamilyTie = (b: Bond | null): boolean => b !== null && (bondBit(b) & FAMILY_MASK) !== 0;

/** "sister", "husband", "mum": the word for a tie (null for ties that are not said as a noun, like a friend). */
export function kinWord(world: World, who: ActorId, bond: Bond, voice: Voice | null, rng: Rng | null): string | null {
  const f = female(world, who);
  const formal = (voice?.formality ?? 0.5) > 0.7 || voice?.group === 'old';
  const age = ageOf(world, who);
  const coin = () => (rng ? rng.float() < 0.5 : true);
  switch (bond) {
    case 'spouse': return f ? 'wife' : 'husband';
    case 'partner': return age < 40 ? (f ? 'girlfriend' : 'boyfriend') : 'partner';
    case 'parent': return formal ? (f ? 'mother' : 'father') : f ? 'mum' : 'dad';
    case 'child': return age < 13 && !formal && coin() ? (f ? 'little girl' : 'little boy') : f ? 'daughter' : 'son';
    case 'sibling': return age < 18 && coin() ? (f ? 'little sister' : 'little brother') : f ? 'sister' : 'brother';
    case 'grandparent': return formal ? (f ? 'grandmother' : 'grandfather') : f ? 'gran' : 'grandad';
    case 'grandchild': return f ? 'granddaughter' : 'grandson';
    case 'relative': return 'cousin';
    case 'ex': return 'ex';
    case 'housemate': return 'flatmate';
    case 'neighbour': return 'neighbour';
    case 'colleague': return null;
    default: return null;
  }
}

/** How well `of` knows `who` (0 for strangers). */
export const familiarity = (world: World, of: ActorId, who: ActorId): number => {
  const r = world.relations.row(of, who);
  return r >= 0 ? world.relations.t.cols.familiarity[r] : 0;
};

/** A description of `who` for someone who does not know them. */
function describe(world: World, who: ActorId, d: Discourse): string {
  if (!isPersonActor(world, who)) return nameOf(world, who);
  const age = ageOf(world, who), f = female(world, who);
  const surname = world.people.last[world.actors.cols.row[who]];
  const rng = d.rng;
  const job = jobOf(world, who);
  const options: string[] = [];
  // By their job (an appositive closes with a comma: "Leo, the baker, got…"), unless the story is about that place.
  if (job && job.role !== 'owner' && job.role !== 'paper round' && job.place !== d.topicPlace) {
    const role = f ? job.role.replace(/man$/, 'woman') : job.role;
    options.push(`${nameOf(world, who)}, the ${role},`, `${firstName(world, who)}, the ${role} [at|from] ${placeName(world, job.place, d)},`, `the ${role} [at|from] ${placeName(world, job.place, d)}`);
  }
  if (age >= 72) options.push(`old ${f ? 'Mrs' : 'Mr'} ${surname}`, `[old |]${f ? 'Mrs' : 'Mr'} ${surname}`);
  else if (age < 13) options.push(`the ${surname}s' little ${f ? 'girl' : 'boy'}`, `the ${surname} [kid|${f ? 'girl' : 'boy'}]`);
  else if (age < 20) options.push(`the ${surname} ${f ? 'girl' : 'boy'}`, `${firstName(world, who)} ${surname}`);
  if (options.length === 0 || rng.float() < 0.3) {
    const home = world.actors.cols.home[who];
    const street = home >= 0 ? world.graph.places[home].street : '';
    options.push(street ? `${nameOf(world, who)} from ${street}` : nameOf(world, who), nameOf(world, who));
  }
  return options[rng.int(0, options.length - 1)];
}

/**
 * The noun phrase for `who` from the speaker to the listener in this conversation (a first mention gets a full
 * reference, later ones a pronoun when that is clear).
 */
export function refer(world: World, who: ActorId, d: Discourse, c: Case, voice: Voice | null = null): string {
  if (who < 0) return c === 'poss' ? "someone's" : 'someone';
  if (who === d.speaker) return c === 'subj' ? 'I' : c === 'obj' ? 'me' : 'my';
  if (who === d.listener) return c === 'poss' ? 'your' : 'you';
  if (d.clear(world, who)) return pronoun(world, who, c);
  let np = expand(firstReference(world, who, d, voice), d.rng);
  // "the baker at Maple Bakery's family" is not English: a possessive takes the name.
  if (c === 'poss' && /,| at | from | - /.test(np)) np = nameOf(world, who);
  d.mention(world, who);
  return c === 'poss' ? possessive(np) : np;
}

function firstReference(world: World, who: ActorId, d: Discourse, voice: Voice | null): string {
  const rng = d.rng;
  if (!isPersonActor(world, who)) {
    // A pet: by name to those who know it, else "the Kellers' dog".
    const hh = householdOf(world, who);
    if (familiarity(world, d.listener, who) > 0.2 || !hh) return nameOf(world, who);
    return `${nameOf(world, who)}, the ${hh.surname}s' [dog|pet]`;
  }
  const mine = tie(world, d.speaker, who), yours = tie(world, d.listener, who);
  const first = firstName(world, who);
  if (mine && isFamilyTie(mine)) {
    const w = kinWord(world, who, mine, voice, rng);
    if (w) return rng.float() < 0.25 && mine !== 'ex' ? `my ${w} ${first}` : `my ${w}`;
  }
  if (yours && isFamilyTie(yours) && rng.float() < 0.65) {
    const w = kinWord(world, who, yours, null, rng);
    if (w) return `your ${w}`;
  }
  const fl = familiarity(world, d.listener, who), fs = familiarity(world, d.speaker, who);
  if (mine === 'colleague' && fl < 0.3) return `${first} from work`;
  if (mine === 'neighbour' && fl < 0.3) return rng.float() < 0.5 ? `${first} next door` : `my neighbour ${first}`;
  if (fl >= 0.3 || (yours && yours !== 'neighbour')) return first;
  if (fl >= 0.12) return nameOf(world, who);
  if (fs >= 0.3 && rng.float() < 0.3) return `${first}, a friend of mine`;
  return describe(world, who, d);
}

/**
 * A reference without a description, for lists like a pair ("Ernst Lawson and Katie", never "Ernst Lawson, the
 * craftsman and Katie"): a family word, the first name for people the listener knows, else the full name.
 */
function shortReference(world: World, who: ActorId, d: Discourse, voice: Voice | null): string {
  if (!isPersonActor(world, who)) return nameOf(world, who);
  const known = d.mentioned(who) || familiarity(world, d.listener, who) >= 0.3;
  let np: string;
  const mine = tie(world, d.speaker, who), yours = tie(world, d.listener, who);
  const word = mine && isFamilyTie(mine) ? kinWord(world, who, mine, voice, d.rng) : null;
  const yword = !word && yours && isFamilyTie(yours) ? kinWord(world, who, yours, null, d.rng) : null;
  if (word) np = `my ${word}`;
  else if (yword) np = `your ${yword}`;
  else np = known ? firstName(world, who) : nameOf(world, who);
  d.mention(world, who);
  return np;
}

/** Words that are names in this world (people, places, the region): they keep their capital at a sentence start. */
export function namesOf(world: World): ReadonlySet<string> {
  let set = NAMES.get(world);
  if (set && set.size > 0 && NAME_COUNT.get(world) === world.actors.count) return set;
  set = new Set<string>();
  for (const l of [world.people.first, world.people.last, world.animals.name]) for (const n of l) if (n) set.add(n);
  for (const p of world.graph.places) for (const w of p.name.split(/\s+/)) if (/^[A-Z]/.test(w) && w !== 'The') set.add(w);
  for (const p of regionPlaces(world)) for (const w of p.name.split(/\s+/)) set.add(w);
  if (world.region) set.add(world.region.region.town);
  NAMES.set(world, set);
  NAME_COUNT.set(world, world.actors.count);
  return set;
}
const NAMES = new WeakMap<World, Set<string>>();
const NAME_COUNT = new WeakMap<World, number>();

/** A place as people say it: "our place", "your place", "the Crown", "a house on Vine Lane". */
/** Whether a place is somebody's home (a house, the flats, a farmhouse). */
export const isDwelling = (world: World, place: PlaceId): boolean => {
  const k = world.graph.places[place]?.kind;
  return k === 'house' || k === 'apartments' || k === 'farmhouse';
};

export function placeName(world: World, place: PlaceId, d: Discourse | null): string {
  if (place < 0) return 'somewhere';
  const p = world.graph.places[place];
  if (d) {
    if (world.actors.cols.home[d.speaker] === place) return 'our place';
    if (world.actors.cols.home[d.listener] === place) return 'your place';
  }
  if (isDwelling(world, place)) {
    return d && d.rng.float() < 0.5 ? `${p.kind === 'apartments' ? 'the flats' : 'a house'} on ${p.street}` : p.name;
  }
  return p.name.startsWith('The ') ? 'the' + p.name.slice(3) : p.name;
}

function personOf(who: ActorId, d: Discourse): Person {
  return who === d.speaker ? 'first' : who === d.listener ? 'second' : 'third';
}

const AGREE: Record<string, Record<Person, string>> = {
  is: { first: 'am', second: 'are', third: 'is', plural: 'are' },
  was: { first: 'was', second: 'were', third: 'was', plural: 'were' },
  has: { first: 'have', second: 'have', third: 'has', plural: 'have' },
  does: { first: 'do', second: 'do', third: 'does', plural: 'do' },
  s: { first: '', second: '', third: 's', plural: '' },
  es: { first: '', second: '', third: 'es', plural: '' },
};

/** "the Kellers", "my family", "your family". */
function family(world: World, who: ActorId, d: Discourse): string {
  if (who === d.speaker || world.relations.isFamily(d.speaker, who)) return d.rng.float() < 0.5 ? 'my family' : 'my lot';
  if (who === d.listener || world.relations.isFamily(d.listener, who)) return 'your family';
  if (!isPersonActor(world, who)) return 'someone';
  const last = world.people.last[world.actors.cols.row[who]];
  return /[sxz]$/.test(last) ? `the ${last} family` : `the ${last}s`;
}

/** The pair "Tom and I", "you and Anna", "we" (speaker and listener), "Tom and Anna" (names, never "he and she"). */
function pair(world: World, s: ActorId, o: ActorId, d: Discourse, c: Case, voice: Voice | null): string {
  const me = s === d.speaker || o === d.speaker, you = s === d.listener || o === d.listener;
  if (me && you) return c === 'subj' ? 'we' : c === 'obj' ? 'us' : 'our';
  if (c === 'poss' && (me || you)) return me ? 'our' : 'your';
  const part = (who: ActorId): string => {
    if (who === d.speaker) return c === 'subj' ? 'I' : 'me';
    if (who === d.listener) return 'you';
    return shortReference(world, who, d, voice);
  };
  const other = s === d.speaker || s === d.listener ? o : s;
  const np = me ? `${part(other)} and ${part(d.speaker)}` : you ? `you and ${part(other)}` : `${part(s)} and ${part(o)}`;
  return c === 'poss' ? possessive(np) : np;
}

/** Values for the grammar slots of a fact phrase (see the header). Names are resolved in reading order. */
export function realiseSlots(world: World, text: string, s: ActorId, o: ActorId, place: PlaceId, d: Discourse, voice: Voice | null): string {
  const pers = (who: ActorId) => (who < 0 ? 'third' : personOf(who, d));
  return text.replace(/\{(S&O|S|O|P)(?::(\w+))?\}/g, (m, who: string, form: string | undefined) => {
    if (who === 'P') return placeName(world, place, d);
    if (who === 'S&O') {
      if (form && AGREE[form]) return AGREE[form].plural;
      return pair(world, s, o, d, (form as Case) ?? 'subj', voice);
    }
    const id = who === 'S' ? s : o;
    if (!form) return refer(world, id, d, 'subj', voice);
    if (form === 'obj' || form === 'poss' || form === 'subj') return refer(world, id, d, form, voice);
    if (form === 'pro') return id >= 0 ? pronoun(world, id, 'subj') : 'they';
    if (form === 'family') return family(world, id, d);
    if (form === 'kid') return id >= 0 && female(world, id) ? 'girl' : 'boy';
    if (form === 'first') return id >= 0 ? (id === d.speaker ? 'I' : id === d.listener ? 'you' : firstName(world, id)) : 'someone';
    const agree = AGREE[form];
    return agree ? agree[pers(id)] : m;
  });
}

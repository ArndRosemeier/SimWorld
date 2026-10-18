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
import { SPECIES } from '../sim/species';
import { ageOf, firstName, householdOf, jobOf, lastName, nameOf, type World } from '../sim/world';
import { dwellingWord } from '../lang/words';
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

  /** The story is the speaker's own romance: their partner goes by name ("Ivan and I are together", not "my boyfriend and I"). */
  ownRomance = false;

  /** The story is about someone's job (they are not described by a job then). */
  jobStory = false;

  /** Someone was already placed by their street ("from Kepler Lane") in this conversation. */
  streetSaid = false;

  constructor(public speaker: ActorId, public listener: ActorId, readonly rng: Rng) {}

  /** The other one speaks now. Mentions carry over ("he" is still Tom). */
  turn(): void { [this.speaker, this.listener] = [this.listener, this.speaker]; }

  mentioned(who: ActorId): boolean { return this.said.has(who); }

  /** Was `who` the last person of their sex mentioned (so a pronoun is clear)? */
  clear(world: World, who: ActorId): boolean { return this.said.has(who) && this.last.get(world.actors.cols.sex[who]) === who; }

  /** People a first name alone would not tell apart in this story ("Andreas and Andreas"). */
  readonly namesakes = new Set<ActorId>();
  namesake(who: ActorId): boolean { return this.namesakes.has(who); }

  mention(world: World, who: ActorId): void {
    this.said.add(who);
    this.last.set(world.actors.cols.sex[who], who);
  }
}

export const female = (world: World, who: ActorId): boolean => world.actors.cols.sex[who] === FEMALE;

/** "herself" or "himself". */
export const reflexive = (world: World, who: ActorId): string => (female(world, who) ? 'herself' : 'himself');
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

/** "sister", "husband", "dad": the word for a tie (null for ties that are not said as a noun, like a friend). */
export function kinWord(world: World, who: ActorId, bond: Bond, voice: Voice | null, rng: Rng | null): string | null {
  const f = female(world, who);
  const formal = (voice?.formality ?? 0.5) > 0.7 || voice?.group === 'old';
  const age = ageOf(world, who);
  const coin = () => (rng ? rng.float() < 0.5 : true);
  switch (bond) {
    case 'spouse': return f ? 'wife' : 'husband';
    case 'partner': return age < 40 ? (f ? 'girlfriend' : 'boyfriend') : 'partner';
    case 'parent': return formal ? (f ? 'mother' : 'father') : f ? 'mother' : 'dad';
    case 'child': return age < 13 && !formal && coin() ? (f ? 'little girl' : 'little boy') : f ? 'daughter' : 'son';
    case 'sibling': return age < 18 && coin() ? (f ? 'little sister' : 'little brother') : f ? 'sister' : 'brother';
    case 'grandparent': return formal ? (f ? 'grandmother' : 'grandfather') : f ? 'grandma' : 'grandpa';
    case 'grandchild': return f ? 'granddaughter' : 'grandson';
    case 'relative': return 'cousin';
    case 'ex': return 'ex';
    case 'housemate': return 'housemate';
    case 'neighbour': return null; // said as "Anna next door" ("neighbour" is spelt two ways)
    case 'colleague': return null;
    default: return null;
  }
}

/** How well `of` knows `who` (0 for strangers). */
export const familiarity = (world: World, of: ActorId, who: ActorId): number => {
  const r = world.relations.row(of, who);
  return r >= 0 ? world.relations.t.cols.familiarity[r] : 0;
};

/**
 * Jobs that say who someone is ("the baker at Church Bakery", "the doctor"). "The office worker at Summit Offices"
 * says nothing, and neither does a job out of town, so those people are named by where they live instead.
 */
const TELLING_ROLES: ReadonlySet<string> = new Set([
  'baker', 'butcher', 'barista', 'bartender', 'chef', 'dentist', 'doctor', 'florist', 'hairdresser', 'librarian', 'mechanic',
  'nurse', 'pharmacist', 'police officer', 'priest', 'teacher', 'kindergarten teacher', 'vet', 'waiter', 'farmer', 'firefighter',
  'mayor', 'physiotherapist', 'shopkeeper', 'beautician', 'gardener', 'coach', 'cook', 'receptionist', 'funeral director', 'fitness trainer',
]);

/** A description of `who` for someone who does not know them. */
function describe(world: World, who: ActorId, d: Discourse): string {
  if (!isPersonActor(world, who)) return nameOf(world, who);
  const age = ageOf(world, who), f = female(world, who);
  const surname = lastName(world, who);
  const rng = d.rng;
  const job = jobOf(world, who);
  const options: string[] = [];
  // By a job that says who they are (an appositive closes with a comma: "Leo, the baker, got…"), unless the story
  // is about that place.
  // (Not in a story about a job: "Linda, the priest at Christ Church, just started in Oakborough".)
  if (job && !d.jobStory && TELLING_ROLES.has(job.role) && job.place !== d.topicPlace && world.graph.places[job.place]?.kind !== 'away') {
    const role = job.role === 'waiter' && f ? 'waitress' : job.role;
    options.push(`${nameOf(world, who)}, the ${role},`, `${firstName(world, who)}, the ${role} at ${placeName(world, job.place, d)},`, `the ${role} at ${placeName(world, job.place, d)}`);
  }
  if (age >= 72) options.push(`old ${f ? 'Mrs' : 'Mr'} ${surname}`, `${f ? 'Mrs' : 'Mr'} ${surname}`);
  else if (age < 13) options.push(`the ${surname}s' little ${f ? 'girl' : 'boy'}`, `the ${surname} [kid|${f ? 'girl' : 'boy'}]`);
  else if (age < 20) options.push(`the ${surname} ${f ? 'girl' : 'boy'}`, `${firstName(world, who)} ${surname}`);
  if (options.length === 0 || rng.float() < 0.3) {
    const home = world.actors.cols.home[who];
    // One "from Kepler Lane" per conversation: two in a row read like a register.
    const street = home >= 0 && !d.streetSaid ? world.graph.places[home].street : '';
    options.push(street ? `${nameOf(world, who)} from ${street}` : nameOf(world, who), nameOf(world, who));
  }
  const np = options[rng.int(0, options.length - 1)];
  if (/ from /.test(np)) d.streetSaid = true;
  return np;
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
    if (familiarity(world, d.listener, who) > 0.2 || !hh) return firstName(world, who);
    return `${firstName(world, who)}, the ${hh.surname}s' ${SPECIES[world.actors.cols.species[who]]?.name ?? 'pet'}`;
  }
  const mine = tie(world, d.speaker, who), yours = tie(world, d.listener, who);
  const first = firstName(world, who);
  if (mine && isFamilyTie(mine) && !(d.ownRomance && (mine === 'partner' || mine === 'spouse'))) {
    const w = kinWord(world, who, mine, voice, rng);
    if (w) return rng.float() < 0.25 && mine !== 'ex' ? `my ${w} ${first}` : `my ${w}`;
  }
  if (yours && isFamilyTie(yours) && rng.float() < 0.65) {
    const w = kinWord(world, who, yours, null, rng);
    if (w) return `your ${w}`;
  }
  const fl = familiarity(world, d.listener, who), fs = familiarity(world, d.speaker, who);
  if (mine === 'colleague' && fl < 0.3) return `${first} from work`;
  if (mine === 'neighbour' && fl < 0.3) return rng.float() < 0.5 ? `${first} next door` : `${first} from next door`;
  if (fl >= 0.3 || (yours && yours !== 'neighbour')) return d.namesake(who) ? nameOf(world, who) : first;
  if (fl >= 0.12) return nameOf(world, who);
  if (fs >= 0.3 && rng.float() < 0.3) return `${first}, a friend of mine,`;
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
  const word = mine && isFamilyTie(mine) && !(d.ownRomance && (mine === 'partner' || mine === 'spouse')) ? kinWord(world, who, mine, voice, d.rng) : null;
  const yword = !word && yours && isFamilyTie(yours) ? kinWord(world, who, yours, null, d.rng) : null;
  if (word) np = `my ${word}`;
  else if (yword) np = `your ${yword}`;
  else np = known && !d.namesake(who) ? firstName(world, who) : nameOf(world, who);
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
  for (const p of world.region?.region.places ?? []) for (const w of p.name.split(/\s+/)) set.add(w);
  if (world.region) set.add(world.region.region.town);
  NAMES.set(world, set);
  NAME_COUNT.set(world, world.actors.count);
  return set;
}
const NAMES = new WeakMap<World, Set<string>>();
const NAME_COUNT = new WeakMap<World, number>();

/** Whether a place is somebody's home (a house, an apartment block, a farmhouse). */
export const isDwelling = (world: World, place: PlaceId): boolean => {
  const k = world.graph.places[place]?.kind;
  return k === 'house' || k === 'apartments' || k === 'farmhouse';
};

/** A place as people say it: "our place", "your place", "the Crown", "a house on Vine Lane". */
export function placeName(world: World, place: PlaceId, d: Discourse | null): string {
  if (place < 0) return 'somewhere';
  const p = world.graph.places[place];
  if (d) {
    if (world.actors.cols.home[d.speaker] === place) return 'our place';
    if (world.actors.cols.home[d.listener] === place) return 'your place';
  }
  if (isDwelling(world, place)) {
    return d && d.rng.float() < 0.5 ? `${dwellingWord(p.kind)} on ${p.street}` : p.name;
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

/** "the Kellers", "my family" (the speaker's own household), "my sister's family", "your family". */
function family(world: World, who: ActorId, d: Discourse): string {
  if (!isPersonActor(world, who)) return 'someone';
  const hh = householdOf(world, who);
  for (const [p, mine] of [[d.speaker, 'my'], [d.listener, 'your']] as const) {
    if (who === p || (hh !== null && householdOf(world, p) === hh)) return `${mine} family`;
    const t = tie(world, p, who);
    const w = t && isFamilyTie(t) ? kinWord(world, who, t, null, null) : null;
    if (w) return `${mine} ${w}'s family`;
  }
  const last = lastName(world, who);
  return /([sxz]|ch|sh)$/.test(last) ? `the ${last} family` : `the ${last}s`;
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
  // Two of the same name or the same tie ("my grandson and my grandson") are told apart by full name.
  if (!me && !you && firstName(world, s) === firstName(world, o)) { d.namesakes.add(s); d.namesakes.add(o); }
  let np: string;
  if (me) np = `${part(other)} and ${part(d.speaker)}`;
  else if (you) np = `you and ${part(other)}`;
  else {
    let x = part(s), y = part(o);
    if (x === y) { x = nameOf(world, s); y = nameOf(world, o); }
    // "Frederick and Laura Lowe", not "Frederick Lowe and Laura Lowe".
    const last = (who: ActorId) => lastName(world, who);
    if (x === nameOf(world, s) && y === nameOf(world, o) && last(s) === last(o)) x = firstName(world, s);
    np = `${x} and ${y}`;
  }
  return c === 'poss' ? possessive(np) : np;
}

/** Values for the grammar slots of a fact phrase (see the header). Names are resolved in reading order. */
export function realiseSlots(world: World, text: string, s: ActorId, o: ActorId, place: PlaceId, d: Discourse, voice: Voice | null): string {
  const pers = (who: ActorId) => (who < 0 ? 'third' : personOf(who, d));
  // One's own new home is not "our place" in the story of moving there: "a house on Elm Street".
  if (place >= 0 && (world.actors.cols.home[d.speaker] === place || world.actors.cols.home[d.listener] === place) && /\b(into|at|to) \{P\}/.test(text)) {
    const p = world.graph.places[place];
    text = text.replace(/\{P\}/g, p.street ? `${dwellingWord(p.kind)} on ${p.street}` : 'a new place');
  }
  // Nobody retires "from Oakborough": from their job there.
  if (place >= 0 && world.graph.places[place]?.kind === 'away' && world.offsite.town[place] === world.graph.places[place].name) text = text.replace(/retired from \{P\}/g, 'retired from {S:poss} job in {P}');
  // A town off the map is "in" ("got a job in Tilford"), not "at" (its school is "at").
  if (place >= 0 && world.graph.places[place]?.kind === 'away' && world.offsite.town[place] === world.graph.places[place].name) text = text.replace(/\b(at|from) \{P\}/g, (_, prep: string) => (prep === 'at' ? 'in {P}' : 'from {P}'));
  return text.replace(/\{(S&O|S|O|P)(?::(\w+))?\}/g, (m, who: string, form: string | undefined) => {
    if (who === 'P') return placeName(world, place, d);
    if (who === 'S&O') {
      if (form && AGREE[form]) return AGREE[form].plural;
      return pair(world, s, o, d, (form as Case) ?? 'subj', voice);
    }
    const id = who === 'S' ? s : o;
    // {S} is a subject, {O} an object ("moved in with him"); {O:subj} when the object person is the sentence's subject.
    if (!form) return refer(world, id, d, who === 'S' ? 'subj' : 'obj', voice);
    if (form === 'obj' || form === 'poss' || form === 'subj') return refer(world, id, d, form, voice);
    if (form === 'pro') return id >= 0 ? pronoun(world, id, 'subj') : 'they';
    if (form === 'family') return family(world, id, d);
    if (form === 'kid') return id >= 0 && female(world, id) ? 'girl' : 'boy';
    if (form === 'first') return id >= 0 ? (id === d.speaker ? 'I' : id === d.listener ? 'you' : firstName(world, id)) : 'someone';
    // (A pet goes by its first name: "their cat Molly", never a person's full name.)
    if (form === 'name') return id >= 0 ? (isPersonActor(world, id) ? nameOf(world, id) : firstName(world, id)) : 'someone';
    const agree = AGREE[form];
    return agree ? agree[pers(id)] : m;
  });
}

/**
 * Who someone is, in a few lines (plan R2, D4): the inhabitant card the character picker shows, read from the sim
 * and nothing else. Their work, who they live with, and the situations of their life right now (recently widowed,
 * new in town, engaged, not speaking to a brother, an affair nobody knows about), each from the life events, the
 * relations, the groups and the knowledge tables. Read-only and pure, so the sim worker makes the cards and tests
 * check them headless.
 *
 * The cards are written from the outside, the way a neighbour would sum someone up, except that the player, about
 * to become this person, also sees their secrets.
 */
import { ACTOR_PERSON, FEMALE, type ActorId } from './actors';
import { dateOf, monthName } from './calendar';
import { ownerOf } from './economy';
import { groupsOf } from './groups';
import { bonded, type LifeEvent } from './life';
import { bondBit, FAMILY_MASK, type Bond } from './relations';
import { agendaOn } from './agenda';
import { intentionsOf } from './intentions';
import { schoolHours, worksOn } from './schedule';
import { dayOf, DAYS_PER_YEAR, hhmm, MINUTES_PER_DAY } from './time';
import { SPECIES } from './species';
import { ageOf, firstName, householdOf, isPerson, jobOf, nameOf, type World } from './world';

/** Filters for the picker (bit flags on `InhabitantCard.tags`). */
export const TAG_SECRET = 1;
export const TAG_IN_LOVE = 2;
export const TAG_NEW = 4;
export const TAG_GRIEVING = 8;
export const TAG_PARENT = 16;
export const TAG_OWNER = 32;
export const TAG_OFFICE = 64;
export const TAG_ALONE = 128;
export const TAG_TROUBLE = 256;
export const TAG_CHILD = 512;
export const TAG_RETIRED = 1024;

/** The picker's filters, in the order it shows them. */
export const CARD_FILTERS: readonly { tag: number; label: string }[] = [
  { tag: TAG_IN_LOVE, label: 'In love' },
  { tag: TAG_SECRET, label: 'Has a secret' },
  { tag: TAG_NEW, label: 'New in town' },
  { tag: TAG_GRIEVING, label: 'Grieving' },
  { tag: TAG_TROUBLE, label: 'In trouble' },
  { tag: TAG_OWNER, label: 'Runs a business' },
  { tag: TAG_OFFICE, label: 'Holds an office' },
  { tag: TAG_PARENT, label: 'Parent' },
  { tag: TAG_ALONE, label: 'Lives alone' },
  { tag: TAG_RETIRED, label: 'Retired' },
  { tag: TAG_CHILD, label: 'Child' },
];

/** One thing going on in someone's life. */
export interface Situation {
  /** "recently widowed", "not speaking to her brother Tom". */
  text: string;
  /** How much it says about them (the card line shows the weightiest). */
  weight: number;
  tags: number;
  /** Only they (and maybe one other) know it. */
  secret?: boolean;
}

/** An inhabitant as the picker shows them. */
export interface InhabitantCard {
  id: ActorId;
  name: string;
  age: number;
  sex: number;
  /** "Owns Elm Street Bakery", "Teacher at Hill Lane School", "Retired", "Pupil at …". */
  occupation: string;
  /** "Lives with her husband Tom and their two children on Mill Street". */
  household: string;
  situations: Situation[];
  /** The one-line summary: occupation and the weightiest situations. */
  line: string;
  /** TAG_* flags, for the picker's filters. */
  tags: number;
  /** Their home's position (the camera flies there when they are indoors). */
  x: number;
  z: number;
}

/** Days within which a life event still colours someone's card. */
const RECENT = { widowed: 2 * DAYS_PER_YEAR, bereaved: DAYS_PER_YEAR, newlywed: 180, romance: 150, baby: 240, newcomer: 300, job: 240, retired: DAYS_PER_YEAR, split: DAYS_PER_YEAR } as const;

const PARTNERS = bondBit('partner') | bondBit('spouse');

/** "wife", "brother", … for what `other` is to `id` (from id's side of the relation), '' when nothing family-like. */
export function kinWord(world: World, id: ActorId, other: ActorId): string {
  const r = world.relations.row(id, other);
  if (r < 0) return '';
  const b = world.relations.t.cols.bonds[r];
  const f = world.actors.cols.sex[other] === FEMALE;
  const has = (x: Bond): boolean => (b & bondBit(x)) !== 0;
  if (has('spouse')) return f ? 'wife' : 'husband';
  if (has('partner')) return f ? 'girlfriend' : 'boyfriend';
  if (has('parent')) return f ? 'mother' : 'father';
  if (has('child')) return f ? 'daughter' : 'son';
  if (has('sibling')) return f ? 'sister' : 'brother';
  if (has('grandparent')) return f ? 'grandmother' : 'grandfather';
  if (has('grandchild')) return f ? 'granddaughter' : 'grandson';
  if (has('relative')) return 'relative';
  if (has('housemate')) return 'housemate';
  return '';
}

/** "her" or "his" for `id`. */
export const their = (world: World, id: ActorId): string => (world.actors.cols.sex[id] === FEMALE ? 'her' : 'his');

/** "in March", "last week", "a year ago": when a day was, as people say it. */
export function whenSaid(world: World, day: number): string {
  const today = Math.floor(world.clock / MINUTES_PER_DAY), ago = today - day;
  if (ago < 2) return ago <= 0 ? 'today' : 'yesterday';
  if (ago < 7) return 'this week';
  if (ago < 14) return 'last week';
  if (ago < 40) return 'a few weeks ago';
  const d = dateOf(world, day * MINUTES_PER_DAY), now = dateOf(world, world.clock);
  if (ago < 330) return `in ${monthName(d.month)}${d.year !== now.year ? ' last year' : ''}`;
  return ago < 500 ? 'about a year ago' : `${Math.round(ago / DAYS_PER_YEAR)} years ago`;
}

/** "two", "three" … for small counts. */
const NUM = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const count = (n: number, one: string, many: string): string => `${NUM[n] ?? n} ${n === 1 ? one : many}`;

/** Where they work or study, or what they do instead ("Baker at Elm Street Bakery", "Retired"); sets the card's TAG_* flags. */
export function occupationOf(world: World, id: ActorId, tags: { v: number } = { v: 0 }): string {
  const age = ageOf(world, id), places = world.graph.places;
  const job = jobOf(world, id);
  if (job) {
    const place = places[job.place];
    if (ownerOf(world, job.place) === job) { tags.v |= TAG_OWNER; return `Owns ${place.name}`; }
    if (job.role === 'mayor') { tags.v |= TAG_OFFICE; return 'The mayor'; }
    if (place.kind === 'away') return `${capitalize(job.role)}, commutes to ${place.name}`;
    return `${capitalize(job.role)} at ${place.name}`;
  }
  const school = world.people.cols.school[world.actors.cols.row[id]];
  if (age < 18) tags.v |= TAG_CHILD;
  if (school >= 0) return `${age < 6 ? 'Goes to' : 'Pupil at'} ${places[school].name}`;
  if (age < 6) return age < 1 ? 'A baby' : 'Too young for school';
  if (age < 18) return 'Left school';
  if (age >= 65) { tags.v |= TAG_RETIRED; return 'Retired'; }
  const hh = householdOf(world, id);
  const small = hh?.members.some((m) => m !== id && ageOf(world, m) < 6 && kinWord(world, id, m).match(/son|daughter/));
  return small ? 'At home with the children' : 'Out of work';
}

/** "Baker" from "baker". */
export const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** Who they live with, and where ("Lives with his wife Anna and their two children on Mill Street, and a dog called Rex"). */
export function householdText(world: World, id: ActorId, tags: { v: number } = { v: 0 }): string {
  const hh = householdOf(world, id);
  const street = hh ? world.graph.places[hh.home].street : '';
  const on = street ? ` on ${street}` : '';
  if (!hh) return `No fixed home${on}`;
  const others = hh.members.filter((m) => m !== id);
  const pets = hh.animals.filter((an) => world.actors.cols.alive[an] && SPECIES[world.actors.cols.species[an]].class === 'pet');
  const pet = pets.length ? `, and ${pets.length === 1 ? `${article(SPECIES[world.actors.cols.species[pets[0]]].name)} called ${nameOf(world, pets[0])}` : count(pets.length, 'pet', 'pets')}` : '';
  if (others.length === 0) {
    if (ageOf(world, id) >= 18) tags.v |= TAG_ALONE;
    return `Lives alone${on}${pet}`;
  }
  const by = new Map<string, ActorId[]>();
  for (const m of others) {
    const w = kinWord(world, id, m) || 'other';
    const l = by.get(w);
    if (l) l.push(m); else by.set(w, [m]);
  }
  const parts: string[] = [];
  const named = (w: string, ms: ActorId[]): string => (ms.length === 1 ? `${their(world, id)} ${w} ${firstName(world, ms[0])}` : '');
  for (const w of ['wife', 'husband', 'girlfriend', 'boyfriend']) { const ms = by.get(w); if (ms) parts.push(named(w, ms)); }
  const kids = [...(by.get('son') ?? []), ...(by.get('daughter') ?? [])];
  if (kids.length) {
    tags.v |= TAG_PARENT;
    parts.push(kids.length === 1 ? named(kinWord(world, id, kids[0]), kids) : `${parts.length ? 'their' : their(world, id)} ${count(kids.length, 'child', 'children')}`);
  }
  for (const [one, many] of [['mother', 'parents'], ['father', 'parents'], ['sister', 'sisters'], ['brother', 'brothers'], ['grandmother', 'grandparents'], ['grandfather', 'grandparents'], ['granddaughter', 'grandchildren'], ['grandson', 'grandchildren'], ['relative', 'relatives'], ['housemate', 'housemates'], ['other', 'others']] as const) {
    const ms = by.get(one);
    if (!ms) continue;
    parts.push(ms.length === 1 ? named(one, ms) : `${their(world, id)} ${count(ms.length, one, many)}`);
  }
  // Mother and father together read as "his parents".
  const mf = parts.findIndex((p) => / mother /.test(p)), ff = parts.findIndex((p) => / father /.test(p));
  if (mf >= 0 && ff >= 0) { parts[mf] = `${their(world, id)} parents`; parts.splice(ff, 1); }
  if (!parts.some((p) => / (child|children|son|daughter)\b/.test(p))) {
    // A parent whose children have moved out still counts for the filter, if they live in town.
    if (bonded(world, id, bondBit('child')).length) tags.v |= TAG_PARENT;
  }
  return `Lives with ${andList(parts.filter(Boolean))}${on}${pet}`;
}

const article = (w: string): string => (/^[aeiou]/.test(w) ? `an ${w}` : `a ${w}`);
/** "a, b and c". */
export const andList = (xs: string[]): string => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** Life events by the person they are about, and by the other party. */
interface EventIndex { who: Map<ActorId, LifeEvent[]>; other: Map<ActorId, LifeEvent[]>; deathDay: Map<ActorId, number> }

function indexEvents(world: World): EventIndex {
  const who = new Map<ActorId, LifeEvent[]>(), other = new Map<ActorId, LifeEvent[]>(), deathDay = new Map<ActorId, number>();
  const fileUnder = (m: Map<ActorId, LifeEvent[]>, k: ActorId, e: LifeEvent): void => { const l = m.get(k); if (l) l.push(e); else m.set(k, [e]); };
  for (const e of world.life.events) {
    if (e.kind === 'holiday' || e.kind === 'birthday') continue;
    if (e.who >= 0) fileUnder(who, e.who, e);
    if (e.other >= 0) fileUnder(other, e.other, e);
    if (e.kind === 'death' && e.who >= 0) deathDay.set(e.who, e.day);
  }
  return { who, other, deathDay };
}

/** The situations of someone's life now, weightiest first. */
function situationsOf(world: World, id: ActorId, ev: EventIndex, secrets: Map<ActorId, string[]>): Situation[] {
  const out: Situation[] = [];
  const today = Math.floor(world.clock / MINUTES_PER_DAY);
  const mine = ev.who.get(id) ?? [], theirs = ev.other.get(id) ?? [];
  const last = (kind: LifeEvent['kind'], within: number, list = mine): LifeEvent | undefined => {
    for (let i = list.length - 1; i >= 0; i--) if (list[i].kind === kind && today - list[i].day <= within) return list[i];
    return undefined;
  };
  const a = world.actors.cols;
  // Deaths in the family: a partner, then the closest kin.
  for (const other of bonded(world, id, FAMILY_MASK, true)) {
    if (a.alive[other] || a.kind[other] !== ACTOR_PERSON) continue;
    const day = ev.deathDay.get(other);
    if (day === undefined) continue;
    const r = world.relations.row(id, other), partner = (world.relations.t.cols.bonds[r] & PARTNERS) !== 0;
    const ago = today - day;
    if (partner && ago <= RECENT.widowed) {
      out.push({ text: ago < 120 ? 'recently widowed' : `widowed ${whenSaid(world, day)}`, weight: 1 - ago / (RECENT.widowed * 2), tags: TAG_GRIEVING });
    } else if (!partner && ago <= RECENT.bereaved) {
      const w = kinWord(world, id, other);
      if (w && w !== 'relative') out.push({ text: `lost ${their(world, id)} ${w} ${whenSaid(world, day)}`, weight: 0.8 - ago / (RECENT.bereaved * 2), tags: TAG_GRIEVING });
    }
  }
  // Love.
  const engaged = [...world.life.engaged.values()].find((e) => e.x === id || e.y === id);
  if (engaged) {
    const other = engaged.x === id ? engaged.y : engaged.x;
    out.push({ text: `engaged to ${nameOf(world, other)}`, weight: 0.8, tags: TAG_IN_LOVE });
  } else {
    const wed = last('marriage', RECENT.newlywed) ?? last('marriage', RECENT.newlywed, theirs);
    if (wed) out.push({ text: `newly married to ${nameOf(world, wed.who === id ? wed.other : wed.who)}`, weight: 0.7, tags: TAG_IN_LOVE });
    else {
      const date = last('dating', RECENT.romance) ?? last('dating', RECENT.romance, theirs);
      const other = date ? (date.who === id ? date.other : date.who) : -1;
      if (other >= 0 && a.alive[other] && (world.relations.t.cols.bonds[world.relations.row(id, other)] & PARTNERS)) {
        out.push({ text: `in a new romance with ${nameOf(world, other)}`, weight: 0.7, tags: TAG_IN_LOVE });
      }
    }
  }
  const split = last('divorce', RECENT.split) ?? last('divorce', RECENT.split, theirs) ?? last('breakup', RECENT.split) ?? last('breakup', RECENT.split, theirs);
  if (split) {
    const other = split.who === id ? split.other : split.who;
    out.push({ text: `${split.kind === 'divorce' ? 'divorced' : 'split up with'} ${firstName(world, other)} ${whenSaid(world, split.day)}`.replace('divorced ', 'divorced from '), weight: 0.65, tags: TAG_TROUBLE });
  }
  // Children.
  const preg = world.life.pregnant.get(id);
  if (preg) out.push(preg.announced ? { text: 'expecting a baby', weight: 0.75, tags: 0 } : { text: 'secretly expecting a baby', weight: 0.8, tags: TAG_SECRET, secret: true });
  const baby = theirs.filter((e) => e.kind === 'birth' && today - e.day <= RECENT.baby).pop()
    ?? bonded(world, id, bondBit('child')).map((c) => (ev.who.get(c) ?? []).find((e) => e.kind === 'birth')).find((e) => e && today - e.day <= RECENT.baby);
  if (baby) out.push({ text: `a new ${a.sex[baby.who] === FEMALE ? 'daughter' : 'son'}, ${firstName(world, baby.who)}`, weight: 0.7, tags: TAG_PARENT });
  // Moving in, work.
  const came = last('arrived', RECENT.newcomer);
  if (came) out.push({ text: today - came.day < 40 ? 'just moved to town' : `moved to town ${whenSaid(world, came.day)}`, weight: 0.6, tags: TAG_NEW });
  const fired = last('fired', RECENT.job);
  if (fired && !jobOf(world, id)) out.push({ text: `lost ${their(world, id)} job at ${world.graph.places[fired.place].name} ${whenSaid(world, fired.day)}`, weight: 0.65, tags: TAG_TROUBLE });
  const retired = last('retired', RECENT.retired);
  if (retired) out.push({ text: `retired from ${world.graph.places[retired.place].name} ${whenSaid(world, retired.day)}`, weight: 0.45, tags: TAG_RETIRED });
  const hired = last('hired', 60);
  if (hired && jobOf(world, id)) out.push({ text: `started a new job ${whenSaid(world, hired.day)}`, weight: 0.4, tags: 0 });
  if (a.health[id] < 0.5) out.push({ text: 'in poor health', weight: 0.5, tags: TAG_TROUBLE });
  // Feuds: family first (the best stories), then a grudge against a neighbour or colleague.
  let feud: { other: ActorId; aff: number; family: boolean } | null = null;
  const rel = world.relations, rc = rel.t.cols;
  for (const r of rel.known(id)) {
    const other = rc.to[r];
    if (!a.alive[other] || a.kind[other] !== ACTOR_PERSON) continue;
    const family = (rc.bonds[r] & FAMILY_MASK) !== 0 && (rc.bonds[r] & PARTNERS) === 0;
    const aff = rc.affection[r];
    if (aff > (family ? -0.2 : -0.4)) continue;
    if (!feud || (family && !feud.family) || (family === feud.family && aff < feud.aff)) feud = { other, aff, family };
  }
  if (feud) {
    const w = kinWord(world, id, feud.other);
    const what = feud.family ? `not speaking to ${their(world, id)} ${w} ${firstName(world, feud.other)}` : `can't stand ${their(world, id)} ${grudgeWord(world, id, feud.other)} ${nameOf(world, feud.other)}`;
    out.push({ text: what, weight: feud.family ? 0.72 : 0.5, tags: TAG_TROUBLE });
  }
  // Offices.
  for (const { group, office } of groupsOf(world, id)) {
    if (group.kind === 'council') out.push({ text: office ? `${office} of the town council` : 'on the town council', weight: 0.5, tags: TAG_OFFICE });
    else if (office) out.push({ text: `${office} of ${group.name}`, weight: 0.4, tags: TAG_OFFICE });
  }
  // Secrets they keep about themselves.
  for (const s of secrets.get(id) ?? []) out.push({ text: s, weight: 0.85, tags: TAG_SECRET, secret: true });
  return out.sort((x, y) => y.weight - x.weight);
}

/** "neighbour", "colleague", … what a non-family person is to `id`. */
function grudgeWord(world: World, id: ActorId, other: ActorId): string {
  const r = world.relations.row(id, other), b = world.relations.t.cols.bonds[r];
  for (const w of ['neighbour', 'colleague', 'classmate', 'ex', 'housemate', 'friend'] as const) if (b & bondBit(w)) return w === 'friend' ? 'old friend' : w;
  return 'acquaintance';
}

/** Secret facts about a person that they hold themselves ("having an affair with …"), in their words. */
function secretsOf(world: World): Map<ActorId, string[]> {
  const out = new Map<ActorId, string[]>();
  const k = world.knowledge, c = k.beliefs.cols;
  for (const f of k.facts) {
    if (!f.secret || f.subject < 0 || !world.actors.cols.alive[f.subject]) continue;
    // Only what they themselves know (a secret that has died out is no longer theirs to keep).
    const held = (k.byHolder[f.subject] ?? []).some((r) => k.facts[c.fact[r]] === f);
    if (!held) continue;
    const text = f.text.replace(/^\{subject\} (is |was )?/, '').replace(/\{object\}/g, f.object >= 0 ? nameOf(world, f.object) : 'someone').replace(/\{place\}/g, f.place >= 0 ? world.graph.places[f.place].name : 'somewhere');
    if (/\{subject\}/.test(text)) continue;
    const l = out.get(f.subject);
    if (l) { if (!l.includes(text)) l.push(text); } else out.set(f.subject, [text]);
  }
  return out;
}

/** One person's card. For many at once use `cardsOf`, which indexes the events once. */
/**
 * What `id` has on for the rest of today, as short phrases without a subject ("work at Fern Bakery 09:00-17:00",
 * "school until 15:15", "Mara and Tom's wedding at 14:00"): their shift, school, the occasions they are invited to
 * and the plans they made (intentions with a time). Empty when the day holds nothing fixed. For the chat prompt:
 * a person's own day, and what their household knows of each other's.
 */
export function plansToday(world: World, id: ActorId, clock = world.clock): string[] {
  const out: string[] = [];
  const places = world.graph.places, today = dayOf(clock), end = (today + 1) * MINUTES_PER_DAY;
  const span = (what: string, s: number, e: number): void => {
    if (e <= clock) return;
    out.push(s > clock ? `${what} ${hhmm(s)}-${hhmm(e)}` : `${what} until ${hhmm(e)}`);
  };
  const job = jobOf(world, id);
  if (job && world.people.cols.leaveUntil[world.actors.cols.row[id]] <= clock && worksOn(world, job, clock)) {
    const s = today * MINUTES_PER_DAY + job.start, e = today * MINUTES_PER_DAY + job.end + (job.end <= job.start ? MINUTES_PER_DAY : 0);
    span(`work at ${places[job.place].name}`, s, e);
  }
  const school = schoolHours(world, id, clock);
  if (school) span(places[world.people.cols.school[world.actors.cols.row[id]]].kind === 'kindergarten' ? 'kindergarten' : 'school', school[0], school[1]);
  const invited = new Set<number>();
  for (const o of agendaOn(world, today)) {
    if (o.end <= clock || !(o.guests?.includes(id) || o.about.includes(id))) continue;
    invited.add(o.id);
    out.push(`${o.name}${o.start > clock ? ` at ${hhmm(o.start)}` : ' (now)'}`);
  }
  for (const i of intentionsOf(world, id)) {
    if (i.origin === 'routine' || i.at >= end || i.until <= clock || (i.kind === 'attend' && invited.has(i.fact))) continue;
    const where = i.place >= 0 && places[i.place] ? ` at ${places[i.place].name}` : '';
    const who = i.person >= 0 && isPerson(world, i.person) ? ` ${firstName(world, i.person)}` : '';
    const what = i.reason || `${i.kind === 'meet' ? 'meet' : i.kind === 'visit' ? 'visit' : i.kind}${who}${where}`;
    out.push(i.at > clock ? `${what} at ${hhmm(i.at)}` : what);
  }
  return out.slice(0, 5);
}

export function profileOf(world: World, id: ActorId): InhabitantCard {
  return cardOf(world, id, indexEvents(world), secretsOf(world));
}

function cardOf(world: World, id: ActorId, ev: EventIndex, secrets: Map<ActorId, string[]>): InhabitantCard {
  const tags = { v: 0 };
  const occupation = occupationOf(world, id, tags);
  const household = householdText(world, id, tags);
  const situations = situationsOf(world, id, ev, secrets);
  for (const s of situations) tags.v |= s.tags;
  // The line: what they do, then the two weightiest things in their life that others know of (secrets stay in the details).
  const shown = situations.filter((s) => !s.secret).slice(0, 2);
  const line = [occupation, ...shown.map((s) => s.text)].join(', ');
  const home = world.actors.cols.home[id];
  const p = world.graph.places[home >= 0 ? home : 0];
  return { id, name: nameOf(world, id), age: ageOf(world, id), sex: world.actors.cols.sex[id], occupation, household, situations, line, tags: tags.v, x: p.x, z: p.z };
}

/** Every living inhabitant's card (people only, not animals), in actor order. */
export function cardsOf(world: World): InhabitantCard[] {
  const ev = indexEvents(world), secrets = secretsOf(world), out: InhabitantCard[] = [];
  for (let id = 0; id < world.actors.count; id++) if (isPerson(world, id)) out.push(cardOf(world, id, ev, secrets));
  return out;
}

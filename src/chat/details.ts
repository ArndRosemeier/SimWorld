/**
 * Everything the town knows about one inhabitant, in plain words: the long form of the picker's card
 * (src/sim/profile.ts) for its "More about …" window (Arnd, 2026-10-19). Who they are, their home and household,
 * family, friends and people they can't stand, work or school, personality, clubs and views, what is going on in
 * their life (secrets marked: the player is about to become them), their day at the time shown, what is on their
 * mind and what the town says about them. Read from the sim and nothing else (no LLM), pure, so the sim worker
 * writes it for the world as the picker's slider shows it and tests check it headless.
 */
import { A, ACTOR_PERSON, FEMALE, type ActorId } from '../sim/actors';
import { dateOf, monthName, weekdayName } from '../sim/calendar';
import { groupsOf } from '../sim/groups';
import { intentionsOf } from '../sim/intentions';
import { factText, isAbout } from '../sim/knowledge';
import { memoriesOf } from '../sim/memory';
import { HABITS, T_AGREE, T_CONSC, T_EXTRA, T_NEURO, T_OPEN, V_AMBITION, V_FAITH, V_HONEST, V_LOYAL } from '../sim/people';
import { opinionsOf } from '../sim/politics';
import { andList, capitalize, householdText, kinWord, occupationOf, plansToday, profileOf, their, whenSaid } from '../sim/profile';
import { bondBit, FAMILY_MASK, type Bond } from '../sim/relations';
import { schoolHours, worksOn } from '../sim/schedule';
import { SPECIES } from '../sim/species';
import { hhmm, MINUTES_PER_DAY } from '../sim/time';
import { ageOf, commute, hasCar, householdOf, isPerson, jobOf, nameOf, traitOf, valueOf, type World } from '../sim/world';
import { activityWord, homeOf, moodOf, speechStyleOf } from './card';

/** One line in a section: the text, a quieter note after it, and whether only the player may know it. */
export interface DetailItem { text: string; note?: string; secret?: boolean }

/** A section of the window: a heading, an optional sentence or two, then its lines. */
export interface DetailSection { title: string; intro?: string; items: DetailItem[] }

/** The whole window's content for one person. */
export interface PersonDetails {
  id: ActorId;
  name: string;
  age: number;
  /** The card's one-line summary. */
  line: string;
  sections: DetailSection[];
}

const DAY_NAMES = [0, 1, 2, 3, 4, 5, 6].map(weekdayName);

/** "Monday to Friday", "every day", "Tuesday, Thursday and Saturday" for a DayMask (bit 0 = Monday). */
export function daysText(mask: number): string {
  const on = DAY_NAMES.filter((_, d) => mask & (1 << d));
  if (on.length === 7) return 'every day';
  if (!on.length) return 'no fixed days';
  const first = DAY_NAMES.indexOf(on[0]), last = DAY_NAMES.indexOf(on[on.length - 1]);
  if (on.length >= 3 && last - first + 1 === on.length) return `${on[0]} to ${on[on.length - 1]}`;
  return andList(on);
}

/** A 0..1 trait as a few words, or '' when it is middling (nothing to say). */
function traitWords(v: number, high: [string, string], low: [string, string]): string {
  if (v >= 0.8) return high[1];
  if (v >= 0.65) return high[0];
  if (v <= 0.2) return low[1];
  if (v <= 0.35) return low[0];
  return '';
}

/** Who someone is to `id`, as a short label ("Neighbour", "Colleague", "Old friend"), from the bonds. */
function tieWord(bonds: number): string {
  const tie = (['ex', 'housemate', 'colleague', 'classmate', 'neighbour', 'friend'] as const).find((b: Bond) => (bonds & bondBit(b)) !== 0);
  return tie ? capitalize(tie) : 'Acquaintance';
}

/** "34, teacher at Hill Lane School, lives on Mill Street": a short line about someone else. */
function aboutOther(world: World, id: ActorId, other: ActorId, home = true): string {
  const parts = [String(ageOf(world, other)), occupationOf(world, other).replace(/^\w/, (c) => c.toLowerCase())];
  if (home) {
    const h = world.actors.cols.home[other];
    const street = h >= 0 ? world.graph.places[h].street : '';
    if (householdOf(world, other) && householdOf(world, other) === householdOf(world, id)) parts.push('lives with them');
    else if (street) parts.push(`lives on ${street}`);
  }
  return parts.join(', ');
}

/** Everything about `id`, at the world's clock (the picker's slider moves the world, so this follows it). */
export function detailsOf(world: World, id: ActorId): PersonDetails {
  const card = profileOf(world, id);
  const sections = [
    whoSection(world, id), homeSection(world, id), familySection(world, id), peopleSection(world, id),
    workSection(world, id), personalitySection(world, id), ...lifeSections(world, id, card.situations), daySection(world, id),
    townSection(world, id), mindSection(world, id),
  ].filter((s) => s.items.length || s.intro);
  return { id, name: card.name, age: card.age, line: card.line, sections };
}

function whoSection(world: World, id: ActorId): DetailSection {
  const a = world.actors.cols, age = ageOf(world, id);
  const born = dateOf(world, a.birth[id] * MINUTES_PER_DAY);
  const items: DetailItem[] = [
    { text: `${age === 1 ? 'One year' : `${age} years`} old`, note: `birthday ${born.day} ${monthName(born.month)}` },
    { text: occupationOf(world, id) },
  ];
  const home = homeOf(world, id);
  if (home) items.push({ text: `Lives in ${home}` });
  const h = a.health[id];
  items.push({ text: h >= 0.9 ? 'In good health' : h >= 0.7 ? 'Not quite well' : h >= 0.5 ? 'Unwell' : 'In poor health' });
  const { mood, needs } = moodOf(world, id);
  items.push({ text: `Feeling ${mood}`, note: needs || undefined });
  return { title: 'Who they are', items };
}

function homeSection(world: World, id: ActorId): DetailSection {
  const hh = householdOf(world, id);
  const items: DetailItem[] = [];
  if (hh) {
    for (const m of hh.members) {
      if (m === id) continue;
      items.push({ text: `${capitalize(kinWord(world, id, m) || 'housemate')}: ${nameOf(world, m)}`, note: aboutOther(world, id, m, false) });
    }
    for (const an of hh.animals) if (world.actors.cols.alive[an]) items.push({ text: `Pet: ${nameOf(world, an)}`, note: SPECIES[world.actors.cols.species[an]].name });
    if (hh.car) items.push({ text: 'The household has a car' });
  }
  return { title: 'Home and household', intro: `${householdText(world, id)}.`, items };
}

/** Kin first in this order; the rest after. */
const KIN_ORDER = ['wife', 'husband', 'girlfriend', 'boyfriend', 'mother', 'father', 'daughter', 'son', 'sister', 'brother', 'grandmother', 'grandfather', 'granddaughter', 'grandson', 'relative'];

function familySection(world: World, id: ActorId): DetailSection {
  const rel = world.relations, c = rel.t.cols, a = world.actors.cols, home = householdOf(world, id);
  const kin: { word: string; other: ActorId }[] = [];
  for (const r of rel.known(id)) {
    const other = c.to[r];
    if (!(c.bonds[r] & FAMILY_MASK) || a.kind[other] !== ACTOR_PERSON || (a.alive[other] && home && home === householdOf(world, other))) continue;
    const word = kinWord(world, id, other);
    if (word) kin.push({ word, other });
  }
  kin.sort((x, y) => KIN_ORDER.indexOf(x.word) - KIN_ORDER.indexOf(y.word) || ageOf(world, y.other) - ageOf(world, x.other));
  const deaths = new Map<ActorId, number>();
  for (const e of world.life.events) if (e.kind === 'death' && e.who >= 0) deaths.set(e.who, e.day);
  const items: DetailItem[] = kin.map(({ word, other }) => {
    if (!a.alive[other]) {
      const day = deaths.get(other);
      return { text: `${capitalize(word)}: ${nameOf(world, other)}`, note: day !== undefined ? `died ${whenSaid(world, day)}` : 'no longer living' };
    }
    const away = world.actors.cols.home[other] < 0;
    return { text: `${capitalize(word)}: ${nameOf(world, other)}`, note: away ? `${ageOf(world, other)}, lives out of town` : aboutOther(world, id, other) };
  });
  const intro = items.length ? (home && home.members.length > 1 ? 'Besides those they live with:' : undefined) : home && home.members.length > 1 ? 'No other family in town.' : 'No family in town.';
  return { title: 'Family', intro, items };
}

/** How warm a feeling is, in words. */
const warmth = (aff: number): string => (aff > 0.75 ? 'very close' : aff > 0.55 ? 'close' : 'gets on well');

function peopleSection(world: World, id: ActorId): DetailSection {
  const rel = world.relations, c = rel.t.cols, a = world.actors.cols;
  const partners = bondBit('partner') | bondBit('spouse');
  const liked: { other: ActorId; aff: number; bonds: number }[] = [], disliked: typeof liked = [];
  for (const r of rel.known(id)) {
    const other = c.to[r];
    if (!a.alive[other] || a.kind[other] !== ACTOR_PERSON || other === id) continue;
    const family = (c.bonds[r] & FAMILY_MASK) !== 0;
    const aff = c.affection[r];
    if (!family && aff > 0.35 && c.familiarity[r] > 0.15) liked.push({ other, aff, bonds: c.bonds[r] });
    else if (aff < -0.3 && !(c.bonds[r] & partners)) disliked.push({ other, aff, bonds: c.bonds[r] });
  }
  liked.sort((x, y) => y.aff - x.aff);
  disliked.sort((x, y) => x.aff - y.aff);
  const items: DetailItem[] = [];
  for (const f of liked.slice(0, 8)) {
    items.push({ text: `${tieWord(f.bonds)}: ${nameOf(world, f.other)}`, note: `${warmth(f.aff)}; ${aboutOther(world, id, f.other)}` });
  }
  for (const d of disliked.slice(0, 4)) {
    const kin = kinWord(world, id, d.other);
    items.push({ text: `Doesn't get on with ${nameOf(world, d.other)}`, note: kin ? `${their(world, id)} ${kin}` : tieWord(d.bonds).toLowerCase() });
  }
  const known = rel.known(id).filter((r) => c.familiarity[r] > 0.15 && a.alive[c.to[r]] && a.kind[c.to[r]] === ACTOR_PERSON).length;
  const intro = known ? `Knows ${known === 1 ? 'one person' : `${known} people`} in town well enough to name${liked.length ? `, and is fond of ${liked.length === 1 ? 'one' : liked.length} of them` : ''}.` : 'Hardly knows anyone in town yet.';
  return { title: 'Friends and other people', intro, items };
}

function workSection(world: World, id: ActorId): DetailSection {
  const items: DetailItem[] = [];
  const places = world.graph.places, clock = world.clock;
  const job = jobOf(world, id);
  if (job) {
    const end = job.end % MINUTES_PER_DAY;
    items.push({ text: `Works ${daysText(job.days)}, ${hhmm(job.start)} to ${hhmm(end)}`, note: `${job.role} at ${places[job.place].name}` });
    const home = world.actors.cols.home[id];
    if (home >= 0 && places[job.place].kind !== 'away') {
      const mins = Math.max(1, Math.round(commute(world, id, job.place)));
      items.push({ text: `About ${mins} minute${mins === 1 ? '' : 's'} to get there`, note: hasCar(world, id) ? 'has a car' : 'on foot or by bike' });
    }
    if (world.people.cols.leaveUntil[world.actors.cols.row[id]] > clock) items.push({ text: 'Off work at the moment', note: 'on leave or ill' });
  }
  const school = world.people.cols.school[world.actors.cols.row[id]];
  if (school >= 0) {
    const hours = schoolHours(world, id, clock);
    items.push({ text: `Goes to ${places[school].name}`, note: hours ? `today ${hhmm(hours[0])} to ${hhmm(hours[1])}` : undefined });
  }
  const pc = world.people.cols, row = world.actors.cols.row[id];
  const spots: string[] = [];
  for (let h = 0; h < HABITS.length; h++) {
    const p = pc.habits[row * HABITS.length + h];
    if (p >= 0 && places[p] && !spots.includes(places[p].name)) spots.push(places[p].name);
  }
  if (spots.length) items.push({ text: `Regular spots: ${andList(spots)}` });
  items.push({ text: `Usually up at ${hhmm(pc.wake[row])}, in bed by ${hhmm(pc.sleep[row])}` });
  if (ageOf(world, id) >= 18) {
    const money = Math.round(pc.money[row] / 10) * 10;
    items.push({ text: money < 0 ? `In debt: ${-money}` : `Savings: ${money}` });
  }
  return { title: job ? 'Work and routine' : school >= 0 ? 'School and routine' : 'Routine', items };
}

function personalitySection(world: World, id: ActorId): DetailSection {
  const trait = (k: number) => traitOf(world, id, k), value = (k: number) => valueOf(world, id, k);
  const words = [
    traitWords(trait(T_EXTRA), ['outgoing', 'very outgoing, the life of the party'], ['reserved', 'very shy']),
    traitWords(trait(T_AGREE), ['kind and easy to get on with', 'warm-hearted, everyone\'s friend'], ['a bit prickly', 'hard to get on with']),
    traitWords(trait(T_CONSC), ['organised and reliable', 'very orderly, always on time'], ['a bit disorganised', 'chaotic, often late']),
    traitWords(trait(T_NEURO), ['a worrier', 'anxious, easily upset'], ['calm', 'unflappable']),
    traitWords(trait(T_OPEN), ['curious, likes new things', 'very curious and imaginative'], ['set in their ways', 'very traditional']),
  ].filter(Boolean);
  const items: DetailItem[] = words.map((w) => ({ text: capitalize(w) }));
  const values = [
    traitWords(value(V_HONEST), ['honest', 'honest to a fault'], ['not above a white lie', 'bends the truth easily']),
    traitWords(value(V_LOYAL), ['loyal to family and friends', 'fiercely loyal'], ['puts themselves first', 'loyal to nobody']),
    traitWords(value(V_AMBITION), ['ambitious', 'very ambitious'], ['content with what they have', 'has no ambition at all']),
    traitWords(value(V_FAITH), ['a believer', 'deeply religious'], ['not religious', 'has no time for religion']),
  ].filter(Boolean);
  if (values.length) items.push({ text: capitalize(andList(values)) });
  return {
    title: 'Personality',
    intro: words.length ? undefined : `Nothing extreme about ${their(world, id)} character: an even-tempered sort.`,
    items: [...items, { text: 'How they talk', note: speechStyleOf(world, id) }],
  };
}

function lifeSections(world: World, id: ActorId, situations: { text: string; secret?: boolean }[]): DetailSection[] {
  const items: DetailItem[] = situations.map((s) => ({ text: capitalize(s.text), secret: s.secret }));
  // Life so far: their own events, newest first.
  const today = Math.floor(world.clock / MINUTES_PER_DAY);
  const story: DetailItem[] = [];
  for (let i = world.life.events.length - 1; i >= 0 && story.length < 10; i--) {
    const e = world.life.events[i];
    if (e.who !== id && e.other !== id) continue;
    const line = eventText(world, id, e.kind, e.who, e.other, e.place);
    if (line) story.push({ text: line, note: whenSaid(world, e.day) });
    if (today - e.day > 30 * 365) break;
  }
  // What the situations already say is not told twice ("moved to town in May").
  const said = new Set(items.map((i) => i.text.toLowerCase()));
  return [
    { title: 'Going on in their life', intro: items.length ? undefined : 'Nothing out of the ordinary at the moment.', items },
    { title: 'Life so far', intro: story.length ? undefined : 'Nothing much has happened to them yet.', items: story.filter((x) => !said.has(`${x.text} ${x.note}`.toLowerCase())) },
  ];
}

/** A life event about `id` in plain words, or null if it says nothing about them. */
function eventText(world: World, id: ActorId, kind: string, who: ActorId, other: ActorId, place: number): string | null {
  const o = other >= 0 ? nameOf(world, other) : '';
  const at = place >= 0 && world.graph.places[place] ? world.graph.places[place].name : '';
  const mine = who === id;
  if (!mine) {
    if (kind === 'birth') return `${nameOf(world, who)} was born`;
    if (kind === 'marriage') return `Married ${nameOf(world, who)}`;
    if (kind === 'engagement') return `Got engaged to ${nameOf(world, who)}`;
    if (kind === 'dating') return `Started seeing ${nameOf(world, who)}`;
    if (kind === 'breakup') return `${nameOf(world, who)} broke up with ${world.actors.cols.sex[id] === FEMALE ? 'her' : 'him'}`;
    if (kind === 'divorce') return `Divorced ${nameOf(world, who)}`;
    if (kind === 'theft' || kind === 'burglary') return `Was robbed${at ? ` at ${at}` : ''}`;
    if (kind === 'fight') return `Got into a fight with ${nameOf(world, who)}`;
    return null;
  }
  switch (kind) {
    case 'marriage': return o ? `Married ${o}` : 'Got married';
    case 'engagement': return o ? `Got engaged to ${o}` : 'Got engaged';
    case 'dating': return o ? `Started seeing ${o}` : null;
    case 'breakup': return o ? `Broke up with ${o}` : 'Went through a break-up';
    case 'divorce': return o ? `Divorced ${o}` : 'Got divorced';
    case 'birth': return o ? `Had a baby, ${nameOf(world, other)}` : null;
    case 'hired': return at ? `Started work at ${at}` : 'Started a new job';
    case 'fired': return at ? `Lost ${their(world, id)} job at ${at}` : `Lost ${their(world, id)} job`;
    case 'quit': return at ? `Quit ${their(world, id)} job at ${at}` : `Quit ${their(world, id)} job`;
    case 'retired': return at ? `Retired from ${at}` : 'Retired';
    case 'arrived': return 'Moved to town';
    case 'moveIn': return o ? `Moved in with ${o}` : 'Moved house';
    case 'leftHome': return 'Moved out of the family home';
    case 'illness': return 'Fell ill';
    case 'recovery': return 'Got better after an illness';
    case 'schoolStart': return at ? `Started at ${at}` : 'Started school';
    case 'schoolEnd': return at ? `Finished at ${at}` : 'Finished school';
    case 'petAdopted': return o ? `Took in ${o}` : 'Took in a pet';
    case 'petLost': return o ? `Lost ${o}` : null;
    case 'petFound': return o ? `Found ${o} again` : null;
    case 'fight': return o ? `Got into a fight with ${o}` : 'Got into a fight';
    case 'theft': case 'burglary': case 'vandalism': return null;
    default: return null;
  }
}

function daySection(world: World, id: ActorId): DetailSection {
  const a = world.actors.cols, places = world.graph.places, clock = world.clock;
  const at = dateOf(world, clock);
  let now: string;
  if (a.dest[id] >= 0) now = `On the way to ${places[a.dest[id]].name}, ${activityWord(a.planned[id])}`;
  else if (a.place[id] >= 0 && a.place[id] === a.home[id]) now = a.activity[id] === A.sleep ? 'Asleep at home' : `At home, ${activityWord(a.activity[id])}`;
  else if (a.place[id] >= 0) now = `${capitalize(activityWord(a.activity[id]))} at ${places[a.place[id]].name}`;
  else now = capitalize(activityWord(a.activity[id]));
  const items: DetailItem[] = [{ text: now }];
  for (const p of plansToday(world, id, clock)) items.push({ text: capitalize(p) });
  // Plans further ahead (a meeting tomorrow, a visit at the weekend).
  const end = (Math.floor(clock / MINUTES_PER_DAY) + 1) * MINUTES_PER_DAY;
  for (const i of intentionsOf(world, id)) {
    if (i.origin === 'routine' || i.at < end || !i.reason) continue;
    items.push({ text: capitalize(i.reason), note: `${weekdayName(dateOf(world, i.at).weekday)} ${hhmm(i.at)}` });
    if (items.length > 9) break;
  }
  const job = jobOf(world, id);
  if (job && !worksOn(world, job, clock) && !items.some((x) => /^Work /.test(x.text))) items.push({ text: 'A day off work' });
  return { title: `Their day: ${weekdayName(at.weekday)} ${hhmm(Math.floor(clock - Math.floor(clock / MINUTES_PER_DAY) * MINUTES_PER_DAY))}`, items };
}

function townSection(world: World, id: ActorId): DetailSection {
  const items: DetailItem[] = [];
  for (const { group, office } of groupsOf(world, id)) items.push({ text: capitalize(group.name), note: office ?? 'member' });
  for (const o of opinionsOf(world, id)) {
    if (Math.abs(o.stance) < 0.35) continue;
    items.push({ text: `${Math.abs(o.stance) > 0.75 ? 'Strongly ' : ''}${o.stance > 0 ? 'in favour of' : 'against'} ${o.what}`.replace(/^\w/, (c) => c.toUpperCase()), note: o.status === 'open' ? 'still being decided' : undefined });
  }
  // The stories about them that go round the town, the most widely known first (secrets only they know stay out).
  const k = world.knowledge, bc = k.beliefs.cols;
  const holders = new Map<number, number>();
  for (let r = 0; r < k.beliefs.count; r++) {
    if (bc.holder[r] < 0 || bc.holder[r] === id) continue;
    const f = k.facts[bc.fact[r]];
    if (f && isAbout(f, id)) holders.set(bc.fact[r], (holders.get(bc.fact[r]) ?? 0) + 1);
  }
  // The same story told as several facts (each one's own telling) counts once, by its widest reach.
  const seen = new Set<string>();
  for (const [f, n] of [...holders].sort((x, y) => y[1] - x[1])) {
    const text = factText(world, k.facts[f]);
    if (/[{}]/.test(text) || seen.has(text) || seen.size >= 4) continue;
    seen.add(text);
    items.push({ text: `People say: ${text}`, note: `${n} ${n === 1 ? 'person knows' : 'people know'}${k.facts[f].secret ? ', a secret' : ''}` });
  }
  return { title: 'Clubs, views and talk', intro: items.length ? undefined : 'Keeps out of town affairs, and nobody is talking about them.', items };
}

/** How fresh a memory is, 1 now halving every week. */
const fresh = (clock: number, time: number): number => Math.pow(0.5, (clock - time) / MINUTES_PER_DAY / 7);

function mindSection(world: World, id: ActorId): DetailSection {
  const clock = world.clock;
  const recent = memoriesOf(world, id)
    .filter((m) => clock - m.time < 60 * MINUTES_PER_DAY && m.importance >= 0.3)
    .slice()
    .sort((x, y) => y.importance * fresh(clock, x.time) - x.importance * fresh(clock, y.time) || y.time - x.time)
    .slice(0, 5);
  const items: DetailItem[] = recent.map((m) => ({ text: `"${capitalize(m.summary)}"`, note: whenSaid(world, Math.floor(m.time / MINUTES_PER_DAY)) }));
  return { title: 'On their mind', intro: items.length ? undefined : 'Nothing much has happened to them lately.', items };
}

/** Is `id` someone the window can be shown for (a person, living or not)? */
export const hasDetails = (world: World, id: ActorId): boolean => id >= 0 && id < world.actors.count && isPerson(world, id);

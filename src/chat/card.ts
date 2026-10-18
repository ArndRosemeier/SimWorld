/**
 * Who an inhabitant is, in words, for their prompt (`NpcCard`) and the chat panel's header: occupation, home,
 * how they talk, a short life story, their mood. Everything is read from the society sim and is about the person
 * themselves (their own life is theirs to know); nothing about the rest of the town enters here.
 */
import { Rng, deriveSeed } from '@futuremagic/core';
import type { NpcCard, Traits } from '../llm/prompt';
import { A, ACTIVITIES, EMOTION_COUNT, FEMALE, type ActorId } from '../sim/actors';
import { groupsOf } from '../sim/groups';
import { standingOf } from '../sim/knowledge';
import type { LifeEvent } from '../sim/life';
import { partnerOf } from '../sim/life';
import { EMOTIONS } from '../sim/mind/proposal';
import { VALUES } from '../sim/people';
import { opinionsOf } from '../sim/politics';
import { capFirst } from '../talk/answer';
import { N_FOOD, N_REST, N_SOCIAL, NEED_COUNT } from '../sim/species';
import { MINUTES_PER_DAY } from '../sim/time';
import { ageOf, firstName, householdOf, isPerson, jobOf, nameOf, traitOf, valueOf, type World } from '../sim/world';


/** "baker at Keller's Bakery", "retired", "pupil at Hill School", "" (no job, not a child). */
export function occupationOf(world: World, id: ActorId): string {
  const job = jobOf(world, id);
  const age = ageOf(world, id);
  if (job) return `${job.role} at ${world.graph.places[job.place].name}`;
  const school = world.people.cols.school[world.actors.cols.row[id]];
  if (school >= 0) return `${age < 6 ? 'goes to' : 'pupil at'} ${world.graph.places[school].name}`;
  if (age >= 66) return 'retired';
  if (age < 6) return 'a small child';
  return age >= 18 ? 'out of work' : '';
}

/** "a house on Elm Street", "a flat on Mill Lane". */
export function homeOf(world: World, id: ActorId): string {
  const home = world.actors.cols.home[id];
  if (home < 0) return '';
  const p = world.graph.places[home];
  const what = p.kind === 'carehome' ? 'a room at the care home' : p.kind === 'farmhouse' ? 'a farmhouse' : p.kind === 'house' ? 'a house' : 'a flat';
  return p.street ? `${what} on ${p.street}` : what;
}

/** Big Five as the prompt's `Traits`. */
export function traitsOf(world: World, id: ActorId): Traits {
  const t = (k: number) => traitOf(world, id, k);
  return { openness: t(0), conscientiousness: t(1), extraversion: t(2), agreeableness: t(3), neuroticism: t(4) };
}

const VERBAL_HABITS = [
  'says "right then" when changing the subject', 'starts answers with "Well,"', 'says "honestly" a lot', 'calls people "love"',
  'trails off with "anyway..."', 'answers questions with a question now and then', 'uses "to be fair" when disagreeing',
  'says "you know what I mean?"', 'laughs at their own jokes', 'sighs before bad news', 'says "fair enough"',
  'swears mildly when surprised', 'says "mind you" before a second thought', 'likes a good proverb',
];

/**
 * How someone talks, from their personality, age and values (stable per person: the same seed, the same voice).
 * The prompt's `speechStyle`; the procedural engine reads the same traits.
 */
export function speechStyleOf(world: World, id: ActorId): string {
  const t = traitsOf(world, id);
  const age = ageOf(world, id);
  const r = new Rng(deriveSeed(world.seed, 'voice', id));
  const parts: string[] = [];
  parts.push(t.extraversion > 0.68 ? 'Chatty and quick to share' : t.extraversion < 0.32 ? 'Quiet; answers in few words and rarely volunteers much' : 'Easy-going in conversation');
  if (t.agreeableness > 0.68) parts.push('warm and polite');
  else if (t.agreeableness < 0.32) parts.push('blunt, can be curt with people they do not like');
  if (t.neuroticism > 0.68) parts.push('worries out loud');
  if (t.openness > 0.68) parts.push('curious, asks questions back');
  else if (t.openness < 0.32) parts.push('plain-spoken, distrusts new ideas');
  if (t.conscientiousness < 0.32) parts.push('rambles and loses the thread');
  else if (t.conscientiousness > 0.75) parts.push('precise, likes to get things right');
  if (age < 13) parts.push('talks like a child: simple words, blunt questions');
  else if (age < 20) parts.push('talks like a teenager: casual, a little slang, embarrassed by adults');
  else if (age >= 70) parts.push('a few old-fashioned turns of phrase');
  if (valueOf(world, id, 0) < 0.3) parts.push('not above a white lie');
  if (valueOf(world, id, 3) > 0.75) parts.push('mentions their faith now and then');
  return `${parts.join(', ')}. ${capFirst(r.pick(VERBAL_HABITS))}.`;
}


/** A life event in the first person's own short words, or null if not worth telling. */
function eventLine(world: World, id: ActorId, e: LifeEvent): string | null {
  const other = e.other >= 0 ? nameOf(world, e.other) : '';
  const place = e.place >= 0 ? world.graph.places[e.place]?.name : '';
  if (e.who === id) {
    switch (e.kind) {
      case 'marriage': return other ? `Married ${other}` : 'Got married';
      case 'divorce': return other ? `Divorced ${other}` : 'Divorced';
      case 'breakup': return other ? `Broke up with ${other}` : 'Went through a break-up';
      case 'dating': return other ? `Started seeing ${other}` : null;
      case 'engagement': return other ? `Got engaged to ${other}` : 'Got engaged';
      case 'hired': return place ? `Started work at ${place}` : 'Started a new job';
      case 'fired': return place ? `Lost their job at ${place}` : 'Lost their job';
      case 'quit': return place ? `Quit their job at ${place}` : 'Quit their job';
      case 'retired': return 'Retired';
      case 'arrived': return 'Moved to town';
      case 'illness': return 'Was ill';
      case 'birth': return other ? `Had a baby, ${firstName(world, e.other)}` : null;
      case 'petAdopted': return other ? `Took in ${other}` : null;
      default: return null;
    }
  }
  if (e.other === id && e.kind === 'birth') return `${nameOf(world, e.who)} had a baby`;
  if (e.kind === 'death' && world.relations.isFamily(id, e.who)) return `Lost ${nameOf(world, e.who)} (family)`;
  return null;
}

const WHEN = (days: number) => days < 2 ? 'yesterday' : days < 14 ? `${Math.round(days)} days ago` : days < 60 ? `${Math.round(days / 7)} weeks ago` : days < 700 ? `${Math.round(days / 30)} months ago` : `${Math.round(days / 365)} years ago`;

/** A few sentences of life story from the sim: home and family, work, past events, clubs, where they stand. */
export function biographyOf(world: World, id: ActorId): string {
  const out: string[] = [];
  const hh = householdOf(world, id);
  const partner = partnerOf(world, id);
  // Who they live with, by what each is to them.
  const home = (bond: 'child' | 'parent' | null): ActorId[] => {
    const out: ActorId[] = [];
    for (const m of hh?.members ?? []) if (m !== id && isPerson(world, m) && (!bond || world.relations.has(id, m, bond))) out.push(m);
    return out;
  };
  const kids = home('child');
  const living: string[] = [];
  if (partner >= 0 && hh?.members.includes(partner)) living.push(`${world.relations.has(id, partner, 'spouse') ? 'spouse' : 'partner'} ${firstName(world, partner)}`);
  if (kids.length) living.push(`${kids.length === 1 ? 'child' : 'children'} ${kids.map((k) => `${firstName(world, k)} (${ageOf(world, k)})`).join(', ')}`);
  const parents = home('parent');
  if (parents.length) living.push(`${parents.length === 1 ? 'parent' : 'parents'} ${parents.map((p) => firstName(world, p)).join(' and ')}`);
  if (living.length) out.push(`Lives with ${living.join('; ')}.`);
  else if (hh && home(null).length === 0) out.push('Lives alone.');
  else if (partner >= 0) out.push(`In a relationship with ${nameOf(world, partner)}.`);
  if (hh?.animals.length) out.push(`Has ${hh.animals.map((p) => nameOf(world, p)).join(' and ')} at home.`);
  // Where they come from, kin out of town (their own standing knowledge).
  for (const s of standingOf(world, id)) if (s.fact.subject === id) out.push(capFirst(s.text.replace(nameOf(world, id), '').trim()) + '.');
  const today = world.clock / MINUTES_PER_DAY;
  const lines: string[] = [];
  for (let i = world.life.events.length - 1; i >= 0 && lines.length < 6; i--) {
    const e = world.life.events[i];
    if (today - e.day > 15 * 365) break;
    if (e.who !== id && e.other !== id && e.kind !== 'death') continue;
    const l = eventLine(world, id, e);
    if (l) lines.push(`${l} ${WHEN(today - e.day)}`);
  }
  if (lines.length) out.push(`${lines.join('. ')}.`);
  const groups = groupsOf(world, id);
  if (groups.length) out.push(`Belongs to ${groups.map((g) => `${g.group.name}${g.office ? ` (${g.office})` : ''}`).join(', ')}.`);
  const views = opinionsOf(world, id).filter((o) => Math.abs(o.stance) > 0.45).slice(0, 2);
  for (const v of views) out.push(`Feels ${Math.abs(v.stance) > 0.75 ? 'strongly ' : ''}${v.stance > 0 ? 'in favour of' : 'against'} ${v.what}.`);
  return out.join(' ');
}

/** The NPC card for `id` (plan §3.1). */
export function npcCard(world: World, id: ActorId): NpcCard {
  const values: Record<string, number> = {};
  VALUES.forEach((v, k) => { values[v] = valueOf(world, id, k); });
  const occupation = occupationOf(world, id);
  return {
    id, name: nameOf(world, id), age: ageOf(world, id), gender: world.actors.cols.sex[id] === FEMALE ? 'woman' : 'man',
    ...(occupation ? { occupation } : {}), ...(homeOf(world, id) ? { home: homeOf(world, id) } : {}),
    traits: traitsOf(world, id), values, speechStyle: speechStyleOf(world, id), biography: biographyOf(world, id),
  };
}

const EMOTION_WORDS: Record<(typeof EMOTIONS)[number], [string, string]> = {
  joy: ['pleased', 'delighted'], sadness: ['a bit down', 'sad'], anger: ['irritated', 'angry'], fear: ['uneasy', 'frightened'],
  surprise: ['surprised', 'shaken up'], disgust: ['put off', 'disgusted'],
};

/** How someone feels right now, in plain words ("tired, a bit irritable, hungry"), from mood, emotions and needs. */
export function moodOf(world: World, id: ActorId): { mood: string; needs: string } {
  const a = world.actors.cols;
  const words: string[] = [];
  const e = id * EMOTION_COUNT;
  const strong = EMOTIONS.map((k, i) => [k, a.emotions[e + i]] as const).filter(([, v]) => v > 0.2).sort((x, y) => y[1] - x[1]).slice(0, 2);
  for (const [k, v] of strong) words.push(EMOTION_WORDS[k][v > 0.55 ? 1 : 0]);
  const m = a.mood[id];
  if (!strong.length) words.push(m > 0.5 ? 'in a good mood' : m > 0.15 ? 'fine' : m > -0.2 ? 'so-so' : m > -0.5 ? 'in a low mood' : 'miserable');
  if (a.stress[id] > 0.6) words.push('stressed');
  const n = id * NEED_COUNT, needs: string[] = [];
  if (a.needs[n + N_REST] < 0.3) needs.push(a.needs[n + N_REST] < 0.12 ? 'exhausted' : 'tired');
  if (a.needs[n + N_FOOD] < 0.3) needs.push('hungry');
  if (a.needs[n + N_SOCIAL] < 0.25) needs.push('lonely, glad of company');
  return { mood: words.join(', '), needs: needs.join(', ') };
}

/** What someone is doing right now, in words ("walking to Elm Street Bakery to shop", "working at the garage"). */
export function activityOf(world: World, id: ActorId): string {
  const a = world.actors.cols, places = world.graph.places;
  if (a.dest[id] >= 0) return `on your way to ${places[a.dest[id]].name} (${ACTIVITY_WORDS[a.planned[id]] ?? ACTIVITIES[a.planned[id]]})`;
  const at = a.place[id] >= 0 ? places[a.place[id]] : null;
  const what = ACTIVITY_WORDS[a.activity[id]] ?? ACTIVITIES[a.activity[id]];
  return at ? `${what} at ${at.kind === 'street' ? at.street || at.name : at.name}` : what;
}

const ACTIVITY_WORDS: Partial<Record<number, string>> = {
  [A.idle]: 'passing the time', [A.work]: 'working', [A.school]: 'at school', [A.eat]: 'eating', [A.shop]: 'shopping',
  [A.socialize]: 'chatting', [A.leisure]: 'out for some free time', [A.errand]: 'on an errand', [A.worship]: 'at worship',
  [A.exercise]: 'exercising', [A.walkDog]: 'walking the dog', [A.visit]: 'visiting', [A.doctor]: 'seeing the doctor',
};

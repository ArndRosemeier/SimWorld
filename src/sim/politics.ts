/**
 * Local politics (plan R7, town-realism §4, track F): the mayor, the council and the issues the town argues about.
 * Politics is local only: whether to close the pool, build a bypass, let a housing estate onto the farmland.
 *
 * An issue comes up now and then and is talked about (news); the council votes on it at a monthly meeting a few
 * months later, each councillor by their own stance, and the vote is news that pleases some and angers others.
 * Every four years, on a Sunday in May, the town elects its mayor and its council: incumbents stand again or step
 * down, ambitious, well-known people stand against them, and each voter picks the candidate they like and agree
 * with most. A mayor who retires, dies or leaves brings a by-election.
 *
 * Stances are not stored: `stanceOf` derives them from personality, age, family, car and where one lives, plus a
 * fixed personal twist, so they are the same in the worker, in views and in the NPC card. The council's seats are
 * the members of the council group (src/sim/groups.ts); the mayor is whoever holds the town hall's mayor job.
 */
import { hashCombine, hashToFloat, type Rng } from '@futuremagic/core';
import { A, type ActorId } from './actors';
import { addOccasion } from './agenda';
import { dateOf, formatDate, gameDayOf, weekdayOfDays } from './calendar';
import { councilSeats, groupsOfKind, seat } from './groups';
import { addFact, broadcast, witness } from './knowledge';
import { closeTo, feel } from './life';
import { remember } from './memory';
import { T_CONSC, T_EXTRA, V_AMBITION, type Job } from './people';
import { liking } from './relations';
import { fitRoutine, settle } from './synth';
import { dayOf, MINUTES_PER_DAY } from './time';
import { ageOf, householdOf, isPerson, jobOf, nameOf, placesOf, tickRng, traitOf, valueOf, weighed, type Weights, type World } from './world';

// ---- the issues ------------------------------------------------------------------------------------------

/** What moves people on an issue: weights on who they are (positive = for). */
interface Drivers extends Weights {
  base: number;
  /** Per decade of age above 40 (negative: the young are more for it). */
  age?: number;
  /** Children under 16 at home. */
  kids?: number;
  /** The household has a car. */
  car?: number;
  /** Lives within a few minutes' walk of the town hall. */
  centre?: number;
}

interface IssueSpec { key: string; what: string; drivers: Drivers }

const ISSUES: IssueSpec[] = [
  { key: 'pool', what: 'closing the open-air pool', drivers: { base: -0.1, age: 0.15, kids: -0.9, consc: 0.4, open: -0.2 } },
  { key: 'bypass', what: 'building a bypass round the town', drivers: { base: 0, car: 0.5, centre: 0.6, open: -0.5, loyal: 0.1 } },
  { key: 'estate', what: 'a new housing estate on the farmland', drivers: { base: -0.1, ambition: 0.5, age: -0.15, open: 0.3, loyal: -0.5 } },
  { key: 'turbines', what: 'wind turbines on the ridge', drivers: { base: 0, open: 0.7, age: -0.12, loyal: -0.4 } },
  { key: 'speed', what: 'a 30 km/h limit through the centre', drivers: { base: 0, kids: 0.6, car: -0.5, centre: 0.5, neuro: 0.3 } },
  { key: 'parking', what: 'parking charges in the centre', drivers: { base: -0.2, car: -0.8, centre: 0.3, consc: 0.2 } },
  { key: 'skatepark', what: 'a skate park by the sports ground', drivers: { base: 0.1, age: -0.2, kids: 0.5, consc: -0.3, agree: 0.2 } },
  { key: 'library', what: 'cutting the library\'s opening hours', drivers: { base: -0.2, open: -0.7, consc: 0.4, age: -0.05 } },
  { key: 'lights', what: 'switching the street lights off after midnight', drivers: { base: 0, consc: 0.4, neuro: -0.7, age: -0.05 } },
  { key: 'rates', what: 'raising the local rates to mend the roads', drivers: { base: -0.3, car: 0.4, ambition: -0.3, consc: 0.3 } },
  { key: 'sunday', what: 'letting the shops open on Sundays', drivers: { base: 0, faith: -1, age: -0.1, ambition: 0.4, loyal: -0.2 } },
];

export interface Issue {
  key: string;
  what: string;
  /** Game day it came up, and of the council vote on it. */
  raised: number;
  vote: number;
  status: 'open' | 'passed' | 'rejected';
  /** Votes for and against when it was decided. */
  yes: number;
  no: number;
  /** The fact that it came up (and, once decided, of the vote). */
  fact: number;
  outcome: number;
}

export interface ElectionResult {
  day: number;
  /** Share of adults who voted. */
  turnout: number;
  /** Mayor candidates and their votes, the winner first (empty in a council-only count). */
  mayor: [ActorId, number][];
  /** Council candidates and their votes, the elected first. */
  council: [ActorId, number][];
  seats: number;
}

export interface Politics {
  issues: Issue[];
  /** Game day of the next election (council and mayor), and of a by-election for mayor (-1 if none). */
  election: number;
  byElection: number;
  /** Announced already (a month ahead), and who stands. */
  announced: boolean;
  slate: Slate | null;
  elections: ElectionResult[];
}

export const newPolitics = (): Politics => ({ issues: [], election: -1, byElection: -1, announced: false, slate: null, elections: [] });

/** Where someone stands on an issue: -1 dead against .. 1 all for it. Derived, never stored. */
export function stanceOf(world: World, id: ActorId, key: string): number {
  const spec = ISSUES.find((s) => s.key === key);
  if (!spec) return 0;
  const d = spec.drivers;
  const hh = householdOf(world, id);
  const kids = hh?.members.some((m) => m !== id && ageOf(world, m) < 16) ? 1 : 0;
  const hall = placesOf(world, ['townhall'])[0];
  const centre = hall !== undefined && world.travel.minutes(world.actors.cols.home[id], hall) <= 6 ? 1 : 0;
  const twist = hashToFloat(hashCombine(hashCombine(world.seed, id * 131 + 5), ISSUES.indexOf(spec))) - 0.5;
  const x = d.base + weighed(world, id, d, true)
    + (d.age ?? 0) * (ageOf(world, id) - 40) / 10 + (d.kids ?? 0) * kids + (d.car ?? 0) * (hh?.car ? 1 : 0) + (d.centre ?? 0) * centre
    + twist * 1.2;
  return Math.tanh(x * 1.5);
}

/** The live issues and where `id` stands on them, for views and the NPC card. */
export function opinionsOf(world: World, id: ActorId): { what: string; stance: number; status: Issue['status'] }[] {
  const day = dayOf(world.clock);
  return world.politics.issues.filter((i) => i.status === 'open' || day - i.vote < 365).map((i) => ({ what: i.what, stance: stanceOf(world, id, i.key), status: i.status }));
}

/** The mayor (holder of the town hall's mayor job), or -1. */
export const mayorOf = (world: World): ActorId => mayorJob(world)?.holder ?? -1;

const mayorJob = (world: World): Job | undefined => world.jobs.find((j) => j.role === 'mayor');

// ---- start and the daily process -------------------------------------------------------------------------

/** The election calendar at the start (`createWorld`, after the groups): the next one falls in the next four years. */
export function foundPolitics(world: World, rng: Rng): void {
  const date = dateOf(world, world.clock);
  let year = date.year + rng.int(0, 3);
  let day = electionDay(world, year);
  while (day <= dayOf(world.clock) + 40) { year += 4; day = electionDay(world, year); }
  world.politics.election = day;
  // The mayor at the start is in mid-term, young enough to finish it.
  const job = mayorJob(world);
  const council = groupsOfKind(world, 'council')[0];
  if (job && council && (job.holder < 0 || ageOf(world, job.holder) > 62)) {
    const pick = [...council.members].filter((id) => id !== job.holder && ageOf(world, id) >= 30 && ageOf(world, id) <= 62).sort((x, y) => standing(world, y) - standing(world, x))[0];
    if (pick !== undefined) appoint(world, pick, job, rng.fork('mayor'));
  }
}

/** The second Sunday in May of `year`, as a game day. */
function electionDay(world: World, year: number): number {
  let d = gameDayOf(world, year, 5, 8);
  while (weekdayOfDays(world.epoch + d) !== 6) d++;
  return d;
}

/** The first Monday of a month on or after game day `day` (the council meets then). */
function councilDay(world: World, day: number): number {
  const date = dateOf(world, day * MINUTES_PER_DAY);
  let d = gameDayOf(world, date.year, date.month, 1);
  while (weekdayOfDays(world.epoch + d) !== 0) d++;
  if (d < day || date.month === 8) return councilDay(world, gameDayOf(world, date.year + (date.month === 12 ? 1 : 0), (date.month % 12) + 1, 1));
  return d;
}

/** Daily (from `passDays`): votes and elections that are due, announcements, new issues, a mayor to replace. */
export function politicsDay(world: World, days: number): void {
  const pol = world.politics;
  if (pol.election < 0 || groupsOfKind(world, 'council').length === 0) return;
  const day = dayOf(world.clock);
  const rng = tickRng(world, 'politics');
  for (const issue of pol.issues) if (issue.status === 'open' && issue.vote <= day) vote(world, issue, rng.fork('vote', issue.raised));
  if (!pol.announced && pol.election - day <= 30) { callElection(world, pol.election, false, rng.fork('announce')); pol.announced = true; }
  if (day >= pol.election) {
    elect(world, pol.election, false, rng.fork('election'));
    pol.election = electionDay(world, dateOf(world, pol.election * MINUTES_PER_DAY).year + 4);
    pol.announced = false;
    pol.byElection = -1;
  }
  if (pol.byElection >= 0 && day >= pol.byElection) { elect(world, pol.byElection, true, rng.fork('by')); pol.byElection = -1; }
  // No mayor, and the next election is far off: a by-election in about six weeks.
  if (mayorOf(world) < 0 && pol.byElection < 0 && pol.election - day > 120) {
    let d = day + 42;
    while (weekdayOfDays(world.epoch + d) !== 6) d++;
    pol.byElection = d;
    callElection(world, d, true, rng.fork('announce-by'));
  }
  // Now and then a new issue, while there are not already two on the table.
  const open = pol.issues.filter((i) => i.status === 'open').length;
  if (open < 2 && rng.chance(1 - Math.exp(-days / 120))) raise(world, rng.fork('raise'));
}

function raise(world: World, rng: Rng): void {
  const day = dayOf(world.clock);
  const fresh = ISSUES.filter((s) => !world.politics.issues.some((i) => i.key === s.key && day - i.raised < 3 * 365));
  if (fresh.length === 0) return;
  const spec = fresh[rng.int(0, fresh.length - 1)];
  const fact = addFact(world, { topic: 'politics', text: `the council is talking about ${spec.what}`, magnitude: 0.55 });
  witness(world, fact, groupsOfKind(world, 'council')[0].members);
  broadcast(world, fact, 0.3);
  world.politics.issues.push({ key: spec.key, what: spec.what, raised: day, vote: councilDay(world, day + rng.int(45, 150)), status: 'open', yes: 0, no: 0, fact, outcome: -1 });
}

/** The council votes, each councillor by their stance; the mayor votes too. News, and feelings about it. */
function vote(world: World, issue: Issue, rng: Rng): void {
  const council = groupsOfKind(world, 'council')[0];
  let yes = 0, no = 0;
  for (const id of council.members) {
    if (!world.actors.cols.alive[id]) continue;
    const s = stanceOf(world, id, issue.key) + rng.range(-0.15, 0.15);
    if (s > 0) yes++; else no++;
    remember(world, id, { who: [], summary: `I voted ${s > 0 ? 'for' : 'against'} ${issue.what} in the council`, importance: 0.4, emotion: null });
  }
  issue.status = yes > no ? 'passed' : 'rejected';
  issue.yes = yes; issue.no = no;
  const text = yes > no ? `the council voted ${yes} to ${no} for ${issue.what}` : `the council voted ${no} to ${yes} against ${issue.what}`;
  issue.outcome = addFact(world, { topic: 'politics', text, place: council.place, magnitude: 0.6 });
  witness(world, issue.outcome, council.members);
  broadcast(world, issue.outcome, 0.35);
  // Those who cared and lost are angry; those who won are pleased (only the strongly minded).
  const sign = yes > no ? 1 : -1;
  for (let id = 0; id < world.actors.count; id++) {
    if (!isPerson(world, id) || !world.actors.cols.alive[id] || ageOf(world, id) < 16) continue;
    const s = stanceOf(world, id, issue.key) * sign;
    if (s < -0.7) feel(world, id, 'anger', 0.25);
    else if (s > 0.7) feel(world, id, 'joy', 0.15);
  }
}

// ---- elections -------------------------------------------------------------------------------------------

/** How well-placed someone is to stand: ambition, a public manner, and how many people know them. */
function standing(world: World, id: ActorId): number {
  const known = world.relations.known(id).length;
  return valueOf(world, id, V_AMBITION) * 0.9 + traitOf(world, id, T_EXTRA) * 0.4 + traitOf(world, id, T_CONSC) * 0.2 + Math.min(1, known / 60) * 0.5;
}

export interface Slate { mayor: ActorId[]; council: ActorId[] }

/** Who stands: most incumbents again, and ambitious, well-known people against them. Chosen when announced. */
function nominate(world: World, mayorOnly: boolean, rng: Rng): Slate {
  const council = groupsOfKind(world, 'council')[0];
  const seats = council.members.length;
  const mayor = mayorOf(world);
  const adults: ActorId[] = [];
  for (let id = 0; id < world.actors.count; id++) if (isPerson(world, id) && world.actors.cols.alive[id] && ageOf(world, id) >= 21 && ageOf(world, id) <= 78) adults.push(id);
  const pool = Array.from({ length: Math.min(250, adults.length) }, () => adults[rng.int(0, adults.length - 1)]);
  const ranked = [...new Set(pool)].sort((x, y) => standing(world, y) - standing(world, x));
  const again = (id: ActorId) => id >= 0 && ageOf(world, id) < 75 && rng.chance(0.85);
  // A mayor serves the whole term, so stands only young enough to finish it before retiring at 67.
  const young = (id: ActorId) => ageOf(world, id) <= 62;
  const m: ActorId[] = [];
  if (again(mayor) && young(mayor)) m.push(mayor);
  for (const id of [...council.members.filter((c) => c !== mayor).sort((x, y) => standing(world, y) - standing(world, x)), ...ranked]) {
    if (m.length >= 2 + (rng.chance(0.3) ? 1 : 0)) break;
    if (!m.includes(id) && young(id) && standing(world, id) > 0.9) m.push(id);
  }
  if (m.length === 0) { const y = ranked.find(young); if (y !== undefined) m.push(y); }
  if (mayorOnly) return { mayor: m, council: [] };
  const c = council.members.filter((id) => id !== mayor && again(id));
  for (const id of ranked) { if (c.length >= Math.round(seats * 1.6)) break; if (!c.includes(id) && !m.includes(id)) c.push(id); }
  return { mayor: m, council: c };
}

/** A month ahead (six weeks for a by-election): the date and the candidates are news; polling day goes into the agenda. */
function callElection(world: World, day: number, mayorOnly: boolean, rng: Rng): void {
  const s = nominate(world, mayorOnly, rng);
  world.politics.slate = s;
  const what = mayorOnly ? 'the election for a new mayor' : 'the town election';
  const fact = addFact(world, { topic: 'politics', text: `${what} is on ${formatDate(dateOf(world, day * MINUTES_PER_DAY))}`, magnitude: 0.5 });
  broadcast(world, fact, 0.5);
  for (const id of s.mayor) {
    const f = addFact(world, { topic: 'politics', text: '{subject} is standing for mayor', subject: id, magnitude: 0.55 });
    witness(world, f, closeTo(world, id));
    broadcast(world, f, 0.3);
    remember(world, id, { who: [], summary: 'I am standing for mayor', importance: 0.6, emotion: null, fact: f });
  }
  for (const id of s.council) remember(world, id, { who: [], summary: 'I am standing for the town council', importance: 0.45, emotion: null });
  const venue = placesOf(world, ['school'])[0] ?? placesOf(world, ['townhall'])[0];
  if (venue !== undefined) {
    const at = day * MINUTES_PER_DAY;
    addOccasion(world, { kind: 'meeting', name: what, place: venue, start: at + 8 * 60, end: at + 18 * 60, pull: 0.35, appeal: 'adults', guests: null, activity: A.errand, about: s.mayor });
  }
}

/** The count: every voter picks the candidate they like and agree with most. */
function elect(world: World, day: number, mayorOnly: boolean, rng: Rng): void {
  const s = world.politics.slate ?? nominate(world, mayorOnly, rng.fork('late'));
  world.politics.slate = null;
  const alive = (id: ActorId) => world.actors.cols.alive[id] === 1;
  const m = s.mayor.filter(alive), c = s.council.filter(alive);
  if (m.length === 0) return;
  const issues = world.politics.issues.filter((i) => i.status === 'open' || day - i.vote < 365).map((i) => i.key);
  const stances = new Map<ActorId, number[]>();
  const view = (id: ActorId) => { let v = stances.get(id); if (!v) { v = issues.map((k) => stanceOf(world, id, k)); stances.set(id, v); } return v; };
  const mayor = mayorOf(world);
  const council = groupsOfKind(world, 'council')[0];
  const appeal = (v: ActorId, cand: ActorId) => {
    const a = view(v), b = view(cand);
    let agree = 0;
    for (let k = 0; k < issues.length; k++) agree += 1 - Math.abs(a[k] - b[k]) / 2;
    return liking(world.relations, v, cand) * 1.2 + (issues.length ? agree / issues.length : 0.5) * 1.2 + standing(world, cand) * 0.6
      + (cand === mayor || council.members.includes(cand) ? 0.15 : 0) + rng.range(0, 0.25);
  };
  const mv = new Map<ActorId, number>(), cv = new Map<ActorId, number>();
  let voters = 0, adults = 0, people = 0;
  for (let v = 0; v < world.actors.count; v++) {
    if (!isPerson(world, v) || !alive(v)) continue;
    people++;
    if (ageOf(world, v) < 18) continue;
    adults++;
    if (!rng.chance(0.3 + traitOf(world, v, T_CONSC) * 0.35 + (ageOf(world, v) >= 50 ? 0.12 : 0) - (mayorOnly ? 0.1 : 0))) continue;
    voters++;
    const best = (list: ActorId[]) => { let b = list[0], bw = -Infinity; for (const x of list) { const w = appeal(v, x); if (w > bw) { bw = w; b = x; } } return b; };
    const pick = best(m);
    mv.set(pick, (mv.get(pick) ?? 0) + 1);
    if (c.length) { const x = best(c); cv.set(x, (cv.get(x) ?? 0) + 1); }
  }
  const order = (list: ActorId[], votes: Map<ActorId, number>) => list.map((id) => [id, votes.get(id) ?? 0] as [ActorId, number]).sort((x, y) => y[1] - x[1] || x[0] - y[0]);
  const mayorVotes = order(m, mv);
  const seats = mayorOnly ? 0 : councilSeats(people);
  const councilVotes = order(c, cv);
  world.politics.elections.push({ day, turnout: voters / Math.max(1, adults), mayor: mayorVotes, council: councilVotes, seats });
  const winner = mayorVotes[0][0];
  const share = Math.round((100 * mayorVotes[0][1]) / Math.max(1, voters));
  const job = mayorJob(world);
  // The news: the mayor first.
  const text = winner === mayor ? `{subject} was re-elected mayor with ${share}% of the vote` : mayor >= 0 && m.includes(mayor) ? `{subject} beat {object} to become mayor, with ${share}% of the vote` : `{subject} was elected mayor with ${share}% of the vote`;
  const fact = addFact(world, { topic: 'politics', text, subject: winner, object: winner !== mayor && m.includes(mayor) ? mayor : -1, magnitude: 0.8 });
  witness(world, fact, [...closeTo(world, ...m), ...council.members]);
  broadcast(world, fact, 0.6);
  remember(world, winner, { who: [], summary: winner === mayor ? 'I was re-elected mayor' : 'I was elected mayor', importance: 1, emotion: 'joy', fact });
  for (const [id] of mayorVotes.slice(1)) { remember(world, id, { who: [winner], summary: `I lost the election for mayor to ${nameOf(world, winner)}`, importance: 0.8, emotion: 'sadness', fact }); feel(world, id, 'sadness', 0.4); }
  if (job && job.holder !== winner) appoint(world, winner, job, rng.fork('appoint'));
  if (mayorOnly) return;
  const elected = councilVotes.slice(0, seats).map(([id]) => id);
  for (const id of elected) {
    if (council.members.includes(id)) continue;
    const f = addFact(world, { topic: 'politics', text: '{subject} was elected to the town council', subject: id, magnitude: 0.4 });
    witness(world, f, closeTo(world, id));
    broadcast(world, f, 0.1);
    remember(world, id, { who: [], summary: 'I was elected to the town council', importance: 0.8, emotion: 'joy', fact: f });
  }
  for (const id of council.members) if (id !== winner && id !== mayor && !elected.includes(id) && c.includes(id)) remember(world, id, { who: [], summary: 'I lost my seat on the town council', importance: 0.7, emotion: 'sadness' });
  seat(world, council, [...elected, winner]);
}

/** The new mayor takes the post (leaving their old job); the old one is out of it. */
function appoint(world: World, id: ActorId, job: Job, rng: Rng): void {
  const pc = world.people.cols, row = world.actors.cols.row;
  if (job.holder >= 0) { pc.job[row[job.holder]] = -1; fitRoutine(world, job.holder, rng.fork('old')); }
  const old = jobOf(world, id);
  if (old) old.holder = -1;
  job.holder = id;
  pc.job[row[id]] = job.id;
  settle(world, id, rng.fork('new'));
}

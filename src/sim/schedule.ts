/**
 * Schedules (plan §1.1): what each actor does next. A person's day is anchored by their chronotype, job shift,
 * school and the household's dinner; between anchors, needs, habits and personality pick what to do. Intentions
 * (src/sim/intentions.ts) override the routine. Decisions are event-driven: an actor decides only when the current
 * activity ends (`until`), so a tick costs almost nothing for people who are busy.
 */
import { hashCombine } from '@futuremagic/core';
import type { Rng } from '@futuremagic/core';
import { A, ACTOR_PERSON, type ActorId } from './actors';
import { performIntention } from './actions';
import { activeIntention, avoids } from './intentions';
import { urgentNeed } from './needs';
import { HABITS, HABIT_COUNT, T_CONSC, T_EXTRA, T_OPEN, V_FAITH } from './people';
import { KINDS, type Service } from './placeKinds';
import type { Trip } from './travel';
import type { DayMask, PlaceId, PlaceKind } from './places';
import type { Job } from './people';
import { awakeAt, NEED_COUNT, N_FOOD, N_FUN, N_HYGIENE, N_REST, N_SOCIAL, SPECIES, speciesId } from './species';
import { atMinute, MINUTES_PER_DAY, minuteOfDay, weekdayOf } from './time';
import { eve, feast, runsLike, schoolDay, sunAt } from './calendar';
import { ageOf, commute, hasCar, householdOf, jobOf, placesOf, placesWith, tickRng, type World } from './world';

/** Does a weekday mask include weekday `wd`? */
const onMask = (mask: DayMask, wd: number) => ((mask >> wd) & 1) === 1;

/** Kinds that open on Christmas Day and New Year's Day (with their Sunday hours); everything else with hours is shut. */
const FEAST_OPEN = new Set<PlaceKind>(['church', 'cemetery', 'pub', 'restaurant', 'park', 'square']);
/** Kinds that close at 14:00 on Christmas Eve and New Year's Eve. */
const EVE_EARLY = new Set(['food', 'service']);

/** Does the place open at all on the day of `clock` (holidays and school terms considered)? */
function opensOn(world: World, place: PlaceId, clock: number): boolean {
  const kind = world.graph.places[place].kind;
  if (feast(world, clock) && !FEAST_OPEN.has(kind)) return false;
  return kind !== 'school' || schoolDay(world, clock);
}

/**
 * Is a place open to visitors at `clock`? Places without hours are always open. The week is read through the
 * calendar: public holidays keep Sunday hours, Christmas Day and New Year's Day shut nearly everything, the eves close
 * the shops early, and the school is shut in the holidays.
 */
export function isOpen(world: World, place: PlaceId, clock: number): boolean {
  const pl = world.graph.places[place];
  if (pl.hours.length === 0) return true;
  const m = minuteOfDay(clock);
  const prev = clock - MINUTES_PER_DAY;
  for (const h of pl.hours) {
    if (m >= h.open && m < h.close && onMask(h.days, runsLike(world, clock)) && opensOn(world, place, clock)) {
      return !(m >= 840 && EVE_EARLY.has(KINDS[pl.kind].category) && pl.kind !== 'pub' && pl.kind !== 'restaurant' && eve(world, clock));
    }
    // A window that runs past midnight, started yesterday.
    if (h.close > MINUTES_PER_DAY && m + MINUTES_PER_DAY < h.close && onMask(h.days, runsLike(world, prev)) && opensOn(world, place, prev)) return true;
  }
  return false;
}

/** Is the day of `clock` a working day of `job`? Holidays run like Sundays; staff of places shut for a feast stay home. */
export function worksOn(world: World, job: Job, clock: number): boolean {
  if (!onMask(job.days, runsLike(world, clock))) return false;
  return world.graph.places[job.place].hours.length === 0 || opensOn(world, job.place, clock);
}

/** Activities that take dependents (small children, the dog) along. */
const OUTINGS = new Set<number>([A.leisure, A.shop, A.worship, A.visit, A.walkDog, A.socialize, A.exercise]);

/** Actors who have arrived where they were going start what they planned. */
export function arrive(world: World): void {
  const a = world.actors.cols;
  for (let id = 0; id < world.actors.count; id++) {
    if (a.dest[id] >= 0 && a.arrive[id] <= world.clock) {
      a.place[id] = a.dest[id];
      a.dest[id] = -1;
      a.activity[id] = a.planned[id];
    }
  }
  // Drop the trips that are over: arrived, or replaced by a new plan on the way.
  const trips = world.trips;
  let n = 0;
  for (const t of trips) if (a.dest[t.who] === t.to && a.arrive[t.who] === t.arrive && a.alive[t.who]) trips[n++] = t;
  trips.length = n;
}

/** Everyone whose activity has ended decides what to do next. */
export function decideAll(world: World): void {
  const a = world.actors.cols;
  for (let id = 0; id < world.actors.count; id++) {
    if (!a.alive[id] || a.dest[id] >= 0 || a.until[id] > world.clock) continue;
    if (a.with[id] >= 0 && follow(world, id)) continue;
    if (a.kind[id] === ACTOR_PERSON) decidePerson(world, id);
    else decideAnimal(world, id);
  }
}

/**
 * Start `activity` at `place` until `until` (travelling there first if needed), and bring followers along.
 * The single way an actor's location and activity change.
 */
export function go(world: World, id: ActorId, place: PlaceId, activity: number, until: number): void {
  const a = world.actors.cols;
  const now = world.clock;
  const from = a.place[id] >= 0 ? a.place[id] : a.home[id];
  // Reconsider when the next planned intention comes due.
  const stack = world.intentions[id];
  if (stack) for (const i of stack) if (i.kind !== 'avoid' && i.at > now && i.at < until) until = i.at;
  if (place < 0 || place === from) {
    if (a.place[id] < 0) a.place[id] = from;
    a.activity[id] = activity;
    a.until[id] = Math.max(until, now + 5);
  } else {
    const car = hasCar(world, id);
    const t = world.travel.minutes(from, place, car);
    world.trips.push({ who: id, from, to: place, depart: now, arrive: now + t, mode: world.travel.mode(from, place, car), leader: -1 });
    a.dest[id] = place;
    a.arrive[id] = now + t;
    const street = world.streetOf[place];
    a.place[id] = street >= 0 ? street : world.streetOf[from];
    a.activity[id] = A.travel;
    a.planned[id] = activity;
    a.until[id] = Math.max(until, now + t + 5);
  }
  leadFollowers(world, id);
}


/** Copy the leader's movement to everyone who goes with them, or release them when the outing is over. */
function leadFollowers(world: World, leader: ActorId): void {
  const a = world.actors.cols;
  const hh = householdOf(world, leader);
  if (!hh) return;
  const outing = OUTINGS.has(a.dest[leader] >= 0 ? a.planned[leader] : a.activity[leader]);
  let trip: Trip | undefined;
  if (a.dest[leader] >= 0) for (let i = world.trips.length - 1; i >= 0 && !trip; i--) if (world.trips[i].who === leader) trip = world.trips[i];
  for (const list of [hh.members, hh.animals]) for (const f of list) {
    if (a.with[f] !== leader) continue;
    if (!outing) { a.with[f] = -1; a.until[f] = world.clock; continue; }
    // They ride or walk along: one car, one group on the pavement.
    if (trip && a.dest[f] !== trip.to) world.trips.push({ ...trip, who: f, leader });
    a.place[f] = a.place[leader]; a.dest[f] = a.dest[leader]; a.arrive[f] = a.arrive[leader];
    a.activity[f] = a.activity[leader]; a.planned[f] = a.planned[leader]; a.until[f] = a.until[leader];
  }
}

/** A follower whose time is up: keeps following if the leader is still out, else is released. */
function follow(world: World, id: ActorId): boolean {
  const a = world.actors.cols;
  const leader = a.with[id];
  // Hungry, worn out, or (for a child) past bedtime: they head home, whatever the leader does.
  const tired = a.kind[id] === ACTOR_PERSON && !inWindow(minuteOfDay(world.clock), world.people.cols.wake[a.row[id]], world.people.cols.sleep[a.row[id]]);
  if (tired || urgentNeed(world, id) >= 0 || a.needs[id * NEED_COUNT + N_FOOD] < 0.3) { a.with[id] = -1; return false; }
  if (OUTINGS.has(a.dest[leader] >= 0 ? a.planned[leader] : a.activity[leader]) && a.until[leader] > world.clock) {
    a.until[id] = a.until[leader];
    return true;
  }
  a.with[id] = -1;
  return false;
}

/** Small children and the dog come along on an outing from home. */
function takeAlong(world: World, leader: ActorId, activity: number, rng: Rng): void {
  const a = world.actors.cols;
  const hh = householdOf(world, leader);
  if (!hh || a.place[leader] !== hh.home) return;
  const dog = speciesId('dog');
  for (const m of hh.members) {
    if (m === leader || a.place[m] !== hh.home || a.activity[m] === A.sleep || a.with[m] >= 0 || a.dest[m] >= 0) continue;
    if (ageOf(world, m) >= 10) continue;
    const adultHome = hh.members.some((o) => o !== leader && a.place[o] === hh.home && a.dest[o] < 0 && ageOf(world, o) >= 16 && a.activity[o] !== A.sleep);
    if (!adultHome || rng.chance(0.5)) a.with[m] = leader;
  }
  for (const an of hh.animals) {
    if (a.species[an] !== dog || a.place[an] !== hh.home || a.activity[an] === A.sleep) continue;
    if (activity === A.walkDog || (activity === A.leisure && rng.chance(0.3))) a.with[an] = leader;
  }
}


// ---- people ----------------------------------------------------------------------------------------------

/** The household's dinner time (18:00-19:30), stable per household. */
const dinnerAt = (world: World, hh: number) => 1080 + (hashCombine(world.seed, hh) % 7) * 15;

/** Clock of the next time minute-of-day `m` comes round (today if still ahead, else tomorrow). */
const nextAt = (now: number, m: number) => {
  const t = atMinute(now, ((m % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY);
  return t > now ? t : t + MINUTES_PER_DAY;
};

/** Is minute-of-day `m` inside the awake window [wake, sleep) (which may wrap past midnight)? */
const inWindow = (m: number, wake: number, sleep: number) => (wake <= sleep ? m >= wake && m < sleep : m >= wake || m < sleep);

interface Day { wake: number; sleep: number; shift: [number, number] | null; school: [number, number] | null }

/** Today's anchors for a person (absolute clocks where it matters). */
function anchors(world: World, id: ActorId): Day {
  const a = world.actors.cols, pc = world.people.cols, p = a.row[id];
  const now = world.clock;
  const weekend = runsLike(world, now) >= 5;
  const job = jobOf(world, id);
  let wake = pc.wake[p];
  // Lie-in on days off.
  if (!job || !worksOn(world, job, now)) { if (weekend && ageOf(world, id) >= 10) wake += 60; }
  let shift: [number, number] | null = null;
  if (job && pc.leaveUntil[p] <= now) {
    const travelTime = commute(world, id, job.place);
    for (const d of [0, -1]) {
      const day = now + d * MINUTES_PER_DAY;
      if (!worksOn(world, job, day)) continue;
      const s = atMinute(day, job.start), e = atMinute(day, job.end);
      if (now >= s - travelTime - 5 && now < e) { shift = [s, e]; break; }
    }
  }
  let school: [number, number] | null = null;
  if (pc.school[p] >= 0 && pc.leaveUntil[p] <= now && (world.graph.places[pc.school[p]].kind === 'school' ? schoolDay(world, now) : runsLike(world, now) < 5)) {
    const kg = world.graph.places[pc.school[p]].kind === 'kindergarten';
    const age = ageOf(world, id);
    const s = atMinute(now, kg ? 450 : 465), e = atMinute(now, kg ? 870 : age < 10 ? 780 : 915);
    const commute = world.travel.minutes(a.home[id], pc.school[p]);
    if (now >= s - commute - 5 && now < e) school = [s, e];
  }
  return { wake, sleep: pc.sleep[p], shift, school };
}

function decidePerson(world: World, id: ActorId): void {
  const a = world.actors.cols, pc = world.people.cols, p = a.row[id];
  const now = world.clock, m = minuteOfDay(now);
  const home = a.home[id];
  const here = a.place[id];
  const rng = tickRng(world, 'decide', id);
  const day = anchors(world, id);
  const awake = inWindow(m, day.wake, day.sleep);
  const needs = (n: number) => a.needs[id * NEED_COUNT + n];
  const age = ageOf(world, id);

  // 1. Intentions win over the routine (but not over sleep, unless they are urgent).
  const intent = activeIntention(world, id);
  if (intent && (awake || intent.priority >= 70) && performIntention(world, id, intent)) return;

  // 2. Sleep (not on an empty stomach).
  if (!awake && needs(N_FOOD) < 0.35 && a.activity[id] !== A.eat && a.activity[id] !== A.sleep) {
    go(world, id, home, A.eat, now + 15);
    return;
  }
  if (!awake) {
    go(world, id, home, A.sleep, nextAt(now, day.wake));
    return;
  }
  const bedtime = nextAt(now, day.sleep);

  // 2b. Ill: stay home in bed, up only to eat.
  if (a.health[id] < 0.5 && a.kind[id] === ACTOR_PERSON) {
    if (needs(N_FOOD) < 0.4) go(world, id, home, A.eat, now + 20);
    else go(world, id, home, A.sleep, Math.min(bedtime, now + 120));
    return;
  }

  // 3. Work and school.
  const job = jobOf(world, id);
  if (day.shift && job) {
    const [, end] = day.shift;
    if (here === job.place && ((m >= 720 && m < 810 && needs(N_FOOD) < 0.7) || needs(N_FOOD) < 0.4) && end - now > 60) {
      go(world, id, job.place, A.eat, now + 30); // meal break
      return;
    }
    // Work in stretches of at most three hours, so meal breaks and intentions get a look in.
    const commute = here === job.place ? 0 : world.travel.minutes(here, job.place, hasCar(world, id));
    go(world, id, job.place, A.work, Math.min(end, now + commute + 180, m < 720 && here === job.place ? atMinute(now, 720) : end));
    return;
  }
  if (day.school) {
    go(world, id, pc.school[p], A.school, day.school[1]);
    return;
  }

  // 4. Urgent needs.
  const urgent = urgentNeed(world, id);
  if (urgent === N_FOOD) { eatSomewhere(world, id, rng); return; }
  if (urgent === N_REST) { go(world, id, home, A.sleep, now + 90); return; }
  if (urgent === N_HYGIENE) { go(world, id, home, A.wash, now + 20); return; }

  // 5. Morning routine at home.
  const sinceWake = (m - day.wake + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  if (here === home && sinceWake < 60) {
    if (needs(N_HYGIENE) < 0.75) { go(world, id, home, A.wash, now + 15); return; }
    if (needs(N_FOOD) < 0.8) { go(world, id, home, A.eat, now + 20); return; }
  }

  // 6. Dinner with the household.
  const hh = pc.household[p];
  const dinner = hh >= 0 ? dinnerAt(world, hh) : 1110;
  if (m >= dinner && m < dinner + 75 && needs(N_FOOD) < 0.8) { go(world, id, home, A.eat, now + 40); return; }
  if (m >= 690 && m < 810 && needs(N_FOOD) < 0.55) { eatSomewhere(world, id, rng); return; }

  // 7. Free time until the next anchor.
  let limit = bedtime;
  if (job) for (const d of [0, 1]) {
    const day2 = now + d * MINUTES_PER_DAY;
    if (!worksOn(world, job, day2)) continue;
    const s = atMinute(day2, job.start) - world.travel.minutes(home, job.place, hasCar(world, id)) - 5;
    if (s > now) { limit = Math.min(limit, s); break; }
  }
  if (m < dinner) limit = Math.min(limit, atMinute(now, dinner));
  const free = limit - now;
  if (free < 20) { go(world, id, here === home || free < 10 ? here : home, A.idle, limit); return; }
  freeTime(world, id, age, limit, rng);
}

/** Eat at home if it is close, else at the nearest open place that serves food. */
function eatSomewhere(world: World, id: ActorId, rng: Rng): void {
  const a = world.actors.cols;
  const here = a.place[id] >= 0 ? a.place[id] : a.home[id];
  if (world.travel.minutes(here, a.home[id]) <= 10 || rng.chance(0.5)) { go(world, id, a.home[id], A.eat, world.clock + 30); return; }
  const place = nearestWith(world, here, 'eat', id);
  go(world, id, place >= 0 ? place : a.home[id], A.eat, world.clock + 35);
}

/** Nearest open place offering `service` that `id` is not avoiding, or -1. */
export function nearestWith(world: World, from: PlaceId, service: Service, id: ActorId): PlaceId {
  const open = placesWith(world, service).filter((pl) => isOpen(world, pl, world.clock + 10) && !avoids(world, id, -1, pl));
  return world.travel.nearest(from, open);
}


interface Option { place: PlaceId; activity: number; minutes: [number, number]; weight: number }

/** Pick a free-time activity from needs, habits and personality (plan §1.3). */
function freeTime(world: World, id: ActorId, age: number, limit: number, rng: Rng): void {
  const a = world.actors.cols, pc = world.people.cols, p = a.row[id];
  const now = world.clock, m = minuteOfDay(now);
  const home = a.home[id];
  const here = a.place[id] >= 0 ? a.place[id] : home;
  const t = (k: number) => pc.traits[p * 5 + k];
  const need = (n: number) => 1 - a.needs[id * NEED_COUNT + n];
  // The park while it is light; the dog goes out in the dark too, but not in the small hours.
  const sun = sunAt(world, now);
  const daylight = m >= sun.rise + 30 && m < sun.set;
  const dogHours = m >= 390 && m < 1290;
  const options: Option[] = [];
  const offer = (place: PlaceId, activity: number, minutes: [number, number], weight: number) => {
    if (place < 0 || weight <= 0 || avoids(world, id, -1, place)) return;
    if (place !== home && !isOpen(world, place, now + 15)) return;
    // Do not start an outing that would barely fit.
    if (place !== here && world.travel.minutes(here, place) * 2 + minutes[0] > limit - now) return;
    options.push({ place, activity, minutes, weight });
  };
  const evening = m >= 1200;
  offer(home, A.idle, [30, 90], 1 + need(N_REST) * 2 + (1 - t(T_EXTRA)) * 0.8 + (evening ? 2 : 0) + (age < 10 ? 4 : 0));
  if (age >= 10) {
    const habit = (h: string) => pc.habits[p * HABIT_COUNT + HABITS.indexOf(h as never)];
    const social = need(N_SOCIAL), fun = need(N_FUN);
    offer(habit('cafe'), A.socialize, [30, 75], (0.2 + social * 1.5) * (0.4 + t(T_EXTRA)) * (m < 1080 ? 1 : 0.2));
    const weekendNight = [4, 5].includes(weekdayOf(now)) ? 1.6 : 1;
    if (age >= 18) offer(habit('pub'), A.socialize, [60, 180], (0.15 + social * 1.6) * (0.3 + t(T_EXTRA)) * weekendNight * (m >= 1050 ? 1 : 0));
    if (daylight) offer(habit('park'), A.leisure, [30, 90], (0.2 + fun * 1.2) * (0.5 + t(T_OPEN)));
    offer(habit('sports'), A.exercise, [45, 100], (0.1 + fun) * t(T_CONSC) * (age < 70 ? 1 : 0.2));
    const faith = pc.values[p * 4 + V_FAITH];
    const service = runsLike(world, now) === 6 && m >= 540 && m < 600;
    offer(habit('church'), A.worship, service ? [70, 90] : [20, 40], service ? 8 * faith : 0.05 * faith);
    offer(habit('library'), A.leisure, [30, 90], 0.4 * t(T_OPEN));
    if (age >= 16 && m >= 480 && m < 1170) offer(habit('shop'), A.shop, [20, 45], 0.5);
    // A bakery run in the morning.
    if (m < 600) { const b = nearestWith(world, here, 'shop', id); if (b >= 0 && world.graph.places[b].kind === 'bakery') offer(b, A.shop, [10, 20], 0.5); }
    // Errands: the post office, the bank, the pharmacy, the hairdresser.
    if (age >= 16 && rng.chance(0.15)) {
      const list = placesWith(world, 'errand');
      if (list.length) offer(list[rng.int(0, list.length - 1)], A.errand, [15, 35], 0.6);
    }
    // Visit someone they like who lives elsewhere.
    if (m >= 600 && m < 1260) {
      const friend = someoneToVisit(world, id, rng);
      if (friend >= 0) offer(a.home[friend], A.visit, [60, 150], 0.3 + social * 1.6);
    }
    // Walk the dog.
    const hh = householdOf(world, id);
    if (hh && dogHours) {
      const dog = speciesId('dog');
      for (const an of hh.animals) {
        if (a.species[an] !== dog || a.place[an] !== hh.home || a.with[an] >= 0) continue;
        const keeper = world.animals.cols.keeper[a.row[an]] === id;
        const restless = 1 - a.needs[an * NEED_COUNT + N_FUN];
        const walk = placesOf(world, ['park', 'woods']);
        const target = walk.length ? walk.reduce((b, x) => (world.travel.minutes(home, x) < world.travel.minutes(home, b) ? x : b)) : world.streetOf[home];
        offer(target, A.walkDog, [25, 50], restless * (keeper ? 6 : 1.5));
        break;
      }
    }
  }
  if (options.length === 0) { go(world, id, home, A.idle, limit); return; }
  const pick = rng.weighted(options, (o) => o.weight);
  const until = Math.min(limit, now + world.travel.minutes(here, pick.place) + rng.int(pick.minutes[0], pick.minutes[1]));
  if (OUTINGS.has(pick.activity)) takeAlong(world, id, pick.activity, rng);
  go(world, id, pick.place, pick.activity, until);
}

/** A friend or relative living elsewhere, picked by affection. -1 if none. */
function someoneToVisit(world: World, id: ActorId, rng: Rng): ActorId {
  const rel = world.relations, c = rel.t.cols, a = world.actors.cols;
  let best = -1, bs = 0;
  for (const r of rel.known(id)) {
    const o = c.to[r];
    if (a.kind[o] !== ACTOR_PERSON || a.home[o] === a.home[id] || c.affection[r] < 0.3 || c.familiarity[r] < 0.5) continue;
    const s = c.affection[r] * rng.float();
    if (s > bs) { bs = s; best = o; }
  }
  return best;
}

// ---- animals ---------------------------------------------------------------------------------------------

const ROAM: Record<string, readonly PlaceKind[]> = {
  fox: ['street', 'park', 'field', 'woods'],
  deer: ['field', 'woods'],
  hedgehog: ['park', 'street'],
  owl: ['park', 'woods', 'cemetery', 'field'],
  cat: ['street'],
};

function decideAnimal(world: World, id: ActorId): void {
  const a = world.actors.cols;
  const sp = SPECIES[a.species[id]];
  const now = world.clock, m = minuteOfDay(now);
  const home = a.home[id];
  const rng = tickRng(world, 'decide', id);
  if (!awakeAt(sp, m)) {
    // Sleep until the next waking minute (step in half-hours so a wrapped window is found cheaply).
    let t = now + 30;
    while (!awakeAt(sp, minuteOfDay(t)) && t < now + MINUTES_PER_DAY) t += 30;
    go(world, id, home, A.sleep, t);
    return;
  }
  const hungry = a.needs[id * NEED_COUNT + N_FOOD] < 0.5;
  if (sp.class === 'pet') {
    const hh = householdOf(world, id);
    const fed = (m >= 420 && m < 510) || (m >= 1080 && m < 1170);
    if (hungry && fed && hh && hh.members.some((x) => a.place[x] === hh.home)) { go(world, id, home, A.eat, now + 15); return; }
    const roam = ROAM[sp.name];
    if (roam && rng.chance(0.4)) { const s = world.streetOf[home]; if (s >= 0) { go(world, id, s, A.roam, now + rng.int(30, 90)); return; } }
    go(world, id, home, A.idle, now + rng.int(45, 120));
    return;
  }
  if (sp.class === 'livestock') {
    const field = farmField(world, home);
    if (sp.name !== 'chicken' && field >= 0 && m < 1140) { go(world, id, field, A.graze, Math.min(now + rng.int(90, 180), atMinute(now, 1140))); return; }
    go(world, id, home, hungry ? A.graze : A.idle, now + rng.int(60, 120));
    return;
  }
  // Wildlife roams its range while awake.
  const range = placesOf(world, ROAM[sp.name] ?? ['woods']);
  const near = range.filter((pl) => world.travel.minutes(home, pl) < 25);
  const pick = near.length && rng.chance(0.7) ? near[rng.int(0, near.length - 1)] : home;
  go(world, id, pick, A.roam, now + rng.int(60, 180));
}

/** The field belonging to a farm (same road node), -1 if none. */
function farmField(world: World, farm: PlaceId): PlaceId {
  const n = world.graph.places[farm].node;
  for (const id of placesOf(world, ['field'])) if (world.graph.places[id].node === n) return id;
  return -1;
}


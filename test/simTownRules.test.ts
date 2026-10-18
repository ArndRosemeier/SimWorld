import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testTown } from '../src/sim/testTown';
import { createWorld } from '../src/sim/synth';
import { budgetOf, LOOK_TO_LET } from '../src/sim/economy';
import { rulesOf } from '../src/sim/politics';
import { isOpen } from '../src/sim/schedule';
import { PLACE_KINDS } from '../src/sim/places';
import { weekdayOfDays } from '../src/sim/calendar';
import { viewOf } from '../src/sim/view';
import { passDays, placesOf, type World } from '../src/sim/world';

/** Whole days in weekly steps, slow processes only (the chronicle's coarse mode without conversations). */
function weeks(world: World, n: number): void {
  for (let k = 0; k < n; k++) {
    world.clock = (Math.floor(world.clock / 1440) + 7) * 1440;
    passDays(world, 7);
  }
}

const today = (w: World) => Math.floor(w.clock / 1440);
const news = (w: World, from: number) => w.knowledge.facts.slice(from).filter((f) => f.topic === 'politics' && f.root === f.id).map((f) => f.text);
/** The next Sunday at `hour` (a game day that runs like a Sunday: no holiday in the test's first months). */
function sundayAt(w: World, hour: number): number {
  let d = today(w) + 1;
  while (weekdayOfDays(w.epoch + d) !== 6) d++;
  return d * 1440 + hour * 60;
}

test('town rules: Sunday trading and the library cut change the hours and the jobs, and the town hears of it', () => {
  const w = createWorld(testTown(43, 1000), 43);
  const shop = placesOf(w, ['supermarket'])[0];
  const library = placesOf(w, ['library'])[0];
  assert.ok(shop !== undefined && library !== undefined);
  const sunday = sundayAt(w, 12);
  assert.ok(!isOpen(w, shop, sunday), 'shut on Sundays before the vote');
  const jobs = w.jobs.length, facts = w.knowledge.facts.length;
  w.politics.due.push({ key: 'sunday', day: today(w) + 1 }, { key: 'library', day: today(w) + 1 });
  weeks(w, 1);
  const rules = rulesOf(w);
  assert.ok(rules.sundayShops && rules.libraryCut);
  assert.ok(isOpen(w, shop, sundayAt(w, 12)), 'the supermarket opens on Sunday afternoons');
  assert.ok(!isOpen(w, shop, sundayAt(w, 9)), 'but not on Sunday mornings');
  const sundayJobs = w.jobs.slice(jobs);
  assert.ok(sundayJobs.length >= 3 && sundayJobs.every((j) => j.days === 1 << 6));
  assert.ok(w.graph.places[library].hours.every((h) => !(h.days & 0b1010) && h.close <= 17 * 60), 'the library shuts on Tuesdays and Thursdays and at five');
  assert.ok(w.jobs.filter((j) => j.place === library).every((j) => !(j.days & 0b1010)));
  const heard = news(w, facts);
  assert.ok(heard.some((t) => t.includes('Sunday')) && heard.some((t) => t.includes('library')), heard.join(' | '));
  // The Sunday shifts are vacancies like any other: within a few weeks some are filled.
  weeks(w, 6);
  assert.ok(sundayJobs.some((j) => j.holder >= 0), 'nobody took a Sunday shift');
  // The view carries the rules.
  assert.ok(viewOf(w, true).town!.rules.sundayShops);
});

test('town rules: an approved skate park is a building site, then opens', () => {
  const w = createWorld(testTown(44, 300), 44);
  const facts = w.knowledge.facts.length;
  w.politics.due.push({ key: 'skatepark', day: today(w) + 1 });
  weeks(w, 1);
  const work = rulesOf(w).works.find((x) => x.key === 'skatepark')!;
  assert.ok(work && work.start <= today(w) && work.done > today(w));
  weeks(w, 14);
  const heard = news(w, facts);
  assert.ok(heard.some((t) => t.includes('work has started on the skate park')));
  assert.ok(heard.some((t) => t.includes('skate park by the sports ground is open')), heard.join(' | '));
});

test('town rules: higher rates and parking charges cost households money', () => {
  const run = (rules: boolean) => {
    const w = createWorld(testTown(45, 200), 45);
    if (rules) { rulesOf(w).ratesUp = true; rulesOf(w).parkingCharges = true; }
    weeks(w, 5);
    return w;
  };
  const a = run(false), b = run(true);
  const car = a.households.find((h) => h.members.length > 0 && h.car)!;
  assert.ok(budgetOf(b, b.households[car.id]).outgo >= budgetOf(a, car).outgo + 12 + 18, `${budgetOf(a, car).outgo} → ${budgetOf(b, b.households[car.id]).outgo}`);
});

test('town rules: the view carries the town as it is now, once a day', () => {
  const w = createWorld(testTown(46, 300), 46);
  assert.equal(viewOf(w).town, null);
  const face = viewOf(w, true).town!;
  assert.equal(face.kind.length, w.graph.places.length);
  assert.equal(face.name.length, w.graph.places.length);
  assert.deepEqual(face.hours[placesOf(w, ['bakery'])[0]], w.graph.places[placesOf(w, ['bakery'])[0]].hours);
  for (const p of w.graph.places) assert.equal(PLACE_KINDS[face.kind[p.id]], p.kind);
  for (const p of w.graph.places) if (p.kind === 'vacant') assert.ok(face.looks.flags[p.id] & LOOK_TO_LET, `${p.name} has no to-let board`);
  assert.equal(face.rules.poolClosed, false);
});

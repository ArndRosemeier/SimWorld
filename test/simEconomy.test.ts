import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testTown } from '../src/sim/testTown';
import { createWorld } from '../src/sim/synth';
import { passDays, ageOf, jobOf, placesOf, type World } from '../src/sim/world';
import {
  BIZ_OPEN, BIZ_VACANT, LOOK_TO_LET, TENURE_CARE, budgetOf, economyDay, jobOpen, openBusiness, payOf, spend, townLooks,
} from '../src/sim/economy';
import { beliefsOf } from '../src/sim/knowledge';
import { HABIT_COUNT } from '../src/sim/people';
import { A } from '../src/sim/actors';
import { Rng } from '@futuremagic/core';

/** Whole days in weekly steps, slow processes only (the chronicle's coarse mode without conversations). */
function weeks(world: World, n: number): void {
  for (let k = 0; k < n; k++) {
    world.clock = (Math.floor(world.clock / 1440) + 7) * 1440;
    passDays(world, 7);
  }
}

const town = createWorld(testTown(21, 1000), 21);

test('economy: every household has a budget; work, pensions and support pay, and few are under pressure', () => {
  const live = town.households.filter((h) => h.members.length > 0);
  let pressed = 0;
  for (const h of live) {
    const b = budgetOf(town, h);
    assert.ok(b.income > 0, `household ${h.id} has no income at all`);
    assert.ok(b.outgo > 0);
    if (b.pressure > 0.5) pressed++;
    const earner = h.members.find((m) => jobOf(town, m) && payOf(jobOf(town, m)!) > 1000);
    if (earner !== undefined) assert.ok(b.income >= 1000);
  }
  assert.ok(pressed / live.length < 0.12, `${pressed} of ${live.length} households under pressure`);
  // The oldest people living alone have moved into the care home.
  const care = placesOf(town, ['carehome']);
  assert.equal(care.length, 1);
  const residents = town.households.filter((h) => h.home === care[0] && h.members.length > 0);
  assert.ok(residents.length > 0 && residents.length <= town.graph.places[care[0]].homes);
  for (const h of residents) {
    assert.ok(ageOf(town, h.members[0]) >= 80);
    assert.equal(town.economy.hh.cols.tenure[h.id], TENURE_CARE);
  }
});

test('economy: a business that runs out of money closes, its staff lose their jobs and the town talks about it', () => {
  const world = createWorld(testTown(22, 400), 22);
  const b = world.economy.biz.cols;
  const cafe = placesOf(world, ['cafe'])[0];
  const name = world.graph.places[cafe].name;
  const staff = world.jobs.filter((j) => j.place === cafe && j.holder >= 0).map((j) => j.holder);
  assert.ok(staff.length > 0);
  b.cash[cafe] = -1e6;
  weeks(world, 6);
  assert.equal(world.graph.places[cafe].kind, 'vacant');
  assert.equal(b.status[cafe], BIZ_VACANT);
  for (const id of staff) if (world.actors.cols.alive[id]) assert.notEqual(jobOf(world, id)?.place, cafe);
  // Its positions are gone for good, nobody keeps it as their café, and there is a to-let board.
  for (const j of world.jobs) if (j.place === cafe) { assert.ok(!jobOpen(world, j)); assert.equal(j.holder, -1); }
  const pc = world.people.cols;
  for (let r = 0; r < world.people.count; r++) for (let k = 0; k < HABIT_COUNT; k++) assert.notEqual(pc.habits[r * HABIT_COUNT + k], cafe);
  assert.ok(townLooks(world).flags[cafe] & LOOK_TO_LET);
  const closed = world.economy.events.find((e) => e.kind === 'closed' && e.place === cafe)!;
  assert.equal(closed.name, name);
  const heard = staff.filter((id) => world.actors.cols.alive[id] && beliefsOf(world, id).some((x) => x.fact.root === closed.fact));
  assert.ok(heard.length > 0, 'the staff know their café closed');
});

test('economy: an empty unit reopens as a new business with jobs to fill', () => {
  const world = createWorld(testTown(23, 600), 23);
  const unit = placesOf(world, ['vacant'])[0];
  const jobs = world.jobs.length;
  openBusiness(world, unit, 'florist', new Rng(1));
  const p = world.graph.places[unit];
  assert.equal(p.kind, 'florist');
  assert.equal(world.economy.biz.cols.status[unit], BIZ_OPEN);
  assert.ok(p.hours.length > 0 && world.jobs.length > jobs);
  assert.deepEqual(placesOf(world, ['florist']).includes(unit), true);
  const opened = world.economy.events.find((e) => e.kind === 'opened' && e.place === unit)!;
  assert.ok(opened.name.length > 0 && world.knowledge.facts[opened.fact].topic === 'business');
  // A year on, the town has kept its books: open jobs are held by living people, closed ones by nobody.
  weeks(world, 52);
  for (const j of world.jobs) {
    if (j.holder >= 0) { assert.ok(jobOpen(world, j)); assert.ok(world.actors.cols.alive[j.holder]); }
  }
});

test('economy: in live play the visits decide which of two shops gets the takings', () => {
  const world = town;
  const b = world.economy.biz.cols;
  const shops = placesOf(world, ['shop']);
  assert.ok(shops.length >= 2);
  const total = shops.reduce((s, c) => s + b.expected[c], 0);
  for (const c of shops) b.revenue[c] = 0;
  const someone = world.households.find((h) => h.members.some((m) => ageOf(world, m) >= 20))!.members.find((m) => ageOf(world, m) >= 20)!;
  world.actors.cols.with[someone] = -1;
  for (let k = 0; k < 5; k++) spend(world, someone, shops[0], A.shop);
  world.clock = (Math.floor(world.clock / 1440) + 1) * 1440;
  economyDay(world, 1);
  assert.ok(Math.abs(b.revenue[shops[0]] - total) < 1);
  for (const c of shops.slice(1)) assert.equal(b.revenue[c], 0);
});

test('economy: the same seed gives the same openings and closures', () => {
  const run = () => {
    const w = createWorld(testTown(25, 300), 25);
    weeks(w, 52);
    return JSON.stringify(w.economy.events) + JSON.stringify(Array.from(w.economy.biz.cols.cash));
  };
  assert.equal(run(), run());
});

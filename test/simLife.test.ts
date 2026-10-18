import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '@futuremagic/core';
import { planRegion } from '../src/plan/region';
import { testTown } from '../src/sim/testTown';
import { createWorld } from '../src/sim/synth';
import { lifeDay, leaveTown, mortality, partnerOf, type LifeEvent } from '../src/sim/life';
import { ageOf, householdOf, isPerson, tick, type World } from '../src/sim/world';
import { A, FEMALE } from '../src/sim/actors';
import { bond } from '../src/sim/relations';
import { beliefsOf } from '../src/sim/knowledge';

/** Advance a world `days` days in steps of `stepDays`, life events only (the chronicle's coarse mode). */
function live(world: World, days: number, stepDays: number): void {
  for (let d = 0; d < days; d += stepDays) {
    world.clock = (Math.floor(world.clock / 1440) + stepDays) * 1440;
    lifeDay(world, stepDays);
  }
}

/** Every household member is alive and lives there; every job holder is alive and holds that job. */
function booksBalance(world: World): void {
  const a = world.actors.cols, pc = world.people.cols;
  for (const h of world.households) {
    for (const m of h.members) {
      assert.ok(a.alive[m], `household ${h.id} lists a dead or departed member`);
      assert.equal(pc.household[a.row[m]], h.id);
      assert.equal(a.home[m], h.home);
    }
    for (const an of h.animals) assert.ok(a.alive[an]);
  }
  for (const j of world.jobs) if (j.holder >= 0) {
    assert.ok(a.alive[j.holder]);
    assert.equal(pc.job[a.row[j.holder]], j.id);
  }
}

const kinds = (events: LifeEvent[]) => new Set(events.map((e) => e.kind));

test('life: three years of a 400-person town in weekly steps keep the books straight', () => {
  const world = createWorld(testTown(5, 400), 5);
  live(world, 3 * 365, 7);
  booksBalance(world);
  const k = kinds(world.life.events);
  for (const kind of ['death', 'illness', 'hired', 'dating', 'arrived', 'departed'] as const) assert.ok(k.has(kind), `no ${kind} in three years`);
  // Stories reach the people they are about.
  const death = world.life.events.find((e) => e.kind === 'death' && e.fact >= 0 && world.actors.cols.kind[e.who] === 0);
  if (death) assert.ok(world.knowledge.byHolder.some((rows, holder) => rows?.length && beliefsOf(world, holder).some((b) => b.fact.root === death.fact)));
});

test('life: the same seed gives the same life story', () => {
  const run = () => {
    const w = createWorld(testTown(6, 200), 6);
    live(w, 365, 7);
    return JSON.stringify(w.life.events);
  };
  assert.equal(run(), run());
});

test('life: mortality rises with age like a Western life table', () => {
  const q = (age: number) => 1 - Math.exp(-mortality(age));
  assert.ok(q(40) < 0.002 && q(70) > 0.015 && q(70) < 0.035 && q(90) > 0.1);
});

test('life: a baby joins the household with parents, siblings and grandparents', () => {
  const world = createWorld(testTown(7, 300), 7);
  const a = world.actors.cols;
  const mother = Array.from({ length: world.actors.count }, (_, i) => i).find((id) =>
    isPerson(world, id) && a.sex[id] === FEMALE && ageOf(world, id) >= 25 && ageOf(world, id) <= 40 && partnerOf(world, id) >= 0 && householdOf(world, partnerOf(world, id)) === householdOf(world, id))!;
  assert.ok(mother !== undefined);
  const father = partnerOf(world, mother);
  const grandma = Array.from({ length: world.actors.count }, (_, i) => i).find((id) => isPerson(world, id) && ageOf(world, id) >= 60 && householdOf(world, id) !== householdOf(world, mother))!;
  bond(world.relations, mother, grandma, 'parent');
  const day = Math.floor(world.clock / 1440) + 1;
  world.life.pregnant.set(mother, { father, due: day, announced: true });
  world.clock = day * 1440;
  const before = householdOf(world, mother)!.members.length;
  lifeDay(world);
  const birth = world.life.events.find((e) => e.kind === 'birth' && e.other === mother)!;
  assert.ok(birth, 'no birth');
  const baby = birth.who;
  assert.equal(householdOf(world, mother)!.members.length, before + 1);
  assert.equal(ageOf(world, baby), 0);
  assert.ok(world.relations.has(mother, baby, 'child') && world.relations.has(father, baby, 'child'));
  assert.ok(world.relations.has(baby, mother, 'parent'));
  assert.ok(world.relations.has(grandma, baby, 'grandchild'));
  assert.ok(beliefsOf(world, grandma).some((b) => b.fact.id === birth.fact), 'grandma has not heard');
  booksBalance(world);
});

test('life: when the only adult dies, the children go to kin and the job falls vacant', () => {
  const world = createWorld(testTown(8, 400), 8);
  const hh = world.households.find((h) => h.members.filter((m) => ageOf(world, m) >= 18).length === 1 && h.members.length >= 2)!;
  assert.ok(hh, 'no single-parent household');
  const parent = hh.members.find((m) => ageOf(world, m) >= 18)!;
  const kids = hh.members.filter((m) => m !== parent);
  const gran = world.households.find((h) => h !== hh && h.members.length > 0 && h.members.every((m) => ageOf(world, m) >= 55))!;
  for (const k of kids) bond(world.relations, gran.members[0], k, 'grandchild');
  const job = world.jobs.find((j) => j.holder === parent);
  leaveTown(world, parent, new Rng(1));
  assert.equal(world.actors.cols.alive[parent], 0);
  for (const k of kids) assert.ok(householdOf(world, k)!.members.some((m) => m !== k && world.relations.isFamily(k, m) && ageOf(world, m) >= 21), 'child not with kin');
  if (job) assert.equal(job.holder, -1);
  booksBalance(world);
});

test('life: someone ill stays home in bed', () => {
  const world = createWorld(testTown(9, 200), 9);
  world.clock = 1440 + 600; // Tuesday 10:00
  const a = world.actors.cols;
  const id = world.jobs.find((j) => j.holder >= 0)!.holder;
  a.health[id] = 0.3;
  a.until[id] = world.clock;
  tick(world, 30);
  assert.equal(a.dest[id] >= 0 ? a.dest[id] : a.place[id], a.home[id]);
  assert.ok([A.sleep, A.eat, A.travel].includes(a.dest[id] >= 0 ? a.planned[id] : a.activity[id]));
});

test('life: with a region, people move away to real places and newcomers come from them', () => {
  const region = planRegion({ seed: 4, town: 'Testford', coastal: false, seaBearing: 0, hilliness: 0.4, warmth: 0.5, american: false, oldWorld: 0.7, railBearing: 90, railTerminus: false, downstreamBearing: 200 });
  const world = createWorld(testTown(4, 300), 4, { region });
  live(world, 2 * 365, 7);
  const names = region.places.map((p) => p.name);
  const told = (kind: string) => world.life.events.filter((e) => e.kind === kind && e.fact >= 0).map((e) => world.knowledge.facts[e.fact].text);
  const moves = [...told('departed'), ...told('arrived')];
  assert.ok(moves.some((t) => names.some((n) => t.includes(n))), `no region place in: ${moves.slice(0, 3).join(' / ')}`);
  booksBalance(world);
});

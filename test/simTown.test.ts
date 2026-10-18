import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testTown } from '../src/sim/testTown';
import { createWorld } from '../src/sim/synth';
import { ageOf, nameOf } from '../src/sim/world';
import { ACTOR_PERSON } from '../src/sim/actors';
import { relation } from '../src/sim/relations';
import { isHome } from '../src/sim/placeKinds';
import { speciesId } from '../src/sim/species';

const graph = testTown(7, 200);
const world = createWorld(graph, 7);
const persons = Array.from({ length: world.actors.count }, (_, i) => i).filter((i) => world.actors.cols.kind[i] === ACTOR_PERSON);

test('testTown: deterministic, essentials present, every place reachable', () => {
  assert.deepEqual(testTown(7, 200), graph);
  for (const k of ['bakery', 'supermarket', 'cafe', 'pub', 'doctor', 'school', 'kindergarten', 'church', 'townhall', 'park']) {
    assert.ok(graph.places.some((p) => p.kind === k), `has a ${k}`);
  }
  const homes = graph.places.filter((p) => isHome(p.kind)).reduce((s, p) => s + p.homes, 0);
  assert.ok(homes >= 200 / 2.6 && homes <= 200 / 2, `homes ${homes}`);
  for (const p of graph.places) assert.ok(world.travel.minutes(0, p.id) < 60, `${p.name} reachable`);
});

test('synthesis: about the asked population, deterministic per seed', () => {
  assert.ok(persons.length > 150 && persons.length < 260, `people ${persons.length}`);
  const again = createWorld(graph, 7);
  assert.deepEqual(again.people.first, world.people.first);
  assert.deepEqual(Array.from(again.relations.t.cols.affection.slice(0, 500)), Array.from(world.relations.t.cols.affection.slice(0, 500)));
  assert.notDeepEqual(createWorld(graph, 8).people.first, world.people.first);
});

test('synthesis: every job is a real slot held by someone old enough; children go to school', () => {
  const pc = world.people.cols;
  for (const j of world.jobs) if (j.holder >= 0) {
    assert.equal(pc.job[world.actors.cols.row[j.holder]], j.id);
    assert.ok(ageOf(world, j.holder) >= j.minAge, `${j.role} held by a ${ageOf(world, j.holder)}-year-old`);
  }
  const inTown = world.jobs.filter((j) => world.graph.places[j.place].kind !== 'away');
  assert.ok(inTown.filter((j) => j.holder >= 0).length / inTown.length > 0.9, 'most positions in town filled');
  assert.ok(world.jobs.some((j) => j.holder >= 0 && world.graph.places[j.place].kind === 'away'), 'nobody commutes');
  for (const id of persons) {
    const age = ageOf(world, id), p = world.actors.cols.row[id];
    if (age >= 6 && age <= 15) assert.ok(pc.school[p] >= 0, `${nameOf(world, id)} (${age}) has a school`);
  }
});

test('synthesis: households live at home, family bonds are reciprocal, pets belong to someone', () => {
  for (const h of world.households) for (const m of h.members) assert.equal(world.actors.cols.home[m], h.home);
  let parents = 0;
  for (const id of persons) for (const r of world.relations.known(id)) {
    const other = world.relations.t.cols.to[r];
    const ab = relation(world, id, other)!.bonds;
    const ba = relation(world, other, id)!.bonds;
    if (ab.includes('child')) { parents++; assert.ok(ba.includes('parent'), 'child ↔ parent'); assert.ok(ageOf(world, id) > ageOf(world, other)); }
    if (ab.includes('spouse')) assert.ok(ba.includes('spouse'));
  }
  assert.ok(parents > 20, 'there are families');
  const dog = speciesId('dog');
  for (let r = 0; r < world.animals.count; r++) {
    const id = world.animals.cols.actor[r];
    if (world.actors.cols.species[id] === dog) assert.ok(world.animals.cols.household[r] >= 0, 'dogs have owners');
  }
});

test('relations: strangers met once are forgotten after two weeks, bonds and feelings are kept', async () => {
  const { Relations, meet, bond } = await import('../src/sim/relations');
  const rel = new Relations();
  meet(rel, 1, 2, 0, 1, 0); // a minute's small talk
  bond(rel, 3, 4, 'friend', { familiarity: 0.02 });
  const r = rel.ensure(5, 6);
  rel.t.cols.affection[r] = -0.5; // a grudge
  assert.equal(rel.prune(10 * 1440), 0, 'not yet');
  assert.equal(rel.prune(20 * 1440), 2, 'both strangers forgot each other');
  assert.equal(rel.row(1, 2), -1);
  assert.ok(rel.row(3, 4) >= 0 && rel.row(5, 6) >= 0);
  assert.equal(rel.ensure(7, 8) < 4, true, 'freed rows are reused');
});

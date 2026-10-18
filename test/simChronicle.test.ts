import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testTown } from '../src/sim/testTown';
import { createWorld } from '../src/sim/synth';
import { chronicle, digest } from '../src/sim/chronicle';
import { addFact, beliefsOf, factText, reach, witness } from '../src/sim/knowledge';
import { isPerson } from '../src/sim/world';
import { weekdayOf } from '../src/sim/time';

test('chronicle: two weeks pass in whole days; news spreads; everyone ends up at home', () => {
  const world = createWorld(testTown(11, 300), 11);
  const persons = Array.from({ length: world.actors.count }, (_, i) => i).filter((i) => isPerson(world, i));
  const story = addFact(world, { topic: 'crime', subject: persons[10], place: 3, text: '{subject} was caught shoplifting at {place}', magnitude: 0.8 });
  witness(world, story, [persons[50], persons[120]]);
  const day0 = Math.floor(world.clock / 1440);
  chronicle(world, 14);
  assert.equal(world.clock, (day0 + 14) * 1440);
  assert.ok(reach(world, story).any > 20, `reach ${reach(world, story).any}`);
  const a = world.actors.cols;
  for (let id = 0; id < world.actors.count; id++) if (a.alive[id]) assert.equal(a.place[id], a.home[id]);
});

test('chronicle: the digest tells what this person heard and lived, nothing else', () => {
  const world = createWorld(testTown(12, 300), 12);
  const persons = Array.from({ length: world.actors.count }, (_, i) => i).filter((i) => isPerson(world, i));
  const story = addFact(world, { topic: 'romance', subject: persons[5], object: persons[6], text: '{subject} was seen kissing {object}', magnitude: 0.8 });
  witness(world, story, [persons[40]]);
  const since = world.clock;
  chronicle(world, 21);
  const listener = persons.find((p) => p !== persons[40] && beliefsOf(world, p).some((b) => b.fact.root === story && b.source >= 0));
  assert.ok(listener !== undefined, 'nobody heard it');
  const items = digest(world, listener, since, 50);
  const belief = beliefsOf(world, listener).find((b) => b.fact.root === story)!;
  assert.ok(items.some((i) => i.kind === 'heard' && i.text.startsWith(factText(world, belief.fact))), 'the story is in the digest');
  const known = new Set(beliefsOf(world, listener).map((b) => factText(world, b.fact)));
  for (const i of items) if (i.kind === 'heard') assert.ok([...known].some((t) => i.text.startsWith(t)), `digest invents: ${i.text}`);
  assert.ok(items.every((i) => i.time >= since));
});

test('history: a town with three years behind it starts on a Monday morning, with a past', () => {
  const make = () => createWorld(testTown(13, 200), 13, { history: 3 });
  const world = make();
  assert.equal(world.clock % 1440, 360);
  assert.equal(weekdayOf(world.clock), 0);
  assert.ok(world.clock >= 3 * 364 * 1440);
  const kinds = new Set(world.life.events.map((e) => e.kind));
  for (const k of ['death', 'hired', 'dating'] as const) assert.ok(kinds.has(k), `no ${k} in three years`);
  assert.equal(JSON.stringify(make().life.events), JSON.stringify(world.life.events), 'deterministic');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testTown } from '../src/sim/testTown';
import { createWorld } from '../src/sim/synth';
import { A } from '../src/sim/actors';
import { addOccasion } from '../src/sim/agenda';
import { addFact, beliefAbout, SOURCE_BROADCAST } from '../src/sim/knowledge';
import { log } from '../src/sim/life';
import { goMissing, lostAt } from '../src/sim/lostPets';
import { boardsOf, noticesAt, paperReaders } from '../src/sim/media';
import { SPECIES } from '../src/sim/species';
import { passDays, placesOf, type World } from '../src/sim/world';

/** One day at a time, as live play does at each midnight. */
function days(world: World, n: number, until?: () => boolean): void {
  for (let d = 0; d < n && !until?.(); d++) {
    world.clock = (Math.floor(world.clock / 1440) + 1) * 1440;
    passDays(world, 1);
  }
}

test('media: the weekly paper prints what happened, and its readers come to know it', () => {
  const world = createWorld(testTown(31, 300), 31);
  const hh = world.households.find((h) => h.members.length > 1)!;
  const day = Math.floor(world.clock / 1440);
  const fact = addFact(world, { topic: 'crime', text: 'someone broke into {place}', place: hh.home, magnitude: 0.6 });
  log(world, day, 'burglary', -1, hh.members[0], hh.home, fact);
  days(world, 7);
  const story = world.media.editions.flatMap((e) => e.stories).find((s) => s.fact === fact);
  assert.ok(story, 'the burglary is in the paper within the week');
  assert.match(story.headline, new RegExp(world.graph.places[hh.home].street));
  const c = world.knowledge.beliefs.cols;
  const readers = paperReaders(world).filter((id) => { const r = beliefAbout(world, id, fact); return r >= 0 && c.source[r] === SOURCE_BROADCAST; });
  assert.ok(readers.length > 10, `readers learned it from the paper (${readers.length})`);
});

test('media: a lost pet gets posters, stays out where it strayed, and comes home or is given up', () => {
  const world = createWorld(testTown(32, 300), 32);
  const pet = world.households.flatMap((h) => h.animals).find((x) => ['dog', 'cat'].includes(SPECIES[world.actors.cols.species[x]].name))!;
  const home = world.actors.cols.home[pet];
  goMissing(world, pet, 7);
  const at = lostAt(world, pet);
  assert.ok(at >= 0 && world.streetOf[at] !== world.streetOf[home]);
  const poster = noticesAt(world, world.streetOf[home]).find((n) => n.kind === 'lostPet' && n.about === pet);
  assert.ok(poster, 'posters on the home street');
  const missing = poster.fact;
  days(world, 30, () => lostAt(world, pet) < 0);
  assert.equal(lostAt(world, pet), -1);
  const end = world.life.events.find((e) => e.who === pet && (e.kind === 'petFound' || e.kind === 'departed'))!;
  assert.ok(end);
  if (end.kind === 'petFound' && end.other >= 0) {
    // Whoever found it knew it was missing.
    assert.ok(beliefAbout(world, end.other, missing) >= 0);
    assert.equal(poster.title, 'Found');
  }
});

test('media: the festival goes up on every board ahead of the day and people who pass read it', () => {
  const world = createWorld(testTown(33, 300), 33);
  // A new world has last week's paper to read, with what is on from today.
  const first = world.media.editions[0];
  assert.ok(first && first.day <= Math.floor(world.clock / 1440) && first.stories.some((s) => s.section === 'whatson'));
  const square = placesOf(world, ['square'])[0];
  const at = (Math.floor(world.clock / 1440) + 10) * 1440 + 14 * 60;
  addOccasion(world, { kind: 'festival', name: 'the summer festival', place: square, start: at, end: at + 360, pull: 1, appeal: 'all', guests: null, activity: A.socialize, about: [] });
  days(world, 1);
  const boards = boardsOf(world);
  assert.ok(boards.length >= 2);
  for (const b of boards) assert.ok(noticesAt(world, b).some((n) => n.title === 'Summer festival'), `poster at ${world.graph.places[b].name}`);
  const fact = noticesAt(world, square)[0].fact;
  days(world, 4);
  let knowers = 0;
  for (let id = 0; id < world.actors.count; id++) if (beliefAbout(world, id, fact) >= 0) knowers++;
  assert.ok(knowers > 30, `the town hears of it (${knowers})`);
  days(world, 7);
  assert.ok(!world.media.notices.some((n) => n.fact === fact), 'the posters come down after the day');
});

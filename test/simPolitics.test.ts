import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testTown } from '../src/sim/testTown';
import { createWorld } from '../src/sim/synth';
import { councilSeats, groupsOfKind } from '../src/sim/groups';
import { mayorOf, stanceOf } from '../src/sim/politics';
import { hireable } from '../src/sim/economy';
import { ageOf, householdOf, isPerson, passDays, type World } from '../src/sim/world';

/** Whole days in weekly steps, slow processes only (the chronicle's coarse mode without conversations). */
function weeks(world: World, n: number): void {
  for (let k = 0; k < n; k++) {
    world.clock = (Math.floor(world.clock / 1440) + 7) * 1440;
    passDays(world, 7);
  }
}

const today = (w: World) => Math.floor(w.clock / 1440);
const adultsOf = (w: World) => Array.from({ length: w.actors.count }, (_, i) => i).filter((id) => isPerson(w, id) && ageOf(w, id) >= 18);

test('politics: the town has a mayor on the council, an election ahead, and people of different minds', () => {
  const w = createWorld(testTown(41, 800), 41);
  const mayor = mayorOf(w);
  assert.ok(mayor >= 0 && ageOf(w, mayor) <= 62);
  assert.ok(groupsOfKind(w, 'council')[0].members.includes(mayor));
  assert.ok(w.politics.election > today(w) && w.politics.election < today(w) + 4 * 366 + 60);
  assert.ok(!hireable(w, w.jobs.find((j) => j.role === 'mayor')!), 'the mayor is elected, not hired');
  // Closing the pool: parents mostly against, and the town is split.
  const adults = adultsOf(w);
  const kids = (id: number) => householdOf(w, id)!.members.some((m) => m !== id && ageOf(w, m) < 16);
  const mean = (l: number[]) => l.reduce((s, x) => s + x, 0) / l.length;
  const parents = adults.filter(kids).map((id) => stanceOf(w, id, 'pool'));
  const others = adults.filter((id) => !kids(id)).map((id) => stanceOf(w, id, 'pool'));
  assert.ok(mean(parents) < mean(others) - 0.2, `parents ${mean(parents).toFixed(2)}, others ${mean(others).toFixed(2)}`);
  const all = adults.map((id) => stanceOf(w, id, 'pool'));
  assert.ok(all.some((s) => s > 0.3) && all.some((s) => s < -0.3) && all.every((s) => s >= -1 && s <= 1));
});

test('politics: issues come up, the council votes on them, and the town hears the result', () => {
  const w = createWorld(testTown(42, 500), 42);
  w.politics.election = today(w) + 3000;
  weeks(w, 60);
  const decided = w.politics.issues.filter((i) => i.status !== 'open');
  assert.ok(decided.length >= 1, 'no vote in more than a year');
  const council = groupsOfKind(w, 'council')[0];
  for (const i of decided) {
    assert.ok(i.yes + i.no >= council.members.length - 2 && i.yes + i.no <= council.members.length + 2);
    assert.equal(i.status, i.yes > i.no ? 'passed' : 'rejected');
    assert.match(w.knowledge.facts[i.outcome].text, /^the council voted \d+ to \d+ (for|against) /);
  }
});

test('politics: on election day the town picks its mayor and council', () => {
  const w = createWorld(testTown(43, 500), 43);
  w.politics.election = today(w) + 20;
  w.politics.announced = false;
  weeks(w, 5);
  assert.equal(w.politics.elections.length, 1);
  const e = w.politics.elections[0];
  assert.ok(e.turnout > 0.3 && e.turnout < 0.85, `turnout ${e.turnout}`);
  assert.equal(mayorOf(w), e.mayor[0][0]);
  const council = groupsOfKind(w, 'council')[0];
  const people = Array.from({ length: w.actors.count }, (_, i) => i).filter((id) => isPerson(w, id) && w.actors.cols.alive[id]).length;
  assert.ok(Math.abs(council.members.length - (councilSeats(people) + 1)) <= 1, `${council.members.length} on the council`);
  assert.ok(council.members.includes(mayorOf(w)));
  assert.ok(w.knowledge.facts.some((f) => f.topic === 'politics' && f.subject === e.mayor[0][0] && /mayor/.test(f.text)));
  assert.ok(w.politics.election > today(w) + 3 * 365, 'the next one is four years on');
});

test('politics: when the mayor leaves office, a by-election finds a new one', () => {
  const w = createWorld(testTown(44, 500), 44);
  w.politics.election = today(w) + 1000;
  const job = w.jobs.find((j) => j.role === 'mayor')!;
  w.people.cols.job[w.actors.cols.row[job.holder]] = -1;
  job.holder = -1;
  weeks(w, 9);
  assert.ok(mayorOf(w) >= 0, 'still no mayor');
  assert.equal(w.politics.elections.length, 1);
  assert.equal(w.politics.elections[0].council.length, 0);
});

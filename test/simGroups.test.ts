import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testTown } from '../src/sim/testTown';
import { createWorld } from '../src/sim/synth';
import { agendaOn } from '../src/sim/agenda';
import { councilSeats, groupsOf, groupsOfKind } from '../src/sim/groups';
import { ageOf, isPerson, passDays, tick, type World } from '../src/sim/world';

/** Whole days in weekly steps, slow processes only (the chronicle's coarse mode without conversations). */
function weeks(world: World, n: number): void {
  for (let k = 0; k < n; k++) {
    world.clock = (Math.floor(world.clock / 1440) + 7) * 1440;
    passDays(world, 7);
  }
}

const town = createWorld(testTown(21, 1000), 21);

test('groups: the town has its clubs, a congregation and a council, with office holders and meetings in the agenda', () => {
  const people = Array.from({ length: town.actors.count }, (_, i) => i).filter((id) => isPerson(town, id)).length;
  for (const kind of ['football', 'choir', 'firebrigade', 'youth', 'congregation', 'council'] as const) {
    assert.equal(groupsOfKind(town, kind).length, 1, kind);
  }
  const council = groupsOfKind(town, 'council')[0];
  assert.ok(council.members.length >= councilSeats(people) && council.members.length <= councilSeats(people) + 1);
  for (const g of town.groups.list) {
    for (const o of g.offices) if (o.holder >= 0) assert.ok(g.members.includes(o.holder), `${o.title} of ${g.name} is not a member`);
    assert.ok(g.offices.some((o) => o.holder >= 0), `${g.name} has nobody in office`);
  }
  for (const id of groupsOfKind(town, 'youth')[0].members) assert.ok(ageOf(town, id) <= 17 || groupsOf(town, id).some((x) => x.office === 'youth leader'));
  const clubs = new Map<number, number>();
  for (const g of town.groups.list) if (g.kind !== 'congregation' && g.kind !== 'council') for (const id of g.members) clubs.set(id, (clubs.get(id) ?? 0) + 1);
  assert.ok(Math.max(...clubs.values()) <= 4);
  // The choir's rehearsal is in the agenda once a week, for its members only.
  const choir = groupsOfKind(town, 'choir')[0];
  const week = Array.from({ length: 7 }, (_, d) => 28 + d).flatMap((d) => agendaOn(town, d)).filter((o) => o.name === choir.name);
  assert.equal(week.length, 1);
  assert.equal(week[0].guests, choir.members);
});

test('groups: on a training evening the footballers are at the ground', () => {
  const w = town;
  const club = groupsOfKind(w, 'football')[0];
  const day = Array.from({ length: 60 }, (_, d) => d).find((d) => agendaOn(w, d).some((o) => o.kind === 'club' && o.name === club.name))!;
  w.clock = day * 1440 + 17 * 60;
  for (let id = 0; id < w.actors.count; id++) w.actors.cols.until[id] = w.clock;
  tick(w, 100);
  const there = club.members.filter((id) => w.actors.cols.place[id] === club.place && w.actors.cols.dest[id] < 0).length;
  assert.ok(there >= 6, `${there} of ${club.members.length} at training`);
});

test('groups: over a year members come and go, office holders are elected, and the big days are news', () => {
  const w = createWorld(testTown(23, 800), 23);
  const before = new Map(w.groups.list.map((g) => [g.id, [...g.members]]));
  const facts = w.knowledge.facts.length;
  weeks(w, 52);
  let joined = 0, left = 0;
  for (const g of w.groups.list) {
    const was = before.get(g.id)!;
    joined += g.members.filter((id) => !was.includes(id)).length;
    left += was.filter((id) => !g.members.includes(id)).length;
    for (const id of g.members) assert.ok(w.actors.cols.alive[id], `a dead member in ${g.name}`);
    assert.equal(g.members.length, g.since.length);
  }
  assert.ok(joined > 5 && left > 5, `${joined} joined, ${left} left`);
  const news = w.knowledge.facts.slice(facts).filter((f) => f.root === f.id && (f.topic === 'event' || f.topic === 'politics')).map((f) => f.text);
  assert.ok(news.some((t) => t.includes('is holding its')), 'no big day announced');
  assert.ok(news.some((t) => t.includes(' won ') || t.includes(' finished ') || t.includes('relegat') || t.includes('promotion')), 'no results');
});

test('groups: a club with too few members folds, and the town hears of it', () => {
  const w = createWorld(testTown(24, 600), 24);
  const choir = groupsOfKind(w, 'choir')[0];
  const members = [...choir.members];
  choir.members.splice(2);
  choir.since.splice(2);
  weeks(w, 5);
  assert.ok(choir.folded);
  assert.equal(choir.members.length, 0);
  const fact = w.knowledge.facts.find((f) => f.text === `${choir.name} has folded for lack of members`);
  assert.ok(fact);
  assert.ok(members.some((id) => w.knowledge.byHolder[id]?.length));
});

test('groups: the same seed gives the same members and office holders', () => {
  const run = () => {
    const w = createWorld(testTown(25, 300), 25);
    weeks(w, 30);
    return JSON.stringify(w.groups.list.map((g) => [g.members, g.offices]));
  };
  assert.equal(run(), run());
});

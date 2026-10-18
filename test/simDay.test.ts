import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testTown } from '../src/sim/testTown';
import { createWorld } from '../src/sim/synth';
import { tick, ageOf, type World } from '../src/sim/world';
import { A, ACTOR_PERSON } from '../src/sim/actors';
import { NEED_COUNT, N_FOOD, speciesId } from '../src/sim/species';
import { onDay, minuteOfDay } from '../src/sim/time';

/** One Monday for a 200-person town, with snapshots at a few hours. */
const world = createWorld(testTown(3, 200), 3);
const a = world.actors.cols;
const persons = Array.from({ length: world.actors.count }, (_, i) => i).filter((i) => a.kind[i] === ACTOR_PERSON);
const snaps = new Map<number, { place: Int32Array; activity: Uint8Array; dest: Int32Array }>();
let walked = 0, talks = 0;
const dog = speciesId('dog');
while (world.clock < 1440 + 360) {
  tick(world, 1);
  for (const e of world.encounters) if (e.kind === 'talk') talks++;
  for (let id = 0; id < world.actors.count; id++) if (a.species[id] === dog && a.activity[id] === A.walkDog) walked++;
  const m = minuteOfDay(world.clock);
  if (m % 60 === 0) snaps.set(m / 60 + (world.clock >= 1440 ? 24 : 0), { place: a.place.slice(), activity: a.activity.slice(), dest: a.dest.slice() });
}

const share = (hour: number, who: number[], ok: (id: number, s: { place: Int32Array; activity: Uint8Array; dest: Int32Array }) => boolean) => {
  const s = snaps.get(hour)!;
  return who.filter((id) => ok(id, s)).length / Math.max(1, who.length);
};

test('day: at 3 am nearly everyone is asleep at home', () => {
  assert.ok(share(27, persons, (id, s) => s.place[id] === a.home[id] && s.activity[id] === A.sleep) > 0.93);
});

test('day: people with a Monday shift covering 10:00 are at work', () => {
  const workers = persons.filter((id) => {
    const j = world.people.cols.job[a.row[id]];
    if (j < 0) return false;
    const job = world.jobs[j];
    return onDay(job.days, 0) && job.start <= 570 && job.end >= 660;
  });
  assert.ok(workers.length > 30);
  assert.ok(share(10, workers, (id, s) => s.place[id] === world.jobs[world.people.cols.job[a.row[id]]].place) > 0.9);
});

test('day: school children are at school at 10:00, home for dinner', () => {
  const kids = persons.filter((id) => world.people.cols.school[a.row[id]] >= 0 && ageOf(world, id) >= 6);
  assert.ok(share(10, kids, (id, s) => s.place[id] === world.people.cols.school[a.row[id]]) > 0.9);
  assert.ok(share(19, kids, (id, s) => s.place[id] === a.home[id] || s.dest[id] === a.home[id]) > 0.7);
});

test('day: nobody starves, people talk, dogs get walked', () => {
  for (const id of persons) assert.ok(a.needs[id * NEED_COUNT + N_FOOD] > 0.1, `food ${a.needs[id * NEED_COUNT + N_FOOD]}`);
  assert.ok(talks > 1000, `conversations ${talks}`);
  assert.ok(walked > 0, 'some dog went for a walk');
});

test('day: the same seed gives the same day', () => {
  const w2: World = createWorld(testTown(3, 200), 3);
  tick(w2, 600);
  const w1 = createWorld(testTown(3, 200), 3);
  tick(w1, 600);
  assert.deepEqual(w2.actors.cols.place, w1.actors.cols.place);
  assert.deepEqual(w2.actors.cols.needs, w1.actors.cols.needs);
});

test('trips: everyone travelling has a trip, cars carry families, and arrivals drop out', () => {
  const w = createWorld(testTown(12, 1500), 12);
  w.clock = 7 * 60;
  const c = w.actors.cols;
  let cars = 0, companions = 0;
  for (let m = 0; m < 180; m++) {
    tick(w, 1);
    for (const t of w.trips) {
      assert.equal(c.dest[t.who], t.to);
      assert.ok(t.arrive >= w.clock && t.depart <= w.clock);
      if (t.mode === 'car') cars++;
      if (t.leader >= 0) { companions++; assert.equal(c.dest[t.leader], t.to); }
    }
    let travelling = 0;
    for (let id = 0; id < w.actors.count; id++) if (c.dest[id] >= 0) travelling++;
    assert.equal(w.trips.length, travelling);
  }
  assert.ok(cars > 0 && companions > 0, `cars ${cars}, companions ${companions}`);
});

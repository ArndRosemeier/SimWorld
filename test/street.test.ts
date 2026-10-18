import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTown } from '../src/plan/town';
import { placeGraphOf } from '../src/plan/placeGraph';
import { createWorld } from '../src/sim/synth';
import { householdOf, tick, tripOf } from '../src/sim/world';
import { tripRow, viewOf, viewTransfers } from '../src/sim/view';
import { agendaOn } from '../src/sim/agenda';
import { ACTOR_PERSON } from '../src/sim/actors';
import { StreetMap, OUTDOOR } from '../src/street/streetMap';
import { trackOf, sample, type Track } from '../src/street/tracks';
import { outfitOf, bodyKey, type LookInfo } from '../src/street/looks';
import { TrafficFeed } from '../src/traffic/feed';
import type { Footprints } from '../src/plan/footprints';

// The smallest planned town (the street layer needs real streets), its people on a Monday morning.
const town = planTown({ seed: 1, size: 0 });
const graph = placeGraphOf(town);
const world = createWorld(graph, 1);
const map = new StreetMap(town, world.graph);
tick(world, 120); // 08:00
// The household cars at the kerb, as in the sim worker.
const feed = new TrafficFeed(town, world, 60);
feed.message();
map.fp.also = feed.standing;
const a = world.actors.cols;
const tracks = new Map<number, Track>();
for (let id = 0; id < world.actors.count; id++) {
  const t = trackOf(world, map, id, world.clock);
  if (t) tracks.set(id, t);
}
const walking = [...tracks.values()].filter((t) => a.dest[t.id] >= 0 && a.with[t.id] < 0);

function length(k: number[]): number {
  let L = 0;
  for (let i = 4; i < k.length; i += 4) L += Math.hypot(k[i + 1] - k[i - 3], k[i + 3] - k[i - 1]);
  return L;
}

test('street: trips walk from door to door over the trip time, on dry ground or a bridge, at a walking pace', () => {
  assert.ok(walking.length > 10, `${walking.length} on their way`);
  const pace: number[] = [];
  for (const t of walking) {
    const trip = tripOf(world, t.id)!, k = t.keys, n = k.length / 4, from = world.graph.places[trip.from], to = world.graph.places[trip.to];
    assert.equal(trip.mode, 'foot');
    assert.equal(k[0], trip.depart);
    assert.equal(k[(n - 1) * 4], Math.max(trip.arrive, trip.depart + 0.5));
    if (!OUTDOOR.has(from.kind)) assert.ok(Math.hypot(k[1] - from.x, k[3] - from.z) < 0.01, 'leaves by the door');
    if (!OUTDOOR.has(to.kind)) assert.ok(Math.hypot(k[(n - 1) * 4 + 1] - to.x, k[(n - 1) * 4 + 3] - to.z) < 0.01, 'goes in by the door');
    for (let i = 4; i < k.length; i += 4) {
      assert.ok(k[i] >= k[i - 4], 'time runs forward');
      assert.ok(Math.hypot(k[i + 1] - k[i - 3], k[i + 3] - k[i - 1]) < 30, 'no jumps');
    }
    for (let i = 0; i < k.length; i += 4) {
      if (town.terrain.isWater(k[i + 1], k[i + 3], 0)) assert.ok(k[i + 2] - town.terrain.height(k[i + 1], k[i + 3]) > 0.5, 'in the water only on a bridge deck');
    }
    if (n > 2) pace.push(length(k) / (k[(n - 1) * 4] - k[0]));
  }
  pace.sort((x, y) => x - y);
  const median = pace[pace.length >> 1];
  assert.ok(median > 55 && median < 100, `median pace ${median.toFixed(0)} m/min`);
  assert.ok(pace[pace.length - 1] < 160, `fastest ${pace[pace.length - 1].toFixed(0)} m/min`);
});

test('street: someone going along keeps beside the one they are with', () => {
  let pairs = 0;
  const p: [number, number, number] = [0, 0, 0], q: [number, number, number] = [0, 0, 0];
  for (const t of tracks.values()) {
    const lead = a.with[t.id], l = tracks.get(lead);
    if (lead < 0 || !l || a.dest[lead] !== a.dest[t.id]) continue;
    pairs++;
    const mid = (l.keys[0] + l.keys[l.keys.length - 4]) / 2;
    sample(t.keys, mid, p);
    sample(l.keys, mid, q);
    const d = Math.hypot(p[0] - q[0], p[2] - q[2]);
    assert.ok(d > 0.3 && d < 2, `beside at ${d.toFixed(2)} m`);
  }
  assert.ok(pairs > 0, 'someone goes along with someone');
});

test('street: a track is a pure function of the sim, and a stay laid out later joins the earlier one', () => {
  const stays = [...tracks.values()].filter((t) => a.dest[t.id] < 0);
  assert.ok(stays.length > 0, 'someone stays out of doors');
  const p: [number, number, number] = [0, 0, 0], q: [number, number, number] = [0, 0, 0];
  for (const t of stays.slice(0, 40)) {
    assert.deepEqual(trackOf(world, map, t.id, world.clock), t);
    const later = trackOf(world, map, t.id, world.clock + 3)!;
    const at = Math.min(world.clock + 6, t.validUntil);
    sample(t.keys, at, p);
    sample(later.keys, at, q);
    assert.ok(Math.hypot(p[0] - q[0], p[2] - q[2]) < 0.01, `${world.graph.places[a.place[t.id]].kind}: same place either way`);
  }
});

test('looks: everyone is dressed every day, the same outfit all day, and the body changes only with age', () => {
  for (let id = 0; id < world.actors.count; id++) {
    if (a.kind[id] !== ACTOR_PERSON) continue;
    const p: LookInfo = { id, sex: a.sex[id], birth: a.birth[id], household: -1, role: '' };
    for (const day of [0, 1, 200]) {
      const clock = day * 1440 + 480, eq = outfitOf(1, p, clock, day === 200 ? 0.1 : 0.9);
      assert.ok(eq.chest && eq.feet || eq.chest?.defId === 'dress', `dressed: ${JSON.stringify(Object.keys(eq))}`);
      if (eq.chest?.defId !== 'dress') assert.ok(eq.legs, 'something on the legs');
      assert.deepEqual(outfitOf(1, p, clock + 600, day === 200 ? 0.1 : 0.9), eq);
    }
    assert.equal(bodyKey(p, 480), bodyKey(p, 1000));
    assert.notEqual(bodyKey(p, 480), bodyKey(p, 480 + 1440 * 366), 'a year older, a new body');
  }
});

test('view: the snapshot carries every trip and everyone\'s whereabouts, in buffers of its own', () => {
  const v = viewOf(world);
  assert.equal(v.clock, world.clock);
  assert.equal(v.trips.who.length, world.trips.length);
  world.trips.forEach((t, i) => assert.deepEqual(tripRow(v.trips, i), { ...t, household: householdOf(world, t.who)?.id ?? -1 }));
  assert.deepEqual(Array.from(v.dest), Array.from(a.dest.slice(0, world.actors.count)));
  const buffers = viewTransfers(v);
  assert.equal(new Set(buffers).size, buffers.length, 'no buffer sent twice');
  assert.ok(!buffers.includes(a.dest.buffer), 'not the sim\'s own columns');
  const today = agendaOn(world, Math.floor(world.clock / 1440)).filter((o) => o.place >= 0 && o.kind !== 'binDay');
  assert.deepEqual(v.occasions.map((o) => [o.kind, o.start, o.x]), today.map((o) => [o.kind, o.start, world.graph.places[o.place].x]), 'today\'s agenda, placed');
});

test('street: walks keep clear of trees, furniture, parked cars (in car parks and at the kerb) and walls', () => {
  // Sampled every 0.3 m of walking: how many people ever step into a thing (their middle inside its outline).
  const near: number[] = [], p: [number, number, number] = [0, 0, 0];
  const inside = (f: Footprints, x: number, z: number) => f.circlesNear(x, z, 0, near).some((c) => Math.hypot(f.circles[c * 3] - x, f.circles[c * 3 + 1] - z) < f.circles[c * 3 + 2]);
  assert.ok(feed.standing.circles.length > 0, 'cars stand at the kerb');
  let people = 0, inThing = 0, inCar = 0, inWall = 0;
  for (const t of tracks.values()) {
    if (a.kind[t.id] !== ACTOR_PERSON) continue;
    people++;
    const k = t.keys, t1 = Math.min(k[k.length - 4], k[0] + 20);
    let thing = false, car = false, wall = false;
    for (let i = 4; i < k.length && k[i - 4] < t1; i += 4) {
      const steps = Math.ceil(Math.hypot(k[i + 1] - k[i - 3], k[i + 3] - k[i - 1]) / 0.3);
      for (let j = 0; j < steps; j++) {
        sample(k, k[i - 4] + ((k[i] - k[i - 4]) * j) / steps, p);
        if (inside(map.fp, p[0], p[2])) thing = true;
        if (inside(feed.standing, p[0], p[2])) car = true;
        // The first and last steps are the doorway.
        if (map.fp.insideBuilding(p[0], p[2]) && i > 4 && i < k.length - 4) wall = true;
      }
    }
    if (thing) inThing++;
    if (car) inCar++;
    if (wall) inWall++;
  }
  assert.ok(people > 30, `${people} people out`);
  assert.ok(inThing / people < 0.02, `${inThing} of ${people} walk into a thing`);
  assert.ok(inCar / people < 0.02, `${inCar} of ${people} walk into a car at the kerb`);
  assert.ok(inWall / people < 0.02, `${inWall} of ${people} walk through a wall`);
});

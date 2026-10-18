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
import { litShares, windowSlots } from '../src/street/windows';
import { A } from '../src/sim/actors';
import { pointInPoly, polyCentroid } from '../src/geom/geom2';

// The smallest planned town (the street layer needs real streets), its people on a Monday morning.
const town = planTown({ seed: 1, size: 0 });
const graph = placeGraphOf(town);
const world = createWorld(graph, 1);
const map = new StreetMap(town, world.graph);
tick(world, 120); // 08:00
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

test('windows: each building finds its slot from inside its walls, and its windows light up with the people in and awake', () => {
  const slots = windowSlots(town, world.graph);
  let checked = 0;
  town.cells.forEach((plan, ci) => plan.buildings.forEach((b, bi) => {
    const [cx, cz] = polyCentroid(b.poly);
    if (!pointInPoly(b.poly, cx, cz)) return;
    const i = Math.floor((cx - slots.x0) / slots.cell), j = Math.floor((cz - slots.z0) / slots.cell);
    const slot = slots.map[j * slots.w + i] - 1;
    assert.ok(slot >= 0, `building ${ci}/${bi} has a slot`);
    const p = world.graph.places.findIndex((pl) => pl.building === ci * 65536 + bi);
    if (p >= 0) assert.equal(slots.placeSlot[p], slot, 'its places point at it');
    checked++;
  }));
  assert.ok(checked > 20, `${checked} buildings checked`);

  // Two people at a block of flats: awake, asleep, on their way out.
  const home = world.graph.places.findIndex((pl, i) => pl.homes > 1 && slots.placeSlot[i] >= 0);
  const slot = slots.placeSlot[home], out = new Uint8Array(slots.count);
  const at = (activity: number, dest: number) => ({ ...viewOf(world), place: Int32Array.of(home, home), dest: Int32Array.of(dest, dest), activity: Uint8Array.of(activity, activity) });
  litShares(at(A.idle, -1), slots, A.sleep, out);
  assert.ok(out[slot] > 0, 'awake at home: some windows lit');
  assert.ok(out.reduce((n, v, i) => n + (v && i !== slot ? 1 : 0), 0) === 0, 'and only there');
  litShares(at(A.sleep, -1), slots, A.sleep, out);
  assert.equal(out[slot], 0, 'asleep: dark');
  litShares(at(A.travel, home), slots, A.sleep, out);
  assert.equal(out[slot], 0, 'gone out: dark');

  // The real town at 08:00: some homes lit, not all.
  litShares(viewOf(world), slots, A.sleep, out);
  const lit = out.filter((v) => v > 0).length;
  assert.ok(lit > 0 && lit < slots.count, `${lit} of ${slots.count} buildings lit`);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTown } from '../src/plan/town';
import { placeGraphOf } from '../src/plan/placeGraph';
import { createWorld } from '../src/sim/synth';
import { tick } from '../src/sim/world';
import { ACTOR_PERSON } from '../src/sim/actors';
import { StreetMap, OUTDOOR } from '../src/street/streetMap';
import { trackOf, sample, type Track } from '../src/street/tracks';
import { outfitOf, bodyKey, type LookInfo } from '../src/street/looks';

// The smallest planned town (the street layer needs real streets), its people on a Monday morning.
const town = planTown({ seed: 1, size: 0 });
const graph = placeGraphOf(town);
const world = createWorld(graph, 1);
const map = new StreetMap(town, graph);
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
  assert.ok(walking.length > 20, `${walking.length} on their way`);
  const pace: number[] = [];
  for (const t of walking) {
    const k = t.keys, n = k.length / 4, from = graph.places[a.from[t.id]], to = graph.places[a.dest[t.id]];
    assert.equal(k[0], a.depart[t.id]);
    assert.equal(k[(n - 1) * 4], Math.max(a.arrive[t.id], a.depart[t.id] + 0.5));
    if (!OUTDOOR.has(from.kind)) assert.deepEqual([k[1], k[3]], [from.x, from.z], 'leaves by the door');
    if (!OUTDOOR.has(to.kind)) assert.deepEqual([k[(n - 1) * 4 + 1], k[(n - 1) * 4 + 3]], [to.x, to.z], 'goes in by the door');
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
    assert.ok(Math.hypot(p[0] - q[0], p[2] - q[2]) < 0.01, `${graph.places[a.place[t.id]].kind}: same place either way`);
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

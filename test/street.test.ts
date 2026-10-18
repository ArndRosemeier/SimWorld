import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTown } from '../src/plan/town';
import { placeGraphOf } from '../src/plan/placeGraph';
import { createWorld } from '../src/sim/synth';
import { ageOf, householdOf, isPerson, tick, tripOf } from '../src/sim/world';
import { civilOf, daysOf } from '../src/sim/calendar';
import { DECOR_HALLOWEEN, homeDecor } from '../src/sim/decor';
import { DOOR_LEG, doorRound, trickOrTreater } from '../src/street/trickOrTreat';
import { townFace, tripRow, viewOf, viewTransfers } from '../src/sim/view';
import { agendaOn } from '../src/sim/agenda';
import { ACTOR_PERSON } from '../src/sim/actors';
import { StreetMap, OUTDOOR } from '../src/street/streetMap';
import { trackOf, sample, type Track } from '../src/street/tracks';
import { costumeOf, dressUpDay, outfitOf, bodyKey, type LookInfo } from '../src/street/looks';
import { buildingLooksOf, litShares, windowSlots } from '../src/street/windows';
import { spotsFor, whoIsInside } from '../src/street/inside';
import { planInterior } from '../src/interior/building';
import { buildingRef } from '../src/plan/placeGraph';
import { A } from '../src/sim/actors';
import { pointInPoly, polyCentroid } from '../src/geom/geom2';
import { TrafficFeed } from '../src/traffic/feed';
import type { Footprints } from '../src/plan/footprints';
import { PropType } from '../src/plan/cell';
import { SEAT_REACH } from '../src/street/seats';

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

  // How the buildings look: the home's upkeep and wealth on its slot, never 0 (left for "not known yet").
  const looks = townFace(world).looks, two = new Uint8Array(slots.count * 2);
  looks.upkeep[home] = 0; looks.wealth[home] = 1;
  buildingLooksOf(looks, slots, two);
  assert.ok(two.every((v) => v > 0), 'every slot known');
  assert.ok(two[slot * 2] <= 2 + 255 / 2 && two[slot * 2 + 1] >= 255 / 4, `the run-down, well-off home reads ${two[slot * 2]}, ${two[slot * 2 + 1]}`);
});

test('street: walks keep clear of trees, furniture, parked cars (in car parks and at the kerb) and walls', () => {
  // Sampled every 0.3 m of walking: how many people ever step into a thing (their middle inside its outline).
  const near: number[] = [], p: [number, number, number] = [0, 0, 0];
  const inside = (f: Footprints, x: number, z: number, but?: Set<number>) =>
    f.circlesNear(x, z, 0, near).some((c) => !but?.has(f.kinds[c]) && Math.hypot(f.circles[c * 3] - x, f.circles[c * 3 + 1] - z) < f.circles[c * 3 + 2]);
  const SEATS = new Set<number>([PropType.Bench, PropType.CafeChair]);
  assert.ok(feed.standing.circles.length > 0, 'cars stand at the kerb');
  let people = 0, inThing = 0, inCar = 0, inWall = 0;
  for (const t of tracks.values()) {
    if (a.kind[t.id] !== ACTOR_PERSON) continue;
    people++;
    const k = t.keys, t1 = Math.min(k[k.length - 4], k[0] + 20);
    let thing = false, car = false, wall = false;
    // Where they stand to sit down.
    const seatsOf: [number, number][] = [];
    for (let i = 0; i < t.rests.length; i += 4) { sample(k, t.rests[i], p); seatsOf.push([p[0], p[2]]); }
    for (let i = 4; i < k.length && k[i - 4] < t1; i += 4) {
      const steps = Math.ceil(Math.hypot(k[i + 1] - k[i - 3], k[i + 3] - k[i - 1]) / 0.3);
      for (let j = 0; j < steps; j++) {
        sample(k, k[i - 4] + ((k[i] - k[i - 4]) * j) / steps, p);
        // Walking up to a bench to sit on it is not walking into it.
        const sitting = seatsOf.some(([sx, sz]) => Math.hypot(sx - p[0], sz - p[2]) < 0.8);
        if (inside(map.fp, p[0], p[2], sitting ? SEATS : undefined)) thing = true;
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

test('street: strollers sit on bench seats now and then, one to a seat, standing in front of it to sit down', () => {
  const sits: { id: number; t0: number; t1: number; x: number; z: number; yaw: number }[] = [];
  const p: [number, number, number] = [0, 0, 0];
  for (const t of tracks.values()) {
    for (let i = 0; i < t.rests.length; i += 4) {
      sample(t.keys, t.rests[i], p);
      sits.push({ id: t.id, t0: t.rests[i], t1: t.rests[i + 1], x: p[0], z: p[2], yaw: t.rests[i + 2] });
      // Still while seated.
      const q = sample(t.keys, (t.rests[i] + t.rests[i + 1]) / 2, [0, 0, 0]);
      assert.ok(Math.hypot(q[0] - p[0], q[2] - p[2]) < 1e-6, 'they stay put while sitting');
    }
  }
  assert.ok(sits.length > 0, 'somebody sits on a bench');
  for (const s of sits) {
    // A seat right behind where they stand.
    const seat = map.seats.find((q) => Math.hypot(q.x - (s.x + Math.sin(s.yaw) * SEAT_REACH), q.z - (s.z + Math.cos(s.yaw) * SEAT_REACH)) < 0.05);
    assert.ok(seat, `a seat behind ${s.x.toFixed(1)}, ${s.z.toFixed(1)}`);
    for (const o of sits) if (o !== s && o.id !== s.id && Math.hypot(o.x - s.x, o.z - s.z) < 0.05) assert.ok(o.t1 <= s.t0 || o.t0 >= s.t1, 'two people on one seat at once');
  }
});

test('inside: everyone in a building and not leaving is there, a household keeps its home, and beds go to their own sleepers', () => {
  // A building of flats with people at home.
  const flats = world.graph.places.find((p) => p.homes >= 2 && p.building >= 0 && 'cell' in buildingRef(p.building)! && whoIsInside(world, p.building).length >= 3)!;
  assert.ok(flats, 'a block of flats with people in');
  const ins = whoIsInside(world, flats.building);
  for (const p of ins) assert.ok(a.place[p.id] === flats.id && a.dest[p.id] < 0, `${p.id} is in`);
  const unitOf = new Map<number, number>();
  for (const p of ins) {
    const hh = householdOf(world, p.id)!;
    if (hh.home !== flats.id) { assert.equal(p.unit, -1, 'a visitor has no home here'); continue; }
    assert.ok(p.unit >= 0 && p.unit < flats.homes);
    if (unitOf.has(hh.id)) assert.equal(unitOf.get(hh.id), p.unit, 'one household, one home');
    unitOf.set(hh.id, p.unit);
  }
  // At night: each sleeper in a bed of their own home, no spot twice.
  const ref = buildingRef(flats.building) as { cell: number; index: number };
  const spots = planInterior(town.cells[ref.cell].buildings[ref.index]).spots;
  const night = ins.map((p) => ({ ...p, activity: A.sleep }));
  const given = spotsFor(night, spots);
  assert.equal(new Set(given.filter((k) => k >= 0)).size, given.filter((k) => k >= 0).length);
  night.forEach((p, i) => { if (p.unit >= 0 && given[i] >= 0) assert.ok(spots[given[i]].use === 'sleep' && spots[given[i]].unit === p.unit, `bed of home ${p.unit}`); });
  assert.ok(given.some((k) => k >= 0 && spots[k].use === 'sleep'));
});

test('street: on Halloween evening children go round the decorated homes, the small ones with a grown-up, in costume', () => {
  const w = createWorld(graph, 1), c = w.actors.cols;
  const y = civilOf(w.epoch).year, hw = daysOf(y, 10, 31) >= w.epoch ? daysOf(y, 10, 31) : daysOf(y + 1, 10, 31);
  w.clock = (hw - w.epoch) * 1440 + 16 * 60;
  for (let id = 0; id < w.actors.count; id++) c.until[id] = w.clock;
  tick(w, 105); // 17:45
  const out = Array.from({ length: w.actors.count }, (_, id) => id).filter((id) =>
    isPerson(w, id) && c.dest[id] < 0 && c.place[id] >= 0 && trickOrTreater(w, id, c.place[id], c.arrive[id]));
  const kids = out.filter((id) => ageOf(w, id) < 13);
  assert.ok(kids.length >= 5, `${kids.length} children out trick-or-treating`);
  for (const id of kids) if (ageOf(w, id) < 8) assert.ok(c.with[id] >= 0 && ageOf(w, c.with[id]) >= 13, `${id} (${ageOf(w, id).toFixed(0)}) has someone older with them`);
  // Each round rings only at decorated homes, and the walk is at each door in turn.
  const flags = homeDecor(w).flags;
  let rounds = 0;
  for (const id of out) {
    if (c.with[id] >= 0 || rounds >= 12) continue;
    const anchor = c.arrive[id], [home, ...doors] = doorRound(w, map, id, anchor);
    for (const d of doors) assert.ok(flags[d] & DECOR_HALLOWEEN && w.graph.places[d].homes > 0, 'a decorated home');
    if (!doors.length) continue;
    rounds++;
    const t = trackOf(w, map, id, w.clock)!, r = Math.floor((w.clock - anchor) / DOOR_LEG) + 1;
    assert.equal(home, c.home[id]);
    const [dx, dz] = map.doorStep(r < doors.length ? doors[r] : home);
    const p = sample(t.keys, anchor + (r + 0.95) * DOOR_LEG, [0, 0, 0]);
    assert.ok(Math.hypot(p[0] - dx, p[2] - dz) < 0.3, `at the door: ${Math.hypot(p[0] - dx, p[2] - dz).toFixed(2)} m off`);
  }
  assert.ok(rounds >= 3, `${rounds} rounds`);
  // Costumes for children that evening, none for grown-ups, everyday clothes the day before.
  const child: LookInfo = { id: kids[0], sex: c.sex[kids[0]], birth: c.birth[kids[0]], household: -1, role: '' };
  const adult: LookInfo = { id: 0, sex: 0, birth: Math.floor(w.clock / 1440) - 40 * 365, household: -1, role: '' };
  assert.ok(dressUpDay(10, 31, w.clock) && !dressUpDay(10, 30, w.clock) && !dressUpDay(10, 31, w.clock - 3 * 60));
  const everyday = outfitOf(1, child, w.clock, 0.4);
  assert.ok(costumeOf(1, child, w.clock, everyday)?.head || costumeOf(1, child, w.clock, everyday)?.back);
  assert.equal(costumeOf(1, adult, w.clock, everyday), null);
});

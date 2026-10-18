import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTown } from '../src/plan/town';
import { placeGraphOf } from '../src/plan/placeGraph';
import { regionOf } from '../src/plan/region';
import { createWorld } from '../src/sim/synth';
import { runsLike } from '../src/sim/calendar';
import { MINUTES_PER_DAY, dayOf } from '../src/sim/time';
import { transitOf } from '../src/sim/transit';
import { BUS_KEY, exitTowardRegion } from '../src/traffic/buses';
import { carPlace, regionOfPlace, type CarTrip } from '../src/traffic/trips';
import { TownTraffic } from '../src/traffic/townTraffic';

// Setup at file level: making the world is the slow part, and the test times only the drive.
const town = planTown({ seed: 1, size: 0 });
const graph = placeGraphOf(town);
const world = createWorld(graph, 1, { region: regionOf(town) });
const tt = new TownTraffic(town, graph.places, 1);
test('the timetable\'s buses: in from the region, a lay-by stop at every town stop until departure time, out again', () => {
  const T = transitOf(world);
  let day = dayOf(world.clock);
  while (runsLike(world, day * MINUTES_PER_DAY) !== 0) day++;
  let clock = day * MINUTES_PER_DAY + 6 * 60;
  const seen = new Map<number, { stops: number[]; left: number[]; due: number[]; gone: boolean }>();
  let stuck = 0;
  tt.traffic.onHalt = (v, h) => seen.get(v.car.key)?.stops.push(h.tag!);
  tt.traffic.onGone = (v, why) => { if (why === 'stuck') stuck++; const b = seen.get(v.car.key); if (b) b.gone = true; };
  const halted = new Map<number, number>();
  for (let m = 0; m < 100; m++) {
    tt.trips([], clock);
    const before = tt.stats.buses;
    tt.transit(world, clock, clock + 1);
    clock++;
    for (let k = 0; k < 60; k++) {
      tt.update(1);
      for (const v of tt.traffic.vehicles) {
        if (v.car.key < BUS_KEY) continue;
        if (!seen.has(v.car.key)) seen.set(v.car.key, { stops: [], left: [], due: [], gone: false });
        // Pulling out of a stop: not before the timetable says (Traffic time, in game seconds).
        const was = halted.get(v.car.key) ?? -1;
        if (was >= 0 && v.halted < 0) seen.get(v.car.key)!.left.push(tt.traffic.time);
        halted.set(v.car.key, v.halted);
        if (v.halted >= 0 && 'leave' in v.goal) { const due = seen.get(v.car.key)!.due; if (due.length === seen.get(v.car.key)!.stops.length - 1) due.push(v.goal.leave!); }
      }
    }
    assert.ok(tt.stats.buses >= before);
  }
  assert.equal(stuck, 0);
  assert.ok(seen.size >= 3, `${seen.size} buses`);
  const done = [...seen.values()].filter((b) => b.gone);
  assert.ok(done.length >= 2, `${done.length} buses through`);
  for (const b of done) {
    assert.ok(b.stops.length >= 1 && b.stops.every((s) => T.stops[s].place >= 0), 'stops at town stops');
    b.left.forEach((t, i) => assert.ok(t >= b.due[i] - 0.5, `left stop ${i} at ${t}, due ${b.due[i]}`));
  }
});

test('commuters: a car trip to the city leaves town on its road; coming home, the car comes in from there and parks', () => {
  const tr = new TownTraffic(town, graph.places, 1, world);
  tr.placeCars(world.households, (h) => carPlace(world, h));
  const hh = world.households.find((h) => h.car && tr.parking.restAt(h.id))!;
  const city = world.offsite.work[0], home = hh.home;
  const exit = exitTowardRegion(world, tr.net, world.offsite.town[city]);
  const trip = (from: number, to: number): CarTrip => ({ driver: hh.members[0], household: hh.id, from, to, depart: 0, arrive: 0, fromRegion: regionOfPlace(world, from), toRegion: regionOfPlace(world, to) });
  let gone = '', parked = false;
  tr.traffic.onGone = (v, why) => { if (v.car.key === hh.id) gone = why; };
  tr.traffic.onPark = (v) => { if (v.car.key === hh.id) parked = true; };
  tr.trips([trip(home, city)], 0);
  const v = tr.traffic.vehicles.find((x) => x.car.key === hh.id);
  assert.ok(v && 'exit' in v.goal && v.goal.exit === exit, 'it drives off by the road to the city');
  // (The country road out is several kilometres long.)
  for (let k = 0; k < 1500 && !gone; k++) tr.update(1);
  assert.equal(gone, 'exit');
  assert.equal(tr.parking.restAt(hh.id), null, 'the car is in the city, not in town');
  tr.trips([trip(city, home)], 600);
  for (let k = 0; k < 1500 && !parked; k++) tr.update(1);
  assert.ok(parked);
  const at = tr.parking.restAt(hh.id)!, h = graph.places[home];
  assert.ok(Math.hypot(at.x - h.x, at.z - h.z) < 300, 'parked near home');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTown } from '../src/plan/town';
import { placeGraphOf } from '../src/plan/placeGraph';
import { regionOf } from '../src/plan/region';
import { createWorld } from '../src/sim/synth';
import { runsLike } from '../src/sim/calendar';
import { MINUTES_PER_DAY, dayOf } from '../src/sim/time';
import { transitOf } from '../src/sim/transit';
import { BUS_KEY } from '../src/traffic/buses';
import { SERVICE_KEY, ServiceRounds, exitTowardRegion, roundGoal } from '../src/traffic/rounds';
import { agendaOn } from '../src/sim/agenda';
import { carPlace, regionOfPlace, type CarTrip } from '../src/traffic/trips';
import { TownTraffic } from '../src/traffic/townTraffic';
import { CAR_STRIDE, PARKED_STRIDE, POSE_STRIDE, TrafficFeed, vehiclePose } from '../src/traffic/feed';
import { tick } from '../src/sim/world';
import { VISITOR_KEY, visitorsAt } from '../src/traffic/visitors';
import { isOpen } from '../src/sim/schedule';

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
    tt.rounds(world, clock, clock + 1);
    clock++;
    for (let k = 0; k < 60; k++) {
      tt.update(1);
      for (const v of tt.traffic.vehicles) {
        if (v.car.key < BUS_KEY || v.car.key >= SERVICE_KEY) continue;
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

test('service rounds: the bin lorry on bin day streets, post and deliveries on working days, nothing on Sunday', () => {
  const tr = new TownTraffic(town, graph.places, 1, world);
  const sr = new ServiceRounds(world, tr.net);
  let day = dayOf(world.clock);
  while (runsLike(world, day * MINUTES_PER_DAY) !== 1) day++;
  const tue = sr.on(day);
  assert.equal(sr.on(day), tue, 'planned once per day');
  const kinds = tue.map((r) => `${r.car.kind}:${r.car.variant}`);
  assert.ok(kinds.includes('van:2') && kinds.includes('delivery:0') && kinds.includes('delivery:1'), kinds.join(' '));
  const bins = tue.find((r) => r.car.kind === 'truck');
  const binStreets = new Set(agendaOn(world, day).filter((o) => o.kind === 'binDay').map((o) => graph.places[o.place].name));
  if (bins) for (const s of bins.stops) assert.ok(binStreets.has(tr.net.streets[tr.net.edges[s.tag].street]));
  // The lorry only calls at shops that open today.
  for (const s of tue.find((r) => r.car.kind === 'delivery' && r.car.variant === 0)!.stops) assert.ok(graph.places[s.tag].hours.length > 0);
  let sun = day;
  while (runsLike(world, sun * MINUTES_PER_DAY) !== 6) sun++;
  assert.equal(sr.on(sun).length, 0);

  // The post van drives its round: every stop, then out of town, nobody stuck.
  const post = tue.find((r) => r.car.kind === 'van')!;
  let stops = 0, out = false, stuck = 0;
  tr.traffic.onHalt = (v) => { if (v.car.key === post.car.key) stops++; };
  tr.traffic.onGone = (v, why) => { if (why === 'stuck') stuck++; else if (v.car.key === post.car.key) out = true; };
  assert.ok(tr.traffic.enter(post.car, post.enter, roundGoal(post, () => 0)));
  // (Out to the farms on the country roads too: a couple of hours.)
  for (let k = 0; k < 4000 && !out; k++) tr.update(2);
  assert.equal(stops, post.stops.length);
  assert.ok(out && stuck === 0);
});

test('visitors from the region: tradespeople on working days, shoppers to open places, family more at weekends; they park, stay and leave', () => {
  const tr = new TownTraffic(town, graph.places, 1, world);
  let day = dayOf(world.clock);
  while (runsLike(world, day * MINUTES_PER_DAY) !== 1) day++;
  const count = (d: number) => {
    const c = { trade: 0, errand: 0, family: 0 };
    for (let m = d * MINUTES_PER_DAY; m < (d + 1) * MINUTES_PER_DAY; m++) {
      for (const v of visitorsAt(world, tr.net, m)) {
        c[v.why]++;
        assert.ok(v.car.key >= VISITOR_KEY && v.exit >= 0 && tr.net.nodes[v.exit].exit);
        if (v.why === 'errand') assert.ok(graph.places.some((p) => p.x === v.x && p.z === v.z && isOpen(world, p.id, m)), 'shopping where it is open');
      }
    }
    return c;
  };
  const tue = count(day), sun = count(day + 5);
  assert.equal(runsLike(world, (day + 5) * MINUTES_PER_DAY), 6);
  assert.ok(tue.trade > 5 && tue.errand > 10, JSON.stringify(tue));
  assert.equal(sun.trade, 0, 'no tradespeople on Sunday');
  assert.ok(sun.family > tue.family && sun.family > sun.errand, JSON.stringify(sun));

  // Loaded at noon: the visitors who came this morning stand parked; when their stay is over they drive home.
  const noon = day * MINUTES_PER_DAY + 12 * 60;
  tr.visitors(world, noon - 240, noon);
  const guests = [...tr.parking.occupied()].filter((s) => s.car >= VISITOR_KEY);
  assert.ok(guests.length > 3, `${guests.length} visitors parked`);
  assert.ok(guests.every((s) => tr.carOf(s.car).kind !== undefined));
  tr.anchor(noon);
  tr.visitors(world, noon, noon + 240);
  for (let k = 0; k < 10; k++) tr.update(1);
  assert.equal([...tr.parking.occupied()].filter((s) => guests.some((g) => g.car === s.car)).length, 0, 'gone home after their stay');
  assert.ok(tr.traffic.vehicles.some((v) => v.car.key >= VISITOR_KEY && 'exit' in v.goal), 'driving out of town');
});

test('the feed: the world drives the traffic; moving cars between recorded moments, parked ones in their bays, never both', () => {
  // (Last in the file: it runs the world on.)
  const feed = new TrafficFeed(town, world, 1);
  const first = feed.message();
  assert.ok(first.parked && first.parked.length / PARKED_STRIDE > 50, 'household cars stand in the bays');
  assert.equal(feed.standing.circles.length / 3, (first.parked.length / PARKED_STRIDE) * 3, 'each parked car is three circles to keep clear of');
  let parked = new Set(Array.from({ length: first.parkedCars!.length / CAR_STRIDE }, (_, i) => first.parkedCars![i * CAR_STRIDE]));
  let clock = world.clock, moving = 0;
  const p = [0, 0, 0, 0];
  for (let k = 0; k < 6; k++) {
    clock += 0.75;
    if (Math.floor(clock) > world.clock) tick(world, Math.floor(clock) - world.clock);
    feed.run(clock);
    const m = feed.message();
    if (m.parkedCars) parked = new Set(Array.from({ length: m.parkedCars.length / CAR_STRIDE }, (_, i) => m.parkedCars![i * CAR_STRIDE]));
    const T = m.times, n = m.cars.length / CAR_STRIDE;
    assert.ok(T[0] <= clock && T[T.length - 1] > clock, 'the moments reach past the clock');
    for (let i = 1; i < T.length; i++) assert.ok(T[i] > T[i - 1]);
    moving = Math.max(moving, n);
    for (let i = 0; i < n; i++) {
      assert.ok(!parked.has(m.cars[i * CAR_STRIDE]), 'a car drives or stands, never both');
      vehiclePose(m, i, T[T.length - 1], p);
      assert.ok(Math.abs(p[0] - m.poses[((i + 1) * T.length - 1) * POSE_STRIDE]) < 1e-3);
    }
  }
  assert.ok(moving > 0, 'cars on the road');
});

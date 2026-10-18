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
import { EMERGENCY_KEY, SERVICE_KEY, ServiceRounds, exitTowardRegion, roundGoal } from '../src/traffic/rounds';
import { agendaOn } from '../src/sim/agenda';
import { carPlace, regionOfPlace, type CarTrip } from '../src/traffic/trips';
import { TownTraffic } from '../src/traffic/townTraffic';
import { CAR_STRIDE, HORN_STRIDE, PARKED_STRIDE, POSE_STRIDE, POST_STRIDE, TrafficFeed, vehiclePose } from '../src/traffic/feed';
import { tick } from '../src/sim/world';
import { VISITOR_KEY, visitorsAt } from '../src/traffic/visitors';
import { isOpen } from '../src/sim/schedule';
import { TRAIN_CAR, Trains } from '../src/traffic/trains';
import { closestOnPolyline, resample } from '../src/geom/geom2';
import { homesRadius } from '../src/sim/places';

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
  assert.equal(sr.on(sun).filter((r) => r.car.key < EMERGENCY_KEY).length, 0, 'the emergency services work on Sundays too');

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

test('emergency services: the police call round where a crime was reported and patrol from their station; ambulances, sirens on, to people\'s homes', () => {
  const tr = new TownTraffic(town, graph.places, 1, world);
  const station = graph.places.find((p) => p.kind === 'police')!;
  // Both police cars stand outside the station.
  for (const k of [0, 1]) assert.ok(Math.hypot(tr.parking.restAt(EMERGENCY_KEY + k)!.x - station.x, tr.parking.restAt(EMERGENCY_KEY + k)!.z - station.z) < 150);
  // A burglary logged at midnight: the police come round that day.
  const day = dayOf(world.clock) + 1, home = graph.places.find((p) => p.homes === 1)!;
  world.life.events.push({ day, kind: 'burglary', who: -1, other: -1, place: home.id, fact: -1 });
  const sr = new ServiceRounds(world, tr.net), rounds = sr.on(day);
  world.life.events.pop();
  const call = rounds.find((r) => r.car.key === EMERGENCY_KEY + 1)!;
  assert.deepEqual(call.stops.map((s) => s.tag), [home.id]);
  assert.ok(rounds.filter((r) => r.car.key === EMERGENCY_KEY).length >= 2, 'patrols');
  // Ambulances: a few a month, urgent, to homes.
  let calls = 0;
  for (let d = day; d < day + 60; d++) for (const r of sr.on(d)) if (r.car.kind === 'ambulance') { calls++; assert.ok(r.stops[0].urgent && graph.places[r.stops[0].tag].homes > 0); }
  assert.ok(calls >= 5 && calls <= 40, `${calls} ambulance calls in 60 days`);
  // The police car drives its call from the station and parks there again; an urgent call runs with the siren until it is there.
  let at = 0;
  tr.traffic.onHalt = (v) => { if (v.car.key === call.car.key) at++; };
  assert.ok(tr.traffic.depart(call.car, roundGoal(call, () => 0)));
  const amb = rounds.find((r) => r.car.kind === 'ambulance') ?? [...Array(60).keys()].flatMap((k) => sr.on(day + k)).find((r) => r.car.kind === 'ambulance')!;
  const av = tr.traffic.enter(amb.car, amb.enter, roundGoal(amb, () => 0))!;
  assert.ok(av.siren, 'blue lights and siren on the way');
  let sirenAfter = false, there = false;
  for (let k = 0; k < 2500 && (tr.traffic.vehicles.some((v) => v.car.key === call.car.key) || av.alive); k++) {
    tr.update(2);
    if (av.halted >= 0) there = true;
    else if (there && av.siren) sirenAfter = true;
  }
  assert.ok(at === 1 && tr.parking.has(call.car.key) && Math.hypot(tr.parking.restAt(call.car.key)!.x - station.x, tr.parking.restAt(call.car.key)!.z - station.z) < 150, 'back at the station');
  assert.ok(there && !sirenAfter, 'at the door, then quietly away');
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
  const guests = [...tr.parking.occupied()].filter((s) => s.car >= VISITOR_KEY && s.car < BUS_KEY);
  assert.ok(guests.length > 3, `${guests.length} visitors parked`);
  assert.ok(guests.every((s) => tr.carOf(s.car).kind !== undefined));
  tr.anchor(noon);
  tr.visitors(world, noon, noon + 240);
  for (let k = 0; k < 10; k++) tr.update(1);
  assert.equal([...tr.parking.occupied()].filter((s) => guests.some((g) => g.car === s.car)).length, 0, 'gone home after their stay');
  assert.ok(tr.traffic.vehicles.some((v) => v.car.key >= VISITOR_KEY && 'exit' in v.goal), 'driving out of town');
});

test('the school bus picks up where the homes are, inside the town (never far out along a country road)', () => {
  const T = transitOf(world), centre = graph.places.find((p) => p.kind === 'square')!, reach = homesRadius(graph, centre.x, centre.z);
  const line = T.lines.find((l) => l.name === 'School bus')!;
  for (const r of T.runs.filter((u) => u.line === line.id)) for (const s of r.stops) {
    const p = graph.places[T.stops[s].place];
    if (!p) continue;
    assert.ok(Math.hypot(p.x - centre.x, p.z - centre.z) <= reach + 1, `${T.stops[s].name} is ${Math.hypot(p.x - centre.x, p.z - centre.z).toFixed(0)} m out`);
    assert.ok(p.homes > 0 || p.id === centre.id, `${T.stops[s].name} is at a home`);
  }
});

test('trains: each timetable run stands at the station on time, on the right-hand track, and closes the level crossings it passes', () => {
  const tr = new Trains(world, town);
  const T = transitOf(world), rail = town.macro.rail!, line = resample(rail.pts, 5);
  let day = dayOf(world.clock);
  while (runsLike(world, day * MINUTES_PER_DAY) !== 1) day++;
  const d0 = day * MINUTES_PER_DAY;
  // Every train run of the day stands at the platform the half minute before it leaves.
  const leaving = T.runs.filter((r) => T.lines[r.line].mode === 'train' && T.stops[r.stops[0]].place >= 0 && r.days === 'weekday');
  assert.ok(leaving.length > 10);
  for (const r of leaving.slice(0, 6)) {
    const cars = tr.cars(d0 + r.times[0] - 0.5);
    assert.ok(cars.some((c) => Math.hypot(c.x - rail.sx, c.z - rail.sz) < TRAIN_CAR * 2), `run ${r.id} at the station`);
  }
  let seen = 0, shutAt = -1;
  for (let m = d0 + 7 * 60; m < d0 + 9 * 60; m += 0.25) {
    const cars = tr.cars(m);
    seen += cars.length;
    // On a track: a track's width off the line's middle.
    for (const c of cars) assert.ok(Math.abs(closestOnPolyline(line, c.x, c.z).d - 1.9) < 0.4, 'on a track');
    if (shutAt < 0 && tr.closed(m)[0]) shutAt = m;
  }
  assert.ok(seen > 0 && shutAt > 0, 'trains in the morning, and a crossing closed for one');
  // From the moment it closed, second by second: closed whenever a train is on it, and open again after.
  const x = tr.crossings[0];
  let on = 0, closedOn = 0, reopened = false;
  for (let t = 0; t < 240; t++) {
    const m = shutAt + t / 60, cars = tr.cars(m), shut = tr.closed(m)[0];
    if (cars.some((c) => Math.hypot(c.x - x.x, c.z - x.z) < TRAIN_CAR / 2 + 3)) { on++; if (shut) closedOn++; }
    if (on && !shut) reopened = true;
  }
  assert.ok(on > 0 && closedOn === on && reopened, `${on} s on it, ${closedOn} closed; reopened ${reopened}`);
  // A barrier post at each road's right kerb, either side, its arm reaching to the road's middle.
  for (const c of tr.crossings) {
    assert.equal(c.posts.length, c.stops.length, 'a post at each stop line');
    for (const q of c.posts) {
      const d = Math.hypot(q.x - c.x, q.z - c.z);
      assert.ok(d > 3 && d < 25 && q.arm > 2 && q.arm < 8, `post ${d.toFixed(1)} m off, arm ${q.arm.toFixed(1)} m`);
    }
  }
});

test('the feed: the world drives the traffic; moving cars between recorded moments, parked ones in their bays, never both', () => {
  // (Last in the file: it runs the world on.)
  const feed = new TrafficFeed(town, world, 1);
  const first = feed.message();
  // The crossings' posts once, which crossings are closed every time.
  assert.ok(first.posts && first.posts.length % POST_STRIDE === 0 && first.posts.length > 0, 'the barrier posts');
  assert.equal(Math.max(...Array.from({ length: first.posts.length / POST_STRIDE }, (_, i) => first.posts![i * POST_STRIDE + 5])) + 1, first.closed.length);
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
    assert.equal(m.posts, null, "the posts only in the first message");
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
  // A driver kept waiting sounds the horn: it comes with the next message, once.
  const v = feed.town.traffic.vehicles[0];
  v.wait = 26;
  feed.town.traffic.onHorn!(v);
  const h = feed.message().horns;
  assert.equal(h.length, HORN_STRIDE);
  assert.deepEqual([h[1], h[3], h[4]], [v.x, v.z, 0]);
  assert.equal(feed.message().horns.length, 0);
});

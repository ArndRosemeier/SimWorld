import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTown } from '../src/plan/town';
import { placeGraphOf } from '../src/plan/placeGraph';
import { LineSource } from '../src/plan/roads';
import { createWorld } from '../src/sim/synth';
import { LIMITS, Rule, RoadNet } from '../src/traffic/roadNet';
import { Parking } from '../src/traffic/parking';
import { Traffic, type Car, type Vehicle } from '../src/traffic/traffic';
import { BIKE_KEY, TownTraffic } from '../src/traffic/townTraffic';
import { newRules } from '../src/sim/politics';
import { bikeTripsSince, carPlace, carTripsSince } from '../src/traffic/trips';
import { ageOf, tick } from '../src/sim/world';

// One small town shared by the file (planning it is the expensive part).
const town = planTown({ seed: 1, size: 0 });
const net = new RoadNet(town);
// (Made at file level too: the test times only the drive.)
const graph = placeGraphOf(town);
const world = createWorld(graph, 1);
const sedan = (key: number): Car => ({ key, kind: 'sedan', variant: 0 });
const run = (tr: Traffic, seconds: number, each?: () => void) => { for (let t = 0; t < seconds; t += 0.1) { tr.update(0.1); each?.(); } };

test('the road network: every road but the footpaths, connected, with exits to the region and km/h limits', () => {
  assert.ok(net.edges.length > 50);
  assert.ok(net.nodes.some((n) => n.exit), 'a country road leaves the map');
  // From one exit, every edge of the network is reachable by car.
  const seen = new Set<number>(), start = net.nodes.findIndex((n) => n.exit), stack = [start];
  seen.add(start);
  while (stack.length) for (const e of net.nodes[stack.pop()!].edges) for (const n of [net.edges[e].a, net.edges[e].b]) if (!seen.has(n)) { seen.add(n); stack.push(n); }
  const unreachable = net.edges.filter((e) => !seen.has(e.a)).length;
  assert.ok(unreachable <= net.edges.length * 0.03, `${unreachable} of ${net.edges.length} edges cut off`);
  assert.ok(net.edges.every((e) => (Object.values(LIMITS) as number[]).includes(e.kmh)));
  assert.ok(net.edges.some((e) => e.kmh === LIMITS.country) && net.edges.some((e) => e.kmh === LIMITS.street));
});

test('junctions: lights only where main roads cross, minor roads give way to the main road', () => {
  for (const n of net.nodes) if (n.signal) assert.ok(n.edges.filter((e) => net.edges[e].source === LineSource.Arterial).length >= 4);
  let giveWay = 0;
  net.nodes.forEach((n, ni) => {
    for (const eid of n.edges) {
      const e = net.edges[eid];
      if (net.ruleAt(e, e.b === ni) !== Rule.GiveWay) continue;
      giveWay++;
      // Someone at this junction has priority over it.
      assert.ok(n.edges.some((o) => net.rank(net.edges[o]) < net.rank(e)));
    }
  });
  assert.ok(giveWay > 0);
});

test('cars keep to the right', () => {
  const e = net.edges.find((x) => x.lanes === 1 && x.len > 40)!;
  const p = { x: 0, z: 0, dx: 0, dz: 0 };
  for (const fwd of [true, false]) {
    net.lanePoint(e, e.len / 2, net.laneOffset(e, fwd, 0), p);
    const hx = fwd ? p.dx : -p.dx, hz = fwd ? p.dz : -p.dz;
    const c = { x: 0, z: 0, dx: 0, dz: 0 };
    net.lanePoint(e, e.len / 2, 0, c);
    // x east, z south: the right of heading (hx, hz) is (−hz, hx).
    assert.ok((p.x - c.x) * -hz + (p.z - c.z) * hx > 0.5, `driving ${fwd ? 'a→b' : 'b→a'} on the right`);
  }
});

test('the planner\'s kerbside bays are the parking: each on its street\'s kerb, on the side whose traffic it faces with', () => {
  const bays = town.cells.flatMap((c) => c.parking);
  const parking = new Parking(net, bays), kerb = parking.spots.filter((s) => net.edges[s.edge].park > 0);
  assert.ok(kerb.length > 100 && kerb.length <= bays.length, `${kerb.length} of ${bays.length} bays`);
  const p = { x: 0, z: 0, dx: 0, dz: 0 };
  for (const s of kerb) {
    const e = net.edges[s.edge];
    net.lanePoint(e, s.s, s.side * (e.width / 2 - e.park / 2), p);
    assert.ok(Math.hypot(p.x - s.x, p.z - s.z) < 1.5, `bay ${s.id} ${Math.hypot(p.x - s.x, p.z - s.z).toFixed(1)} m off its kerb`);
    // Facing a → b on the right side, b → a on the left.
    const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
    assert.ok((fx * p.dx + fz * p.dz) * s.side > 0.9, `bay ${s.id} faces against its traffic`);
  }
});

test('a car pulls out, drives across town and parks in the bay it reserved; its old bay is free again', () => {
  const parking = new Parking(net), tr = new Traffic(net, parking);
  const from = parking.spots[5], to = parking.spots[parking.spots.length - 40];
  parking.parkNear(1, from.x, from.z);
  assert.equal(parking.spotOf(1), from);
  let parkedIn: unknown = undefined;
  tr.onPark = (_, s) => { parkedIn = s; };
  const v = tr.depart(sedan(1), { park: true, x: to.x, z: to.z });
  assert.ok(v);
  assert.equal(from.car, -1, 'the old bay is free');
  assert.equal(v!.spot, to, 'the bay at the goal is reserved');
  run(tr, 400, () => { if (!tr.vehicles.length) return; });
  assert.equal(tr.vehicles.length, 0);
  assert.equal(parkedIn, to);
  assert.equal(parking.spotOf(1), to);
});

test('a house\'s driveway is its household\'s: the car backs out of it, drives off, and turns into it again coming home', () => {
  const tt = new TownTraffic(town, graph.places, 1), P = tt.parking, tr = tt.traffic;
  tt.placeCars(world.households, (h) => world.households[h].home);
  const drives = P.spots.filter((s) => s.drive && s.drive.owner >= 0);
  assert.ok(drives.length > 20, `${drives.length} driveways with a car`);
  // At home, each car stands in its own driveway.
  assert.ok(drives.filter((s) => s.car === s.drive!.owner).length > drives.length * 0.9);
  const home = drives[0], key = home.drive!.owner, away = P.spots.find((s) => !s.drive && s.car < 0 && Math.hypot(s.x - home.x, s.z - home.z) > 150)!;
  // Nobody else parks in it, even right beside it.
  P.release(key);
  assert.notEqual(P.reserve(999_999, home.x, home.z), home);
  P.parkNear(key, home.x, home.z);
  assert.equal(P.spotOf(key), home);
  const car: Car = { key, kind: 'sedan', variant: 0 };
  const out = tr.depart(car, { park: true, x: away.x, z: away.z });
  assert.ok(out?.drive?.out, 'backing out');
  assert.ok(Math.hypot(out.x - home.x, out.z - home.z) < 0.5, 'from the spot');
  run(tr, 300, () => undefined);
  assert.equal(P.spotOf(key), away);
  const back = tr.depart(car, { park: true, x: home.x, z: home.z })!;
  assert.equal(back.spot, home, 'its own driveway is reserved for it');
  let turnedIn = false;
  run(tr, 300, () => { if (back.alive && back.drive && !back.drive.out) turnedIn = true; });
  assert.ok(turnedIn, 'turned in from the street');
  assert.equal(P.spotOf(key), home);
});

test('busy streets: nobody drives through anybody, every car arrives', () => {
  const parking = new Parking(net), tr = new Traffic(net, parking);
  let parked = 0, stuck = 0;
  tr.onPark = () => parked++;
  tr.onGone = (_, why) => { if (why === 'stuck') stuck++; };
  const n = 40;
  for (let i = 0; i < n; i++) parking.parkNear(i, parking.spots[(i * 37) % parking.spots.length].x, parking.spots[(i * 37) % parking.spots.length].z);
  // Everyone wants to leave at once: a car waits until there is room to pull out.
  const waiting = new Set(Array.from({ length: n }, (_, i) => i));
  let started = 0;
  const tryStart = () => {
    for (const i of waiting) {
      const g = parking.spots[(i * 53 + 11) % parking.spots.length];
      if (tr.depart(sedan(i), { park: true, x: g.x + 2, z: g.z })) { started++; waiting.delete(i); }
    }
  };
  for (let t = 0; t < 60 && waiting.size; t += 0.5) { tryStart(); run(tr, 0.5); }
  assert.ok(started > n * 0.9, `${started} of ${n} pulled out`);
  let overlaps = 0;
  const check = () => {
    const vs = tr.vehicles.filter((v) => !v.turn);
    for (let i = 0; i < vs.length; i++) for (let j = i + 1; j < vs.length; j++) {
      const a: Vehicle = vs[i], b: Vehicle = vs[j];
      if (a.edge === b.edge && a.fwd === b.fwd && a.lane === b.lane && Math.abs(a.s - b.s) < (a.length + b.length) / 2 - 0.5) overlaps++;
    }
  };
  run(tr, 420, check); // (the longest trip across town takes five and a half minutes)
  assert.equal(overlaps, 0);
  assert.equal(stuck, 0);
  assert.equal(parked, started);
});

test('a car stops at a red light and goes on green', () => {
  const ni = net.nodes.findIndex((n) => n.signal);
  assert.ok(ni >= 0, 'the town has a crossroads of main roads');
  const tr = new Traffic(net, new Parking(net));
  const eid = net.nodes[ni].edges.reduce((b, e) => (net.edges[e].len > net.edges[b].len ? e : b));
  const e = net.edges[eid], fwd = e.b === ni;
  // Wait for the start of this approach's red phase, then put a car 60 m before the junction.
  while (tr.signalGreen(ni, e)) tr.update(0.1);
  const exit = net.nodes.findIndex((n) => n.exit);
  const v = tr.place(sedan(1), eid, fwd, fwd ? e.len - 60 : 60, { exit });
  assert.ok(v);
  let stopped = false, ranRed = false, through = false;
  for (let k = 0; k < 900 && !through; k++) {
    const inLane = v!.edge === eid && !v!.turn, red = !tr.signalGreen(ni, e);
    tr.update(0.1);
    if (inLane && red && v!.speed < 0.05) stopped = true;
    if (inLane && v!.turn) { if (red) ranRed = true; else through = true; }
  }
  assert.ok(stopped && !ranRed && through, `stopped ${stopped}, ran the red ${ranRed}, went on green ${through}`);
});

test('the council\'s rules: the 30 zone slows the centre\'s faster roads only; the bypass takes most through traffic', () => {
  const fast = net.edges.filter((e) => e.kmh > 30);
  const centre = fast.filter((e) => e.centre), outside = fast.filter((e) => !e.centre);
  assert.ok(centre.length > 3 && outside.length > centre.length, `${centre.length} central of ${fast.length}`);
  const before = fast.map((e) => net.limit(e));
  const rules = { ...newRules(), speed30: true };
  const tt = new TownTraffic(town, [], 1);
  tt.obey(rules, 0);
  assert.ok(centre.every((e) => Math.abs(tt.net.limit(tt.net.edges[net.edges.indexOf(e)]) - 30 / 3.6) < 1e-9));
  assert.ok(outside.every((e) => tt.net.limit(tt.net.edges[net.edges.indexOf(e)]) === before[fast.indexOf(e)]) && outside.length > 0);
  const through = (r: typeof rules) => {
    const t = new TownTraffic(town, [], 1);
    t.obey(r, 500);
    // (The morning rush, 7 to 11.)
    for (let m = 7 * 60; m < 11 * 60; m++) { t.trips([], m); t.update(2); }
    return t.stats.through;
  };
  const open = through({ ...newRules(), works: [{ key: 'bypass', what: 'bypass', start: 100, done: 400 }] }), none = through(newRules());
  assert.ok(open < none * 0.5 && open > 0, `${open} with the bypass, ${none} without`);
});

test('a closed level crossing: cars heading for the railway stop at its barrier, a car facing away drives on', () => {
  // A long straight-ish street, a car near its start, a barrier 80 m on.
  const eid = net.edges.reduce((b, e, i) => (e.cls === net.edges[b].cls && e.len > net.edges[b].len && e.len < 400 ? i : b), net.edges.findIndex((e) => e.len > 150));
  const e = net.edges[eid];
  assert.ok(e.len > 150);
  const p = { x: 0, z: 0, dx: 0, dz: 0 }, end = { x: 0, z: 0, dx: 0, dz: 0 };
  net.lanePoint(e, 100, 0, p);
  net.lanePoint(e, e.len - 2, 0, end);
  const tr = new Traffic(net, new Parking(net));
  const exit = net.nodes.findIndex((n) => n.exit);
  const v = tr.place(sedan(1), eid, true, 10, { halt: true, x: end.x, z: end.z, dwell: 1e6, then: { exit } })!;
  assert.ok(v);
  const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw);
  tr.barriers = [{ x: p.x, z: p.z, r: e.width / 2, fx, fz }];
  run(tr, 30);
  assert.equal(v.edge, eid);
  assert.ok(v.s < 100 - v.length / 2 && v.s > 60 && v.speed < 0.1, `waits at the barrier: s ${v.s.toFixed(1)}, speed ${v.speed.toFixed(2)}`);
  // The barrier on the other side of the railway (facing the other way) does not hold it.
  tr.barriers = [{ x: p.x, z: p.z, r: e.width / 2, fx: -fx, fz: -fz }];
  run(tr, 15);
  assert.ok(v.s > 100 || v.edge !== eid, 'drives on');
});

test('the sim drives the traffic: car trips take the household car, which parks near the destination', () => {
  const tt = new TownTraffic(town, graph.places, 1);
  tt.placeCars(world.households, (h) => carPlace(world, h));
  let trips = 0, bikes = 0;
  for (let m = 0; m < 60; m++) {
    const since = world.clock;
    tick(world, 1);
    const t = carTripsSince(world, since);
    trips += t.length;
    for (const trip of t) assert.ok(world.households[trip.household].car && trip.from !== trip.to);
    tt.trips(t, world.clock);
    const b = bikeTripsSince(world, since);
    bikes += b.length;
    for (const r of b) assert.ok(ageOf(world, r.rider) >= 9 && world.travel.mode(r.from, r.to) === 'foot' && world.travel.metres(r.from, r.to) <= 6000, 'a ride in town by someone old enough');
    tt.bikes(b);
    for (let k = 0; k < 20; k++) tt.update(0.5);
  }
  assert.ok(bikes > 0 && tt.stats.bikes === bikes, `some cycle to school and work (${bikes})`);
  assert.ok(trips > 0, 'some people drive in the morning');
  assert.ok(tt.stats.trips > 0 && tt.stats.parked > 0, JSON.stringify(tt.stats));
  // Every parked household car stands in its own bay.
  const keys = [...tt.parking.occupied()].map((s) => s.car);
  assert.equal(new Set(keys).size, keys.length);
});

test('a cyclist rides near the kerb at their own pace, gets off at the door; a car behind overtakes', () => {
  const parking = new Parking(net), tr = new Traffic(net, parking);
  const e = net.edges.find((x) => x.lanes === 1 && x.len > 150 && x.len < 400)!;
  const ei = net.edges.indexOf(e);
  const end = { x: 0, z: 0, dx: 0, dz: 0 };
  net.lanePoint(e, e.len - 8, net.laneOffset(e, true, 0), end);
  const goal = { ride: true as const, x: end.x, z: end.z };
  const bike = tr.place({ key: BIKE_KEY + 1, kind: 'bicycle', variant: 0 }, ei, true, 30, goal)!;
  const car = tr.place(sedan(2), ei, true, 5, goal)!;
  assert.ok(bike && car);
  let gone = '', closest = Infinity, passed = false, top = 0;
  tr.onGone = (v, why) => { if (v === bike) gone = why; };
  run(tr, 120, () => {
    if (!bike.alive) return;
    top = Math.max(top, bike.speed);
    if (car.alive && car.edge === bike.edge && !car.turn && !bike.turn && Math.abs(car.s - bike.s) < 2) closest = Math.min(closest, Math.hypot(car.x - bike.x, car.z - bike.z));
    if (car.alive && car.edge === bike.edge && car.s > bike.s + 6) passed = true;
  });
  assert.ok(passed, 'the car got past');
  assert.ok(closest > 1.2, `it kept ${closest.toFixed(2)} m from the cyclist`);
  assert.ok(top > 3 && top < 7, `the cyclist's speed ${top.toFixed(1)} m/s`);
  assert.equal(gone, 'there', 'the cyclist got off at the door');
});

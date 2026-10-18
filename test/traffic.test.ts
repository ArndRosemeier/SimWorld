import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTown } from '../src/plan/town';
import { placeGraphOf } from '../src/plan/placeGraph';
import { LineSource } from '../src/plan/roads';
import { createWorld } from '../src/sim/synth';
import { tick } from '../src/sim/world';
import { LIMITS, Rule, RoadNet } from '../src/traffic/roadNet';
import { Parking } from '../src/traffic/parking';
import { Traffic, type Car, type Vehicle } from '../src/traffic/traffic';
import { TownTraffic } from '../src/traffic/townTraffic';
import { TripWatcher, carPlace } from '../src/traffic/trips';

// One small town shared by the file (planning it is the expensive part).
const town = planTown({ seed: 1, size: 0 });
const net = new RoadNet(town);
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
  run(tr, 300, check);
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

test('the sim drives the traffic: car trips take the household car, which parks near the destination', () => {
  const graph = placeGraphOf(town);
  const world = createWorld(graph, 1);
  const tt = new TownTraffic(town, graph.places, 1);
  tt.placeCars(world.households, (h) => carPlace(world, h));
  const watcher = new TripWatcher();
  watcher.poll(world);
  let trips = 0;
  for (let m = 0; m < 60; m++) {
    tick(world, 1);
    const t = watcher.poll(world);
    trips += t.length;
    for (const trip of t) assert.ok(world.households[trip.household].car && trip.from !== trip.to);
    tt.trips(t, world.clock);
    for (let k = 0; k < 20; k++) tt.update(0.5);
  }
  assert.ok(trips > 0, 'some people drive in the morning');
  assert.ok(tt.stats.trips > 0 && tt.stats.parked > 0, JSON.stringify(tt.stats));
  // Every parked household car stands in its own bay.
  const keys = [...tt.parking.occupied()].map((s) => s.car);
  assert.equal(new Set(keys).size, keys.length);
});

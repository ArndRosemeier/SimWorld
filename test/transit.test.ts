import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planRegion } from '../src/plan/region';
import { testTown } from '../src/sim/testTown';
import { createWorld } from '../src/sim/synth';
import { schoolDay, runsLike } from '../src/sim/calendar';
import { MINUTES_PER_DAY, atMinute, dayOf } from '../src/sim/time';
import { departures, nextRide, runsAt, runsOnDay, stopTimetables, transitOf } from '../src/sim/transit';

const region = planRegion({
  seed: 5, town: 'Testford', coastal: false, seaBearing: 0, hilliness: 0.4, warmth: 0.5, oldWorld: 0.7,
  railBearing: 90, railTerminus: false, downstreamBearing: 200,
});
const world = createWorld(testTown(5, 1200), 5, { region });
const T = transitOf(world);
const [city, near] = region.places;
/** The clock at hh:mm on the first day from `world.clock` that matches `pick`. */
const dayWhere = (pick: (c: number) => boolean, hh: number, mm = 0) => {
  for (let d = dayOf(world.clock); ; d++) { const c = atMinute(d * MINUTES_PER_DAY, hh * 60 + mm); if (pick(c)) return c; }
};

test('transit: a bus line to the nearby town, a school bus, trains to the city; the same every time', () => {
  assert.equal(transitOf(world), T);
  const names = T.lines.map((l) => l.name);
  assert.ok(names.includes(`Bus 1 to ${near.name}`) && names.includes('School bus') && names.includes(`Trains to ${city.name}`), names.join(', '));
  assert.ok(T.stops.some((s) => s.region === near.name) && T.stops.some((s) => s.region === city.name));
  for (const r of T.runs) for (let i = 1; i < r.times.length; i++) assert.ok(r.times[i] > r.times[i - 1], 'time runs forward along a run');
  const again = transitOf(createWorld(testTown(5, 1200), 5, { region }));
  assert.deepEqual(again.runs, T.runs);
});

test('transit: the school bus runs on school days only and is at school before eight', () => {
  const school = T.lines.find((l) => l.name === 'School bus')!;
  const runs = T.runs.filter((r) => r.line === school.id);
  const morning = runs.find((r) => T.stops[r.stops[r.stops.length - 1]].region === near.name)!;
  assert.ok(morning.stops.length >= 3, 'it picks pupils up round the town');
  assert.ok(morning.times[morning.times.length - 1] <= 8 * 60 && morning.times[0] >= 6 * 60 + 30);
  const term = dayWhere((c) => schoolDay(world, c), 7);
  const weekend = dayWhere((c) => runsLike(world, c) === 5, 7);
  assert.ok(runsOnDay(world, morning, term) && !runsOnDay(world, morning, weekend));
  // Out on the road at the right time.
  const mid = Math.round((morning.times[0] + morning.times[morning.times.length - 1]) / 2);
  assert.ok(runsAt(world, atMinute(term, mid)).some((u) => u.run === morning));
  assert.ok(!runsAt(world, atMinute(weekend, mid)).some((u) => u.run === morning));
});

test('transit: departures and rides from town to the region and back', () => {
  const station = T.stops.find((s) => s.place >= 0 && world.graph.places[s.place].kind === 'station')!;
  const monday = dayWhere((c) => runsLike(world, c) === 0, 7);
  const board = departures(world, station.id, monday, 8);
  assert.equal(board.length, 8);
  for (let i = 1; i < board.length; i++) assert.ok(board[i].clock >= board[i - 1].clock);
  assert.ok(board.every((d) => d.clock >= monday));
  // Rush hour: two trains an hour into the city.
  const toCity = board.filter((d) => T.lines[d.run.line].name === `Trains to ${city.name}` && d.clock < monday + 2 * 60);
  assert.ok(toCity.length >= 3, `${toCity.length} city trains 07-09`);

  const home = world.households[0].home;
  const ride = nextRide(world, home, city.name, monday);
  assert.ok(ride && T.lines[ride.run.line].mode === 'train' && ride.depart >= monday && ride.arrive > ride.depart);
  const back = nextRide(world, near.name, home, monday + 9 * 60);
  assert.ok(back && back.arrive > back.depart);
  // Sunday: no buses, fewer trains.
  const sunday = dayWhere((c) => runsLike(world, c) === 6, 6);
  const sun = departures(world, station.id, sunday, 50).filter((d) => d.clock < sunday + MINUTES_PER_DAY - 6 * 60);
  assert.ok(sun.every((d) => T.lines[d.run.line].mode === 'train'));
  assert.ok(sun.length < board.length * 3);
});

test('transit: on a branch line every train goes towards the city; no railway, no trains', () => {
  const lines = (rail: 'terminus' | null) => transitOf(createWorld(testTown(5, 1200), 5, { region: { ...region, rail } })).lines;
  assert.deepEqual(lines('terminus').filter((l) => l.mode === 'train').map((l) => l.name), [`Trains to ${city.name}`]);
  assert.equal(lines(null).filter((l) => l.mode === 'train').length, 0);
});

test('transit: each town stop has its printed timetable, the times it leaves there by line, way and kind of day', () => {
  const tables = stopTimetables(world);
  assert.ok(tables.length >= 2, `${tables.length} stops in town`);
  for (const t of tables) {
    const st = T.stops.find((s) => s.place === t.place)!;
    assert.equal(st.name, t.name);
    for (const r of t.rows) {
      assert.ok(r.times.length > 0 && r.times.every((m, i) => m >= 0 && m < MINUTES_PER_DAY && (i === 0 || m >= r.times[i - 1])), `${t.name}: ${r.code} to ${r.to}`);
      assert.notEqual(r.to, t.name, 'nothing leaves a stop for itself');
    }
  }
  // What the timetable prints is what leaves: tomorrow's first departures from the stop are on it.
  const t = tables[0], st = T.stops.find((s) => s.place === t.place)!;
  const day = dayWhere((c) => runsLike(world, c) < 5 && !schoolDay(world, c), 0);
  for (const d of departures(world, st.id, day, 4)) {
    const line = T.lines[d.run.line];
    assert.ok(t.rows.some((r) => r.code === line.code && r.days === d.run.days && r.times.includes(d.run.times[d.at] % MINUTES_PER_DAY)), `${line.code} at ${d.clock % MINUTES_PER_DAY}`);
  }
});

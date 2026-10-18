/**
 * Places off the map (town-realism §3, track E): the city and the next town where commuters work, and the secondary
 * school there that the town's older children ride the bus to. Each is a place of kind 'away' whose entrance is the
 * town's gateway (where the main road leaves town) and which lies `beyond` metres further along it. People there are
 * out of town: not drawn, met by nobody in the sim, and back through the gateway when they come home.
 *
 * `createWorld` makes the world's graph from the planner's with these appended (the planner's own graph is left
 * as it is, so its place ids stay valid for the views).
 */
import type { Region, RegionPlace } from './region';
import { WEEKDAYS, type PlaceGraph, type PlaceId, type StaffSlot } from './places';
import { nextRide, transitOf } from './transit';
import type { Mode } from './travel';
import type { World } from './world';

export interface Offsite {
  /** Where commuters work (the city first). */
  work: PlaceId[];
  /** The secondary school (pupils from 11), -1 when the town's own school takes everyone. */
  secondary: PlaceId;
  /** Away place → the region town it is in (the name transit's region stops use). */
  town: Record<PlaceId, string>;
}

const MON_SAT = 0b0111111;
const slot = (role: string, count: number, days: number, start: number, end: number, minAge = 18): StaffSlot =>
  ({ role, count: Math.max(1, Math.round(count)), days, start: start * 60, end: end * 60, minAge });

/** The road node where the town's main road leaves: the node farthest from the middle of town. */
export function gateway(graph: PlaceGraph): number {
  let cx = 0, cz = 0, n = 0;
  for (const p of graph.places) if (p.kind !== 'away') { cx += p.x; cz += p.z; n++; }
  cx /= Math.max(1, n); cz /= Math.max(1, n);
  let best = -1, bd = -1;
  graph.nodes.forEach((node, i) => {
    const d = (node.x - cx) ** 2 + (node.z - cz) ** 2;
    if (d > bd) { bd = d; best = i; }
  });
  return best;
}

/**
 * The planner's graph with the places off the map appended, and which is which. Commuter jobs are sized to the town:
 * about 9.5 % of its people in the city, 3.5 % in the next town (whoever finds no job in town takes one).
 */
export function withOffsite(planned: PlaceGraph, region: Region | undefined): { graph: PlaceGraph; offsite: Offsite } {
  const graph: PlaceGraph = { ...planned, places: planned.places.slice() };
  const gate = gateway(graph);
  if (gate < 0) return { graph, offsite: { work: [], secondary: -1, town: {} } };
  const people = graph.places.reduce((s, p) => s + p.homes, 0) * 2.3;
  // As the region and transit have it: places[0] is the big city, places[1] the larger town nearby (secondary school).
  const city: RegionPlace | undefined = region?.places[0];
  const town: RegionPlace | undefined = region?.places[1];
  const g = graph.nodes[gate];
  const towns: Record<PlaceId, string> = {};
  const place = (name: string, km: number, staff: StaffSlot[], capacity: number, inTown = name): PlaceId => {
    const id = graph.places.length;
    towns[id] = inTown;
    graph.places.push({ id, kind: 'away', name, street: '', x: g.x, z: g.z, node: gate, capacity, homes: 0, hours: [], staff, building: -1, beyond: Math.round(km * 1000 * 1.2) });
    return id;
  };
  const cityName = city?.name ?? 'the city', townName = town?.name ?? 'the nearby town';
  const work = [
    place(cityName, city?.km ?? 60, [
      slot('office worker', people * 0.05, WEEKDAYS, 8.5, 17),
      slot('shop worker', people * 0.015, MON_SAT, 9, 18, 16),
      slot('nurse', people * 0.01, WEEKDAYS, 7, 15.5, 21),
      slot('factory worker', people * 0.02, WEEKDAYS, 6, 14),
    ], 100000),
    place(townName, town?.km ?? 15, [
      slot('office worker', people * 0.02, WEEKDAYS, 8, 16.5),
      slot('warehouse worker', people * 0.015, WEEKDAYS, 7, 15.5),
    ], 100000),
  ];
  // The town's own school teaches up to 10; from 11 they go to the secondary school in the next town.
  const secondary = graph.places.some((p) => p.kind === 'school')
    ? place(`${townName} Secondary School`, town?.km ?? 15, [slot('teacher', people * 0.004, WEEKDAYS, 7.75, 16, 23)], 2000, townName)
    : -1;
  return { graph, offsite: { work, secondary, town: towns } };
}

/**
 * Someone without a car going out of town or coming back: the next bus or train on the timetable (src/sim/transit.ts)
 * between here and the region town of the away place. Null when nothing runs (then they get a lift). Minutes are
 * door to door: the walk to the stop and the wait included.
 */
export function awayRide(world: World, from: PlaceId, to: PlaceId, clock: number): { minutes: number; mode: Mode; run: number } | null {
  const tf = world.offsite.town[from], tt = world.offsite.town[to];
  if ((tf === undefined) === (tt === undefined)) return null;
  const ride = nextRide(world, tf ?? from, tt ?? to, clock);
  if (!ride) return null;
  const mode: Mode = transitOf(world).lines[ride.run.line].mode;
  return { minutes: Math.max(1, (tt !== undefined ? ride.arrive : ride.arrive + ride.walk) - clock), mode, run: ride.run.id };
}

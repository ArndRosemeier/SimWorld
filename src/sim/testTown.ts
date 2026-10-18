/**
 * A synthetic `PlaceGraph` for tests and benchmarks: a grid of named streets with homes for about `size` people,
 * the amenities a town of that size has (scaled per capita, essentials always present), work places sized so most
 * working-age adults can have a job, farms and woods on the edge. Deterministic per seed.
 *
 * Real towns come from the planner (`placeGraphOf(plan)` in src/plan); this one exists so the society sim can be
 * built and tested without it.
 */
import { Rng, deriveSeed } from '@futuremagic/core';
import type { Place, PlaceGraph, PlaceKind, RoadEdge, RoadNode } from './places';
import { defaultHours, defaultStaff, KINDS } from './placeKinds';
import { STREET_STEMS, STREET_SUFFIXES } from './names';

/** Amenities per 2,000 inhabitants, and whether a town of any size has at least one. */
const AMENITIES: [PlaceKind, number, boolean][] = [
  ['bakery', 2, true], ['butcher', 1, false], ['supermarket', 1, true], ['grocer', 1, false], ['cafe', 2, true],
  ['pub', 2, true], ['restaurant', 2, false], ['pharmacy', 1, false], ['doctor', 2, true], ['dentist', 1, false],
  ['hairdresser', 2, false], ['garage', 1, false], ['bank', 1, false], ['post', 1, false], ['shop', 4, false],
  ['school', 1, true], ['kindergarten', 1, true], ['townhall', 1, true], ['police', 1, false], ['fire', 1, false],
  ['church', 1, true], ['library', 1, false], ['station', 1, false], ['vet', 1, false], ['factory', 1, false],
  ['park', 2, true], ['square', 1, true], ['sports', 1, false], ['cemetery', 1, false],
  ['petrol', 1, false], ['hardware', 1, false], ['clothes', 1, false], ['florist', 1, false], ['newsagent', 1, false],
  ['charity', 1, false], ['takeaway', 2, false], ['hotel', 1, false], ['estateagent', 1, false], ['beauty', 1, false],
  ['physio', 1, false], ['gym', 1, false], ['funeral', 1, false], ['carehome', 1, false], ['vacant', 2, false],
];
/** Residents' rooms in a care home per inhabitant of the town. */
const CARE_ROOMS_PER_PERSON = 0.025;
/** Kinds whose staff grows with the town (one big school rather than three small ones). */
const SCALED: ReadonlySet<PlaceKind> = new Set(['school', 'kindergarten', 'supermarket', 'factory', 'townhall']);

const BLOCK = 100; // metres between junctions
const AVG_HOUSEHOLD = 2.3;
/** Share of inhabitants that should find a job in town. */
const JOBS_PER_PERSON = 0.42;

export function testTown(seed: number, size: number): PlaceGraph {
  const rng = new Rng(deriveSeed(seed, 'testTown'));
  const households = Math.max(4, Math.round(size / AVG_HOUSEHOLD));
  // Grid big enough for every lot at ~8 lots per block side.
  const lotsWanted = households * 0.45 + 60 + size / 20;
  const g = Math.max(3, Math.ceil(Math.sqrt(lotsWanted / 8)));

  const nodes: RoadNode[] = [];
  for (let j = 0; j <= g; j++) for (let i = 0; i <= g; i++) nodes.push({ x: i * BLOCK, z: j * BLOCK });
  const nodeAt = (i: number, j: number) => j * (g + 1) + i;
  const edges: RoadEdge[] = [];
  for (let j = 0; j <= g; j++) for (let i = 0; i <= g; i++) {
    if (i < g) edges.push({ a: nodeAt(i, j), b: nodeAt(i + 1, j), length: BLOCK, walk: 1 });
    if (j < g) edges.push({ a: nodeAt(i, j), b: nodeAt(i, j + 1), length: BLOCK, walk: 1 });
  }

  // Street names: rows run east-west, columns north-south.
  const stems = rng.shuffle([...STREET_STEMS]);
  const streetName = (n: number) => `${stems[n % stems.length]} ${STREET_SUFFIXES[n % STREET_SUFFIXES.length]}`;
  const rowStreet = (j: number) => streetName(j);
  const colStreet = (i: number) => streetName(g + 1 + i);

  const places: Place[] = [];
  const addPlace = (kind: PlaceKind, name: string, street: string, x: number, z: number, node: number, homes: number, scale = 1): Place => {
    const info = KINDS[kind];
    const p: Place = {
      id: places.length, kind, name, street, x, z, node,
      capacity: Math.round(info.capacity * (kind === 'apartments' ? homes / 8 : scale)),
      homes, hours: defaultHours(kind), staff: defaultStaff(kind, scale), building: -1,
    };
    places.push(p);
    return p;
  };

  // One street place per named street.
  for (let j = 0; j <= g; j++) addPlace('street', rowStreet(j), rowStreet(j), (g * BLOCK) / 2, j * BLOCK, nodeAt(g >> 1, j), 0, 1);
  for (let i = 0; i <= g; i++) addPlace('street', colStreet(i), colStreet(i), i * BLOCK, (g * BLOCK) / 2, nodeAt(i, g >> 1), 0, 1);

  // Lots along every segment, centre first so amenities cluster downtown and homes spread outward.
  type Lot = { x: number; z: number; node: number; street: string; d: number; n: number };
  const lots: Lot[] = [];
  const c = (g * BLOCK) / 2;
  for (let j = 0; j <= g; j++) for (let i = 0; i <= g; i++) {
    for (let k = 1; k <= 4; k++) {
      const f = k / 5;
      if (i < g) {
        const x = (i + f) * BLOCK, z = j * BLOCK;
        lots.push({ x, z, node: nodeAt(f < 0.5 ? i : i + 1, j), street: rowStreet(j), d: Math.hypot(x - c, z - c), n: 0 });
      }
      if (j < g) {
        const x = i * BLOCK, z = (j + f) * BLOCK;
        lots.push({ x, z, node: nodeAt(i, f < 0.5 ? j : j + 1), street: colStreet(i), d: Math.hypot(x - c, z - c), n: 0 });
      }
    }
  }
  lots.sort((a, b) => a.d - b.d || a.x - b.x || a.z - b.z);
  const numbers = new Map<string, number>();
  let next = 0;
  const lot = (): Lot => {
    const l = lots[next++ % lots.length];
    const n = (numbers.get(l.street) ?? 0) + 1 + (rng.int(0, 1));
    numbers.set(l.street, n);
    l.n = n;
    return l;
  };

  // Amenities (downtown).
  let jobs = 0;
  const taken = new Map<PlaceKind, number>();
  const amenity = (kind: PlaceKind, scale: number) => {
    const l = lot();
    const count = (taken.get(kind) ?? 0) + 1;
    taken.set(kind, count);
    const label = kind[0].toUpperCase() + kind.slice(1);
    const name = kind === 'vacant' ? `${l.n} ${l.street}` : `${l.street.split(' ')[0]} ${label}${count > 1 ? ' ' + count : ''}`;
    const rooms = kind === 'carehome' ? Math.max(8, Math.round(size * CARE_ROOMS_PER_PERSON)) : 0;
    const p = addPlace(kind, name, l.street, l.x, l.z, l.node, rooms, scale);
    for (const s of p.staff) jobs += s.count;
  };
  for (const [kind, per2000, essential] of AMENITIES) {
    const want = Math.round((per2000 * size) / 2000);
    const count = Math.max(essential ? 1 : 0, want);
    const scale = SCALED.has(kind) ? Math.max(0.3, (per2000 * size) / 2000 / Math.max(1, count)) : 1;
    for (let i = 0; i < count; i++) amenity(kind, scale);
  }
  // Work places until most adults can find a job in town.
  const work: PlaceKind[] = ['office', 'workshop'];
  for (let i = 0; jobs < size * JOBS_PER_PERSON; i++) amenity(work[i % 2], size < 500 ? 0.5 : 1);

  // Homes: about 70 % of households in houses, the rest in apartment blocks of 6-12.
  let left = households;
  while (left > 0) {
    const l = lot();
    if (left >= 6 && rng.chance(0.3 / 9 * 2)) {
      const homes = Math.min(left, rng.int(6, 12));
      addPlace('apartments', `${l.n} ${l.street}`, l.street, l.x, l.z, l.node, homes);
      left -= homes;
    } else {
      addPlace('house', `${l.n} ${l.street}`, l.street, l.x, l.z, l.node, 1);
      left -= 1;
    }
  }

  // Countryside on the edge: farms with their farmhouses, fields and woods.
  const edge = g * BLOCK;
  const farms = Math.max(1, Math.round((3 * size) / 2000));
  for (let i = 0; i < farms; i++) {
    const x = edge + 150 + i * 120, z = rng.range(0, edge);
    const node = nodeAt(g, Math.round(z / BLOCK));
    const name = `${['Hill', 'Brook', 'Meadow', 'Oak', 'Willow', 'Stone'][i % 6]} Farm`;
    addPlace('farm', name, 'Farm Road', x, z, node, 0);
    addPlace('farmhouse', `${name} House`, 'Farm Road', x + 20, z, node, 1);
    addPlace('field', `${name} Fields`, '', x + 120, z, node, 0);
  }
  addPlace('woods', 'Town Woods', '', -250, edge / 2, nodeAt(0, g >> 1), 0);
  return { places, nodes, edges };
}

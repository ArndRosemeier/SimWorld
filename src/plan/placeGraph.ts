/**
 * The planned town as the society simulation sees it: every home, shop, workplace, public
 * building, farm, park, square and named street as a `Place`, and the road network (arterials,
 * local streets, country roads, farm tracks) as nodes and edges with lengths. New in SimWorld.
 * The type is the sim's (src/sim/places.ts); opening hours, staff and capacity are the sim's
 * per-kind defaults (src/sim/placeKinds.ts), scaled to the town.
 *
 * Pure; a function of the planned town.
 */
import { Rng, deriveSeed, clamp } from '@futuremagic/core';
import { polyArea, polyCentroid, pointInPoly, type Poly } from '../geom/geom2';
import type { Place, PlaceGraph, PlaceKind, RoadEdge, RoadNode } from '../sim/places';
import { KINDS, defaultHours, defaultStaff } from '../sim/placeKinds';
import { dwellingsOf, flatsDoor } from './building';
import { eateryName, type Eatery } from './eatery';
import { AMENITY_LABEL, PLACE_KIND_OF } from './amenities';
import { ROOTS, cityName, shopName } from './names';
import { alongLine, townRoads, upperBound } from './roads';
import { siteToWorld, inSite, type LandmarkKind } from './landmarks';
import { frontDoor } from './terrace';
import { PEOPLE_PER_HOME, type Town } from './town';

/**
 * `Place.building` codes: a town building is `cell * 65536 + index` in its cell plan; a public
 * building's site is SITE + landmark id; a farm is FARM + farm id.
 */
export const SITE = 0x40000000, FARM = 0x50000000;

/** Decode `Place.building` (null for -1). */
export function buildingRef(code: number): { cell: number; index: number } | { site: number } | { farm: number } | null {
  if (code < 0) return null;
  if (code >= FARM) return { farm: code - FARM };
  if (code >= SITE) return { site: code - SITE };
  return { cell: code >>> 16, index: code & 0xffff };
}

const SITE_KIND: Record<LandmarkKind, PlaceKind> = {
  townhall: 'townhall', church: 'church', school: 'school', kindergarten: 'kindergarten', clinic: 'doctor',
  fire: 'fire', supermarket: 'supermarket', sports: 'sports', station: 'station',
};
/** Kinds whose staff and capacity grow with the town (one school for the whole town). */
const BY_TOWN: ReadonlySet<PlaceKind> = new Set(['school', 'kindergarten', 'townhall', 'supermarket', 'doctor', 'police', 'fire']);

/** Share of the town's inhabitants employed by each kind of workplace without customers. */
const JOBS: Partial<Record<PlaceKind, number>> = { factory: 0.1, office: 0.08, workshop: 0.04 };

export function placeGraphOf(town: Town): PlaceGraph {
  const { macro, cells, rural, terrain } = town;
  const seed = town.settings.seed;
  const city = cityName(seed);
  const pop = town.dwellings * PEOPLE_PER_HOME;
  const townScale = clamp(pop / 2000, 0.4, 1.5);

  // ------------------------------------------------------------------ the road network
  const { nodes, lines, streets, nearest: nearestOnLines, addNode } = townRoads(town);
  // Long stretches get a node every ~150 m, so an entrance is never far from its node.
  for (const L of lines) {
    L.cuts.sort((a, b) => a.s - b.s);
    const extra: { s: number; node: number }[] = [];
    for (let k = 0; k + 1 < L.cuts.length; k++) {
      const gap = L.cuts[k + 1].s - L.cuts[k].s, n = Math.floor(gap / 150);
      for (let q = 1; gap > 200 && q <= n; q++) {
        const s = L.cuts[k].s + (gap * q) / (n + 1), [x, z] = alongLine(L, s);
        extra.push({ s, node: addNode(x, z) });
      }
    }
    if (extra.length) L.cuts.push(...extra), L.cuts.sort((a, b) => a.s - b.s);
  }
  const edges: RoadEdge[] = [];
  const edgeSeen = new Set<string>();
  for (const L of lines) {
    for (let k = 0; k + 1 < L.cuts.length; k++) {
      const a = L.cuts[k], b = L.cuts[k + 1];
      if (a.node === b.node || b.s - a.s < 0.5) continue;
      const key = a.node < b.node ? `${a.node},${b.node}` : `${b.node},${a.node}`;
      if (edgeSeen.has(key)) continue;
      edgeSeen.add(key);
      const length = b.s - a.s;
      const grade = Math.abs(terrain.height(nodes[b.node].x, nodes[b.node].z) - terrain.height(nodes[a.node].x, nodes[a.node].z)) / length;
      edges.push({ a: a.node, b: b.node, length: Math.round(Math.max(length, Math.hypot(nodes[b.node].x - nodes[a.node].x, nodes[b.node].z - nodes[a.node].z)) * 10) / 10, walk: Math.round((L.walk / (1 + 4 * grade)) * 100) / 100 });
    }
  }

  connectAll(nodes, edges);

  /** Street, node and arc position for an entrance: the nearest line it fronts. */
  const attach = (x: number, z: number) => {
    const hit = nearestOnLines(x, z, 400);
    if (!hit) {
      let best = 0, bd = Infinity;
      nodes.forEach((n, i) => { const d = Math.hypot(n.x - x, n.z - z); if (d < bd) { bd = d; best = i; } });
      return { node: best, street: -1, s: 0, side: 0 };
    }
    const L = lines[hit.li];
    let k = 0;
    while (k + 2 < L.cuts.length && L.cuts[k + 1].s < hit.s) k++;
    const a = L.cuts[k], b = L.cuts[Math.min(k + 1, L.cuts.length - 1)];
    const node = hit.s - a.s <= b.s - hit.s ? a.node : b.node;
    // Which side of the line (odd numbers left, even right).
    const i = Math.min(L.pts.length - 4, Math.max(0, upperBound(L.cum, hit.s) - 1) * 2);
    const side = (L.pts[i + 2] - L.pts[i]) * (z - L.pts[i + 1]) - (L.pts[i + 3] - L.pts[i + 1]) * (x - L.pts[i]) > 0 ? 1 : 0;
    // A farm track or footpath takes the address of the road it leads off.
    const named = L.street >= 0 ? hit : nearestOnLines(x, z, 2500, -1, true);
    return { node, street: named ? lines[named.li].street : -1, s: named ? named.s : 0, side };
  };

  // ------------------------------------------------------------------ places
  const places: Place[] = [];
  // Names are unique in a town ("Hazel Offices" once; a second one is "Stone Offices").
  const taken = new Set<string>();
  const unique = (name: string, again: (r: Rng) => string, salt: number): string => {
    const r = new Rng(deriveSeed(seed, 'place-name', salt));
    for (let k = 0; k < 12 && taken.has(name); k++) name = again(r);
    for (let k = 2; taken.has(name); k++) name = `${name.replace(/ \d+$/, '')} ${k}`;
    taken.add(name);
    return name;
  };
  const placeOf = (kind: PlaceKind, name: string, street: number, x: number, z: number, node: number, building: number, homes = 0, scale = 1): Place => {
    const p: Place = {
      id: places.length, kind, name: unique(name, (r) => `${r.pick(ROOTS)} ${name.split(' ').slice(1).join(' ')}`, places.length), street: street >= 0 ? streets[street].name : '', x: round1(x), z: round1(z), node,
      capacity: Math.max(1, Math.round(KINDS[kind].capacity * (kind === 'apartments' ? homes / 8 : scale))),
      homes, hours: defaultHours(kind), staff: defaultStaff(kind, scale), building,
    };
    places.push(p);
    return p;
  };
  // House numbers: by position along the street, odd on one side, even on the other.
  const numbers = new Map<number, Set<number>>();
  const houseNumber = (street: number, s: number, side: number): number => {
    let set = numbers.get(street);
    if (!set) numbers.set(street, (set = new Set()));
    let n = 2 * Math.max(0, Math.round(s / 14)) + 1 + side;
    while (set.has(n)) n += 2;
    set.add(n);
    return n;
  };
  const street = (k: number) => (k >= 0 ? streets[k].name : city);

  // Public buildings.
  for (const lm of macro.landmarks) {
    const kind = SITE_KIND[lm.kind];
    const [x, z] = siteToWorld(lm, 0, -lm.hv);
    const at = attach(x, z);
    placeOf(kind, lm.name, at.street, x, z, at.node, SITE + lm.id, 0, BY_TOWN.has(kind) ? townScale : 1);
  }
  // Workplaces share out the town's jobs of their kind by floor area: a town of 1000 has about
  // 100 factory, 80 office and 40 workshop jobs, however many halls the planner built.
  const floorArea = (b: (typeof cells)[number]['buildings'][number]) =>
    Math.abs(polyArea(b.poly)) * (PLACE_KIND_OF[b.amenity!] === 'office' ? Math.max(1, b.floors - (dwellingsOf(b) ? 1 : 0)) : 1);
  const total = new Map<PlaceKind, number>();
  for (const plan of cells) for (const b of plan.buildings) {
    const kind = b.amenity ? PLACE_KIND_OF[b.amenity] : null;
    if (kind && kind in JOBS) total.set(kind, (total.get(kind) ?? 0) + floorArea(b));
  }
  const workScale = (kind: PlaceKind, area: number) => {
    const base = defaultStaff(kind, 1).reduce((s, x) => s + x.count, 0);
    return clamp(((JOBS[kind]! * pop) / base) * (area / total.get(kind)!), 0.1, 3);
  };

  // Homes and ground-floor uses in the town's buildings.
  cells.forEach((plan, ci) => plan.buildings.forEach((b, bi) => {
    const homes = dwellingsOf(b);
    const kind = b.amenity ? PLACE_KIND_OF[b.amenity] : null;
    if (!homes && !kind) return;
    const door = frontDoor(b);
    const at = attach(door.x, door.z);
    const code = ci * 65536 + bi;
    if (kind && b.amenity) {
      const scale = kind in JOBS ? workScale(kind, floorArea(b)) : BY_TOWN.has(kind) ? townScale : 1;
      const name = b.eatery ? eateryName(seed, ci, bi, b.eatery as Eatery)
        : kind === 'shop' ? shopName(seed, ci * 65536 + bi).name
        : kind === 'police' ? `${city} Police`
        : `${street(at.street).split(' ')[0]} ${AMENITY_LABEL[b.amenity]}`.replace(/^\d+\w* /, `${city} `);
      placeOf(kind, name, at.street, door.x, door.z, at.node, code, 0, scale);
    }
    if (homes) {
      // Homes over a shop have their own door (src/plan/building.ts flatsDoor).
      const fd = flatsDoor(b), hd = fd ? frontDoor(b, fd) : door;
      const n = houseNumber(at.street, at.s, at.side);
      placeOf(homes > 1 ? 'apartments' : 'house', `${n} ${street(at.street)}`, at.street, hd.x, hd.z, at.node, code, homes);
    }
  }));
  // Farms: the farmhouse, the farm (work) and its fields.
  const fr = new Rng(deriveSeed(seed, 'farm-names'));
  for (const f of rural.farms) {
    const [gx, gz] = rural.fromFrame(f, -f.hu, 0);
    const at = attach(gx, gz);
    let name = `${fr.pick(ROOTS)} Farm`;
    for (let k = 0; k < 12 && taken.has(name); k++) name = `${fr.pick(ROOTS)} Farm`;
    placeOf('farm', name, at.street, gx, gz, at.node, FARM + f.id);
    placeOf('farmhouse', `${name} House`, at.street, gx, gz, at.node, FARM + f.id, 1);
    const [fx, fz] = rural.fromFrame(f, f.hu + 80, 0);
    placeOf('field', `${name} Fields`, -1, fx, fz, at.node, -1);
  }
  // Parks, squares and cemeteries (not the grounds of the public buildings).
  const pr = new Rng(deriveSeed(seed, 'park-names'));
  const open = (kind: PlaceKind, poly: Poly, name: string) => {
    if (Math.abs(polyArea(poly)) < 300) return;
    const [x, z] = polyCentroid(poly);
    if (!pointInPoly(poly, x, z) || macro.landmarks.some((lm) => inSite(lm, x, z))) return;
    const at = attach(x, z);
    placeOf(kind, name, at.street, x, z, at.node, -1, 0, clamp(Math.abs(polyArea(poly)) / 8000, 0.2, 2));
  };
  for (const plan of cells) {
    for (const s of plan.parks) open('park', s.outer, `${pr.pick(ROOTS)} Park`);
    for (const s of plan.plazas) open('square', s.outer, `${pr.pick(ROOTS)} Square`);
    for (const s of plan.cemeteries) open('cemetery', s.outer, `${city} Cemetery`);
  }
  // The woods nearest the town (a walk out of town).
  const wr = new Rng(deriveSeed(seed, 'woods'));
  const ls = { rural: 0, forest: 0, field: 0, meadow: 1, bank: 0, edge: 0, water: Infinity };
  const woods: [number, number][] = [];
  for (let k = 0; k < 48 && woods.length < 2; k++) {
    const a = (k / 48) * Math.PI * 2 * 7, R = terrain.profile.radius + 300 + (k % 6) * 200;
    const x = Math.cos(a) * R, z = Math.sin(a) * R;
    town.land.sample(x, z, ls);
    if (ls.forest < 0.7 || woods.some(([wx, wz]) => Math.hypot(wx - x, wz - z) < 800)) continue;
    woods.push([x, z]);
    const at = attach(x, z);
    placeOf('woods', `${wr.pick(ROOTS)} Woods`, -1, x, z, at.node, -1);
  }
  // One place per named street, at the middle of its longest stretch.
  streets.forEach((st, k) => {
    if (!st.lines.length) return;
    const L = lines[st.lines.reduce((b, li) => (lines[li].cum[lines[li].cum.length - 1] > lines[b].cum[lines[b].cum.length - 1] ? li : b), st.lines[0])];
    const mid = L.cum[L.cum.length - 1] / 2, [x, z] = alongLine(L, mid);
    const near = L.cuts.reduce((b, c) => (Math.abs(c.s - mid) < Math.abs(b.s - mid) ? c : b), L.cuts[0]);
    placeOf('street', st.name, k, x, z, near.node, -1);
  });
  return { places, nodes: nodes.map((n) => ({ x: round1(n.x), z: round1(n.z) })), edges };
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * A stretch of street the planner left unconnected (a cul-de-sac cut off by a park, a lane
 * whose junction fell between two snaps) joins the rest by a footpath to its nearest node, so
 * every place can be walked to.
 */
function connectAll(nodes: RoadNode[], edges: RoadEdge[]): void {
  for (;;) {
    const comp = new Int32Array(nodes.length).fill(-1);
    const adj: number[][] = nodes.map(() => []);
    for (const e of edges) { adj[e.a].push(e.b); adj[e.b].push(e.a); }
    const size: number[] = [];
    for (let i = 0; i < nodes.length; i++) {
      if (comp[i] >= 0) continue;
      const stack = [i];
      comp[i] = size.length;
      let n = 0;
      while (stack.length) { const u = stack.pop()!; n++; for (const v of adj[u]) if (comp[v] < 0) { comp[v] = size.length; stack.push(v); } }
      size.push(n);
    }
    if (size.length <= 1) return;
    const main = size.indexOf(Math.max(...size));
    // The smallest piece first, to its nearest node in any other piece.
    const lone = size.indexOf(Math.min(...size));
    let a = -1, b = -1, bd = Infinity;
    for (let i = 0; i < nodes.length; i++) if (comp[i] === lone) for (let j = 0; j < nodes.length; j++) {
      if (comp[j] === lone || (lone === main && comp[j] === main)) continue;
      const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].z - nodes[j].z);
      if (d < bd) { bd = d; a = i; b = j; }
    }
    edges.push({ a, b, length: Math.round(Math.max(1, bd) * 10) / 10, walk: 0.8 });
  }
}

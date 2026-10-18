/**
 * Where the town's signs go (town-realism track A: shop signs, street names, the town sign, estate
 * agents' boards): the mounts, not what they say. What a sign says comes from the sim at run time
 * (the town's face: a shop's name and hours now, a home for sale), drawn by src/render/signsView.ts
 * from instance lists built by src/build/signs.ts. New in SimWorld.
 *
 *  - fronts: per workplace building, its sign (a fascia over the shop window, a hanging sign by an
 *    eatery's door, a brass plate by an office door, lettering high on a factory wall) and the
 *    plate by the door with the opening hours;
 *  - homes: per home, where a "for sale" or "to let" board would go (on a post in the front garden,
 *    or on the wall when the house stands at the back of the pavement);
 *  - sites: a name board in front of each public building;
 *  - corners: a street-name post at each junction of two differently named streets;
 *  - gateways: a town sign beside each road where it enters the town.
 *
 * Heights are above the building's floor level (`buildingBase`) for wall mounts and above the
 * ground for free-standing ones; the build layer adds the terrain. Yaw is the instance yaw of the
 * furniture models (their front, -Z, faces (-sin yaw, -cos yaw)).
 *
 * Pure; a function of the planned town. The placement belongs with the planner (it knows the
 * fronts, the gardens and the kerbs); the signs track only reads it.
 */
import { alongLine } from '../geom/geom2';
import { dwellingsOf, flatsDoorBay, streetDoor, type BuildingDesc } from './building';
import { siteToWorld } from './landmarks';
import { eachBuilding } from './placeGraph';
import { LineSource, type TownRoads } from './roads';
import type { Town } from './town';

/** A sign on a building's front: `code` the building (`Place.building`: cell * 65536 + index). */
export interface FrontSign {
  code: number;
  /** fascia: board over the shop window; hanging: a board out from the wall by the door (eateries); plate: by the door (offices); wall: high on the wall (factories, workshops). */
  style: 'fascia' | 'hanging' | 'plate' | 'wall';
  /** The sign's centre (on the wall for wall mounts) and its height above the floor level. */
  x: number;
  z: number;
  y: number;
  yaw: number;
  width: number;
  height: number;
  /** The opening-hours plate beside the door (centre on the wall, height above the floor level). */
  hours: { x: number; z: number; y: number };
}

/** Where a home's estate agent's board goes: `code` the building, `onWall` mounted beside the door rather than on a post. */
export interface HomeSign { code: number; x: number; z: number; y: number; yaw: number; onWall: boolean }

/** A public building's name board (free-standing, beside its entrance): `site` the landmark id. */
export interface SiteSign { site: number; x: number; z: number; yaw: number }

/** A street-name post: its foot and one blade per street (the blade's yaw lays it along the street). */
export interface CornerSign { x: number; z: number; blades: { street: number; yaw: number }[] }

/** A town sign facing the traffic coming in (`street`: the road's street index, -1 unnamed). */
export interface GatewaySign { x: number; z: number; yaw: number; street: number }

export interface SignSpots {
  fronts: FrontSign[];
  homes: HomeSign[];
  sites: SiteSign[];
  corners: CornerSign[];
  gateways: GatewaySign[];
}

/** Instance yaw whose model front (-Z) faces along (nx, nz). */
export const facing = (nx: number, nz: number): number => Math.atan2(-nx, -nz);
/** Instance yaw whose model +X runs along (dx, dz). */
export const along = (dx: number, dz: number): number => Math.atan2(-dz, dx);

/** How far a hanging sign's centre stands out from its wall (m). */
export const HANG_OUT = 0.55;
/** How far out from the wall a mounted sign stands (m): clear of the facade's own relief. */
const OFF_WALL = 0.06;

export function signSpots(town: Town, roads: TownRoads): SignSpots {
  const fronts: FrontSign[] = [], homes: HomeSign[] = [];
  eachBuilding(town.cells, (b, code) => {
    if (b.amenity && b.amenity !== 'vacant' || b.shopfront) fronts.push(frontSign(b, code));
    if (dwellingsOf(b) > 0) homes.push(homeSign(b, code, roads));
  });
  return { fronts, homes, sites: siteSigns(town), corners: cornerSigns(roads), gateways: gatewaySigns(town, roads) };
}

/** The front edge: its start, unit direction, length and the outward normal. */
function facadeFront(b: BuildingDesc) {
  const P = b.poly, n = P.length >> 1, i = b.front % n, j = (i + 1) % n;
  const ax = P[i * 2], az = P[i * 2 + 1], L = Math.hypot(P[j * 2] - ax, P[j * 2 + 1] - az) || 1;
  const dx = (P[j * 2] - ax) / L, dz = (P[j * 2 + 1] - az) / L;
  return { ax, az, dx, dz, L, nx: dz, nz: -dx };
}

function frontSign(b: BuildingDesc, code: number): FrontSign {
  const e = facadeFront(b), door = streetDoor(b);
  const onFront = (s: number, out: number) => ({ x: e.ax + e.dx * s + e.nx * out, z: e.az + e.dz * s + e.nz * out });
  const yaw = facing(e.nx, e.nz);
  const bays = Math.max(1, Math.round(e.L / b.bay)), bayW = e.L / bays;
  // The opening hours: on the wall beside the door, on the side with more room.
  const hs = door.s1 + 0.3 < e.L - 0.2 ? door.s1 + 0.25 : door.s0 - 0.25;
  const hours = { ...onFront(hs, OFF_WALL * 0.5), y: 1.45 };
  if (b.eatery) {
    // A board hung out from the wall on the far side of the door, over the pavement.
    const s = door.s1 + 0.6 < e.L ? door.s1 + 0.45 : Math.max(0.3, door.s0 - 0.45);
    return { code, style: 'hanging', ...onFront(s, HANG_OUT), y: Math.min(b.groundH - 0.2, 3.1), yaw, width: 0.75, height: 0.75, hours };
  }
  if (b.shopfront) {
    // Across the shop's bays (not the flats' door), in the band over the display windows.
    const fb = flatsDoorBay(b, bays);
    let s0 = 0, s1 = e.L;
    if (fb === 0) s0 = bayW;
    else if (fb === 1 && bays > 2) s0 = 2 * bayW;
    else if (fb === 1) s1 = bayW;
    const width = Math.max(1, s1 - s0 - 0.3);
    return { code, style: 'fascia', ...onFront((s0 + s1) / 2, OFF_WALL), y: b.groundH - 0.475, yaw, width, height: 0.6, hours };
  }
  if (b.amenity === 'factory' || b.amenity === 'workshop' || b.amenity === 'garage') {
    const wallH = b.groundH + (b.floors - 1) * b.floorH;
    const width = Math.min(9, e.L * 0.6);
    return { code, style: 'wall', ...onFront(e.L / 2, OFF_WALL), y: Math.max(2.8, Math.min(wallH - 0.9, 5.5)), yaw, width, height: width / 8, hours };
  }
  // A brass plate at eye height on the other side of the door from the hours.
  const ps = hs > door.s1 ? Math.max(0.35, door.s0 - 0.4) : Math.min(e.L - 0.35, door.s1 + 0.4);
  return { code, style: 'plate', ...onFront(ps, OFF_WALL * 0.5), y: 1.6, yaw, width: 0.48, height: 0.06, hours };
}

function homeSign(b: BuildingDesc, code: number, roads: TownRoads): HomeSign {
  const e = facadeFront(b), door = streetDoor(b), yaw = facing(e.nx, e.nz);
  // The front garden: from the wall to the back of the pavement.
  const hit = roads.nearest(door.x + e.nx * 0.5, door.z + e.nz * 0.5, 40);
  const line = hit ? roads.lines[hit.li] : null;
  const garden = hit && line ? hit.d - line.width / 2 - line.sidewalk - 0.5 : 0;
  if (garden > 2 && b.floors <= 3) {
    const out = Math.min(garden - 0.6, Math.max(1.2, garden * 0.6));
    const s = Math.min(e.L - 0.5, door.s1 + 1.2);
    return { code, x: e.ax + e.dx * s + e.nx * out, z: e.az + e.dz * s + e.nz * out, y: 0, yaw, onWall: false };
  }
  // On the wall above the door's side, over head height (flats: the first floor).
  const s = door.s1 + 0.6 < e.L ? door.s1 + 0.45 : Math.max(0.3, door.s0 - 0.45);
  return { code, x: e.ax + e.dx * s + e.nx * OFF_WALL, z: e.az + e.dz * s + e.nz * OFF_WALL, y: b.floors > 1 ? b.groundH + 0.4 : 2.1, yaw, onWall: true };
}

function siteSigns(town: Town): SiteSign[] {
  return town.macro.landmarks.map((lm) => {
    // Beside the entrance path, just inside the site's front edge, facing out (the front is -v).
    const [x, z] = siteToWorld(lm, Math.min(lm.hu * 0.6, 4.5), -lm.hv + 1.4);
    return { site: lm.id, x, z, yaw: facing(Math.sin(lm.angle), -Math.cos(lm.angle)) };
  });
}

/** One arm of a road at a node: its street, unit direction away from the node, half width to the kerb, sidewalk width. */
interface Arm { street: number; dx: number; dz: number; half: number; walk: number }

function armsAt(roads: TownRoads): Arm[][] {
  const arms: Arm[][] = roads.nodes.map(() => []);
  for (const L of roads.lines) {
    if (L.street < 0 || L.source === LineSource.Track || L.source === LineSource.Country) continue;
    const len = L.cum[L.cum.length - 1];
    for (const { s, node } of L.cuts) {
      const [x, z] = alongLine(L, s);
      for (const dir of [1, -1]) {
        const s2 = s + dir * Math.min(4, len / 2);
        if (s2 < -1e-6 || s2 > len + 1e-6 || Math.abs(s2 - s) < 0.5) continue;
        const [x2, z2] = alongLine(L, s2), l = Math.hypot(x2 - x, z2 - z);
        if (l < 0.3) continue;
        arms[node].push({ street: L.street, dx: (x2 - x) / l, dz: (z2 - z) / l, half: L.width / 2, walk: L.sidewalk });
      }
    }
  }
  return arms;
}

function cornerSigns(roads: TownRoads): CornerSign[] {
  const out: CornerSign[] = [];
  armsAt(roads).forEach((arms, ni) => {
    const names = new Set(arms.map((a) => a.street));
    if (arms.length < 3 || names.size < 2) return;
    // The corner between two neighbouring arms (by angle) of different streets, with pavements,
    // that lands clear of every carriageway.
    const angle = (a: Arm) => Math.atan2(a.dz, a.dx);
    const sorted = [...arms].sort((p, q) => angle(p) - angle(q));
    const n = roads.nodes[ni];
    for (let k = 0; k < sorted.length; k++) {
      const a = sorted[k], b = sorted[(k + 1) % sorted.length];
      if (a.street === b.street || a.walk <= 0 || b.walk <= 0) continue;
      // Off street A by its half width and part of its pavement, and off street B likewise: along
      // arm b and arm a, stretched by the angle between them.
      const sin = Math.max(0.35, Math.abs(a.dx * b.dz - a.dz * b.dx));
      const offA = (a.half + a.walk * 0.55) / sin, offB = (b.half + b.walk * 0.55) / sin;
      const x = n.x + a.dx * offB + b.dx * offA, z = n.z + a.dz * offB + b.dz * offA;
      if (!Number.isFinite(x) || Math.hypot(x - n.x, z - n.z) > 30) continue;
      const hit = roads.nearest(x, z, 30);
      if (hit && hit.d < roads.lines[hit.li].width / 2 + 0.4) continue;
      out.push({ x, z, blades: [{ street: a.street, yaw: along(a.dx, a.dz) }, { street: b.street, yaw: along(b.dx, b.dz) }] });
      return;
    }
  });
  return out;
}

function gatewaySigns(town: Town, roads: TownRoads): GatewaySign[] {
  const out: GatewaySign[] = [];
  for (const L of roads.lines) {
    if (L.source !== LineSource.Arterial && L.source !== LineSource.Country) continue;
    const P = L.pts, n = P.length >> 1;
    let prev = town.land.edge(P[0], P[1]);
    for (let k = 1; k < n; k++) {
      const e = town.land.edge(P[k * 2], P[k * 2 + 1]);
      if ((prev > 0) !== (e > 0)) {
        // Crossing the town's outline: the travel direction into town.
        const t = prev / (prev - e), x = P[k * 2 - 2] + (P[k * 2] - P[k * 2 - 2]) * t, z = P[k * 2 - 1] + (P[k * 2 + 1] - P[k * 2 - 1]) * t;
        let dx = P[k * 2] - P[k * 2 - 2], dz = P[k * 2 + 1] - P[k * 2 - 1];
        const l = Math.hypot(dx, dz) || 1;
        dx /= l; dz /= l;
        if (prev <= 0) { dx = -dx; dz = -dz; }
        // Right of the incoming traffic (drive on the right), just outside the outline, facing it.
        const rx = -dz, rz = dx, side = L.width / 2 + Math.max(L.sidewalk, 0) + 1.6;
        const sx = x - dx * 6 + rx * side, sz = z - dz * 6 + rz * side;
        if (!out.some((g) => Math.hypot(g.x - sx, g.z - sz) < 60)) out.push({ x: sx, z: sz, yaw: facing(-dx, -dz), street: L.street });
      }
      prev = e;
    }
  }
  return out;
}

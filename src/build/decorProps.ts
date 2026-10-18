/**
 * Holiday decorations outside, as instance lists (realism plan; the households choose them, src/sim/decor.ts):
 * every place a decoration could go, with what decides whether it is up. The town workers list them once; the
 * view (src/render/decorView.ts) shows the ones the sim's town face puts up today.
 * - Halloween: pumpkins on the doorsteps of homes;
 * - Christmas: strings of lights along the front eaves of houses; the town's tree on the square, and the
 *   market's stalls round it while the market is on;
 * - the summer festival: bunting across the streets round the square, stalls round the square on its days.
 * Each instance carries its building's slot (the town's buildings in `eachBuilding` order, as the lit windows
 * count them; -1 for the town's own), the season it belongs to (`DecorWhen`) and a rank in [0, 1): a building
 * shows the share of its decorations that the share of its households decorating says.
 *
 * Pure. New in SimWorld.
 */
import { hash32, hashToFloat } from '@futuremagic/core';
import { closestOnPolyline, polylineLength, resample } from '../geom/geom2';
import { inShape } from '../geom/clip';
import { townGround } from './ground';
import { RoadClass } from '../plan/types';
import { dwellingsOf, facadeFront, streetDoor } from '../plan/building';
import { along, facing } from '../plan/signs';
import { eachBuilding } from '../plan/placeGraph';
import { footprintsOf } from '../plan/footprints';
import type { CellPlan } from '../plan/cell';
import type { Terrain } from '../world/terrain';
import { buildingBase, buildingHeight } from './massing';
import { InstanceLists, type ModelInstances } from './instanceLists';
import { PROP_STRIDE } from './streetProps';

/** What puts a decoration up: a building's own choice (by its slot) or the town's season and occasions. */
export const enum DecorWhen {
  /** The building's households decorate for Halloween. */
  Halloween = 0,
  /** The building's households put up Christmas lights (slot -1: any household in town does: the season is on). */
  Lights = 1,
  /** The Christmas market is on today. */
  Market = 2,
  /** The festival's bunting is up in town (any household has its bunting out). */
  Bunting = 3,
  /** The summer festival is on today. */
  Festival = 4,
}

/** Floats per instance: a prop's (PROP_STRIDE: x, y, z, yaw, scale, tint rgb, noise) then slot, `DecorWhen`, rank. */
export const DECOR_STRIDE = PROP_STRIDE + 3;

/** Bunting hangs this high over the street (m), on poles at the edges of the sidewalks, round the square this far (m). */
/** At most this many stalls (the nearest free spots to the tree). */
const MAX_STALLS = 10;
const BUNTING_Y = 5.4, BUNTING_REACH = 220, BUNTING_STEP = 32, MAX_SPANS = 48;

/** Every outdoor decoration's instance, by model ('f:<FurnitureKind>:<variant>'), `square` the town's gathering place. */
export function decorInstances(cells: readonly CellPlan[], terrain: Terrain, square: { x: number; z: number } | null): ModelInstances[] {
  const lists = new InstanceLists();
  const ground = townGround(cells, terrain);
  const put = (kind: string, v: number, x: number, y: number, z: number, yaw: number, scale: number, slot: number, when: DecorWhen, rank: number) =>
    lists.add(`f:${kind}:${v}`, x, y, z, yaw, scale, 0, 0, 0, (x * 7.3 + z * 3.1) % 50, slot, when, rank);

  // The homes: pumpkins at the door, lights along the front eaves.
  let slot = 0;
  eachBuilding(cells, (b) => {
    const s = slot++;
    const homes = dwellingsOf(b);
    if (!homes) return;
    const { ax, az, dx: ux, dz: uz, L, nx: ox, nz: oz } = facadeFront(b); // along the front, out of it
    const h = hashToFloat(hash32(b.seed ^ 0x5eed));
    const out = facing(ox, oz);
    const door = streetDoor(b);
    // Two pumpkins either side of the door (the first one up wherever anyone in the building decorates).
    [-1, 1].forEach((side, k) => {
      const x = door.x + ux * side * 0.95 + ox * 0.45, z = door.z + uz * side * 0.95 + oz * 0.45;
      put('pumpkin', k, x, ground(x, z), z, out + side * 0.3, 1, s, DecorWhen.Halloween, (k + h) / 2);
    });
    // String lights on houses and town houses (not on blocks of flats): along the front just under the eaves.
    if (homes > 2 || b.floors > 3) return;
    const y = buildingBase(b, terrain).base + buildingHeight(b) - 0.18, v = h < 0.55 ? 0 : 1;
    const segs = Math.floor((L - 0.6) / 2.5);
    for (let k = 0; k < segs; k++) {
      const t = 0.3 + 1.25 + k * 2.5 + ((L - 0.6) - segs * 2.5) / 2;
      put('stringLights', v, ax + ux * t + ox * 0.22, y, az + uz * t + oz * 0.22, along(ux, uz), 1, s, DecorWhen.Lights, h);
    }
  });

  if (square) {
    const feet = footprintsOf(cells);
    const open = (x: number, z: number, r: number) =>
      feet.overlap(x, z, r) === 0 && !feet.insideBuilding(x, z, r) && cells.some((c) => [...c.plazas, ...c.parks].some((sh) => inShape(sh, x, z)));
    // The tree: on the square's middle, or the nearest free spot to it.
    let tx = square.x, tz = square.z;
    search: for (let r = 0; r <= 12; r += 1.5) for (let a = 0; a < 12; a++) {
      const x = square.x + Math.cos((a / 12) * Math.PI * 2) * r, z = square.z + Math.sin((a / 12) * Math.PI * 2) * r;
      if (open(x, z, 3.2)) { tx = x; tz = z; break search; }
    }
    put('xmasTree', 0, tx, ground(tx, tz), tz, 0, 1, -1, DecorWhen.Lights, 0);
    // Stalls on the open ground nearest the tree, facing it: the market's huts, the festival's striped stalls.
    const stalls: [number, number][] = [];
    for (let r = 6; r <= 42 && stalls.length < MAX_STALLS; r += 3) {
      const m = Math.floor((2 * Math.PI * r) / 4.6);
      for (let k = 0; k < m && stalls.length < MAX_STALLS; k++) {
        const a = (k / m) * Math.PI * 2 + r, x = tx + Math.cos(a) * r, z = tz + Math.sin(a) * r;
        if (!open(x, z, 1.9) || stalls.some(([sx, sz]) => Math.hypot(sx - x, sz - z) < 4.6)) continue;
        stalls.push([x, z]);
        const d = Math.hypot(tx - x, tz - z), yaw = facing((tx - x) / d, (tz - z) / d); // the counter towards the tree
        put('marketStall', 0, x, ground(x, z), z, yaw, 1, -1, DecorWhen.Market, 0);
        put('marketStall', 1, x, ground(x, z), z, yaw, 1, -1, DecorWhen.Festival, 0);
      }
    }
    // Bunting across the streets near the square, a line of pennants between two poles.
    let spans = 0;
    for (const plan of cells) for (const st of plan.streets) {
      if (st.cls === RoadClass.Path || spans >= MAX_SPANS) continue;
      if (closestOnPolyline(st.pts, square.x, square.z).d > BUNTING_REACH) continue;
      const len = polylineLength(st.pts);
      if (len < 40) continue;
      const pts = resample(st.pts, BUNTING_STEP), m = pts.length >> 1;
      for (let i = 1; i < m - 1 && spans < MAX_SPANS; i++) {
        const x = pts[i * 2], z = pts[i * 2 + 1];
        if (Math.hypot(x - square.x, z - square.z) > BUNTING_REACH) continue;
        const dx = pts[i * 2 + 2] - pts[i * 2 - 2], dz = pts[i * 2 + 3] - pts[i * 2 - 1], dl = Math.hypot(dx, dz) || 1;
        const nx = -dz / dl, nz = dx / dl, half = st.width / 2 + st.sidewalk * 0.7;
        const ends = [[x + nx * half, z + nz * half], [x - nx * half, z - nz * half]];
        if (ends.some(([ex, ez]) => feet.insideBuilding(ex, ez, 0.3))) continue;
        for (const [ex, ez] of ends) put('bunting', 1, ex, ground(ex, ez), ez, 0, 1, -1, DecorWhen.Bunting, 0);
        const parts = Math.max(1, Math.round((2 * half) / 3)), sc = (2 * half) / (3 * parts), y = ground(x, z) + BUNTING_Y;
        for (let p = 0; p < parts; p++) {
          const t = -half + (p + 0.5) * (2 * half / parts);
          put('bunting', 0, x + nx * t, y, z + nz * t, along(nx, nz), sc, -1, DecorWhen.Bunting, 0);
        }
        spans++;
      }
    }
  }
  return lists.groups();
}

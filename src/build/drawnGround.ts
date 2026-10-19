/**
 * The height of the ground as it is drawn, at any point of the world: what wheels and feet stand on. The one way to
 * ask it (docs/ARCHITECTURE.md). It reads the very data the ground meshes are built from, the same way they build it:
 * the town cells' draped surfaces (carriageway, kerbs up to the pavements, driveways, lots: `cellGround`), the
 * town bridges' decks (`bridgeGround`), the country roads with their camber and lips, the railway's bed and level
 * crossings, the farmyards (`countryGround`), and elsewhere the terrain mesh (`terrainMeshHeight`, a little under the
 * natural ground). Buildings' floors are not ground. `settle` stands a vehicle on it: each wheel on the ground under
 * it, the body pitched and rolled to match.
 *
 * New in SimWorld. Pure.
 */
import type { Town } from '../plan/town';
import { bridgeGround } from './bridges';
import { cellGround, surfaceStack } from './ground';
import type { CellPlan } from '../plan/cell';
import { polyBounds } from '../geom/geom2';
import { countryGround } from './rural';
import { terrainMeshHeight } from './terrainMesh';

/** Edge of the squares the town's cells are found by (m). */
const G = 64;
/**
 * The terrain under the town's surfaces is read from a grid of its heights this far apart (m), measured when first
 * needed, in blocks of TB × TB points: between them it is nearly flat (the drapes themselves are triangles that
 * follow it to 2 cm), and the analytic terrain is slow to ask four times a wheel.
 */
const TSTEP = 2, TB = 64;

export class DrawnGround {
  private readonly cells = new Map<number, number[]>();
  private readonly box: [number, number, number, number][] = [];
  private readonly cellAt: (((x: number, z: number) => number) | undefined)[] = [];
  private readonly bridges: (x: number, z: number) => number;
  private country: ((x: number, z: number) => number) | null = null;
  private readonly mesh = new Map<number, number>();
  private readonly blocks = new Map<number, Float32Array>();
  private readonly terrainAt = (x: number, z: number): number => this.terrainGrid(x, z);

  constructor(private readonly town: Town) {
    town.cells.forEach((c, id) => {
      // (A cell's ground can reach a little past its bounds: by all its surfaces' outlines.)
      const [x0, z0, x1, z1] = this.box[id] = cellBox(c);
      for (let i = Math.floor(x0 / G); i <= Math.floor(x1 / G); i++) for (let j = Math.floor(z0 / G); j <= Math.floor(z1 / G); j++) {
        const k = i * 65536 + j;
        let l = this.cells.get(k);
        if (!l) this.cells.set(k, (l = []));
        l.push(id);
      }
    });
    this.bridges = bridgeGround(town.macro.bridges, town.terrain, town.macro.edges);
  }

  /** Height of the drawn ground at (x, z). */
  heightAt(x: number, z: number): number {
    const { town } = this;
    let y = this.bridges(x, z);
    // The town's ground where a cell draws some.
    for (const id of this.cells.get(Math.floor(x / G) * 65536 + Math.floor(z / G)) ?? []) {
      const b = this.box[id];
      if (x < b[0] || x > b[2] || z < b[1] || z > b[3]) continue;
      const h = (this.cellAt[id] ??= cellGround(town.cells[id], town.terrain, this.terrainAt))(x, z);
      if (h === h) return y === y ? Math.max(y, h) : h;
    }
    if (y === y) return y;
    // The countryside's surfaces, else the terrain mesh.
    this.country ??= countryGround(town.rural, town.macro.rail, town.terrain);
    y = this.country(x, z);
    // (A country surface over the natural ground is over the terrain mesh too; only its lips dip under that.)
    if (y === y && y >= this.terrainGrid(x, z)) return y;
    const ground = terrainMeshHeight(town.terrain, x, z, this.mesh);
    return y === y ? Math.max(y, ground) : ground;
  }

  /** The terrain's height at (x, z), bilinear between the grid's points. */
  private terrainGrid(x: number, z: number): number {
    const fx = x / TSTEP, fz = z / TSTEP, i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    return (this.gridPoint(i, j) * (1 - u) + this.gridPoint(i + 1, j) * u) * (1 - v) + (this.gridPoint(i, j + 1) * (1 - u) + this.gridPoint(i + 1, j + 1) * u) * v;
  }

  /** The terrain's height at grid point (i, j). */
  private gridPoint(i: number, j: number): number {
    const bi = Math.floor(i / TB), bj = Math.floor(j / TB), key = bi * 65536 + bj;
    let B = this.blocks.get(key);
    if (!B) this.blocks.set(key, (B = new Float32Array(TB * TB).fill(NaN)));
    const k = (i - bi * TB) * TB + (j - bj * TB);
    let y = B[k];
    // (Read back from the array: the first answer is then the same as every later one.)
    if (y !== y) { B[k] = this.town.terrain.height(i * TSTEP, j * TSTEP); y = B[k]; }
    return y;
  }
}

/** The bounds of everything a cell's ground draws. */
function cellBox(c: CellPlan): [number, number, number, number] {
  const b: [number, number, number, number] = [...c.bounds];
  for (const g of surfaceStack(c)) for (const sh of g.shapes) {
    const [x0, z0, x1, z1] = polyBounds(sh.outer);
    b[0] = Math.min(b[0], x0); b[1] = Math.min(b[1], z0); b[2] = Math.max(b[2], x1); b[3] = Math.max(b[3], z1);
  }
  return b;
}

const made = new WeakMap<Town, DrawnGround>();
/** The town's drawn ground (made once per town). */
export function drawnGround(town: Town): DrawnGround {
  let g = made.get(town);
  if (!g) made.set(town, (g = new DrawnGround(town)));
  return g;
}

/** The town's drawn ground as a height function (`heightAt`), for what stands on it: props, trees, signs, decorations. */
export function groundOf(town: Town): (x: number, z: number) => number {
  const g = drawnGround(town);
  return (x, z) => g.heightAt(x, z);
}

/** Wheel contacts: half the wheelbase and half the track, as shares of the vehicle's length and width. */
export const WHEELBASE = 0.31, TRACK = 0.42;

/**
 * A vehicle's height and tilt: pitch (nose up +) and roll (right side up +), radians, and the twist (m) its
 * suspension takes up where the four wheel spots are not in one plane (a junction's crown, a ramp's edge): the front
 * right and back left wheels rise by it (drop, when negative), the other two drop by it, so each touches the ground.
 */
export interface Stance { y: number; pitch: number; roll: number; twist: number }

/** The most a wheel travels up or down on its suspension (m). */
export const SUSPENSION = 0.12;

/**
 * Settle a vehicle at (x, z) facing `yaw` (forward (−sin yaw, −cos yaw)), `length` × `width` m, on `ground`: the
 * drawn ground's height at (x, z) (src/build/drawnGround.ts). `width` 0: a single track
 * (a bicycle; no roll, no twist). Writes into out.
 */
export function settle(ground: (x: number, z: number) => number, x: number, z: number, yaw: number, length: number, width: number, out: Stance): Stance {
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = -fz, rz = fx;
  const hb = length * WHEELBASE, ht = width * TRACK;
  let front: number, back: number, right = 0, left = 0, twist = 0;
  if (ht > 0) {
    const fr = ground(x + fx * hb + rx * ht, z + fz * hb + rz * ht), fl = ground(x + fx * hb - rx * ht, z + fz * hb - rz * ht);
    const br = ground(x - fx * hb + rx * ht, z - fz * hb + rz * ht), bl = ground(x - fx * hb - rx * ht, z - fz * hb - rz * ht);
    front = (fr + fl) / 2; back = (br + bl) / 2; right = (fr + br) / 2; left = (fl + bl) / 2;
    // What the plane through the four misses at each wheel: +twist at front right and back left, -twist at the others.
    twist = Math.max(-SUSPENSION, Math.min(SUSPENSION, (fr - fl - br + bl) / 4));
  } else {
    front = ground(x + fx * hb, z + fz * hb); back = ground(x - fx * hb, z - fz * hb);
  }
  out.y = (front + back) / 2;
  out.pitch = Math.atan2(front - back, 2 * hb);
  out.roll = ht > 0 ? Math.atan2(right - left, 2 * ht) : 0;
  out.twist = twist;
  return out;
}

/**
 * What stands on the ground and cannot be walked through: every planned prop (trees, lamps, benches, bins,
 * café tables, parked cars, …) as circles of its body's size, and every building's footprint. One dataset for
 * everyone who must keep clear of things: people on foot (src/street), and the planner placing more things.
 *
 * Built from the cells' plans (pure). Circles, not boxes: a parked car is three overlapping circles along
 * its length; a bench or a stretch of wall a row of small ones. The sizes are each kind's footprint as an
 * oriented box (half extents across and along).
 */
import { distPointPolyEdge, pointInPoly, polyBounds, type Poly } from '../geom/geom2';
import { PropType, type CellPlan } from './cell';

/**
 * Half extents [hx, hz] in m at scale 1 of each solid prop's footprint, as an oriented box: hx across (the
 * model's x), hz along its yaw (its z). Missing types are walked over or under (manholes, awnings).
 */
const SIZE: Partial<Record<PropType, [number, number]>> = {
  [PropType.Tree]: [0.35, 0.35], // the trunk and its pit; the crown is overhead
  [PropType.Yew]: [0.7, 0.7],
  [PropType.Bush]: [0.8, 0.8],
  [PropType.Hedge]: [1.0, 1.0],
  [PropType.Lamp]: [0.15, 0.15],
  [PropType.TrafficLight]: [0.2, 0.2],
  [PropType.StopSign]: [0.1, 0.1],
  [PropType.Bollard]: [0.12, 0.12],
  [PropType.Hydrant]: [0.25, 0.25],
  [PropType.Bin]: [0.3, 0.3],
  [PropType.Mailbox]: [0.3, 0.3],
  [PropType.Planter]: [0.6, 0.6],
  [PropType.Bench]: [0.95, 0.35],
  [PropType.BusStop]: [1.8, 0.8],
  [PropType.Kiosk]: [1.8, 1.8],
  [PropType.Fountain]: [3.5, 3.5],
  [PropType.Statue]: [1.5, 1.5],
  [PropType.PlayGround]: [4.5, 4.5],
  [PropType.ParkedCar]: [1.0, 2.4],
  [PropType.CafeTable]: [0.45, 0.45],
  [PropType.CafeChair]: [0.3, 0.3],
  [PropType.Parasol]: [0.15, 0.15], // the pole
  [PropType.MenuBoard]: [0.35, 0.3],
  [PropType.TerraceRail]: [1.0, 0.1],
  [PropType.Parklet]: [1.0, 0.9],
  [PropType.CemWall]: [1.3, 0.28],
  [PropType.Gravestone]: [0.35, 0.2],
  [PropType.Grave]: [0.5, 1.1],
  [PropType.Tomb]: [1.5, 1.5],
};
/** Grid cell size (m) of the lookup. */
const CELL = 8;

/** Circles (x, z, r) and building outlines on a grid, for "what is near here?". */
export class Footprints {
  /** Circles: [x, z, r] * n. */
  readonly circles: number[] = [];
  /** The PropType of each circle (-1 for none). */
  readonly kinds: number[] = [];
  /** Building footprints. */
  readonly buildings: Poly[] = [];
  /**
   * Another set laid over this one, asked along with it by `overlap` and `insideBuilding`: what comes and goes
   * (the traffic's parked cars, src/traffic/feed.ts `standing`) over what the plan put there for good.
   */
  also: Footprints | null = null;
  private readonly grid = new Map<number, number[]>();
  private readonly bgrid = new Map<number, number[]>();

  /** Add a circle (`kind`: the PropType it belongs to, -1 for none). */
  circle(x: number, z: number, r: number, kind = -1): void {
    if (r <= 0) return;
    const i = this.circles.length / 3;
    this.circles.push(x, z, r);
    this.kinds.push(kind);
    for (let gx = Math.floor((x - r) / CELL); gx <= Math.floor((x + r) / CELL); gx++)
      for (let gz = Math.floor((z - r) / CELL); gz <= Math.floor((z + r) / CELL); gz++) bucket(this.grid, gx, gz).push(i);
  }

  /** Add a building footprint. */
  building(poly: Poly): void {
    const i = this.buildings.length;
    this.buildings.push(poly);
    const [x0, z0, x1, z1] = polyBounds(poly);
    for (let gx = Math.floor(x0 / CELL); gx <= Math.floor(x1 / CELL); gx++)
      for (let gz = Math.floor(z0 / CELL); gz <= Math.floor(z1 / CELL); gz++) bucket(this.bgrid, gx, gz).push(i);
  }

  /** Indices of the circles that may come within `r` of (x, z) (into `out`, which is cleared first). */
  circlesNear(x: number, z: number, r: number, out: number[]): number[] {
    out.length = 0;
    const gx0 = Math.floor((x - r) / CELL), gx1 = Math.floor((x + r) / CELL), gz0 = Math.floor((z - r) / CELL), gz1 = Math.floor((z + r) / CELL);
    if (gx0 === gx1 && gz0 === gz1) {
      const l = this.grid.get(key(gx0, gz0));
      if (l) for (const i of l) out.push(i);
      return out;
    }
    for (let gx = gx0; gx <= gx1; gx++)
      for (let gz = gz0; gz <= gz1; gz++) {
        for (const i of this.grid.get(key(gx, gz)) ?? []) if (!out.includes(i)) out.push(i);
      }
    return out;
  }

  /** How far (m) a body of radius `r` at (x, z) overlaps the nearest circle, here or in `also` (0: clear). */
  overlap(x: number, z: number, r: number): number {
    // Straight over the grid cells (a circle met twice changes nothing): this is the hot query of every walk.
    let worst = 0;
    const C = this.circles;
    const gx0 = Math.floor((x - r) / CELL), gx1 = Math.floor((x + r) / CELL), gz0 = Math.floor((z - r) / CELL), gz1 = Math.floor((z + r) / CELL);
    for (let gx = gx0; gx <= gx1; gx++)
      for (let gz = gz0; gz <= gz1; gz++) {
        const l = this.grid.get(key(gx, gz));
        if (!l) continue;
        for (let k = 0; k < l.length; k++) {
          const i = l[k] * 3, d = r + C[i + 2] - Math.hypot(C[i] - x, C[i + 1] - z);
          if (d > worst) worst = d;
        }
      }
    return this.also ? Math.max(worst, this.also.overlap(x, z, r)) : worst;
  }

  /** Is (x, z) inside a building, or within `r` of a wall? */
  insideBuilding(x: number, z: number, r = 0): boolean {
    for (const i of this.bgrid.get(key(Math.floor(x / CELL), Math.floor(z / CELL))) ?? []) {
      const p = this.buildings[i];
      if (pointInPoly(p, x, z) || (r > 0 && distPointPolyEdge(p, x, z) < r)) return true;
    }
    return this.also?.insideBuilding(x, z, r) ?? false;
  }
}

/** Everything standing in the planned cells. */
export function footprintsOf(cells: readonly CellPlan[]): Footprints {
  const f = new Footprints();
  for (const plan of cells) {
    const P = plan.props;
    for (let i = 0; i < P.length; i += 6) {
      const size = SIZE[P[i] as PropType];
      if (!size) continue;
      const x = P[i + 1], z = P[i + 2], yaw = P[i + 3], k = P[i + 4] || 1;
      const hx = size[0] * k, hz = size[1] * k;
      // A box as a row of circles of its short half extent along its long axis (a parked car: three).
      const r = Math.min(hx, hz), long = Math.max(hx, hz), n = Math.max(1, Math.round(long / r));
      // Along yaw: (sin, cos); across: (cos, −sin).
      const ux = hz >= hx ? Math.sin(yaw) : Math.cos(yaw), uz = hz >= hx ? Math.cos(yaw) : -Math.sin(yaw);
      for (let j = 0; j < n; j++) {
        const d = n === 1 ? 0 : -(long - r) + (2 * (long - r) * j) / (n - 1);
        f.circle(x + ux * d, z + uz * d, r, P[i]);
      }
    }
    for (const b of plan.buildings) f.building(b.poly);
  }
  return f;
}

const key = (gx: number, gz: number): number => gx * 131071 + gz;
function bucket(m: Map<number, number[]>, gx: number, gz: number): number[] {
  const k = key(gx, gz);
  let l = m.get(k);
  if (!l) m.set(k, (l = []));
  return l;
}

/**
 * What stands on the ground and cannot be walked through: every planned prop (trees, lamps, benches, bins,
 * café tables, parked cars, …) as circles of its body's size, and every building's footprint. One dataset for
 * everyone who must keep clear of things: people on foot (src/street), and the planner placing more things.
 *
 * Built from the cells' plans (pure). Circles, not boxes: a parked car is three overlapping circles along
 * its length; a hedge or wall segment one circle per segment.
 */
import { distPointPolyEdge, pointInPoly, polyBounds, type Poly } from '../geom/geom2';
import { PropType, type CellPlan } from './cell';

/** Radius (m) of each prop kind's body at scale 1, by PropType; 0 for things walked over (manholes) or overhead (awnings). */
const BODY: Record<number, number> = {
  [PropType.Tree]: 0.35, [PropType.Lamp]: 0.15, [PropType.Bench]: 0.85, [PropType.Bin]: 0.3, [PropType.Hydrant]: 0.25,
  [PropType.TrafficLight]: 0.2, [PropType.BusStop]: 1.6, [PropType.Bollard]: 0.15, [PropType.Fountain]: 2.2, [PropType.Statue]: 1,
  [PropType.Bush]: 0.6, [PropType.Kiosk]: 1.4, [PropType.Planter]: 0.5, [PropType.StopSign]: 0.1, [PropType.Hedge]: 0.8,
  [PropType.PlayGround]: 3.5, [PropType.Manhole]: 0, [PropType.Mailbox]: 0.3, [PropType.CafeTable]: 0.4, [PropType.CafeChair]: 0.3,
  [PropType.Parasol]: 0.15, [PropType.Awning]: 0, [PropType.MenuBoard]: 0.35, [PropType.TerraceRail]: 0.5, [PropType.Parklet]: 1.2,
  [PropType.CemWall]: 0.6, [PropType.Gravestone]: 0.4, [PropType.Grave]: 0.9, [PropType.Tomb]: 1.8, [PropType.Yew]: 0.6,
};
/** A parked car: three circles of this radius, this far apart along its length. */
const CAR_R = 1.0, CAR_STEP = 1.45;
/** Grid cell size (m) of the lookup. */
const CELL = 8;

/** Circles (x, z, r) and building outlines on a grid, for "what is near here?". */
export class Footprints {
  /** Circles: [x, z, r] * n. */
  readonly circles: number[] = [];
  /** Building footprints. */
  readonly buildings: Poly[] = [];
  private readonly grid = new Map<number, number[]>();
  private readonly bgrid = new Map<number, number[]>();
  private readonly scratch: number[] = [];

  /** Add a circle. */
  circle(x: number, z: number, r: number): void {
    if (r <= 0) return;
    const i = this.circles.length / 3;
    this.circles.push(x, z, r);
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

  /** How far (m) a body of radius `r` at (x, z) overlaps the nearest circle (0: clear). */
  overlap(x: number, z: number, r: number): number {
    let worst = 0;
    const C = this.circles;
    for (const i of this.circlesNear(x, z, r, this.scratch)) {
      const d = r + C[i * 3 + 2] - Math.hypot(C[i * 3] - x, C[i * 3 + 1] - z);
      if (d > worst) worst = d;
    }
    return worst;
  }

  /** Is (x, z) inside a building, or within `r` of a wall? */
  insideBuilding(x: number, z: number, r = 0): boolean {
    for (const i of this.bgrid.get(key(Math.floor(x / CELL), Math.floor(z / CELL))) ?? []) {
      const p = this.buildings[i];
      if (pointInPoly(p, x, z) || (r > 0 && distPointPolyEdge(p, x, z) < r)) return true;
    }
    return false;
  }
}

/** Everything standing in the planned cells. */
export function footprintsOf(cells: readonly CellPlan[]): Footprints {
  const f = new Footprints();
  for (const plan of cells) {
    const P = plan.props;
    for (let i = 0; i < P.length; i += 6) {
      const t = P[i], x = P[i + 1], z = P[i + 2], yaw = P[i + 3], sc = P[i + 4];
      if (t === PropType.ParkedCar) {
        // Along the car: (sin yaw, cos yaw) (src/build/streetProps.ts puts its front at -that).
        const ax = Math.sin(yaw) * CAR_STEP * sc, az = Math.cos(yaw) * CAR_STEP * sc;
        for (const k of [-1, 0, 1]) f.circle(x + ax * k, z + az * k, CAR_R * sc);
      } else f.circle(x, z, (BODY[t] ?? 0.4) * sc);
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

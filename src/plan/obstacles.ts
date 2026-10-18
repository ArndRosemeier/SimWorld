/**
 * What stands in the way on foot: the footprint of every solid prop of a cell (street furniture,
 * tree trunks, café terraces, parked cars, graves) as oriented boxes, for whoever moves people
 * or cars about (the street layer routes walkers round them, the traffic keeps clear of them).
 * Things one walks over or under (manholes, awnings, parasols' canopies) are left out.
 *
 * New in SimWorld. Pure; a function of the cell plan.
 */
import { PropType, type CellPlan } from './cell';

/** Floats per obstacle: x, z, yaw, hx (half extent across: the model's x), hz (half extent along yaw: its z). */
export const OBSTACLE_STRIDE = 5;

/** Half extents [hx, hz] in m at scale 1, per prop type; missing types are no obstacle. */
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

/** The cell's obstacles, OBSTACLE_STRIDE floats each, in the order of its props. */
export function obstaclesOf(plan: CellPlan): Float32Array {
  const P = plan.props, out: number[] = [];
  for (let i = 0; i < P.length; i += 6) {
    const s = SIZE[P[i] as PropType];
    if (!s) continue;
    const k = P[i + 4] || 1;
    out.push(P[i + 1], P[i + 2], P[i + 3], s[0] * k, s[1] * k);
  }
  return Float32Array.from(out);
}

/** Is (x, z) inside obstacle k of `obs`, grown by `pad` m (a walker's radius)? */
export function inObstacle(obs: Float32Array, k: number, x: number, z: number, pad = 0): boolean {
  const o = k * OBSTACLE_STRIDE, dx = x - obs[o], dz = z - obs[o + 1];
  const s = Math.sin(obs[o + 2]), c = Math.cos(obs[o + 2]);
  // Along yaw: (sin, cos); across: (cos, −sin).
  const along = dx * s + dz * c, across = dx * c - dz * s;
  return Math.abs(across) < obs[o + 3] + pad && Math.abs(along) < obs[o + 4] + pad;
}

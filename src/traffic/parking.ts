/**
 * Where cars stand when nobody drives them: the planner's kerbside bays along the town's streets
 * (clear of the junctions, crossings and driveways; else one every car length along both kerbs),
 * the yards at the ends of the farm tracks, and the houses' own driveways (private: only the car
 * of the household living there parks in one, and it does whenever it comes home).
 * Every car has at most one spot; a journey reserves its spot when it starts, so two cars never
 * head for the same bay. A car with no spot near its goal stands off the street (a garage, a
 * private drive) and is not drawn until it drives again.
 *
 * New in SimWorld (Scale's parked cars were decoration). Pure.
 */
import { LineSource } from '../plan/roads';
import { gridKey as gkey, type RoadNet } from './roadNet';
import { settle } from '../build/drawnGround';
import { DIMS } from './traffic';

export interface Spot {
  id: number;
  /** Edge it is beside, arc length along it, and which side (+1 right of a → b, −1 left). */
  edge: number;
  s: number;
  side: number;
  /** World pose of a car standing in it (forward is (−sin yaw, −cos yaw): with the traffic on its side). */
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Its tilt on the ground there (`settle`): pitch nose up +, roll right side up +, the twist its wheels take up. */
  pitch: number;
  roll: number;
  twist: number;
  /** Car key standing here, or reserved for, or -1. */
  car: number;
  /**
   * A house's driveway (private): the car that may stand here (-1 until a household is given it),
   * and where its mouth meets the kerb lane (arc length on `edge`; `s` is where the car stops before turning in).
   */
  drive?: { owner: number; mouth: number };
}

/** A house's driveway for the parking: its car spot, its mouth, the house's `Place.building` code. */
export interface DriveSpot { x: number; z: number; mx: number; mz: number; code: number }

/** Bay length along the kerb (m). */
const BAY = 6.2;
/** A planner's bay farther than this (m) from the traffic's kerb lane is not used. */
const KERB_FIT = 1.5;
/** How far from its goal a driver looks for a free bay (m). */
const SEARCH = 260;
/** A car parks in its own driveway when its goal is this near (m); it stops this far before the mouth to turn in. */
const HOME_REACH = 40, TURN_IN = 5;
const G = 48;

export class Parking {
  readonly spots: Spot[] = [];
  private readonly grid = new Map<number, number[]>();
  /** Car key → spot id, or -1 when the car stands off the street (`offStreet` holds where). */
  private readonly where = new Map<number, number>();
  readonly offStreet = new Map<number, { x: number; z: number }>();
  /** Spot ids by edge. */
  private readonly byEdge = new Map<number, number[]>();
  /** Driveway spot ids by house (`Place.building` code), and by the car that owns them. */
  private readonly driveOf = new Map<number, number>();
  private readonly ownSpot = new Map<number, number>();

  /**
   * `bays`: the planner's kerbside bays (`CellPlan.parking`, clear of junctions, crossings and driveways); without
   * them a bay every BAY m along both kerbs of every street with parking. `drives`: the houses' driveways.
   */
  constructor(net: RoadNet, bays?: readonly { x: number; z: number }[], drives: readonly DriveSpot[] = []) {
    const tmp = { x: 0, z: 0, dx: 0, dz: 0 };
    net.edges.forEach((e, ei) => {
      const at: [number, number][] = [];
      if (e.park > 0) {
        if (bays) return;
        const back = Math.min(e.len * 0.3, e.width * 0.55 + 2.5) + 3;
        for (let s = back + BAY / 2; s <= e.len - back - BAY / 2; s += BAY) at.push([s, e.width / 2 - e.park / 2 - 0.05], [s, -(e.width / 2 - e.park / 2 - 0.05)]);
      } else if (e.source === LineSource.Track) {
        // A farm track's dead end is the yard: room for a few cars beside the track.
        for (const [end, s0] of [[e.a, 0], [e.b, e.len]] as const) {
          if (net.nodes[end].edges.length !== 1 || e.len < 20) continue;
          for (let k = 0; k < 3; k++) {
            const s = s0 === 0 ? 3 + k * BAY : e.len - 3 - k * BAY;
            at.push([s, e.width / 2 + 1.6], [s, -(e.width / 2 + 1.6)]);
          }
        }
      }
      for (const [s, off] of at) {
        net.lanePoint(e, s, off, tmp);
        const side = Math.sign(off);
        // Parked with the traffic on its side: facing a → b on the right, b → a on the left.
        const dx = side > 0 ? tmp.dx : -tmp.dx, dz = side > 0 ? tmp.dz : -tmp.dz;
        this.addSpot(net, ei, s, side, tmp.x, tmp.z, Math.atan2(-dx, -dz));
      }
    });
    // The planner's bays, on the streets the traffic parks on (a bay on a road without parking lanes, or off the
    // kerb lane the traffic knows, stays empty). The car faces with the traffic on its side.
    for (const b of bays ?? []) {
      const ne = net.nearestEdge(b.x, b.z, 12, (e) => e.park > 0);
      if (!ne) continue;
      const e = net.edges[ne.e];
      net.lanePoint(e, ne.s, ne.side * (e.width / 2 - e.park / 2), tmp);
      if (Math.hypot(tmp.x - b.x, tmp.z - b.z) > KERB_FIT) continue;
      const dx = ne.side > 0 ? tmp.dx : -tmp.dx, dz = ne.side > 0 ? tmp.dz : -tmp.dz;
      this.addSpot(net, ne.e, ne.s, ne.side, b.x, b.z, Math.atan2(-dx, -dz));
    }
    // The driveways: the car comes along the kerb on the mouth's side, stops just short of it and turns in.
    for (const d of drives) {
      const ne = net.nearestEdge(d.mx, d.mz, 12);
      if (!ne || ne.d > 10) continue;
      const e = net.edges[ne.e], s = ne.s - ne.side * TURN_IN;
      if (s < 3 || s > e.len - 3) continue;
      this.driveOf.set(d.code, this.spots.length);
      // Nose to the house, as it drove in.
      this.addSpot(net, ne.e, s, ne.side, d.x, d.z, Math.atan2(d.mx - d.x, d.mz - d.z));
      this.spots[this.spots.length - 1].drive = { owner: -1, mouth: ne.s };
    }
  }

  /** Give the driveway of house `code` (a `Place.building` code) to a car; false when the house has none. */
  own(code: number, car: number): boolean {
    const id = this.driveOf.get(code);
    if (id === undefined) return false;
    const d = this.spots[id].drive!;
    if (d.owner >= 0) this.ownSpot.delete(d.owner);
    d.owner = car;
    this.ownSpot.set(car, id);
    return true;
  }

  /** A spot for a car at (x, z) facing yaw, standing on the drawn ground (a car's size: the stance of the usual car). */
  private addSpot(net: RoadNet, edge: number, s: number, side: number, x: number, z: number, yaw: number): void {
    const id = this.spots.length;
    const [L, W] = DIMS.sedan, st = settle((px, pz) => net.groundAt(px, pz), x, z, yaw, L, W, { y: 0, pitch: 0, roll: 0, twist: 0 });
    this.spots.push({ id, edge, s, side, x, y: st.y, z, yaw, pitch: st.pitch, roll: st.roll, twist: st.twist, car: -1 });
    const k = gkey(Math.floor(x / G), Math.floor(z / G));
    let l = this.grid.get(k);
    if (!l) this.grid.set(k, (l = []));
    l.push(id);
    let le = this.byEdge.get(edge);
    if (!le) this.byEdge.set(edge, (le = []));
    le.push(id);
  }

  /** The spot a car stands in (or is heading for), null when it stands off the street or is unknown. */
  spotOf(car: number): Spot | null {
    const id = this.where.get(car);
    return id !== undefined && id >= 0 ? this.spots[id] : null;
  }

  /** Is the car somewhere at rest (in a spot or off the street)? */
  has(car: number): boolean {
    return this.where.has(car);
  }

  /** Where a car at rest stands: its spot, or its off-street place. */
  restAt(car: number): { x: number; z: number } | null {
    const s = this.spotOf(car);
    return s ?? this.offStreet.get(car) ?? null;
  }

  /** The free spot nearest (x, z) within `max` m for car `car`: its own driveway when that is near, never another's; or null. */
  nearestFree(x: number, z: number, max = SEARCH, car = -1): Spot | null {
    const mine = this.ownSpot.get(car);
    if (mine !== undefined) {
      const s = this.spots[mine];
      if ((s.car < 0 || s.car === car) && Math.hypot(s.x - x, s.z - z) < HOME_REACH) return s;
    }
    let best: Spot | null = null, bd = max;
    const r = Math.ceil(max / G);
    const i0 = Math.floor(x / G), j0 = Math.floor(z / G);
    for (let i = i0 - r; i <= i0 + r; i++) for (let j = j0 - r; j <= j0 + r; j++) {
      for (const id of this.grid.get(gkey(i, j)) ?? []) {
        const s = this.spots[id];
        if (s.car >= 0 || s.drive) continue;
        const d = Math.hypot(s.x - x, s.z - z);
        if (d < bd) { bd = d; best = s; }
      }
    }
    return best;
  }

  /**
   * Put a car at rest near (x, z): the nearest free spot, else off the street there. The car's
   * old spot is freed. Returns the spot, or null for off the street.
   */
  parkNear(car: number, x: number, z: number): Spot | null {
    this.release(car);
    const s = this.nearestFree(x, z, SEARCH, car);
    this.arrive(car, s, x, z);
    return s;
  }

  /** Reserve the free spot nearest (x, z) for a car on its way (null: it will stand off the street). */
  reserve(car: number, x: number, z: number): Spot | null {
    const s = this.nearestFree(x, z, SEARCH, car);
    if (s) s.car = car;
    return s;
  }

  /** A car arrived: it stands in its reserved spot (or, without one, off the street at (x, z)). */
  arrive(car: number, spot: Spot | null, x: number, z: number): void {
    this.release(car);
    if (spot) { spot.car = car; this.where.set(car, spot.id); return; }
    this.where.set(car, -1);
    this.offStreet.set(car, { x, z });
  }

  /** The car drives off: its spot is free again. */
  release(car: number): void {
    const id = this.where.get(car);
    if (id === undefined) return;
    if (id >= 0 && this.spots[id].car === car) this.spots[id].car = -1;
    this.where.delete(car);
    this.offStreet.delete(car);
  }

  /** Give up a reservation that was never used. */
  unreserve(spot: Spot, car: number): void {
    if (spot.car === car && this.where.get(car) !== spot.id) spot.car = -1;
  }

  /** Cars standing in spots (for drawing). */
  *occupied(): Generator<Spot> {
    for (const [car, id] of this.where) if (id >= 0 && this.spots[id].car === car) yield this.spots[id];
  }

  /** Number of spots on an edge (tests, stats). */
  spotsOn(edge: number): number {
    return this.byEdge.get(edge)?.length ?? 0;
  }
}

/**
 * Where cars stand when nobody drives them: kerbside bays along the town's streets (both sides,
 * one car length apart, clear of the junctions) and the yards at the ends of the farm tracks.
 * Every car has at most one spot; a journey reserves its spot when it starts, so two cars never
 * head for the same bay. A car with no spot near its goal stands off the street (a garage, a
 * private drive) and is not drawn until it drives again.
 *
 * New in SimWorld (Scale's parked cars were decoration). Pure.
 */
import { LineSource } from '../plan/roads';
import { gridKey as gkey, type RoadNet } from './roadNet';

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
  /** Car key standing here, or reserved for, or -1. */
  car: number;
}

/** Bay length along the kerb (m). */
const BAY = 6.2;
/** How far from its goal a driver looks for a free bay (m). */
const SEARCH = 260;
const G = 48;

export class Parking {
  readonly spots: Spot[] = [];
  private readonly grid = new Map<number, number[]>();
  /** Car key → spot id, or -1 when the car stands off the street (`offStreet` holds where). */
  private readonly where = new Map<number, number>();
  readonly offStreet = new Map<number, { x: number; z: number }>();
  /** Spot ids by edge. */
  private readonly byEdge = new Map<number, number[]>();

  constructor(net: RoadNet) {
    const tmp = { x: 0, z: 0, dx: 0, dz: 0 };
    net.edges.forEach((e, ei) => {
      const bays: [number, number][] = [];
      if (e.park > 0) {
        const back = Math.min(e.len * 0.3, e.width * 0.55 + 2.5) + 3;
        for (let s = back + BAY / 2; s <= e.len - back - BAY / 2; s += BAY) bays.push([s, e.width / 2 - e.park / 2 - 0.05], [s, -(e.width / 2 - e.park / 2 - 0.05)]);
      } else if (e.source === LineSource.Track) {
        // A farm track's dead end is the yard: room for a few cars beside the track.
        for (const [end, s0] of [[e.a, 0], [e.b, e.len]] as const) {
          if (net.nodes[end].edges.length !== 1 || e.len < 20) continue;
          for (let k = 0; k < 3; k++) {
            const s = s0 === 0 ? 3 + k * BAY : e.len - 3 - k * BAY;
            bays.push([s, e.width / 2 + 1.6], [s, -(e.width / 2 + 1.6)]);
          }
        }
      }
      for (const [s, off] of bays) {
        net.lanePoint(e, s, off, tmp);
        const side = Math.sign(off);
        // Parked with the traffic on its side: facing a → b on the right, b → a on the left.
        const dx = side > 0 ? tmp.dx : -tmp.dx, dz = side > 0 ? tmp.dz : -tmp.dz;
        const id = this.spots.length;
        this.spots.push({ id, edge: ei, s, side, x: tmp.x, y: net.heightAt(e, s), z: tmp.z, yaw: Math.atan2(-dx, -dz), car: -1 });
        const k = gkey(Math.floor(tmp.x / G), Math.floor(tmp.z / G));
        let l = this.grid.get(k);
        if (!l) this.grid.set(k, (l = []));
        l.push(id);
        let le = this.byEdge.get(ei);
        if (!le) this.byEdge.set(ei, (le = []));
        le.push(id);
      }
    });
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

  /** The free spot nearest (x, z) within `max` m, or null. */
  nearestFree(x: number, z: number, max = SEARCH): Spot | null {
    let best: Spot | null = null, bd = max;
    const r = Math.ceil(max / G);
    const i0 = Math.floor(x / G), j0 = Math.floor(z / G);
    for (let i = i0 - r; i <= i0 + r; i++) for (let j = j0 - r; j <= j0 + r; j++) {
      for (const id of this.grid.get(gkey(i, j)) ?? []) {
        const s = this.spots[id];
        if (s.car >= 0) continue;
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
    const s = this.nearestFree(x, z);
    this.arrive(car, s, x, z);
    return s;
  }

  /** Reserve the free spot nearest (x, z) for a car on its way (null: it will stand off the street). */
  reserve(car: number, x: number, z: number): Spot | null {
    const s = this.nearestFree(x, z);
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

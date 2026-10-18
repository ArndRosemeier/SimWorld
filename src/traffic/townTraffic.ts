/**
 * The town's traffic driven by its inhabitants: every household car stands somewhere (in a bay
 * near home, near work, at the supermarket), pulls out when a member of the household sets off
 * on a car trip and parks again near where they are going. Cars from the region pass through on
 * the country roads. Nothing drives that nobody is driving.
 *
 * Fed with the sim's car trips (`CarTrip`, src/traffic/trips.ts) once per game minute and run per
 * frame. New in SimWorld. Pure (no three.js).
 */
import { Rng, deriveSeed, hash32 } from '@futuremagic/core';
import type { Town } from '../plan/town';
import type { Place, PlaceId } from '../sim/places';
import { MINUTES_PER_DAY } from '../sim/time';
import { Parking } from './parking';
import { RoadNet } from './roadNet';
import { Traffic, type Car, type VKind } from './traffic';
import type { CarTrip } from './trips';

/** Household car models, most common first (a small western town). */
const HOUSEHOLD: VKind[] = ['sedan', 'suv', 'hatch', 'wagon', 'pickup', 'suv', 'sedan', 'van', 'hatch', 'pickup', 'sports', 'sedan'];
/** Through traffic on the country roads: cars, vans, lorries. */
const THROUGH: VKind[] = ['sedan', 'suv', 'hatch', 'van', 'pickup', 'truck', 'delivery', 'wagon', 'flatbed'];
/** Keys of cars that belong to nobody in town (through traffic) start here. */
const THROUGH_KEY = 1 << 24;
/** A trip whose car is farther than this from where the driver sets off is walked (or someone gave them a lift). */
const CAR_REACH = 450;
/** Seconds a departure that found no room to pull out keeps trying. */
const RETRY_S = 90;

/** Through cars per hour on the whole town's country roads, by hour of day. */
const THROUGH_PER_HOUR = [1, 0.5, 0.5, 0.5, 1, 3, 8, 14, 12, 9, 8, 9, 10, 9, 9, 10, 13, 15, 11, 8, 6, 4, 3, 2];

/** A household's car model (stable: the same car every time the town is made). */
export function householdCar(seed: number, household: number): Car {
  const h = hash32(deriveSeed(seed, 'car', household));
  return { key: household, kind: HOUSEHOLD[h % HOUSEHOLD.length], variant: (h >>> 8) & 3 };
}

export class TownTraffic {
  readonly net: RoadNet;
  readonly parking: Parking;
  readonly traffic: Traffic;
  private readonly pending: { trip: CarTrip; car: Car; t: number }[] = [];
  private throughN = 0;
  /** Stats for the HUD and tests. */
  readonly stats = { trips: 0, walked: 0, parked: 0, through: 0 };

  constructor(town: Town, private readonly places: readonly Place[], private readonly seed: number) {
    this.net = new RoadNet(town);
    this.parking = new Parking(this.net);
    this.traffic = new Traffic(this.net, this.parking);
    this.traffic.onPark = () => this.stats.parked++;
  }

  /** Put every household car at rest: at `at(household)`'s place (home, or where its driver is). */
  placeCars(households: readonly { id: number; car: boolean }[], at: (household: number) => PlaceId): void {
    for (const h of households) {
      if (!h.car) continue;
      const p = this.places[at(h.id)];
      if (p) this.parking.parkNear(h.id, p.x, p.z);
    }
  }

  /** New car trips from the sim (call once per game minute with what `TripWatcher.poll` returned). */
  trips(trips: readonly CarTrip[], clock: number): void {
    for (const trip of trips) {
      const car = householdCar(this.seed, trip.household);
      const at = this.parking.restAt(car.key), from = this.places[trip.from];
      // The car is out with someone else, or stands somewhere else: on foot this time.
      if (!at || !from || Math.hypot(at.x - from.x, at.z - from.z) > CAR_REACH) { this.stats.walked++; continue; }
      this.stats.trips++;
      if (!this.start(trip, car)) this.pending.push({ trip, car, t: 0 });
    }
    this.through(clock);
  }

  /** Run the cars for dt seconds. */
  update(dt: number): void {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      p.t += dt;
      if (this.start(p.trip, p.car) || p.t > RETRY_S) this.pending.splice(i, 1);
    }
    this.traffic.update(dt);
  }

  private start(trip: CarTrip, car: Car): boolean {
    const to = this.places[trip.to];
    return !!to && !!this.traffic.depart(car, { park: true, x: to.x, z: to.z });
  }

  /** Cars from the region passing through, at the hour's rate (seeded per game minute). */
  private through(clock: number): void {
    const exits = this.net.nodes.map((n, i) => (n.exit ? i : -1)).filter((i) => i >= 0);
    if (exits.length < 2) return;
    const r = new Rng(deriveSeed(this.seed, 'through', clock));
    const rate = THROUGH_PER_HOUR[Math.floor((clock % MINUTES_PER_DAY) / 60)] / 60;
    if (!r.chance(rate)) return;
    const a = r.int(0, exits.length - 1);
    let b = r.int(0, exits.length - 2);
    if (b >= a) b++;
    const car: Car = { key: THROUGH_KEY + this.throughN++, kind: r.pick(THROUGH), variant: r.int(0, 3) };
    if (this.traffic.enter(car, exits[a], { exit: exits[b] })) this.stats.through++;
  }
}

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
import { Buses } from './buses';
import { ServiceRounds, exitTowardRegion, roundGoal } from './rounds';
import type { World } from '../sim/world';

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
  /** Vehicles waiting for room to pull out or come in: tried every frame until they go or RETRY_S runs out. */
  private readonly waiting: { go: () => boolean; t: number }[] = [];
  private throughN = 0;
  private buses: Buses | null = null;
  private services: ServiceRounds | null = null;
  private world: World | null = null;
  /** Game clock (s) minus Traffic time (s): set at every game minute, or once for good by `anchor`. */
  private clockOffset = 0;
  private anchored = false;
  /** Stats for the HUD and tests. */
  readonly stats = { trips: 0, walked: 0, parked: 0, through: 0, buses: 0, services: 0, stops: 0 };

  /** `world` (optional until the view has one) tells the roads to the region towns apart. */
  constructor(town: Town, private readonly places: readonly Place[], private readonly seed: number, world?: World) {
    this.world = world ?? null;
    this.net = new RoadNet(town);
    // The kerbside bays are the planner's (src/plan/cell.ts): the same ones the plan's kerb cars stood in.
    this.parking = new Parking(this.net, town.cells.flatMap((c) => c.parking));
    this.traffic = new Traffic(this.net, this.parking);
    this.traffic.onPark = () => this.stats.parked++;
    this.traffic.onHalt = () => this.stats.stops++;
  }

  /** Put every household car at rest: at `at(household)`'s place (home, or where its driver is). */
  placeCars(households: readonly { id: number; car: boolean }[], at: (household: number) => PlaceId): void {
    for (const h of households) {
      if (!h.car) continue;
      const p = this.places[at(h.id)];
      if (p) this.parking.parkNear(h.id, p.x, p.z);
    }
  }

  /** Tie Traffic time to the game clock for good: the cars run on their own clock, ahead of the world's minutes (src/traffic/feed.ts). */
  anchor(clock: number): void {
    this.clockOffset = clock * 60 - this.traffic.time;
    this.anchored = true;
  }

  /** New car trips from the sim (call once per game minute with what `carTripsSince` returned). */
  trips(trips: readonly CarTrip[], clock: number): void {
    if (!this.anchored) this.clockOffset = clock * 60 - this.traffic.time;
    for (const trip of trips) {
      const car = householdCar(this.seed, trip.household);
      // Home from the city: the car comes in on the road from there (it was never parked in town).
      if (trip.fromRegion !== null) {
        if (trip.toRegion === null && this.comeHome(trip, car)) this.stats.trips++;
        continue;
      }
      const at = this.parking.restAt(car.key), from = this.places[trip.from];
      // The car is out with someone else, or stands somewhere else: on foot this time.
      if (!at || !from || Math.hypot(at.x - from.x, at.z - from.z) > CAR_REACH) { this.stats.walked++; continue; }
      this.stats.trips++;
      this.launch(() => this.start(trip, car));
    }
    this.through(clock);
  }

  /**
   * The rounds that come on to the map in the game minutes (since, clock]: the timetable's buses,
   * the bin lorry, the post van, deliveries (call once per game minute, after `trips`).
   */
  rounds(world: World, since: number, clock: number): void {
    this.world = world;
    this.buses ??= new Buses(world, this.net);
    this.services ??= new ServiceRounds(world, this.net);
    for (const r of [...this.buses.due(since, clock), ...this.services.due(since, clock)]) {
      const goal = roundGoal(r, (c) => c * 60 - this.clockOffset);
      const count = r.run ? 'buses' : 'services';
      this.launch(() => !!this.traffic.enter(r.car, r.enter, goal) && ++this.stats[count] > 0);
    }
  }

  /** Run the cars for dt seconds. */
  update(dt: number): void {
    for (let i = this.waiting.length - 1; i >= 0; i--) {
      const w = this.waiting[i];
      w.t += dt;
      if (w.go() || w.t > RETRY_S) this.waiting.splice(i, 1);
    }
    this.traffic.update(dt);
  }

  /** Put a vehicle on the road now, or as soon as there is room (a car in the way of pulling out or coming in). */
  private launch(go: () => boolean): void {
    if (!go()) this.waiting.push({ go, t: 0 });
  }

  private start(trip: CarTrip, car: Car): boolean {
    // Out to the city or the nearby town: off the map by the road that leads there.
    if (trip.toRegion !== null) {
      const exit = this.exitFor(trip.toRegion);
      return exit >= 0 && !!this.traffic.depart(car, { exit });
    }
    const to = this.places[trip.to];
    return !!to && !!this.traffic.depart(car, { park: true, x: to.x, z: to.z });
  }

  private comeHome(trip: CarTrip, car: Car): boolean {
    const to = this.places[trip.to], exit = this.exitFor(trip.fromRegion);
    if (!to || exit < 0 || this.parking.restAt(car.key)) return false;
    this.launch(() => !!this.traffic.enter(car, exit, { park: true, x: to.x, z: to.z }));
    return true;
  }

  /** The exit towards a region town (by its compass direction; the first exit before a world is known). */
  private exitFor(region: string | null): number {
    return this.world ? exitTowardRegion(this.world, this.net, region) : this.net.nodes.findIndex((n) => n.exit);
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

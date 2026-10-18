/**
 * Car trips out of the society simulation: who drives from which place to which, now. The traffic
 * turns each into a household car pulling out and parking again near the destination. Read from
 * the sim's own record of journeys under way (`world.trips`, mode 'car'); companions riding along
 * (`leader` set) are in the driver's car, not their own.
 *
 * Pure (reads the world, never writes it). When the sim moves into its worker, the trips reach
 * the view through `SimView` in the same shape.
 */
import type { ActorId } from '../sim/actors';
import type { PlaceId } from '../sim/places';
import { hasCar, householdOf, type World } from '../sim/world';

export interface CarTrip {
  driver: ActorId;
  /** Household whose car it is (the car's key). */
  household: number;
  from: PlaceId;
  to: PlaceId;
  /** Game clock minutes. */
  depart: number;
  arrive: number;
}

/** Car trips that set off after clock minute `since` (call once per game minute with the last clock seen). */
export function carTripsSince(world: World, since: number): CarTrip[] {
  const out: CarTrip[] = [];
  for (const t of world.trips) {
    if (t.mode !== 'car' || t.leader >= 0 || t.depart <= since) continue;
    const hh = householdOf(world, t.who);
    if (hh) out.push({ driver: t.who, household: hh.id, from: t.from, to: t.to, depart: t.depart, arrive: t.arrive });
  }
  return out;
}

/**
 * Where a household's car stands when the town is loaded: at the destination of a member who
 * drove somewhere (under way, or there now), else at home.
 */
export function carPlace(world: World, household: number): PlaceId {
  const hh = world.households[household];
  const a = world.actors.cols;
  for (const t of world.trips) if (t.mode === 'car' && t.leader < 0 && hh.members.includes(t.who)) return t.to;
  for (const m of hh.members) {
    const p = a.place[m];
    if (p >= 0 && p !== hh.home && a.with[m] < 0 && world.travel.mode(hh.home, p, true) === 'car' && a.dest[m] < 0 && hasCar(world, m)) return p;
  }
  return hh.home;
}


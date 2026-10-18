/**
 * Car trips out of the society simulation: who drives from which place to which, now. The traffic
 * turns each into a household car pulling out and parking again near the destination.
 *
 * Stand-in until the sim records its trips itself (agreed with the "Society simulation" thread:
 * `go()` will log each departure with its mode): it watches every person's destination and
 * arrival time and calls a departure a car trip when the sim's own travel time for it was the
 * car's (`world.travel.minutes(from, to, true)` beats walking). Followers (a toddler, the dog)
 * ride with the leader. One car per household: when the car is out with someone else, the
 * person goes on foot.
 *
 * Pure (reads the world, never writes it).
 */
import { A, type ActorId } from '../sim/actors';
import type { PlaceId } from '../sim/places';
import { DRIVE_IF_WALK_OVER, WALK_M_PER_MIN } from '../sim/travel';
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

/** Remembers what it saw last, so each departure is reported once. */
export class TripWatcher {
  private seenArrive = new Int32Array(0);
  private seenDest = new Int32Array(0);
  private seenPlace = new Int32Array(0);

  /** Car trips that started since the last call (the first call only takes note of the present). */
  poll(world: World): CarTrip[] {
    const a = world.actors.cols, n = world.actors.count;
    const first = this.seenArrive.length === 0;
    if (this.seenArrive.length < n) {
      const grow = (old: Int32Array) => { const x = new Int32Array(n).fill(-1); x.set(old); return x; };
      this.seenArrive = grow(this.seenArrive); this.seenDest = grow(this.seenDest); this.seenPlace = grow(this.seenPlace);
    }
    const out: CarTrip[] = [];
    for (let id = 0; id < n; id++) {
      const dest = a.dest[id];
      const fresh = dest >= 0 && (this.seenDest[id] !== dest || this.seenArrive[id] !== a.arrive[id]);
      const from = this.seenPlace[id];
      this.seenDest[id] = dest;
      this.seenArrive[id] = a.arrive[id];
      // Where the trip starts: where the actor was before setting off (a street place while travelling is not it).
      if (dest < 0) this.seenPlace[id] = a.place[id];
      if (first || !fresh || !a.alive[id] || a.with[id] >= 0 || a.activity[id] !== A.travel) continue;
      const start = from >= 0 ? from : a.home[id];
      if (start < 0 || start === dest || !drives(world, id, start, dest)) continue;
      const hh = householdOf(world, id);
      if (!hh) continue;
      out.push({ driver: id, household: hh.id, from: start, to: dest, depart: world.clock, arrive: a.arrive[id] });
    }
    return out;
  }
}

/** Does this person take the car from `from` to `to` (the sim's own mode choice in travel.minutes)? */
export function drives(world: World, id: ActorId, from: PlaceId, to: PlaceId): boolean {
  if (!hasCar(world, id)) return false;
  return world.travel.metres(from, to) / WALK_M_PER_MIN > DRIVE_IF_WALK_OVER;
}

/**
 * Where a household's car stands when the town is loaded: by the place of the member who drove
 * somewhere and is still there (at work, at the shops), else at home.
 */
export function carPlace(world: World, household: number): PlaceId {
  const hh = world.households[household];
  const a = world.actors.cols;
  for (const m of hh.members) {
    const p = a.dest[m] >= 0 ? a.dest[m] : a.place[m];
    if (p >= 0 && p !== hh.home && a.with[m] < 0 && drives(world, m, hh.home, p)) return p;
  }
  return hh.home;
}

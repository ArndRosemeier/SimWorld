/**
 * Visitors from the region: cars that come into town for a while and go home again. Tradespeople's
 * vans calling at houses on working days, people from the villages shopping or seeing the doctor,
 * relatives visiting family (more at weekends and in the evening). Each comes in on the road from
 * the region town it lives in (weighted by size and nearness, like the region lore's), parks near
 * the place it is visiting, stays, and drives back out the way it came.
 *
 * Nobody in the sim drives these cars: they are the region's people, which the game keeps as lore.
 * New in SimWorld. Pure (no three.js); seeded per game minute.
 */
import { Rng, deriveSeed } from '@futuremagic/core';
import { runsLike } from '../sim/calendar';
import { isOpen } from '../sim/schedule';
import { rulesOf } from '../sim/politics';
import { regionPlaces } from '../sim/region';
import { MINUTES_PER_DAY } from '../sim/time';
import type { World } from '../sim/world';
import type { RoadNet } from './roadNet';
import { exitTowardRegion } from './rounds';
import { regionCar, type Car, type VKind } from './traffic';

/** Keys of visitors' cars start here (through traffic at 1 << 24, buses at 1 << 26). */
export const VISITOR_KEY = 1 << 25;

/** A visit: the car comes in at `exit`, parks near `x, z`, stays `stay` minutes, leaves by `exit`. */
export interface Visit { car: Car; exit: number; x: number; z: number; stay: number; why: 'trade' | 'errand' | 'family' }

/** Cars coming in per hour for a town of REF_PEOPLE, by hour of day: tradespeople (working days), errands, family. */
const TRADE = [0, 0, 0, 0, 0, 0, 0, 3, 4, 3, 2, 2, 1, 2, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const ERRAND = [0, 0, 0, 0, 0, 0, 0, 1, 2, 4, 5, 5, 4, 4, 4, 5, 5, 4, 2, 1, 0, 0, 0, 0];
const FAMILY = [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 1, 1, 0, 0];
const REF_PEOPLE = 1500;
/** Family visits at weekends, errands on Saturdays and Sundays, against a working day. */
const WEEKEND_FAMILY = 3, SATURDAY_ERRAND = 1.3, SUNDAY_ERRAND = 0.3;
/** Errands from the region once parking in the centre costs money (some shop elsewhere). */
const CHARGED_ERRAND = 0.8;
const VANS: VKind[] = ['van', 'van', 'pickup', 'van', 'delivery'];
const CARS: VKind[] = ['sedan', 'hatch', 'suv', 'wagon', 'sedan', 'hatch', 'suv', 'pickup'];

/** The visitors who come into town in a game minute. */
export function visitorsAt(world: World, net: RoadNet, clock: number): Visit[] {
  const places = regionPlaces(world);
  if (!places.length) return [];
  const r = new Rng(deriveSeed(world.seed, 'visitors', clock));
  const h = Math.floor((clock % MINUTES_PER_DAY) / 60), wd = runsLike(world, clock), work = wd < 5;
  const scale = world.people.count / REF_PEOPLE / 60;
  const all = world.graph.places;
  const out: Visit[] = [];
  const come = (rate: number, why: Visit['why']) => {
    if (!r.chance(Math.min(1, rate * scale))) return;
    const town = r.weighted(places, (p) => Math.sqrt(p.population) / Math.max(3, p.km));
    const exit = exitTowardRegion(world, net, town.name);
    let to = null;
    if (why === 'errand') {
      const open = all.filter((p) => p.hours.length > 0 && p.kind !== 'away' && isOpen(world, p.id, clock));
      if (open.length) to = r.pick(open);
    } else {
      const homes = all.filter((p) => p.homes > 0);
      if (homes.length) to = r.pick(homes);
    }
    if (!to || exit < 0) return;
    const kinds = why === 'trade' ? VANS : CARS;
    const stay = why === 'trade' ? r.int(60, 240) : why === 'errand' ? r.int(15, 60) : r.int(90, 240);
    out.push({ car: regionCar(r, VISITOR_KEY + ((clock * 4) % (1 << 24)) + out.length, kinds), exit, x: to.x, z: to.z, stay, why });
  };
  if (work) come(TRADE[h], 'trade');
  come(ERRAND[h] * (wd === 5 ? SATURDAY_ERRAND : wd === 6 ? SUNDAY_ERRAND : 1) * (rulesOf(world).parkingCharges ? CHARGED_ERRAND : 1), 'errand');
  come(FAMILY[h] * (wd >= 5 ? WEEKEND_FAMILY : 1), 'family');
  return out;
}

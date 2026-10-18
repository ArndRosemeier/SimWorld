/**
 * Who is inside a building now (the walk-in interior's people, src/game/inside.ts): everyone at one of its
 * places and not on the way somewhere else, with the home in it they live in. A building's homes are
 * numbered by its households in order (the interior's units in order, src/interior/building.ts), so the
 * same family always has the same flat.
 *
 * New in SimWorld. Pure: runs in the sim worker and headless tests.
 */
import { A, ACTOR_PERSON } from '../sim/actors';
import type { FurnUse } from '../interior/types';
import { householdOf, type World } from '../sim/world';

export interface InsidePerson {
  id: number;
  place: number;
  /** Their home in the building (0, 1, …: the households living there in order), -1 for a visitor or staff. */
  unit: number;
  /** What they are doing (src/sim/actors.ts `A`): A.sleep lies them in bed. */
  activity: number;
}

/** The people inside building `building` (a `Place.building` code) now. */
export function whoIsInside(world: World, building: number): InsidePerson[] {
  if (building < 0) return [];
  const at = new Set<number>();
  for (const p of world.graph.places) if (p.building === building) at.add(p.id);
  if (!at.size) return [];
  const unitOf = new Map<number, number>();
  for (const h of world.households) if (at.has(h.home) && h.members.length) unitOf.set(h.id, unitOf.size);
  const a = world.actors.cols, out: InsidePerson[] = [];
  for (let id = 0; id < world.actors.count; id++) {
    if (a.kind[id] !== ACTOR_PERSON || !a.alive[id] || a.dest[id] >= 0 || !at.has(a.place[id])) continue;
    const hh = householdOf(world, id);
    out.push({ id, place: a.place[id], unit: hh && hh.home === a.place[id] ? unitOf.get(hh.id) ?? -1 : -1, activity: a.activity[id] });
  }
  return out;
}

/** A spot of the building (src/interior/indoors.ts IndoorSpot, any height). */
interface SpotLike { use: FurnUse; unit: number }

/**
 * Who goes where: for each person (in order) the index of their spot in `spots`, -1 when none is left. Asleep:
 * a bed of their home (or one that is no home's, in a care home). At work in a workplace: a desk or counter. Otherwise a seat of their home (a visitor
 * or a customer: a seat not in a home), then any seat, then anywhere free. No spot is given twice.
 */
export function spotsFor(people: readonly InsidePerson[], spots: readonly SpotLike[]): number[] {
  const taken = new Uint8Array(spots.length);
  const claim = (ok: (s: SpotLike) => boolean): number => {
    const k = spots.findIndex((s, i) => !taken[i] && ok(s));
    if (k >= 0) taken[k] = 1;
    return k;
  };
  const order = people.map((_, i) => i).sort((i, j) => firstServed(people[i]) - firstServed(people[j]));
  const out = new Array<number>(people.length).fill(-1);
  for (const i of order) {
    const p = people[i];
    if (p.activity === A.sleep) out[i] = claim((s) => s.use === 'sleep' && s.unit === p.unit && p.unit >= 0);
    // (A bed that is nobody's home: a care home's room.)
    if (out[i] < 0 && p.activity === A.sleep) out[i] = claim((s) => s.use === 'sleep' && s.unit < 0);
    else if (p.activity === A.work && p.unit < 0) out[i] = claim((s) => (s.use === 'work' || s.use === 'serve') && s.unit < 0);
    if (out[i] < 0 && p.activity !== A.sleep) out[i] = claim((s) => s.use === 'sit' && s.unit === p.unit);
    if (out[i] < 0) out[i] = claim((s) => s.use === 'sit');
    if (out[i] < 0) out[i] = claim((s) => s.use !== 'sleep');
  }
  return out;
}

/** Beds and desks are handed out first (they are the scarce, owned spots), then seats. */
const firstServed = (p: InsidePerson) => (p.activity === A.sleep ? 0 : p.activity === A.work ? 1 : 2);

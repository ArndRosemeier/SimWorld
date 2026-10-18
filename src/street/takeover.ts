/**
 * Where the player takes someone over, as the sim has them (plan R5): the one decision both the sim worker (the
 * player's status) and the tests use. Inside their building (the game stands them up by their spot); on the street
 * where their walk has them, or at the doorstep of a place with no inside to show; or not yet (`waitOf`: in a
 * vehicle or out of town, the game starts when they are on foot in town again). Nobody is ever put where the sim
 * does not have them.
 */
import { waitOf, type Takeover } from '../sim/player';
import type { ActorId } from '../sim/actors';
import type { World } from '../sim/world';
import { OUTDOOR, type StreetMap } from './streetMap';
import { sample, trackOf, type Track } from './tracks';

/** `id`'s takeover at `clock`; `track`: their track if the caller has it (else made here). */
export function takeoverOf(world: World, map: StreetMap, id: ActorId, clock: number, track?: Track | null): Takeover {
  const wait = waitOf(world, id);
  if (wait) return wait;
  const a = world.actors.cols, places = world.graph.places;
  const t = track === undefined ? trackOf(world, map, id, clock) : track;
  if (t && clock <= t.hideAfter) {
    const p = sample(t.keys, clock), q = sample(t.keys, clock + 0.05);
    const yaw = Math.hypot(q[0] - p[0], q[2] - p[2]) > 1e-3 ? Math.atan2(-(q[0] - p[0]), -(q[2] - p[2])) : 0;
    return { kind: 'street', x: p[0], z: p[2], yaw };
  }
  // Arrived, or at a place: inside its building, else out on its doorstep.
  const here = a.dest[id] >= 0 && clock >= a.arrive[id] ? a.dest[id] : a.place[id];
  const pl = here >= 0 ? places[here] : null;
  if (!pl) return { kind: 'street', x: 0, z: 0, yaw: 0 };
  const [dx, dz] = map.door(here), [x, z] = map.doorStep(here), yaw = Math.atan2(-(x - dx), -(z - dz)) || 0;
  return pl.building >= 0 && !OUTDOOR.has(pl.kind) ? { kind: 'inside', building: pl.building, x, z, yaw } : { kind: 'street', x, z, yaw };
}

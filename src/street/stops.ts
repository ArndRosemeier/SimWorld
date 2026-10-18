/**
 * The town's bus stops as the street shows them: a post at the kerb where the bus pulls up (by the stop's
 * place, src/plan/signs.ts `stopPost`) with the stop's printed timetable (src/sim/transit.ts
 * `stopTimetables`). Made once in the sim worker, which has both the town and the transit; the signs draw
 * them (src/render/signsView.ts `addStops`).
 *
 * Pure (no three, no DOM). New in SimWorld.
 */
import { stopPost } from '../plan/signs';
import type { TownRoads } from '../plan/roads';
import type { Town } from '../plan/town';
import { stopTimetables, type StopTimetable } from '../sim/transit';
import type { World } from '../sim/world';

/** A bus stop: its post's foot (`y` the ground under it), the way its timetable faces, and the timetable. */
export interface StopBoard extends StopTimetable { x: number; y: number; z: number; yaw: number }

/** The town's bus stops (buses only: the trains have the station). */
export function stopBoards(town: Town, roads: TownRoads, world: World): StopBoard[] {
  const out: StopBoard[] = [];
  for (const t of stopTimetables(world)) {
    const rows = t.rows.filter((r) => r.mode === 'bus');
    const pl = world.graph.places[t.place];
    const post = rows.length && pl ? stopPost(town, roads, pl.x, pl.z) : null;
    if (post) out.push({ ...t, rows, ...post, y: town.terrain.height(post.x, post.z) });
  }
  return out;
}

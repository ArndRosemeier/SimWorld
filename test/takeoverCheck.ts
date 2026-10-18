/**
 * Take over people wherever they are on a weekday (on the street, at a doorstep, on the road to the city) as the
 * game does (src/game/standing.ts, src/sim/player.ts `onTheGround`) and list every body that does not stand on the
 * ground with room round it, or cannot walk off. Used by test/takeover.test.ts (a sample, in CI) and
 * test/slow/takeover.slow.test.ts (whole towns, by hand).
 */
import { planTown } from '../src/plan/town';
import { placeGraphOf } from '../src/plan/placeGraph';
import { regionOf } from '../src/plan/region';
import { createWorld } from '../src/sim/synth';
import { isPerson, tick } from '../src/sim/world';
import { onTheGround } from '../src/sim/player';
import { StreetMap, OUTDOOR } from '../src/street/streetMap';
import { sample, trackOf } from '../src/street/tracks';
import { Physics } from '../src/physics/physics';
import { heightOnGrid, onGrid } from '../src/physics/solids';
import { pointInPoly } from '../src/geom/geom2';
import { Avatar } from '../src/game/avatar';
import { GROUND_EDGE, landOutdoors, placeSolids } from '../src/game/standing';

export interface TakeoverRun { checked: number; outOfTown: number; problems: string[] }

/**
 * For each town `seeds` (size 0), at each time of a Monday `times` ([hour, minute]): every `every`-th person out of
 * doors, everyone on the road out of town, and every `every * 6`-th person indoors (put on their doorstep, as when
 * their building has no interior to stand in).
 */
export async function checkTakeovers(seeds: number[], times: [number, number][], every: number): Promise<TakeoverRun> {
  const run: TakeoverRun = { checked: 0, outOfTown: 0, problems: [] };
  for (const seed of seeds) {
    const town = planTown({ seed, size: 0 }), w = createWorld(placeGraphOf(town), seed, { region: regionOf(town) });
    const map = new StreetMap(town, w.graph), half = town.terrain.profile.radius * 1.4, ground = map.heightGrid(half, 4);
    const phys = await Physics.create(ground), lim = half - GROUND_EDGE;
    const isAway = (p: number) => p >= 0 && w.graph.places[p].kind === 'away';
    for (const [hh, mm] of times) {
      tick(w, hh * 60 + mm - w.clock);
      const a = w.actors.cols;
      for (let id = 0, k = 0; id < w.actors.count; id++) {
        if (!isPerson(w, id)) continue;
        const n = k++, here = a.place[id], travel = a.dest[id] >= 0;
        if (!(n % every === 0 || (travel && (isAway(a.dest[id]) || isAway(here))))) continue;
        const t = trackOf(w, map, id, w.clock), p = t && w.clock <= t.hideAfter ? sample(t.keys, w.clock) : null;
        let x: number, z: number;
        if (p) {
          [x, z] = onTheGround(w, id, p[0], p[2], lim);
          if (Math.max(Math.abs(p[0]), Math.abs(p[2])) > lim) run.outOfTown++;
          else if (n % every !== 0) continue;
        } else if (n % (every * 6) === 0 && here >= 0 && !OUTDOOR.has(w.graph.places[here].kind)) [x, z] = onTheGround(w, id, ...map.doorStep(here), lim);
        else continue;
        const near = map.solidsNear(x, z, 75);
        placeSolids(phys, near, -1);
        const at = landOutdoors(phys, ground, near, x, z), who = `seed ${seed} ${hh}:${String(mm).padStart(2, '0')} #${id} at ${x.toFixed(1)},${z.toFixed(1)}`;
        run.checked++;
        if (!onGrid(ground, x, z, GROUND_EDGE - 1) || !onGrid(ground, at.x, at.z, GROUND_EDGE - 1)) { run.problems.push(`${who}: off the ground`); continue; }
        if (near.buildings.some((b) => pointInPoly(b.poly, at.x, at.z))) run.problems.push(`${who}: inside a building`);
        const body = new Avatar(phys, at.x, at.y, at.z, 0);
        for (let i = 0; i < 10; i++) { body.step(1 / 30, 0, 0, false); phys.world.step(); }
        const g = heightOnGrid(ground, body.x, body.z);
        if (!body.grounded || Math.abs(body.y - g) > 0.2) run.problems.push(`${who}: not on the ground (feet ${body.y.toFixed(2)}, ground ${g.toFixed(2)})`);
        // A way to walk: some direction takes them a metre off, never under the ground.
        let off = 0;
        for (let d = 0; d < 8 && off < 1; d++) {
          body.putAt(at.x, at.y, at.z);
          const dx = Math.sin((d * Math.PI) / 4), dz = Math.cos((d * Math.PI) / 4);
          for (let i = 0; i < 30; i++) {
            body.step(1 / 30, dx, dz, false); phys.world.step();
            if (body.y < heightOnGrid(ground, body.x, body.z) - 0.3) { run.problems.push(`${who}: fell under the ground walking`); break; }
          }
          off = Math.max(off, Math.hypot(body.x - at.x, body.z - at.z));
        }
        if (off < 1) run.problems.push(`${who}: hemmed in (${off.toFixed(2)} m)`);
        body.dispose();
      }
    }
  }
  return run;
}

/**
 * The railway (new in SimWorld): one line through the countryside that passes the town on one
 * side, with the station just outside the town's edge. The town is the whole world, so the line
 * runs from the edge of the world to the edge of the world: trains come from and go to
 * "elsewhere" (a town by the coast may get a branch line instead, ending at its station). Pure
 * data, part of the macro plan.
 *
 * Near the town the line is straight (a tangent to the town's outline, 70–150 m beyond it); out
 * in the country it bends gently away. Where it crosses a river it runs on a bridge; it never
 * runs through the sea or a lake.
 */
import { Rng, deriveSeed } from '@futuremagic/core';
import { resample } from '../geom/geom2';
import { riverSpans, type Terrain } from '../world/terrain';
import { boundaryAt } from '../world/boundary';
import type { MacroPlan, Railway } from './types';

/** Half width of the track bed (one track each way). */
export const RAIL_HW = 4;
/** Straight run each side of the station before the line may bend (m). */
const STRAIGHT = 700;

/**
 * Plan the line: the side of the town it passes (the first of a seeded ring of directions that
 * keeps it dry and outside the town) and its course. Where no through line stays dry (a town on
 * a coast or a peninsula) the line is a branch line instead: it comes from one edge of the
 * world and ends at the station. Null when not even that works (an island town).
 */
export function planRail(plan: MacroPlan, terrain: Terrain): Railway | null {
  const p = terrain.profile;
  const rng = new Rng(deriveSeed(p.seed, 'rail'));
  const a0 = rng.range(0, Math.PI * 2);
  const reach = terrain.worldExtent - 300;
  const b0 = rng.range(0.6, 1) * rng.sign();
  const N = 16;
  // Through lines first (both ends), then branch lines (one end, either side of the station).
  for (const ends of [[-1, 1], [-1], [1]]) {
    for (const bend of [b0, -b0, 2 * b0, -2 * b0]) {
      for (const gap of [70, 110, 150]) {
        for (let k = 0; k < N; k++) {
          const th = a0 + (k * Math.PI * 2) / N;
          const nx = Math.cos(th), nz = Math.sin(th), dx = -nz, dz = nx;
          const d = boundaryAt(plan.boundary, nx, nz) + gap;
          // The course: the tangent, bending away from the town beyond the straight run.
          const course = (t: number): [number, number] => {
            const o = Math.max(0, Math.abs(t) - STRAIGHT);
            const off = Math.abs((o * o) / 9000 * bend);
            return [nx * (d + off) + dx * t, nz * (d + off) + dz * t];
          };
          const t0 = ends.includes(-1) ? -reach * 2 : 0, t1 = ends.includes(1) ? reach * 2 : 0;
          const ctrl: number[] = [];
          let ok = true;
          for (let t = t0; t <= t1 && ok; t += 50) {
            const [x, z] = course(t);
            if (Math.max(Math.abs(x), Math.abs(z)) > reach) { if (t > 0) break; continue; }
            // Outside the town all along (the outline wobbles), dry near the station, never
            // through the sea or a lake (rivers it bridges).
            if (Math.hypot(x, z) - boundaryAt(plan.boundary, x, z) < 40) ok = false;
            else if (p.coastal && terrain.coastDistance(x, z) < 40) ok = false;
            else if (Math.abs(t) < 200 && terrain.isWater(x, z, 30)) ok = false;
            else if (terrain.lakeAt(x, z).e < 20) ok = false;
            ctrl.push(x, z);
          }
          if (!ok || ctrl.length < 4) continue;
          const pts = resample(ctrl, 20);
          return { pts, bridges: riverSpans(terrain, pts, RAIL_HW + 6), side: th, offset: d, sx: nx * d, sz: nz * d, angle: Math.atan2(dz, dx), terminus: ends.length === 1 };
        }
      }
    }
  }
  return null;
}

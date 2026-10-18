/**
 * The check that a building's painted street doors (src/build/massing.ts `paintedDoors`, the facade shader's rule)
 * and its interior's real ones (src/interior/building.ts `Interior.doors`) are the same doors: each painted door has a
 * real door with the same middle and width, and each real door is painted. For test/doorsAlign.test.ts and its slow
 * whole-town run.
 */
import { planInterior } from '../src/interior/building';
import { paintedDoors } from '../src/build/massing';
import type { BuildingDesc } from '../src/plan/building';

/** What does not line up, one line per door ([] when every door is one door). */
export function doorMismatches(buildings: readonly BuildingDesc[]): string[] {
  const out: string[] = [];
  for (const b of buildings) {
    const painted = paintedDoors(b), real = planInterior(b).doors;
    const same = (p: { x: number; z: number; w: number }, d: { x: number; z: number; w: number }) => Math.hypot(p.x - d.x, p.z - d.z) < 0.05 && Math.abs(p.w - d.w) < 0.02;
    const what = `${b.style} ${b.use}${b.shopfront ? ' with a shop' : ''} (building ${b.id})`;
    for (const p of painted) if (!real.some((d) => same(p, d))) out.push(`${what}: a painted door at ${p.x.toFixed(1)}, ${p.z.toFixed(1)} with no real door`);
    for (const d of real) if (!painted.some((p) => same(p, d))) out.push(`${what}: a real door at ${d.x.toFixed(1)}, ${d.z.toFixed(1)} not painted`);
  }
  return out;
}

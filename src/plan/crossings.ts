/**
 * Zebra crossings as data: where each street end that meets a junction has its crossing, a
 * little back from the junction (three quarters of the street's width plus 1.2 m). The ground
 * (src/build/ground.ts) paints them from this list, and people on the street read it to cross
 * where the stripes are. Pulled out of Scale's ground builder (src/build/ground.ts buildMarkings);
 * the placement is the same.
 *
 * Pure; a function of the cell plan.
 */
import { resample, polylineLength, reversePoly } from '../geom/geom2';
import { RoadClass } from './types';
import type { CellPlan, StreetSeg } from './cell';

export interface Crossing {
  /** Middle of the crossing on the street's centreline. */
  x: number;
  z: number;
  /** Direction along the street, away from the junction (yaw as everywhere: dir = (sin, cos)). */
  heading: number;
  /** Carriageway width (curb to curb) the stripes span, in m. */
  width: number;
  /** Index of the street in `plan.streets`, and which of its ends (0 its first point, 1 its last). */
  street: number;
  end: 0 | 1;
}

/** Distance of a crossing's middle from the street's end at the junction. */
export const crossingSetback = (width: number): number => width * 0.75 + 1.2;

/** A cell owns an arterial's markings when the cell lies to the left of the polyline direction. */
export function ownsArterial(plan: CellPlan, pts: number[]): boolean {
  const n = pts.length >> 1;
  const i = Math.max(0, (n >> 1) - 1);
  const ax = pts[i * 2], az = pts[i * 2 + 1], bx = pts[i * 2 + 2], bz = pts[i * 2 + 3];
  const mx = (ax + bx) / 2, mz = (az + bz) / 2;
  const [x0, z0, x1, z1] = plan.bounds;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  return (bx - ax) * (cz - mz) - (bz - az) * (cx - mx) > 0;
}

/**
 * Does this cell paint the street's markings, and does each of its ends meet a junction? Null
 * for a street the cell leaves unmarked: footpaths, the old town's streets and lanes, and an
 * arterial the cell on its other side paints.
 */
export function markedEnds(plan: CellPlan, st: StreetSeg): [boolean, boolean] | null {
  if (st.cls === RoadClass.Path) return null;
  if (st.arterial >= 0 && !ownsArterial(plan, st.pts)) return null;
  if (plan.district === 'oldtown' && st.cls >= RoadClass.Street) return null;
  const atJunction = (x: number, z: number) => {
    for (let i = 0; i < plan.junctions.length; i += 3) if (Math.hypot(plan.junctions[i] - x, plan.junctions[i + 1] - z) < 4) return true;
    return false;
  };
  const n = st.pts.length;
  return [atJunction(st.pts[0], st.pts[1]) || st.arterial >= 0, atJunction(st.pts[n - 2], st.pts[n - 1]) || st.arterial >= 0];
}

/** Every zebra crossing of a cell, in street order (deterministic). */
export function crossingsOf(plan: CellPlan): Crossing[] {
  const out: Crossing[] = [];
  plan.streets.forEach((st, si) => {
    const ends = markedEnds(plan, st);
    if (!ends) return;
    for (const end of [0, 1] as const) {
      if (!ends[end]) continue;
      const pts = end === 0 ? st.pts : reversePoly(st.pts);
      const d = crossingSetback(st.width);
      if (polylineLength(pts) < d + 3) continue;
      const rs = resample(pts.slice(0, Math.min(pts.length, 8)), 0.5);
      // The point at distance d from the end.
      let acc = 0, px = pts[0], pz = pts[1], dx = 1, dz = 0;
      for (let i = 2; i < rs.length; i += 2) {
        const seg = Math.hypot(rs[i] - rs[i - 2], rs[i + 1] - rs[i - 1]);
        if (acc + seg >= d) {
          const t = (d - acc) / seg;
          px = rs[i - 2] + (rs[i] - rs[i - 2]) * t; pz = rs[i - 1] + (rs[i + 1] - rs[i - 1]) * t;
          dx = (rs[i] - rs[i - 2]) / seg; dz = (rs[i + 1] - rs[i - 1]) / seg;
          break;
        }
        acc += seg;
      }
      out.push({ x: px, z: pz, heading: Math.atan2(dx, dz), width: st.width, street: si, end });
    }
  });
  return out;
}

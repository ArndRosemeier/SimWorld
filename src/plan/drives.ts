/**
 * Driveways and front paths of detached houses (SimWorld; realism plan track A). A house on a free
 * lot gets a driveway beside it, from the lot's front edge to a little past the house front, on the
 * wider side, when there is room for a car (3 m). Its door gets a paved path to the front edge,
 * unless the door opens onto the driveway. The driveway's car spot and its mouth on the street are
 * data, so the traffic can park a household's car at home (`CellPlan.driveways`).
 */
import type { Rng } from '@futuremagic/core';
import { closestOnPolyline, pointInPoly, type Poly } from '../geom/geom2';
import { difference, intersection, strokePolylines, shapesToPolys, shapeArea, type Shape } from '../geom/clip';
import { RoadClass } from './types';
import { frontDoor } from './terrace';
import type { CellPlan } from './cell';

/** What a driveway is laid with. */
export const enum DriveSurface { Asphalt = 0, Paving = 1, Gravel = 2 }

/** A house's driveway: its ground, its car spot and where it meets the street. */
export interface Driveway {
  shape: Shape;
  surface: DriveSurface;
  /** Middle of the car spot, and the yaw of a car parked nose to the house. */
  x: number;
  z: number;
  yaw: number;
  /** The mouth: the middle of its edge on the lot front, and the street (index in `plan.streets`) it opens onto. */
  mx: number;
  mz: number;
  street: number;
  /** The house (index in `plan.buildings`). */
  building: number;
}

/** A driveway's width, the margin it keeps from the house and the lot side, and a front path's width. */
export const DRIVE_W = 3, DRIVE_GAP = 0.4, PATH_W = 1.2;
/** A parked car's half length (the spot keeps it on the driveway). */
const CAR_HL = 2.4;

/** Lay out the driveways (`plan.driveways`) and front paths (`plan.paths`) of the cell's detached houses. */
export function planDrives(plan: CellPlan, r: Rng): void {
  plan.buildings.forEach((b, bi) => {
    if (b.style !== 'house' || b.use !== 'residential') return;
    const lot = plan.lots[b.id];
    if (!lot || lot.kind !== 'free') return;
    const [ax, az, bx, bz] = lot.front;
    const fl = Math.hypot(bx - ax, bz - az);
    if (fl < 8) return;
    // The lot's frame: u along the front from its middle, v inward.
    const ux = (bx - ax) / fl, uz = (bz - az) / fl, nx = -uz, nz = ux;
    const ox = (ax + bx) / 2, oz = (az + bz) / 2;
    const lotPt = (u: number, v: number): [number, number] => [ox + ux * u + nx * v, oz + uz * u + nz * v];
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity;
    for (let i = 0; i < b.poly.length; i += 2) {
      const u = (b.poly[i] - ox) * ux + (b.poly[i + 1] - oz) * uz, v = (b.poly[i] - ox) * nx + (b.poly[i + 1] - oz) * nz;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v);
    }
    if (v0 < 2) return;
    const lots = shapesToPolys([{ outer: lot.poly, holes: [] }]), houses = plan.buildings.map((o) => o.poly);
    const clipped = (p: Poly): Shape | null => {
      const s = difference(shapesToPolys(intersection([p], lots)), houses).sort((a, c) => shapeArea(c) - shapeArea(a))[0];
      return s && shapeArea(s) > 2 ? s : null;
    };
    const r1 = r.fork('drive', bi);

    // The driveway, on the wider side of the house.
    const left = u0 - -fl / 2, right = fl / 2 - u1;
    const side = left > right ? -1 : 1, room = Math.max(left, right);
    let drive: Driveway | null = null;
    if (room >= DRIVE_W + 2 * DRIVE_GAP) {
      const ua = side > 0 ? u1 + DRIVE_GAP : u0 - DRIVE_GAP, ub = ua + side * DRIVE_W;
      const len = Math.max(v0 + r1.range(2, 6), 2 * CAR_HL + 1);
      const poly = [...lotPt(ua, -3), ...lotPt(ub, -3), ...lotPt(ub, len), ...lotPt(ua, len)];
      const shape = clipped(side > 0 ? poly : [...lotPt(ub, -3), ...lotPt(ua, -3), ...lotPt(ua, len), ...lotPt(ub, len)]);
      const um = (ua + ub) / 2, [x, z] = lotPt(um, len - CAR_HL - 0.5), [mx, mz] = lotPt(um, 0);
      const street = nearestStreet(plan, mx, mz);
      if (shape && street >= 0 && pointInPoly(shape.outer, x, z)) {
        drive = {
          shape, surface: r1.weighted([DriveSurface.Asphalt, DriveSurface.Paving, DriveSurface.Gravel], (k) => [0.45, 0.35, 0.2][k]),
          x, z, yaw: Math.atan2(nx, nz), mx, mz, street, building: bi,
        };
        plan.driveways.push(drive);
      }
    }

    // The front path, from the door straight out to the lot front (none where the door opens onto the driveway).
    const d = frontDoor(b);
    const du = (d.x - ox) * ux + (d.z - oz) * uz, dv = (d.x - ox) * nx + (d.z - oz) * nz;
    if (dv < 1 || Math.abs(du) > fl / 2 - PATH_W) return;
    if (drive && Math.abs(du - (drive.mx - ox) * ux - (drive.mz - oz) * uz) < DRIVE_W / 2 + PATH_W) return;
    const path = strokePolylines([[...lotPt(du, -3), ...lotPt(du, dv + 0.3)]], PATH_W / 2, 'miter', 'butt')[0];
    const s = path && clipped(path.outer);
    if (s) plan.paths.push(s);
  });
}

/** The street (index) whose sidewalk (x, z) is just behind, footpaths aside; -1 when none (a lot facing a footpath). */
function nearestStreet(plan: CellPlan, x: number, z: number): number {
  let best = -1, bd = Infinity;
  for (let i = 0; i < plan.streets.length; i++) {
    const s = plan.streets[i], d = s.cls === RoadClass.Path ? Infinity : closestOnPolyline(s.pts, x, z).d - s.width / 2 - s.sidewalk;
    if (d < bd && d < 2.5) { bd = d; best = i; }
  }
  return best;
}

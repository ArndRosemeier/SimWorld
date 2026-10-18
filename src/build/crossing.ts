/**
 * Level-crossing barriers (src/render/railView.ts lowers and raises them; src/traffic/trains.ts
 * says where they stand and when a crossing is closed): a post with its lamp housing and the arm's
 * counterweight, the two red lamp lenses (each its own instance, so they flash in turn), and the
 * arm, striped white and red. Generic: no country's design.
 *
 * For the `VEHICLE` kind like the vehicles (`aPart` from `VPart`; the paint per instance is the
 * post's white; the lenses glow with the instance's brake light). Model space: the post at the
 * origin on the ground; the cars it stops come along +X; the arm points along −Z from its pivot
 * (`ARM_PIVOT`) when it is down. New in SimWorld. Pure.
 */
import { MeshBuilder, type MeshData } from './meshBuilder';
import { VEHICLE_SPECS, VPart } from './vehicles';

/** The arm's pivot height above the ground (m), its model length (scaled to the road), its stripes. */
export const ARM_PIVOT = 1.05, ARM_LENGTH = 4, STRIPE = 0.5;
/** Where the two lamp lenses sit on the post (model space): x, y, and z either side. */
export const LENS_AT: [number, number, number] = [-0.16, 2.25, 0.27];

/** The post: pole, foot, lamp housing with its backboard and hoods, the arm's drive box and counterweight. */
export function crossingPost(): MeshData {
  const mb = new MeshBuilder(VEHICLE_SPECS);
  mb.set('aPart', VPart.Plastic);
  mb.box(0, 0.08, 0, 0.22, 0.08, 0.22);
  mb.box(0, ARM_PIVOT, 0.05, 0.16, 0.32, 0.2);
  // The counterweight behind the pivot (the arm's short end).
  mb.box(0, ARM_PIVOT, 0.55, 0.09, 0.12, 0.3);
  mb.set('aPart', VPart.Paint);
  mb.box(0, 1.55, 0, 0.06, 1.55, 0.06);
  // The lamps' black backboard (facing the cars, −X), the housings and hoods.
  mb.set('aPart', VPart.Plastic);
  const [lx, ly, lz] = LENS_AT;
  mb.box(lx + 0.1, ly, 0, 0.03, 0.2, 0.52);
  for (const s of [-1, 1]) {
    mb.box(lx + 0.05, ly, s * lz, 0.06, 0.13, 0.13);
    mb.box(lx - 0.06, ly + 0.14, s * lz, 0.08, 0.015, 0.14);
  }
  return mb.build();
}

/** One lamp lens (at the origin, facing −X): it glows red with the instance's brake light. */
export function crossingLens(): MeshData {
  const mb = new MeshBuilder(VEHICLE_SPECS);
  mb.set('aPart', VPart.Taillight);
  mb.box(0, 0, 0, 0.02, 0.1, 0.1);
  return mb.build();
}

/** The arm from its pivot along −Z, ARM_LENGTH long: white with red stripes, a rubber skirt-less bar. */
export function crossingArm(): MeshData {
  const mb = new MeshBuilder(VEHICLE_SPECS);
  for (let z = 0, k = 0; z < ARM_LENGTH - 1e-6; z += STRIPE, k++) {
    mb.set('aPart', k % 2 ? VPart.Taillight : VPart.Paint);
    const len = Math.min(STRIPE, ARM_LENGTH - z);
    mb.box(0, 0, -(z + len / 2), 0.04, 0.06, len / 2);
  }
  return mb.build();
}

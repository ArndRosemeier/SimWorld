/**
 * The body you steer while you play as someone (plan R5): a capsule the height of a person moved by Rapier's
 * character controller (src/physics/physics.ts), so it walks the sidewalk-level ground, steps up kerbs and stair
 * treads, slides along walls and parked cars and never passes through them. Its position is what the street
 * draws as your person (src/game/street.ts `self`) and what the sim is told (src/game/playing.ts).
 */
import { lerpAngle } from '@futuremagic/core';
import type { CharacterController, Collider, Physics } from '../physics/physics';

/** Capsule: radius and the half height of its straight part (whole height 1.76 m). */
const RADIUS = 0.28, HALF = 0.6;
/** Walking and hurrying speed (m/s). */
export const WALK_SPEED = 1.45, RUN_SPEED = 3.6;
/** How fast the speed follows the keys (1/s). */
const ACCEL = 9;

export class Avatar {
  /** Feet (x, y, z) and velocity on the ground (m/s). */
  x = 0; y = 0; z = 0; vx = 0; vz = 0;
  /** Facing (0 looks to −z, as the camera's yaw). */
  yaw = 0;
  grounded = false;
  private vy = 0;
  /** The speed it means to go at (vx, vz are what it managed: against a wall, less). */
  private ux = 0;
  private uz = 0;
  private readonly collider: Collider;
  private readonly ctl: CharacterController;

  constructor(readonly phys: Physics, x: number, y: number, z: number, yaw: number) {
    const R = phys.R, w = phys.world;
    this.collider = w.createCollider(R.ColliderDesc.capsule(HALF, RADIUS).setTranslation(x, y + HALF + RADIUS, z));
    this.ctl = w.createCharacterController(0.02);
    this.ctl.setUp({ x: 0, y: 1, z: 0 });
    this.ctl.enableAutostep(0.32, 0.18, false);
    this.ctl.enableSnapToGround(0.35);
    this.ctl.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.ctl.setSlideEnabled(true);
    this.putAt(x, y, z, yaw);
  }

  /** The collider (to see through when the camera checks its line of sight). */
  get body(): Collider { return this.collider; }

  /** Put the body at feet (x, y, z), facing `yaw`, at rest. */
  putAt(x: number, y: number, z: number, yaw = this.yaw): void {
    this.collider.setTranslation({ x, y: y + HALF + RADIUS + 0.02, z });
    this.x = x; this.y = y; this.z = z; this.yaw = yaw;
    this.vx = this.vz = this.vy = this.ux = this.uz = 0;
  }

  /**
   * One frame: want to move along (wx, wz) (a direction on the ground, length 0…1; 0 stands still), hurrying or
   * not. Turns to face where it goes.
   */
  step(dt: number, wx: number, wz: number, hurry: boolean): void {
    if (dt <= 0) return;
    const top = hurry ? RUN_SPEED : WALK_SPEED, k = 1 - Math.exp(-dt * ACCEL);
    // Speeding up from what it means to go at, not from what it managed: a bump at the foot of the stairs stops it for a frame, not for good.
    this.ux += (wx * top - this.ux) * k;
    this.uz += (wz * top - this.uz) * k;
    this.vy = this.grounded ? -1 : Math.max(-30, this.vy - 9.81 * dt);
    this.ctl.computeColliderMovement(this.collider, { x: this.ux * dt, y: this.vy * dt, z: this.uz * dt });
    const m = this.ctl.computedMovement(), p = this.collider.translation();
    const nx = p.x + m.x, ny = p.y + m.y, nz = p.z + m.z;
    this.collider.setTranslation({ x: nx, y: ny, z: nz });
    // What it actually managed (a wall stops it): the figure animates at that speed.
    this.vx = m.x / dt; this.vz = m.z / dt;
    this.grounded = this.ctl.computedGrounded();
    this.x = nx; this.y = ny - HALF - RADIUS; this.z = nz;
    if (Math.hypot(wx, wz) > 0.05) this.yaw = lerpAngle(this.yaw, Math.atan2(-wx, -wz), Math.min(1, dt * 10));
  }

  dispose(): void {
    this.phys.world.removeCharacterController(this.ctl);
    this.phys.world.removeCollider(this.collider, false);
  }
}

/**
 * The camera: the drone circling the town from above (the start), down on the street walking about
 * (W A S D or the arrow keys, drag to look, Shift to hurry), or following an inhabitant from behind.
 * Keys: Enter goes down to the street (at the town's centre, or where the drone looks), F follows the
 * nearest person (F again: the next one), Esc goes back up a level.
 *
 * `?at=x,z&r=…&h=…&a=…` fixes the drone; `?street=x,z&yaw=…` starts on the street there; `?follow=<id>`
 * starts behind that inhabitant (screenshots and checks).
 */
import type { PerspectiveCamera } from 'three/webgpu';
import { clamp } from '@futuremagic/core';

export type CameraMode = 'drone' | 'street' | 'follow';

/** Eye height when walking (m). */
const EYE = 1.65;
const WALK = 1.6, HURRY = 6;

export interface Followed { x: number; y: number; z: number; vx: number; vz: number }

export class CameraControl {
  mode: CameraMode = 'drone';
  /** Street position and view direction (yaw: 0 looks to -z, pitch: up positive). */
  x = 0;
  z = 0;
  yaw = 0;
  pitch = -0.05;
  /** The inhabitant followed, by actor id (-1: none). */
  following = -1;
  private readonly keys = new Set<string>();
  private drag: { x: number; y: number } | null = null;
  private fy = 0;
  private fyaw = 0;
  /** Asks the game for someone to follow near (x, z), someone else each time (-1: none found). */
  pickNear: (x: number, z: number) => number = () => -1;

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly drone: { cx: number; cz: number; y: number; r: number; h: number; fixed: number | null },
    private readonly ground: (x: number, z: number) => number,
  ) {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLElement && /input|textarea/i.test(e.target.tagName)) return;
      this.keys.add(e.code);
      if (e.code === 'Enter' && this.mode === 'drone') this.toStreet(this.drone.cx, this.drone.cz);
      else if (e.code === 'KeyF') this.follow(this.pickNear(this.x, this.z));
      else if (e.code === 'Escape') this.goUp();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('pointerdown', (e) => { if (e.target instanceof HTMLCanvasElement) this.drag = { x: e.clientX, y: e.clientY }; });
    window.addEventListener('pointerup', () => { this.drag = null; });
    window.addEventListener('pointermove', (e) => {
      if (!this.drag || this.mode === 'drone') return;
      this.yaw -= (e.clientX - this.drag.x) * 0.004;
      this.pitch = clamp(this.pitch - (e.clientY - this.drag.y) * 0.004, -1.2, 1.0);
      this.drag = { x: e.clientX, y: e.clientY };
    });
  }

  toStreet(x: number, z: number, yaw = this.yaw): void {
    this.mode = 'street';
    this.following = -1;
    this.x = x; this.z = z; this.yaw = yaw;
  }

  follow(id: number): void {
    if (id < 0) return;
    if (this.mode === 'drone') this.fy = 0;
    this.mode = 'follow';
    this.following = id;
  }

  goUp(): void {
    if (this.mode === 'follow') this.mode = 'street';
    else this.mode = 'drone';
    this.following = -1;
  }

  /** Place the camera for this frame. `target`: where the followed person is (null: lost them). `t`: ms. */
  update(dt: number, t: number, target: Followed | null): void {
    const cam = this.camera;
    if (this.mode === 'follow' && !target) this.mode = 'street';
    if (this.mode === 'drone') {
      const d = this.drone, a = d.fixed ?? t * 0.00002;
      cam.position.set(d.cx + Math.cos(a) * d.r, d.y + d.h, d.cz + Math.sin(a) * d.r);
      cam.lookAt(d.cx, d.y, d.cz);
      return;
    }
    if (this.mode === 'follow' && target) {
      // Behind and a little above them, turning after them slowly.
      const speed = Math.hypot(target.vx, target.vz);
      if (speed > 0.3) this.fyaw = turn(this.fyaw, Math.atan2(-target.vx, -target.vz), dt * 1.5);
      const look = this.fyaw;
      const back = 4.2, up = 2.1;
      const cx = target.x + Math.sin(look) * back, cz = target.z + Math.cos(look) * back;
      this.fy = this.fy === 0 ? target.y : this.fy + (target.y - this.fy) * Math.min(1, dt * 4);
      cam.position.set(cx, Math.max(this.fy + up, this.ground(cx, cz) + 0.6), cz);
      cam.lookAt(target.x, this.fy + 1.5, target.z);
      this.x = target.x; this.z = target.z; this.yaw = look;
      return;
    }
    // Walking: forward is where the camera looks, flattened.
    const k = this.keys, sp = (k.has('ShiftLeft') || k.has('ShiftRight') ? HURRY : WALK) * dt;
    const f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const s = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    const turnK = (k.has('ArrowLeft') ? 1 : 0) - (k.has('ArrowRight') ? 1 : 0);
    this.yaw += turnK * dt * 1.6;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    this.x += (fx * f - fz * s) * sp;
    this.z += (fz * f + fx * s) * sp;
    const y = this.ground(this.x, this.z) + EYE;
    cam.position.set(this.x, y, this.z);
    const cp = Math.cos(this.pitch);
    cam.lookAt(this.x + fx * cp, y + Math.sin(this.pitch), this.z + fz * cp);
  }
}

/** Turn angle `a` toward `b` by at most `k` (0..1 of the way). */
function turn(a: number, b: number, k: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * Math.min(1, k);
}

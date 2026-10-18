/**
 * The camera: the drone circling the town from above (the start), down on the street walking about
 * (W A S D or the arrow keys, drag to look, Shift to hurry), or following an inhabitant from behind.
 * Keys: Enter goes down to the street (at the town's centre, or where the drone looks), F follows the
 * nearest person (F again: the next one), Esc goes back up a level. Playing as an inhabitant (`play`), the
 * camera eases to them from wherever it was (from the drone: the flight down) and stays with them: behind them
 * out of doors, circling their building while they are inside; drag turns it around them. While steering, the
 * mouse wheel zooms from far behind them down to their own eyes (first person: their body is not drawn); the
 * distance is kept between sessions.
 *
 * `?at=x,z&r=…&h=…&a=…` fixes the drone; `?street=x,z&yaw=…` starts on the street there; `?follow=<id>`
 * starts behind that inhabitant (screenshots and checks).
 */
import type { PerspectiveCamera } from 'three/webgpu';
import { clamp } from '@futuremagic/core';
import { readNumPref, writePref } from '../persist/prefs';

export type CameraMode = 'drone' | 'street' | 'follow' | 'play' | 'free';

/** Eye height when walking (m). */
const EYE = 1.65;
const WALK = 1.6, HURRY = 6;
/** The free camera's speed (m/s), with Shift. */
const FLY = 8, FLY_FAST = 40;

export interface Followed { x: number; y: number; z: number; vx: number; vz: number }

/** Where the player's person is: out of doors (`outside`, walking at vx, vz) or in the building at (x, y, z). */
export interface PlayTarget extends Followed { outside: boolean }

/** How fast the play camera closes in (1/s); slower while shaders still compile, so the flight hides them. */
const EASE = 1.4, EASE_COMPILING = 0.45;
/** While steering: how far behind the head the camera stays when nothing is in the way (m): the wheel sets it, from
 * 0 (first person, at the eyes) through ZOOM_MIN up to ZOOM_MAX; STEER_BACK at first. */
const STEER_BACK = 3.4, ZOOM_MIN = 0.8, ZOOM_MAX = 14;
/** One wheel notch (deltaY 100) zooms by this factor. */
const ZOOM_STEP = 1.25;
/** Nearer than this (m) the camera is at the eyes: first person. */
const FIRST_AT = 0.06;
/**
 * The steering camera as a ball this big (m): it stops this far short of walls, ceilings and furniture, so the
 * near plane (NEAR_CLOSE) never cuts into them.
 */
export const EYE_BALL = 0.22;
/**
 * Near plane (m): NEAR_FAR as a rule (the town far off needs its depth precision: the ground's draped surfaces are
 * spaced for it), down to NEAR_MIN only while something is that close to the camera (a wall, the person's body).
 */
const NEAR_MIN = 0.1, NEAR_FAR = 1;
/** Closer than this to the head (m), the camera would look through the body: it is not drawn then. */
const HIDE_AT = 0.75;

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
  /** The play camera's smoothed eye and look-at point. */
  private readonly eye = { x: 0, y: 0, z: 0 };
  private readonly at = { x: 0, y: 0, z: 0 };
  /** Turn around the player's person, from dragging (while steering: the absolute direction the camera looks). */
  private orbit = 0;
  /** While steering: how far behind the head the player wants the camera (the wheel; 0: first person), and how far it is now (easing there). */
  private zoom = clamp(readNumPref('camera.zoom', STEER_BACK), 0, ZOOM_MAX);
  private zoomNow = this.zoom;
  /** While steering: how far the camera looks down (negative) or up. */
  private lookPitch = -0.22;
  /** Steering last frame (to carry the view over when it starts). */
  private steering = false;
  /** The free camera (debug menu): its height, and the mode it came from (Escape or `freeCamera(false)` goes back). */
  private fly = { y: 0, from: 'drone' as CameraMode };
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
      if (this.mode === 'play') return;
      if (this.mode === 'free') { if (e.code === 'Escape') this.freeCamera(false); return; }
      if (e.code === 'Enter' && this.mode === 'drone') this.toStreet(this.drone.cx, this.drone.cz);
      else if (e.code === 'KeyF') this.follow(this.pickNear(this.x, this.z));
      else if (e.code === 'Escape') this.goUp();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('pointerdown', (e) => {
      if (!(e.target instanceof HTMLCanvasElement)) return;
      // The drag is the camera's: no text selection starting, no middle-click autoscroll, and it carries on outside the window.
      e.preventDefault();
      e.target.setPointerCapture(e.pointerId);
      this.drag = { x: e.clientX, y: e.clientY };
    });
    // The wheel zooms the steering camera, over the game view only (the minimap and the map take theirs first).
    window.addEventListener('wheel', (e) => {
      if (this.mode !== 'play' || !(e.target instanceof HTMLCanvasElement) || e.defaultPrevented) return;
      this.zoomBy(e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1));
    }, { passive: true });
    window.addEventListener('pointerup', () => { this.drag = null; });
    window.addEventListener('pointercancel', () => { this.drag = null; });
    blockBrowserDefaults();
    window.addEventListener('pointermove', (e) => {
      if (!this.drag || this.mode === 'drone') return;
      if (this.mode === 'play') {
        this.orbit -= (e.clientX - this.drag.x) * 0.005;
        // From the eyes you can look further up and down than from behind.
        const fp = this.firstPerson;
        this.lookPitch = clamp(this.lookPitch - (e.clientY - this.drag.y) * 0.004, fp ? -1.45 : -1.1, fp ? 1.3 : 0.6);
        this.drag = { x: e.clientX, y: e.clientY };
        return;
      }
      this.yaw -= (e.clientX - this.drag.x) * 0.004;
      this.pitch = clamp(this.pitch - (e.clientY - this.drag.y) * 0.004, -1.2, 1.0);
      this.drag = { x: e.clientX, y: e.clientY };
    });
  }

  /** Where the camera stands (the player, on the street). */
  position(): { x: number; z: number } {
    return { x: this.camera.position.x, z: this.camera.position.z };
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

  /** Start playing as someone: the camera leaves wherever it is and eases to them (see `updatePlay`). */
  play(): void {
    if (this.mode !== 'play') {
      const p = this.camera.position;
      this.eye.x = p.x; this.eye.y = p.y; this.eye.z = p.z;
      const e = this.camera.matrixWorld.elements;
      this.at.x = p.x - e[8] * 50; this.at.y = p.y - e[9] * 50; this.at.z = p.z - e[10] * 50;
      this.orbit = 0;
    }
    this.mode = 'play';
    this.following = -1;
  }

  /** Stop playing: back to the drone over the town (the picker). */
  stopPlay(): void {
    if (this.mode === 'play') this.mode = 'drone';
  }

  /**
   * The free camera (debug menu): from where the camera is, W A S D along the view (Shift faster), Q and E down
   * and up, drag to look, through walls and floors; off (or Escape) goes back to the mode it came from.
   */
  freeCamera(on: boolean): void {
    if (on === (this.mode === 'free')) return;
    if (!on) { this.mode = this.fly.from; if (this.mode === 'play') this.play(); return; }
    const p = this.camera.position, e = this.camera.matrixWorld.elements;
    this.fly = { y: p.y, from: this.mode };
    this.x = p.x; this.z = p.z;
    this.yaw = Math.atan2(e[8], e[10]);
    this.pitch = clamp(Math.asin(clamp(-e[9], -1, 1)), -1.2, 1.0);
    this.mode = 'free';
    this.following = -1;
  }

  goUp(): void {
    if (this.mode === 'free') return this.freeCamera(false);
    if (this.mode === 'follow') this.mode = 'street';
    else this.mode = 'drone';
    this.following = -1;
  }

  /**
   * Place the camera for this frame while playing. Out of doors: behind the person and a little above, turning
   * after them; indoors: circling their building from rooftop height. The eye and the look-at point ease toward
   * that, so a change (they step out, the first frame after the drone) is a flight rather than a cut; while
   * shaders still compile (`compiling`) the flight is slower, so it hides them.
   */
  updatePlay(dt: number, t: number, target: PlayTarget, compiling: boolean): void {
    if (this.steering) { this.steering = false; this.fyaw = this.orbit; this.orbit = 0; }
    this.setNear(NEAR_FAR);
    this.tooClose = false;
    let ex: number, ey: number, ez: number, ay: number;
    if (target.outside) {
      const speed = Math.hypot(target.vx, target.vz);
      if (speed > 0.3) this.fyaw = turn(this.fyaw, Math.atan2(-target.vx, -target.vz), dt * 1.5);
      const look = this.fyaw + this.orbit, back = 5, up = 2.4;
      ex = target.x + Math.sin(look) * back; ez = target.z + Math.cos(look) * back;
      ey = Math.max(target.y + up, this.ground(ex, ez) + 0.6);
      ay = target.y + 1.4;
    } else {
      const a = this.orbit + t * 0.00004, r = 38;
      ex = target.x + Math.cos(a) * r; ez = target.z + Math.sin(a) * r;
      ey = target.y + 26;
      ay = target.y + 4;
    }
    const k = 1 - Math.exp(-dt * (compiling ? EASE_COMPILING : EASE));
    const e = this.eye, l = this.at;
    e.x += (ex - e.x) * k; e.y += (ey - e.y) * k; e.z += (ez - e.z) * k;
    // The look-at point leads, so the camera turns toward them first and then flies in.
    const kl = Math.min(1, k * 2.5);
    l.x += (target.x - l.x) * kl; l.y += (ay - l.y) * kl; l.z += (target.z - l.z) * kl;
    this.camera.position.set(e.x, Math.max(e.y, this.ground(e.x, e.z) + 0.6), e.z);
    this.camera.lookAt(l.x, l.y, l.z);
    this.x = target.x; this.z = target.z;
  }

  /**
   * What the keys ask of the player's body while steering: a direction on the ground relative to where the camera
   * looks (length 0…1) and whether Shift is held. Zero when no key is down.
   */
  wish(): { x: number; z: number; hurry: boolean } {
    const k = this.keys;
    const f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const s = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const fx = -Math.sin(this.orbit), fz = -Math.cos(this.orbit);
    let x = fx * f - fz * s, z = fz * f + fx * s;
    const l = Math.hypot(x, z);
    if (l > 1) { x /= l; z /= l; }
    return { x, z, hurry: k.has('ShiftLeft') || k.has('ShiftRight') };
  }

  /** Steer from behind someone facing `yaw` (0 looks to −z): the camera swings round behind them (tilted `pitch`, if given). */
  behind(yaw: number, pitch?: number): void {
    this.orbit = yaw;
    if (pitch !== undefined) this.lookPitch = pitch;
    this.steering = true;
  }

  /**
   * Zoom the steering camera by a wheel movement (`delta`: pixels, out positive): each notch a step further or
   * nearer; in from ZOOM_MIN it goes to the eyes, out from the eyes back to ZOOM_MIN.
   */
  zoomBy(delta: number): void {
    const f = Math.pow(ZOOM_STEP, delta / 100);
    if (this.zoom === 0) this.zoom = delta > 0 ? ZOOM_MIN : 0;
    else if (this.zoom * f < ZOOM_MIN * 0.99) this.zoom = delta < 0 ? 0 : ZOOM_MIN;
    else this.zoom = Math.min(ZOOM_MAX, this.zoom * f);
    writePref('camera.zoom', this.zoom.toFixed(2));
  }

  /** The steering camera is at the person's eyes (zoomed all the way in). */
  get firstPerson(): boolean {
    return this.zoom === 0 && this.zoomNow < FIRST_AT;
  }

  /** Which way the steering camera looks: its turn round the person and its tilt (a report, src/game/report.ts). */
  get look(): { orbit: number; pitch: number } {
    return { orbit: this.orbit, pitch: this.lookPitch };
  }

  /**
   * Place the camera for this frame while the player steers their person (`head`: their eye point): behind them
   * where the player looks (drag to turn and tilt), pulled in where a wall or a ceiling would come between
   * (`clear(dx, dy, dz, max)`: how far from the head the view is free along that direction). From afar (the flight
   * down from the drone) it eases in as `updatePlay` does.
   */
  updateSteer(dt: number, head: { x: number; y: number; z: number }, compiling: boolean, clear: (dx: number, dy: number, dz: number, max: number) => number, room: (x: number, y: number, z: number) => number = () => Infinity): void {
    if (!this.steering) {
      // Carry on looking the way the camera looks now.
      const e = this.camera.matrixWorld.elements;
      this.orbit = Math.atan2(e[8], e[10]);
      this.steering = true;
    }
    // Out of the eyes again: back to the tilt a camera behind can have.
    if (!this.firstPerson) this.lookPitch = clamp(this.lookPitch, -1.1, 0.6);
    const cp = Math.cos(this.lookPitch), dx = Math.sin(this.orbit) * cp, dy = -Math.sin(this.lookPitch), dz = Math.cos(this.orbit) * cp;
    // The wheel's distance, eased (a notch is a glide, not a jump); at the eyes it stays there.
    this.zoomNow += (this.zoom - this.zoomNow) * (1 - Math.exp(-dt * 10));
    if (Math.abs(this.zoom - this.zoomNow) < 0.01) this.zoomNow = this.zoom;
    if (!this.firstPerson && this.zoomNow < FIRST_AT && this.zoom > 0) this.zoomNow = FIRST_AT;
    // As far back as there is room for the camera ball (a wall, a ceiling, a wardrobe, a shut door pulls it in).
    const want = this.zoomNow;
    const back = want < FIRST_AT ? 0 : Math.max(0.05, Math.min(want, clear(dx, dy, dz, want) - 0.02));
    const ex = head.x + dx * back, ey = head.y + dy * back, ez = head.z + dz * back;
    const e = this.eye, l = this.at;
    const far = Math.hypot(ex - e.x, ey - e.y, ez - e.z) > 8;
    // Easing out again is smooth; pulling in is at once (else it sits in the wall for a few frames).
    const pullIn = !far && back < Math.hypot(e.x - head.x, e.y - head.y, e.z - head.z);
    const k = far ? 1 - Math.exp(-dt * (compiling ? EASE_COMPILING : EASE)) : pullIn ? 1 : 1 - Math.exp(-dt * 16);
    e.x += (ex - e.x) * k; e.y += (ey - e.y) * k; e.z += (ez - e.z) * k;
    const kl = far ? Math.min(1, k * 2.5) : 1;
    const ax = head.x - dx, ay = head.y - dy, az = head.z - dz;
    l.x += (ax - l.x) * kl; l.y += (ay - l.y) * kl; l.z += (az - l.z) * kl;
    this.camera.position.set(e.x, e.y, e.z);
    this.camera.lookAt(l.x, l.y, l.z);
    this.x = head.x; this.z = head.z;
    const toHead = Math.hypot(e.x - head.x, e.y - head.y, e.z - head.z);
    // Nothing nearer than the near plane: the nearest solid, and the body (about 0.35 m round the head; not drawn
    // when the camera is that close, so then only the solids count).
    const hidden = !far && toHead < HIDE_AT;
    this.setNear(far ? NEAR_FAR : clamp(Math.min(room(e.x, e.y, e.z) * 0.6, hidden ? Infinity : (toHead - 0.35) * 0.8), NEAR_MIN, NEAR_FAR));
    this.tooClose = hidden;
  }

  /** The steering camera is so close to the head that the body would fill the view: the game leaves it undrawn. */
  tooClose = false;

  private setNear(n: number): void {
    if (this.camera.near === n) return;
    this.camera.near = n;
    this.camera.updateProjectionMatrix();
  }

  /** Place the camera for this frame. `target`: where the followed person is (null: lost them). `t`: ms. */
  update(dt: number, t: number, target: Followed | null): void {
    const cam = this.camera;
    if (this.mode === 'play') return;
    this.setNear(NEAR_FAR);
    this.tooClose = false;
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
    if (this.mode === 'free') return this.flyFrame(dt);
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

  /** A frame of the free camera: along the view, up and down, never held by the ground. */
  private flyFrame(dt: number): void {
    const k = this.keys, sp = (k.has('ShiftLeft') || k.has('ShiftRight') ? FLY_FAST : FLY) * dt;
    const f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const s = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    const u = (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);
    this.yaw += ((k.has('ArrowLeft') ? 1 : 0) - (k.has('ArrowRight') ? 1 : 0)) * dt * 1.6;
    const cp = Math.cos(this.pitch), fx = -Math.sin(this.yaw) * cp, fy = Math.sin(this.pitch), fz = -Math.cos(this.yaw) * cp;
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    this.x += (fx * f + rx * s) * sp;
    this.fly.y += (fy * f + u) * sp;
    this.z += (fz * f + rz * s) * sp;
    this.camera.position.set(this.x, this.fly.y, this.z);
    this.camera.lookAt(this.x + fx, this.fly.y + fy, this.z + fz);
  }
}

/** Turn angle `a` toward `b` by at most `k` (0..1 of the way). */
function turn(a: number, b: number, k: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * Math.min(1, k);
}

/** Keys the browser would scroll a page with. */
const SCROLL_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End']);

/**
 * The browser's own reactions to the mouse and keys over the game, off: the right-click menu, middle-click
 * autoscroll, wheel scrolling and zooming, dragging the canvas as an image, keys scrolling the page. Text fields
 * and the panels (chat, menus, lists) keep theirs: only what happens on the canvas or with no field focused.
 */
function blockBrowserDefaults(): void {
  const onCanvas = (e: Event) => e.target instanceof HTMLCanvasElement;
  window.addEventListener('contextmenu', (e) => { if (onCanvas(e)) e.preventDefault(); });
  window.addEventListener('auxclick', (e) => { if (onCanvas(e)) e.preventDefault(); });
  window.addEventListener('dragstart', (e) => { if (onCanvas(e)) e.preventDefault(); });
  window.addEventListener('wheel', (e) => { if (onCanvas(e)) e.preventDefault(); }, { passive: false });
  window.addEventListener('keydown', (e) => {
    const t = e.target;
    if (SCROLL_KEYS.has(e.code) && (t === document.body || t === document.documentElement || t instanceof HTMLCanvasElement)) e.preventDefault();
  });
}

/**
 * The scene's lights, made once before the warm-up (docs/SHADERS.md): the number, order and shadow
 * flags of lights are part of every shader's cache key, so nothing adds a light later. Guarded: no
 * other file constructs a light. Street lamps and window lights will come as a fixed pool here
 * (an unused light stays in the scene at intensity 0).
 */
import { DirectionalLight, HemisphereLight, Vector3, type Scene } from 'three/webgpu';

export interface Lights {
  /** The sun by day, the moon (or the night sky's glow) by night: the one shadow-casting light. */
  sun: DirectionalLight;
  sky: HemisphereLight;
  /** Towards the light (unit length); the day cycle sets it with `aimSun`. */
  readonly dir: Vector3;
  /** What the shadow covers: a square of half-side r around (x, y, z). */
  readonly focus: { x: number; y: number; z: number; r: number };
}

export function makeLights(scene: Scene): Lights {
  const sky = new HemisphereLight(0xbfd8ff, 0x5a5040, 0.9);
  const sun = new DirectionalLight(0xfff2dd, 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = sun.shadow.camera;
  s.left = -120; s.right = 120; s.top = 120; s.bottom = -120; s.near = 1; s.far = 400;
  scene.add(sky, sun, sun.target);
  const l: Lights = { sun, sky, dir: new Vector3(80, 120, 40).normalize(), focus: { x: 0, y: 0, z: 0, r: 120 } };
  placeSun(l);
  return l;
}


/**
 * Point the sun's shadow at a square of half-side `r` around (x, y, z): the town from above, or
 * the streets around the player. Moving the shadow camera changes no shader.
 */
export function fitSunShadow(l: Lights, x: number, y: number, z: number, r: number): void {
  Object.assign(l.focus, { x, y, z, r });
  placeSun(l);
}

/**
 * Turn the shadow-casting light towards `dir` (unit, towards the sun or moon). Kept a little above the horizon,
 * so a low sun's shadows stay inside the shadow map. Changes no shader.
 */
export function aimSun(l: Lights, dir: { x: number; y: number; z: number }): void {
  l.dir.set(dir.x, Math.max(dir.y, 0.06), dir.z).normalize();
  placeSun(l);
}

function placeSun(l: Lights): void {
  const { x, y, z, r } = l.focus, D = l.dir;
  const d = r * 2 + 200;
  l.sun.target.position.set(x, y, z);
  l.sun.position.set(x + D.x * d, y + D.y * d, z + D.z * d);
  const s = l.sun.shadow.camera;
  if (s.right !== r || s.far !== d * 2) {
    s.left = -r; s.right = r; s.top = r; s.bottom = -r; s.near = 1; s.far = d * 2;
    s.updateProjectionMatrix();
  }
  l.sun.target.updateMatrixWorld();
}

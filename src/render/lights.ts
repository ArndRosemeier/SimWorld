/**
 * The scene's lights, made once before the warm-up (docs/SHADERS.md): the number, order and shadow
 * flags of lights are part of every shader's cache key, so nothing adds a light later. Guarded: no
 * other file constructs a light. Street lamps and window lights will come as a fixed pool here
 * (an unused light stays in the scene at intensity 0).
 */
import { DirectionalLight, HemisphereLight, type Scene } from 'three/webgpu';

/** The sun's direction (towards the sun, unit length). */
const SUN_DIR = [80 / 149.67, 120 / 149.67, 40 / 149.67];

export interface Lights {
  sun: DirectionalLight;
  sky: HemisphereLight;
}

export function makeLights(scene: Scene): Lights {
  const sky = new HemisphereLight(0xbfd8ff, 0x5a5040, 0.9);
  const sun = new DirectionalLight(0xfff2dd, 2.2);
  sun.position.set(SUN_DIR[0] * 150, SUN_DIR[1] * 150, SUN_DIR[2] * 150);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = sun.shadow.camera;
  s.left = -120; s.right = 120; s.top = 120; s.bottom = -120; s.near = 1; s.far = 400;
  scene.add(sky, sun, sun.target);
  return { sun, sky };
}


/**
 * Point the sun's shadow at a square of half-side `r` around (x, y, z): the town from above, or
 * the streets around the player. Moving the shadow camera changes no shader.
 */
export function fitSunShadow(l: Lights, x: number, y: number, z: number, r: number): void {
  const d = r * 2 + 200;
  l.sun.target.position.set(x, y, z);
  l.sun.position.set(x + SUN_DIR[0] * d, y + SUN_DIR[1] * d, z + SUN_DIR[2] * d);
  const s = l.sun.shadow.camera;
  s.left = -r; s.right = r; s.top = r; s.bottom = -r; s.near = 1; s.far = d * 2;
  s.updateProjectionMatrix();
  l.sun.target.updateMatrixWorld();
}

/**
 * The scene's lights, made once before the warm-up (docs/SHADERS.md): the number, order and shadow
 * flags of lights are part of every shader's cache key, so nothing adds a light later. Guarded: no
 * other file constructs a light. Street lamps and window lights will come as a fixed pool here
 * (an unused light stays in the scene at intensity 0).
 */
import { DirectionalLight, HemisphereLight, type Scene } from 'three/webgpu';

export interface Lights {
  sun: DirectionalLight;
  sky: HemisphereLight;
}

export function makeLights(scene: Scene): Lights {
  const sky = new HemisphereLight(0xbfd8ff, 0x5a5040, 0.9);
  const sun = new DirectionalLight(0xfff2dd, 2.2);
  sun.position.set(80, 120, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = sun.shadow.camera;
  s.left = -120; s.right = 120; s.top = 120; s.bottom = -120; s.near = 1; s.far = 400;
  scene.add(sky, sun, sun.target);
  return { sun, sky };
}

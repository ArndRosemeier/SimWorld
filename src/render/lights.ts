/**
 * The scene's lights, made once before the warm-up (docs/SHADERS.md): the number, order and shadow
 * flags of lights are part of every shader's cache key, so nothing adds a light later. Guarded: no
 * other file constructs a light. The street lamps nearest the camera get a fixed pool of point lights
 * (`placeLamps`); an unused one stays in the scene at intensity 0.
 */
import { Color, DirectionalLight, HemisphereLight, PointLight, Vector3, type Scene } from 'three/webgpu';

/** Point lights for the nearest street lamps. Every lit shader loops over them, so the pool stays small. */
export const LAMP_POOL = 6;
/** How far a lamp's light reaches (m). */
const LAMP_REACH = 24;
/** Lamp light colour by lamp kind (src/build/streetProps.ts `lampsOf`: 0 modern LED, 1 classic, 2 double). */
const LAMP_COLOURS = [new Color(1, 0.93, 0.82), new Color(1, 0.8, 0.55), new Color(1, 0.9, 0.75)];

export interface Lights {
  /** The sun by day, the moon (or the night sky's glow) by night: the one shadow-casting light. */
  sun: DirectionalLight;
  sky: HemisphereLight;
  /** Towards the light (unit length); the day cycle sets it with `aimSun`. */
  readonly dir: Vector3;
  /** What the shadow covers: a square of half-side r around (x, y, z). */
  readonly focus: { x: number; y: number; z: number; r: number };
  /** The street-lamp pool (`placeLamps`). */
  readonly lamps: PointLight[];
}

export function makeLights(scene: Scene): Lights {
  const sky = new HemisphereLight(0xbfd8ff, 0x5a5040, 0.9);
  const sun = new DirectionalLight(0xfff2dd, 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = sun.shadow.camera;
  s.left = -120; s.right = 120; s.top = 120; s.bottom = -120; s.near = 1; s.far = 400;
  scene.add(sky, sun, sun.target);
  const lamps: PointLight[] = [];
  for (let i = 0; i < LAMP_POOL; i++) {
    const p = new PointLight(0xffe0b0, 0, LAMP_REACH, 2);
    p.position.set(0, -1000, 0);
    lamps.push(p);
    scene.add(p);
  }
  const l: Lights = { sun, sky, dir: new Vector3(80, 120, 40).normalize(), focus: { x: 0, y: 0, z: 0, r: 120 }, lamps };
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

const _near: { i: number; d: number }[] = [];

/**
 * Put the lamp pool on the `LAMP_POOL` street lamps nearest (x, z) (heads from src/build/streetProps.ts `lampsOf`,
 * `stride` floats each: x, head y, z, kind), at brightness `on` (0 off … 1 night). With no lamp near the camera
 * the pool stays dark. Changes no shader.
 */
export function placeLamps(l: Lights, heads: Float32Array | undefined, x: number, z: number, on: number, stride = 4): void {
  _near.length = 0;
  const n = heads && on > 0.01 ? heads.length / stride : 0;
  for (let i = 0; i < n; i++) {
    const dx = heads![i * stride] - x, dz = heads![i * stride + 2] - z, d = dx * dx + dz * dz;
    if (d < 160 * 160) _near.push({ i, d });
  }
  _near.sort((a, b) => a.d - b.d);
  for (let j = 0; j < LAMP_POOL; j++) {
    const p = l.lamps[j];
    if (j >= _near.length) { p.intensity = 0; continue; }
    const o = _near[j].i * stride;
    p.position.set(heads![o], heads![o + 1] - 0.3, heads![o + 2]);
    p.color.copy(LAMP_COLOURS[heads![o + 3]] ?? LAMP_COLOURS[0]);
    p.intensity = 60 * on;
  }
}

/**
 * Even white light from every side and no sun (the looks check, src/looks.ts): a hemisphere light lights only
 * diffusely, so what a surface shows is its own colour, and one whose colour came out zero shows black, however
 * much the sun would gloss it. The sky view sets the lights back on its next update.
 */
export function evenLight(l: Lights): void {
  l.sun.intensity = 0;
  l.sky.intensity = 1;
  l.sky.color.setRGB(1, 1, 1);
  l.sky.groundColor.setRGB(1, 1, 1);
  for (const p of l.lamps) p.intensity = 0;
}

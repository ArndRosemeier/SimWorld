/**
 * Entry point. For now: the town from above. The renderer on WebGL 2, the Stage's warm-up behind
 * the loading screen, then the town workers plan the town from its seed and the view fills in
 * from the centre while a slow drone drift circles it. The selector-as-loading-screen and the
 * game come in their own changes (docs/design/simworld-plan.md R2).
 *
 * `?seed=…&size=…` (0 … 1) pick the town; `?tex=…` the texture size in texels (256 default, 512 sharper and slower); `?at=x,z&r=…&h=…&a=…` fix the drone's centre, distance,
 * height and angle (radians) instead of circling, for screenshots. `?inside=<cell>/<building>&floor=…`
 * shows one storey of a building as a cutaway instead (showInside). Sound: `?date=YYYY-MM-DD`, `?time=HH:MM`,
 * `?rain=0…1`, `?wind=0…1` set what the soundscape hears instead of the real date, time and weather
 * (LiveClock); `?mute` keeps it silent.
 */
import { Color, Fog, PerspectiveCamera, Scene } from 'three/webgpu';
import { clamp } from '@futuremagic/core';
import { createRenderer, GraphicsUnavailable } from './render/renderer';
import { Stage } from './render/stage';
import { fitSunShadow, makeLights } from './render/lights';
import { setParcels } from './render/tsl/ground';
import { showTown } from './render/townView';
import { meshFromData } from './render/meshes';
import { WorkerPool } from './workers/pool';
import townWorkerUrl from './workers/town.worker.ts?worker&url';
import texWorkerUrl from './workers/tex.worker.ts?worker&url';
import type { FromTex, ToTex } from './workers/texProtocol';
import { loadTextures } from './render/textures';
import { INTERIOR, useTextures } from './render/materials';
import { whatsNewButton } from './app/whatsNew';
import type { FromTown, ToTown } from './workers/townProtocol';
import { DEFAULT_SETTINGS, type TownSettings } from './world/settings';
import { TownAudio } from './audio/townAudio';
import { LiveClock } from './audio/env';
import { soundButton } from './app/soundPanel';

const SKY = 0xa9c8e4;

function settingsFromUrl(): TownSettings {
  const q = new URLSearchParams(location.search);
  const seed = Number(q.get('seed') ?? DEFAULT_SETTINGS.seed);
  const size = Number(q.get('size') ?? DEFAULT_SETTINGS.size);
  return { seed: Number.isFinite(seed) ? seed >>> 0 : DEFAULT_SETTINGS.seed, size: Number.isFinite(size) ? clamp(size, 0, 1) : DEFAULT_SETTINGS.size };
}

function step(text: string, frac?: number): void {
  const el = document.querySelector('#loading .step');
  if (el) el.textContent = text;
  const bar = document.querySelector<HTMLElement>('#loading .bar i');
  if (bar && frac !== undefined) bar.style.width = `${Math.round(frac * 100)}%`;
}

async function start(audio: TownAudio, live: LiveClock): Promise<void> {
  const settings = settingsFromUrl();
  const cores = Math.max(1, (navigator.hardwareConcurrency || 4) - 1);
  // The town workers start planning at once; the texture workers generate the facade textures
  // meanwhile (the shaders need them before the warm-up), then the renderer warms up.
  const pool = new WorkerPool<ToTown, FromTown>(townWorkerUrl, Math.min(4, cores));
  const planned = pool.start(() => ({ type: 'init', settings }));
  const texPool = new WorkerPool<ToTex, FromTex>(texWorkerUrl, Math.min(6, cores));
  await texPool.start(() => ({ type: 'init' }));
  const texSize = Number(new URLSearchParams(location.search).get('tex')) === 512 ? 512 : 256;
  step('Making the materials', 0.02);
  // Facades first, then the interiors' finishes (queued behind them in the same pool).
  const facade = loadTextures(texPool, 'facade', (done, total) => step('Making the materials', 0.02 + (0.08 * done) / total), texSize);
  const interior = loadTextures(texPool, 'interior', (done, total) => step('Making the materials', 0.1 + (0.02 * done) / total), texSize, 100);

  const canvas = document.createElement('canvas');
  document.body.prepend(canvas);
  const { renderer } = await createRenderer(canvas);
  const scene = new Scene();
  scene.background = new Color(SKY);
  scene.fog = new Fog(SKY, 1200, 6500);
  const camera = new PerspectiveCamera(50, innerWidth / innerHeight, 1, 9000);
  const resize = (): void => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
  resize();
  addEventListener('resize', resize);
  renderer.shadowMap.enabled = true;
  const lights = makeLights(scene);
  const stage = new Stage(renderer, scene, camera);
  stage.shadowCamera = lights.sun.shadow.camera;
  useTextures({ facade: await facade, interior: await interior });
  texPool.dispose();
  step('Preparing the shaders', 0.12);
  await stage.warmUp();
  step('Planning the town', 0.15);

  const [ready] = await planned;
  if (ready.type !== 'ready') throw new Error('the town workers did not start');
  const town = ready.town;
  setParcels(town.parcels);
  const inside = new URLSearchParams(location.search).get('inside');
  if (inside) return showInside(inside, pool, stage, lights, renderer, camera, scene);
  fitSunShadow(lights, town.x, town.y, town.z, town.radius * 1.15);
  // What the town sounds like where: one worker works it out alongside the meshes.
  void pool.run<Extract<FromTown, { type: 'sound' }>>({ type: 'sound' }, 0.5).then((r) => { live.region.coastal = r.map.coastal; audio.setTown(r.map); });
  const view = showTown(stage, pool, town, (done, total) => step(`Building the town (${done} of ${total})`, 0.15 + (0.85 * done) / total));

  // The drone drift: a slow circle around the town, high enough to see it whole.
  const q = new URLSearchParams(location.search);
  const num = (k: string, d: number) => (q.has(k) && Number.isFinite(Number(q.get(k))) ? Number(q.get(k)) : d);
  const [cx, cz] = (q.get('at') ?? `${town.x},${town.z}`).split(',').map(Number);
  const R = num('r', town.radius * 1.35), H = town.y + num('h', town.radius * 0.55), fixed = q.has('a') ? num('a', 0) : null;
  const hud = document.getElementById('hud');
  let shown = false, lastT = 0;
  const fwd = { x: 0, y: 0, z: 0 };
  renderer.setAnimationLoop((t: number) => {
    const dt = lastT ? Math.min(0.25, (t - lastT) / 1000) : 0;
    lastT = t;
    stage.frame();
    const a = fixed ?? t * 0.00002;
    camera.position.set(cx + Math.cos(a) * R, H, cz + Math.sin(a) * R);
    camera.lookAt(cx, town.y, cz);
    renderer.render(scene, camera);
    const e = camera.matrixWorld.elements;
    fwd.x = -e[8]; fwd.y = -e[9]; fwd.z = -e[10];
    audio.frame(dt, { x: camera.position.x, y: camera.position.y, z: camera.position.z, fx: fwd.x, fy: fwd.y, fz: fwd.z, ux: e[4], uy: e[5], uz: e[6] }, live.now());
    if (!shown && view.done > 0) { shown = true; document.getElementById('loading')?.remove(); audio.startTown(); }
    if (hud) hud.textContent = `${town.dwellings} households · ${view.done < view.total ? `building ${view.done}/${view.total} · ` : ''}${stage.hudLine()}`;
  });
  await view.ready;
}

/**
 * `?inside=<cell>/<building>&floor=<n>`: the dollhouse cutaway of one storey of a building, the
 * camera circling it (or fixed with `a=`), to look at interiors before the game can walk in.
 */
async function showInside(arg: string, pool: WorkerPool<ToTown, FromTown>, stage: Stage, lights: ReturnType<typeof makeLights>, renderer: Awaited<ReturnType<typeof createRenderer>>['renderer'], camera: PerspectiveCamera, scene: Scene): Promise<void> {
  const q = new URLSearchParams(location.search);
  const [cell, building] = arg.split('/').map(Number);
  step('Planning the rooms', 0.5);
  const r = await pool.run({ type: 'interior', cell, building, floor: Number(q.get('floor') ?? 0) }, 0);
  if (r.type !== 'interior') throw new Error(r.type === 'error' ? r.message : 'no interior');
  if (r.mesh) await stage.add(meshFromData(r.mesh, INTERIOR));
  scene.fog = null;
  const [x, y, z] = r.at, R = Math.max(8, r.radius * 1.5), fixed = q.has('a') ? Number(q.get('a')) : null;
  fitSunShadow(lights, x, y, z, r.radius * 1.5);
  document.getElementById('loading')?.remove();
  const hud = document.getElementById('hud');
  renderer.setAnimationLoop((t: number) => {
    stage.frame();
    const a = fixed ?? t * 0.0001;
    camera.position.set(x + Math.cos(a) * R, y + R * 0.9, z + Math.sin(a) * R);
    camera.lookAt(x, y, z);
    renderer.render(scene, camera);
    if (hud) hud.textContent = `${r.about} · ${stage.hudLine()}`;
  });
}

// The version and What's new sit on the start screen and stay in the corner once the town is up.
document.body.append(whatsNewButton());
// Sound starts with the first click or key (browsers allow nothing earlier): the title music on the
// start screen, then the town.
const audio = new TownAudio(settingsFromUrl().seed);
const live = new LiveClock(settingsFromUrl().seed, new URLSearchParams(location.search));
document.body.append(soundButton(audio.engine));
void audio.init();
// The title music runs while the start screen is up; the render loop takes over once it starts.
const startScreen = setInterval(() => {
  if (document.getElementById('loading')) audio.tickMusic(0.1, live.now());
  else clearInterval(startScreen);
}, 100);

start(audio, live).catch((err) => {
  const el = document.querySelector('#loading .step');
  if (el) el.textContent = err instanceof GraphicsUnavailable ? 'This browser cannot draw 3D graphics (WebGL 2 needed).' : `Start failed: ${err instanceof Error ? err.message : String(err)}`;
  throw err;
});

/**
 * Entry point. For now: the town from above. The renderer on WebGL 2, the Stage's warm-up behind
 * the loading screen, then the town workers plan the town from its seed and the view fills in
 * from the centre while a slow drone drift circles it. The selector-as-loading-screen and the
 * game come in their own changes (docs/design/simworld-plan.md R2).
 *
 * `?seed=…&size=…` (0 … 1) pick the town; `?at=x,z&r=…&h=…&a=…` fix the drone's centre, distance,
 * height and angle (radians) instead of circling, for screenshots.
 */
import { Color, Fog, PerspectiveCamera, Scene } from 'three/webgpu';
import { clamp } from '@futuremagic/core';
import { createRenderer, GraphicsUnavailable } from './render/renderer';
import { Stage } from './render/stage';
import { fitSunShadow, makeLights } from './render/lights';
import { setParcels } from './render/tsl/ground';
import { showTown } from './render/townView';
import { WorkerPool } from './workers/pool';
import townWorkerUrl from './workers/town.worker.ts?worker&url';
import type { FromTown, ToTown } from './workers/townProtocol';
import { DEFAULT_SETTINGS, type TownSettings } from './world/settings';

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

async function start(): Promise<void> {
  const settings = settingsFromUrl();
  // The town workers start planning at once; the renderer warms up meanwhile.
  const pool = new WorkerPool<ToTown, FromTown>(townWorkerUrl, Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1)));
  const planned = pool.start(() => ({ type: 'init', settings }));
  step('Planning the town', 0.05);

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
  await stage.warmUp();
  step('Planning the town', 0.15);

  const [ready] = await planned;
  if (ready.type !== 'ready') throw new Error('the town workers did not start');
  const town = ready.town;
  setParcels(town.parcels);
  fitSunShadow(lights, town.x, town.y, town.z, town.radius * 1.15);
  const view = showTown(stage, pool, town, (done, total) => step(`Building the town (${done} of ${total})`, 0.15 + (0.85 * done) / total));

  // The drone drift: a slow circle around the town, high enough to see it whole.
  const q = new URLSearchParams(location.search);
  const num = (k: string, d: number) => (q.has(k) && Number.isFinite(Number(q.get(k))) ? Number(q.get(k)) : d);
  const [cx, cz] = (q.get('at') ?? `${town.x},${town.z}`).split(',').map(Number);
  const R = num('r', town.radius * 1.35), H = town.y + num('h', town.radius * 0.55), fixed = q.has('a') ? num('a', 0) : null;
  const hud = document.getElementById('hud');
  let shown = false;
  renderer.setAnimationLoop((t: number) => {
    stage.frame();
    const a = fixed ?? t * 0.00002;
    camera.position.set(cx + Math.cos(a) * R, H, cz + Math.sin(a) * R);
    camera.lookAt(cx, town.y, cz);
    renderer.render(scene, camera);
    if (!shown && view.done > 0) { shown = true; document.getElementById('loading')?.remove(); }
    if (hud) hud.textContent = `${town.dwellings} households · ${view.done < view.total ? `building ${view.done}/${view.total} · ` : ''}${stage.hudLine()}`;
  });
  await view.ready;
}

start().catch((err) => {
  const el = document.querySelector('#loading .step');
  if (el) el.textContent = err instanceof GraphicsUnavailable ? 'This browser cannot draw 3D graphics (WebGL 2 needed).' : `Start failed: ${err instanceof Error ? err.message : String(err)}`;
  throw err;
});

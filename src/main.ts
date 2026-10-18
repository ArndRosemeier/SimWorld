/**
 * Entry point. For now: the town from above. The renderer on WebGL 2, the Stage's warm-up behind
 * the loading screen, then the town workers plan the town from its seed and the view fills in
 * from the centre while a slow drone drift circles it. The selector-as-loading-screen and the
 * game come in their own changes (docs/design/simworld-plan.md R2).
 *
 * `?seed=…&size=…` (0 … 1) pick the town; `?tex=…` the texture size in texels (256 default, 512 sharper and slower); `?at=x,z&r=…&h=…&a=…` fix the drone's centre, distance,
 * height and angle (radians) instead of circling, for screenshots.
 *
 * The society runs in the sim worker from the start; Enter takes the camera down to the street, where the
 * inhabitants out of doors walk their real errands (src/game/street.ts, keys in src/game/camera.ts).
 * `?time=HH:MM` starts the day at that time (default: the time of day now), `?speed=…` runs game time that
 * many times faster than real time (default 1), `?street=x,z&yaw=…` and `?follow=<id>` start on the street.
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
import texWorkerUrl from './workers/tex.worker.ts?worker&url';
import type { FromTex, ToTex } from './workers/texProtocol';
import { loadTextures } from './render/textures';
import { useTextures } from './render/materials';
import { whatsNewButton } from './app/whatsNew';
import type { FromTown, ToTown } from './workers/townProtocol';
import { DEFAULT_SETTINGS, type TownSettings } from './world/settings';
import { SimClient } from './game/SimClient';
import { Street } from './game/street';
import { CameraControl } from './game/camera';
import { PeopleView } from './render/people/peopleView';
import { appearanceOf, outfitOf, type LookInfo } from './street/looks';
import { FEMALE, MALE } from './sim/actors';
import { hhmm, minuteOfDay, weekdayOf } from './sim/time';

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

/** The game clock to start at: day 0 (a Monday) at `?time=HH:MM`, by default the time of day now. */
function startClock(): number {
  const t = new URLSearchParams(location.search).get('time');
  const m = t && /^\d{1,2}:\d{2}$/.test(t) ? Number(t.split(':')[0]) * 60 + Number(t.split(':')[1]) : new Date().getHours() * 60 + new Date().getMinutes();
  // The world is made at 06:00 of day 0; earlier times are the next morning.
  return m >= 360 ? m : m + 1440;
}

/** Day of the year today (0 = 1 January): game day 0 is today, so the season is the real one. */
function dayOfYear(): number {
  const now = new Date();
  return Math.floor((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(now.getFullYear(), 0, 1)) / 86400000);
}

/** Two looks whose shaders the warm-up compiles (every human after them is a cache hit). */
function sampleLooks(seed: number, clock: number) {
  const infos: LookInfo[] = [
    { id: 1, sex: FEMALE, birth: -30 * 365, household: -1, role: '' },
    { id: 2, sex: MALE, birth: -50 * 365, household: -1, role: '' },
  ];
  return infos.map((p, i) => ({
    bodyKey: `sample${i}`, app: appearanceOf(seed, p, clock), outfitKey: '',
    outfit: i === 0
      ? { chest: { defId: 'dress', visual: { shape: 'cloth', seed: 3, primary: [0.6, 0.2, 0.2] as [number, number, number], secondary: [0.2, 0.2, 0.3] as [number, number, number], accent: [0, 0, 0] as [number, number, number], material: 'checks', glow: 0 } } }
      : outfitOf(seed, p, clock, 1),
  }));
}

async function start(): Promise<void> {
  const settings = settingsFromUrl();
  const cores = Math.max(1, (navigator.hardwareConcurrency || 4) - 1);
  const q0 = new URLSearchParams(location.search);
  const rate = Math.max(0, Number(q0.get('speed') ?? 1)) || 1;
  // The society: planned and populated in its own worker while the rest loads.
  const simulated = SimClient.start(settings, startClock(), rate);
  // The town workers start planning at once; the texture workers generate the facade textures
  // meanwhile (the shaders need them before the warm-up), then the renderer warms up.
  const pool = new WorkerPool<ToTown, FromTown>(townWorkerUrl, Math.min(4, cores));
  const planned = pool.start(() => ({ type: 'init', settings }));
  const texPool = new WorkerPool<ToTex, FromTex>(texWorkerUrl, Math.min(6, cores));
  await texPool.start(() => ({ type: 'init' }));
  const texSize = Number(new URLSearchParams(location.search).get('tex')) === 512 ? 512 : 256;
  step('Making the materials', 0.02);
  const facade = loadTextures(texPool, 'facade', (done, total) => step('Making the materials', 0.02 + (0.1 * done) / total), texSize);

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
  useTextures({ facade: await facade });
  texPool.dispose();
  step('Making the people', 0.1);
  const { view: people, warm } = await PeopleView.create(stage, sampleLooks(settings.seed, startClock()), Math.min(2, cores));
  scene.add(people.root);
  step('Preparing the shaders', 0.12);
  await stage.warmUp(warm);
  people.warmedUp();
  step('Planning the town', 0.15);

  const [ready] = await planned;
  if (ready.type !== 'ready') throw new Error('the town workers did not start');
  const town = ready.town;
  setParcels(town.parcels);
  fitSunShadow(lights, town.x, town.y, town.z, town.radius * 1.15);
  const view = showTown(stage, pool, town, (done, total) => step(`Building the town (${done} of ${total})`, 0.15 + (0.85 * done) / total));

  step('Waking the town', 0.15);
  const sim = await simulated;
  const street = new Street(sim, people, settings.seed, dayOfYear());

  // The drone drift: a slow circle around the town, high enough to see it whole (or fixed by ?at=…).
  const q = new URLSearchParams(location.search);
  const num = (k: string, d: number) => (q.has(k) && Number.isFinite(Number(q.get(k))) ? Number(q.get(k)) : d);
  const [cx, cz] = (q.get('at') ?? `${town.x},${town.z}`).split(',').map(Number);
  const cam = new CameraControl(camera, { cx, cz, y: town.y, r: num('r', town.radius * 1.35), h: num('h', town.radius * 0.55), fixed: q.has('a') ? num('a', 0) : null }, (x, z) => sim.groundAt(x, z));
  cam.pickNear = (x, z) => street.next(x, z);
  if (q.has('street')) { const [sx, sz] = q.get('street')!.split(',').map(Number); cam.toStreet(sx, sz, num('yaw', 0)); }
  const followId = q.has('follow') ? num('follow', -1) : -1;
  const hud = document.getElementById('hud');
  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  let shown = false, last = performance.now(), shadowMode = '';
  renderer.setAnimationLoop((t: number) => {
    const dt = Math.min(0.1, (t - last) / 1000);
    last = t;
    stage.frame();
    if (followId >= 0 && cam.following < 0 && cam.mode !== 'follow' && sim.walkers.has(followId)) cam.follow(followId);
    const target = cam.mode === 'follow' ? street.where(cam.following) : null;
    cam.update(dt, t, target);
    const ground = cam.mode === 'drone' ? { x: cx, z: cz } : { x: camera.position.x, z: camera.position.z };
    sim.update(ground.x, ground.z);
    people.draw(cam.mode === 'drone' ? [] : street.figuresNow(), camera.position.x, camera.position.z, dt, t / 1000);
    // The sun's shadow covers the whole town from above, the streets around you down there.
    if (cam.mode !== 'drone') fitSunShadow(lights, camera.position.x, camera.position.y, camera.position.z, 70);
    else if (shadowMode !== 'drone') fitSunShadow(lights, town.x, town.y, town.z, town.radius * 1.15);
    shadowMode = cam.mode;
    renderer.render(scene, camera);
    if (!shown && view.done > 0) { shown = true; document.getElementById('loading')?.remove(); }
    if (hud) {
      const c = sim.clock, n = people.counts;
      const who = cam.mode === 'follow' ? `\n${street.describe(cam.following)}` : cam.mode === 'drone' ? '\nEnter: down to the street' : '\nW A S D walk, drag to look, F follow someone, Esc up';
      hud.textContent = `${DAYS[weekdayOf(c)]} ${hhmm(Math.floor(minuteOfDay(c)))} · ${sim.people} people, ${sim.walkers.size} out near you, ${n.shown} drawn · ${town.dwellings} households · ${view.done < view.total ? `building ${view.done}/${view.total} · ` : ''}${stage.hudLine()}${who}`;
    }
  });
  await view.ready;
}

// The version and What's new sit on the start screen and stay in the corner once the town is up.
document.body.append(whatsNewButton());

start().catch((err) => {
  const el = document.querySelector('#loading .step');
  if (el) el.textContent = err instanceof GraphicsUnavailable ? 'This browser cannot draw 3D graphics (WebGL 2 needed).' : `Start failed: ${err instanceof Error ? err.message : String(err)}`;
  throw err;
});

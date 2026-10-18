/**
 * The looks page (`looks.html`): every registered material kind, in each of its variants, drawn alone from the game's
 * own mesh data into a small linear render target at noon and at midnight, judged (src/render/lookStats.ts: pure
 * black, blown-out white, NaN, magenta, nothing drawn) and laid out as a contact sheet with the failures framed red.
 * `npm run looks` (tools/looks/check.mjs) opens it in headless Chromium and fails on any failing swatch; open it in a
 * browser to see every finish at a glance.
 *
 * `?seed=…&size=…` pick the town the data comes from (default seed, the smallest size); `?date=YYYY-MM-DD` the day.
 * When done, `window.looks` holds the results (`LooksResult`).
 */
import { Color, Fog, HalfFloatType, PerspectiveCamera, RenderTarget, Scene, Vector3, type Material } from 'three/webgpu';
import { createRenderer } from './render/renderer';
import { Stage } from './render/stage';
import { evenLight, fitSunShadow, makeLights } from './render/lights';
import { DaySky } from './render/sky';
import { Precipitation } from './render/precip';
import { ChimneySmoke } from './render/smoke';
import { setParcels } from './render/tsl/ground';
import { loadTextures, loadVegetationTextures } from './render/textures';
import { useTextures } from './render/materials';
import { collectSwatches, kindsWithout, type Swatch } from './render/looks';
import { halfToFloat, lookStats, lookVerdict, type LookStats, type LookVerdict } from './render/lookStats';
import { forceWeather, weatherAt } from './sim/weather';
import { WorkerPool } from './workers/pool';
import townWorkerUrl from './workers/town.worker.ts?worker&url';
import texWorkerUrl from './workers/tex.worker.ts?worker&url';
import type { FromTex, ToTex } from './workers/texProtocol';
import type { FromTown, ToTown } from './workers/townProtocol';
import { DEFAULT_SETTINGS } from './world/settings';
import { playStart, screenWorld } from './game/SimClient';

/** Swatch size in pixels. */
const S = 48;
const HAZE = 0xa9c8e4;

export interface LooksTile { pass: string; kind: string; label: string; verdict: LookVerdict; stats: LookStats }
export interface LooksResult { done: boolean; error?: string; ms: number; missing: string[]; tiles: LooksTile[]; failures: LooksTile[] }

const result: LooksResult = { done: false, ms: 0, missing: [], tiles: [], failures: [] };
(globalThis as { looks?: LooksResult }).looks = result;

const say = (t: string) => { const el = document.getElementById('status'); if (el) el.textContent = t; };

async function run(): Promise<void> {
  const t0 = performance.now();
  const q = new URLSearchParams(location.search);
  const seed = q.has('seed') ? Number(q.get('seed')) >>> 0 : DEFAULT_SETTINGS.seed;
  const settings = { seed, size: Number(q.get('size') ?? 0) };
  const date = q.get('date') ?? '2026-06-21';
  const pool = new WorkerPool<ToTown, FromTown>(townWorkerUrl, 2);
  const planned = pool.start(() => ({ type: 'init', settings }));
  const texPool = new WorkerPool<ToTex, FromTex>(texWorkerUrl, 2);
  await texPool.start(() => ({ type: 'init' }));
  say('making the textures');
  const facade = loadTextures(texPool, 'facade', () => {}, 256);
  const interior = loadTextures(texPool, 'interior', () => {}, 256, 100);
  const vegetation = loadVegetationTextures(texPool, 200);

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  canvas.style.cssText = `width:${S}px;height:${S}px`;
  document.body.append(canvas);
  const { renderer } = await createRenderer(canvas);
  renderer.setPixelRatio(1);
  renderer.setSize(S, S, false);
  renderer.shadowMap.enabled = true;
  const scene = new Scene();
  scene.background = new Color(HAZE);
  scene.fog = new Fog(HAZE, 1200, 6500);
  const camera = new PerspectiveCamera(35, 1, 0.01, 9000);
  const lights = makeLights(scene);
  const stage = new Stage(renderer, scene, camera);
  stage.shadowCamera = lights.sun.shadow.camera;
  const sky = new DaySky(renderer, scene, lights, seed);
  const world = screenWorld(seed, playStart('12:00', date));
  const noon = world.clock, midnight = noon + 12 * 60;
  const clear = forceWeather(weatherAt(world), 'clear'), rain = forceWeather(weatherAt(world), 'rain');
  sky.update(0, world, noon, clear, camera);
  useTextures({ facade: await facade, interior: await interior, vegetation: await vegetation });
  texPool.dispose();
  say('warming up the shaders');
  // Everything is drawn into the swatch target, so the shaders are built for it once, in the warm-up. (A second build
  // of the terrain's for another target fails to compile: its parcel function loses its uniforms, three r186.)
  const rt = new RenderTarget(S, S, { type: HalfFloatType });
  renderer.setRenderTarget(rt);
  await stage.warmUp();

  const [ready] = await planned;
  if (ready.type !== 'ready') throw new Error('the town workers did not start');
  const town = ready.town;
  setParcels(town.parcels);
  say('collecting the swatches');
  const swatches = await collectSwatches(pool, town);
  // The sky, rain and smoke are not mesh data: the dome seen from inside, rain round the camera, one chimney's smoke.
  const eye = new Vector3(town.x, town.y + 2, town.z);
  swatches.push({ kind: 'sky', label: 'sky', mesh: sky.dome, center: eye.clone(), radius: 1, inside: true });
  const precip = new Precipitation(seed);
  swatches.push({ kind: 'precip', label: 'rain', mesh: precip.mesh, center: eye.clone(), radius: 1, inside: true, seeThrough: true });
  const smoke = new ChimneySmoke(seed);
  smoke.addChimneys([town.x, town.y, town.z]);
  swatches.push({ kind: 'smoke', label: 'smoke', mesh: smoke.mesh, center: new Vector3(town.x, town.y + 3, town.z), radius: 4, seeThrough: true });
  result.missing = kindsWithout(swatches);
  // `?kinds=a,b`: only those kinds' swatches (to look into one).
  const only = q.get('kinds')?.split(',');
  if (only) swatches.splice(0, swatches.length, ...swatches.filter((s) => only.includes(s.kind)));
  pool.dispose();

  say(`compiling ${swatches.length} swatches`);
  for (const s of swatches) { s.mesh.visible = false; await stage.add(s.mesh); }

  scene.background = null;
  renderer.setClearColor(0x000000, 0);
  const sheet = makeSheet(swatches.length * 3);
  // Its own colour under even white light (black, white judged here), then at noon and at midnight (NaN, magenta).
  const passes = [{ name: 'colour', clock: noon, even: true }, { name: 'noon', clock: noon, even: false }, { name: 'night', clock: midnight, even: false }];
  let shown = 0;
  for (const p of passes) {
    for (const s of swatches) {
      say(`${p.name}: ${s.kind} ${s.label}`);
      frame(camera, s);
      sky.update(0.016, world, p.clock, s.kind === 'precip' ? rain : clear, camera);
      fitSunShadow(lights, s.center.x, s.center.y, s.center.z, Math.max(4, s.radius * 2));
      if (p.even) evenLight(lights);
      if (s.kind === 'precip') precip.fall(0.5, camera, rain, rain.windDir, sky.day, 0);
      if (s.kind === 'smoke') smoke.puff(2, clear, p.clock % 1440, sky.day);
      s.mesh.visible = true;
      renderer.render(scene, camera);
      s.mesh.visible = false;
      const raw = await renderer.readRenderTargetPixelsAsync(rt, 0, 0, S, S);
      const px = raw instanceof Uint16Array ? Float32Array.from(raw, halfToFloat) : Float32Array.from(raw as ArrayLike<number>);
      const stats = lookStats(px);
      const verdict = lookVerdict(stats, { even: p.even, expectPx: expectPx(camera, s), dark: s.dark, seeThrough: s.seeThrough });
      const tile: LooksTile = { pass: p.name, kind: s.kind, label: s.label, verdict, stats };
      if (q.has('debug')) console.log(JSON.stringify({ label: s.label, c: s.center.toArray(), r: s.radius, area: s.frontArea, view: s.view, cam: camera.position.toArray(), stats }));
      result.tiles.push(tile);
      if (verdict !== 'ok') result.failures.push(tile);
      sheet(shown++, px, `${p.name} ${s.kind} ${s.label}`, verdict);
    }
  }
  result.ms = Math.round(performance.now() - t0);
  result.done = true;
  say(`${result.tiles.length} swatches, ${result.failures.length} failing${result.missing.length ? `, no swatch for ${result.missing.join(', ')}` : ''} (${(result.ms / 1000).toFixed(1)} s)`);
}

/** Point the camera at a swatch: from above and in front for things, from its centre outwards for the sky and rain. */
function frame(camera: PerspectiveCamera, s: Swatch): void {
  if (s.inside) {
    camera.position.copy(s.center);
    camera.lookAt(s.center.x, s.center.y + 0.35, s.center.z - 1);
  } else {
    const d = (s.radius / Math.sin((camera.fov * Math.PI) / 360)) * 1.05;
    camera.position.copy(s.center).addScaledVector(new Vector3(...(s.view ?? [0.55, 0.65, 0.75])).normalize(), d);
    camera.lookAt(s.center);
  }
  camera.updateMatrixWorld();
}

/** The pixels a swatch's front faces should cover, seen as `frame` frames it (a tenth for cut-outs like leaf cards). */
function expectPx(camera: PerspectiveCamera, s: Swatch): number {
  if (s.inside || !s.frontArea) return 0;
  const d = camera.position.distanceTo(s.center), side = 2 * d * Math.tan((camera.fov * Math.PI) / 360);
  const cut = ((s.mesh.material as Material).alphaTest ?? 0) > 0 ? 0.1 : 1;
  return Math.min(S * S, (s.frontArea / (side * side)) * S * S) * cut;
}

/** The contact sheet: each swatch tone-mapped as a thumbnail with its name, failures framed red. */
function makeSheet(n: number): (i: number, px: Float32Array, label: string, verdict: LookVerdict) => void {
  const cell = S + 6, cols = Math.max(1, Math.floor((innerWidth - 16) / cell)), rows = Math.ceil(n / cols);
  const c = document.createElement('canvas');
  c.width = cols * cell; c.height = rows * cell;
  c.id = 'sheet';
  document.getElementById('failures')?.before(c);
  const ctx = c.getContext('2d')!;
  const list = document.getElementById('failures');
  return (i, px, label, verdict) => {
    const img = ctx.createImageData(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const src = ((S - 1 - y) * S + x) * 4, dst = (y * S + x) * 4; // render targets read bottom-up
      for (let k = 0; k < 3; k++) { const v = px[src + k]; img.data[dst + k] = Number.isFinite(v) ? Math.round(255 * Math.pow(Math.max(0, v) / (1 + Math.max(0, v)), 1 / 2.2)) : 255; }
      img.data[dst + 3] = px[src + 3] > 0.004 || !Number.isFinite(px[src + 3]) ? 255 : 40;
    }
    const x = (i % cols) * cell + 3, y = Math.floor(i / cols) * cell + 3;
    ctx.putImageData(img, x, y);
    if (verdict !== 'ok') { ctx.strokeStyle = '#ff3030'; ctx.lineWidth = 3; ctx.strokeRect(x - 1.5, y - 1.5, S + 3, S + 3); }
    if (verdict !== 'ok' && list) list.append(Object.assign(document.createElement('li'), { textContent: `${label}: ${verdict}` }));
  };
}

run().catch((err) => {
  result.error = err instanceof Error ? err.stack ?? err.message : String(err);
  result.done = true;
  say(`failed: ${result.error}`);
});

/**
 * The game behind the title screen (src/app/title.ts), loaded by the small entry chunk (src/main.ts) while the title
 * shows. Then: the town from above. The renderer on WebGL 2, the Stage's warm-up behind
 * the loading screen, then the town workers plan the town from its seed and the view fills in
 * from the centre while a slow drone drift circles it. The selector-as-loading-screen and the
 * game come in their own changes (docs/design/simworld-plan.md R2).
 *
 * `?seed=…&size=…` (0 … 1) pick the town; `?tex=…` the texture size in texels (256 default, 512 sharper and slower); `?at=x,z&r=…&h=…&a=…` fix the drone's centre, distance,
 * height and angle (radians) instead of circling, for screenshots. `?inside=<cell>/<building>&floor=…`
 * shows one storey of a building as a cutaway instead (showInside), `?indoors=<cell>/<index>` stands you inside it (showIndoors). `?wx=rain` (any weather state) overrides the sky;
 * `?rain=0…1`, `?wind=0…1` what the soundscape hears (src/audio/env.ts); `?mute` keeps it silent.
 *
 * The society runs in the sim worker from the start; Enter takes the camera down to the street, where the
 * inhabitants out of doors walk their real errands (src/game/street.ts, keys in src/game/camera.ts) and the household
 * cars drive their trips, with the buses and the rounds (src/traffic, run in the sim worker; src/render/vehiclesView.ts).
 * `?date=YYYY-MM-DD` starts on that day (default: today), `?time=HH:MM` at that time (default: the time of day now), `?speed=…` runs game time that
 * many times faster than real time (default 1), `?street=x,z&yaw=…` and `?follow=<id>` start on the street.
 *
 * Once the town shows, the picker comes up over it (src/game/playing.ts): pick an inhabitant and the camera flies
 * down to them and stays with them while you play as them. `?be=<id>` starts as that inhabitant. `?still` keeps the
 * drone view without the title or the picker, for screenshots (the looks check, tools/looks/check.mjs): once the town is built the
 * page's root gets `data-town="built"`.
 * T talks to the person nearest you (or the one you follow), out of doors or in the building you are in.
 *
 * A report's repro link (Shift+Ctrl+F12 → Report this spot, F8; src/game/report.ts, docs/REPORTS.md) adds `?clock=<world
 * minute>` (the world run to that minute from the start `date`), `?stand=x,y,z,yaw,building` and `?look=orbit,pitch`
 * (where `be` stands and looks), `?autopilot` (their routine runs them), and `?save=<url>` plays on from a save file.
 */
import { Color, Fog, PerspectiveCamera, Scene } from 'three/webgpu';
import { DebugMenu } from '../app/debug';
import { addDebugTools } from './debugTools';
import { parseLook, parseStand } from './report';
import { createRenderer, GraphicsUnavailable } from '../render/renderer';
import { Stage } from '../render/stage';
import { fitSunShadow, makeLights, placeLamps } from '../render/lights';
import { DaySky } from '../render/sky';
import { Precipitation } from '../render/precip';
import { ChimneySmoke } from '../render/smoke';
import { WEATHER_KINDS, describeWeather, forceWeather, weatherAt, type Weather, type WeatherKind } from '../sim/weather';
import { setParcels } from '../render/tsl/ground';
import { showTown, type TownView } from '../render/townView';
import { meshFromData } from '../render/meshes';
import { WorkerPool, WorkerStartError } from '../workers/pool';
import townWorkerUrl from '../workers/town.worker.ts?worker&url';
import texWorkerUrl from '../workers/tex.worker.ts?worker&url';
import type { FromTex, ToTex } from '../workers/texProtocol';
import { loadTextures, loadVegetationTextures } from '../render/textures';
import { INTERIOR, useTextures } from '../render/materials';
import { InteriorView } from '../render/interiorView';
import { SITE, buildingRef } from '../plan/placeGraph';
import { GoingInside } from './inside';
import { openWhatsNew, VERSION } from '../app/whatsNew';
import type { TitleScreen } from '../app/title';
import { reloadForUpdate } from '../app/update';
import { Shell } from '../app/shell';
import type { FromTown, ToTown } from '../workers/townProtocol';
import { settingsFromQuery, type TownSettings } from '../world/settings';
import { SimClient, followSim, playStart, screenWorld, type ScreenWorld } from './SimClient';
import { Street } from './street';
import { Chat } from './chat';
import { LlmSetup } from './llmSetup';
import { openLlmSettings } from '../app/llmSettings';
import { CameraControl } from './camera';
import { Playing } from './playing';
import { PeopleView } from '../render/people/peopleView';
import { VehiclesView } from '../render/vehiclesView';
import { RailView } from '../render/railView';
import { appearanceOf, outfitOf, type LookInfo } from '../street/looks';
import { A, FEMALE, MALE } from '../sim/actors';
import { buildingLooksOf, decorShares, litShares } from '../street/windows';
import { showDecor, type DecorShown } from '../render/decorView';
import { setBuildingLooks, setDecor, setLitShares, setWindowMap, WINDOW_SLOTS } from '../render/windowLight';
import { hhmm, minuteOfDay, MINUTES_PER_DAY } from '../sim/time';
import type { MediaView } from '../sim/media';
import type { TownFace } from '../sim/view';
import { formatDate } from '../sim/calendar';
import { StreetSounds } from '../traffic/sounds';
import { TownAudio } from '../audio/townAudio';
import { soundEnvFromSim, soundEnvOf, soundOverrides } from '../audio/env';
import { soundNote, soundOpener } from '../app/soundPanel';
import { openPaper } from '../app/paperPanel';
import { mapOpener } from '../app/mapPanel';

const HAZE = 0xa9c8e4;

function settingsFromUrl(): TownSettings {
  return settingsFromQuery(new URLSearchParams(location.search));
}

/** The title screen the game loads behind, and the screen's frame (set by `bootTown`). */
let title: TitleScreen;
let shell: Shell;
let debug: DebugMenu;

function step(text: string, frac?: number): void {
  title.step(text, frac);
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

async function start(audio: TownAudio, play: ReturnType<typeof playStart>, time: ScreenWorld, ears: ReturnType<typeof soundOverrides>): Promise<void> {
  const settings = settingsFromUrl();
  const cores = Math.max(1, (navigator.hardwareConcurrency || 4) - 1);
  const q0 = new URLSearchParams(location.search);
  const rate = Math.max(0, Number(q0.get('speed') ?? 1)) || 1;
  // The society: planned and populated in its own worker while the rest loads.
  // `?resume`: play on from this town's last save (made when the tab is hidden, and every few minutes).
  // A report's repro link (src/game/report.ts): `?clock=` runs the world to that minute, `?save=<url>` plays on from a save file.
  const until = q0.has('clock') && Number.isFinite(Number(q0.get('clock'))) ? Number(q0.get('clock')) : undefined;
  const simulated = SimClient.boot(settings, play.start, play.startDay, play.clock, rate, { resume: q0.has('resume'), until, saveUrl: q0.get('save') ?? undefined });
  // The town workers start planning at once; the texture workers generate the facade textures
  // meanwhile (the shaders need them before the warm-up), then the renderer warms up.
  const pool = new WorkerPool<ToTown, FromTown>(townWorkerUrl, Math.min(4, cores));
  const planned = pool.start(() => ({ type: 'init', settings }));
  // Their failures reach the loading screen when awaited below; until then they are not unhandled.
  for (const p of [simulated, planned]) p.catch(() => undefined);
  const texPool = new WorkerPool<ToTex, FromTex>(texWorkerUrl, Math.min(6, cores));
  await texPool.start(() => ({ type: 'init' }));
  const texSize = Number(new URLSearchParams(location.search).get('tex')) === 512 ? 512 : 256;
  step('Making the materials', 0.02);
  // Facades first, then the interiors' finishes (queued behind them in the same pool).
  const facade = loadTextures(texPool, 'facade', (done, total) => step('Making the materials', 0.02 + (0.08 * done) / total), texSize);
  const interior = loadTextures(texPool, 'interior', (done, total) => step('Making the materials', 0.1 + (0.02 * done) / total), texSize, 100);
  const vegetation = loadVegetationTextures(texPool, 200);

  const canvas = document.createElement('canvas');
  document.body.prepend(canvas);
  const { renderer } = await createRenderer(canvas);
  const scene = new Scene();
  scene.background = new Color(HAZE);
  scene.fog = new Fog(HAZE, 1200, 6500);
  const camera = new PerspectiveCamera(50, innerWidth / innerHeight, 1, 9000);
  const resize = (): void => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
  resize();
  addEventListener('resize', resize);
  renderer.shadowMap.enabled = true;
  const lights = makeLights(scene);
  const stage = new Stage(renderer, scene, camera);
  stage.shadowCamera = lights.sun.shadow.camera;
  const wxq = new URLSearchParams(location.search).get('wx') as WeatherKind | null;
  const wx = wxq && WEATHER_KINDS.includes(wxq) ? wxq : null;
  const forced = (w: Weather): Weather => (wx ? forceWeather(w, wx) : w);
  const sky = new DaySky(renderer, scene, lights, settings.seed);
  sky.update(0, time, time.clock, forced(weatherAt(time)), camera, rate);
  useTextures({ facade: await facade, interior: await interior, vegetation: await vegetation });
  texPool.dispose();
  step('Making the people', 0.1);
  const { view: people, warm } = await PeopleView.create(stage, sampleLooks(settings.seed, play.clock), Math.min(2, cores));
  scene.add(people.root);
  step('Preparing the shaders', 0.12);
  await stage.warmUp(warm);
  people.warmedUp();
  void stage.add(sky.dome);
  const precip = new Precipitation(settings.seed);
  void stage.add(precip.mesh);
  const smoke = new ChimneySmoke(settings.seed);
  void stage.add(smoke.mesh);
  step('Planning the town', 0.15);

  const [ready] = await planned;
  if (ready.type !== 'ready') throw new Error('the town workers did not start');
  const town = ready.town;
  setParcels(town.parcels);
  const inside = new URLSearchParams(location.search).get('inside');
  if (inside) return showInside(inside, pool, stage, lights, renderer, camera, scene);
  const indoors = new URLSearchParams(location.search).get('indoors');
  if (indoors) return showIndoors(indoors, pool, stage, renderer, camera, scene, () => { fitSunShadow(lights, town.x, town.y, town.z, town.radius * 1.15); const v = showTown(stage, pool, town, () => {}, () => {}); return v.ready.then(() => v); });
  fitSunShadow(lights, town.x, town.y, town.z, town.radius * 1.15);
  // What the town sounds like where: one worker works it out alongside the meshes.
  void pool.run<Extract<FromTown, { type: 'sound' }>>({ type: 'sound' }, 0.5).then((r) => { time.region = { region: { coastal: r.map.coastal } }; audio.setTown(r.map); });
  const view = showTown(stage, pool, town, (done, total) => step(`Building the town (${done} of ${total})`, 0.15 + (0.85 * done) / total), (tops) => smoke.addChimneys(tops));

  step('Waking the town', 0.15);
  const sim = await simulated;
  // Lit windows follow who is in and awake (src/street/windows.ts), refreshed with every game minute.
  setWindowMap(sim.windows);
  const lit = new Uint8Array(sim.windows.count), looks = new Uint8Array(sim.windows.count * 2);
  // Holiday decorations in the windows follow the households' choices, once a game day (src/sim/decor.ts).
  const decor = new Uint8Array(WINDOW_SLOTS * 2);
  // Outdoors too: pumpkins, string lights, the square's tree and stalls, festival bunting (src/render/decorView.ts).
  let outdoors: DecorShown | null = null;
  const decorate = (face = sim.town) => { decorShares(face.decor, sim.windows, decor); setDecor(decor); outdoors?.set(decor, sim.view.occasions); };
  void showDecor(stage, pool, view.root, 80 + town.cells).then((d) => { outdoors = d; decorate(); });
  sim.onView = (v) => { litShares(v, sim.windows, A.sleep, lit); setLitShares(lit); if (v.town) decorate(v.town); else outdoors?.set(decor, v.occasions); };
  sim.onView(sim.view);
  decorate();
  if (q0.has('skip')) await sim.skip(Number(q0.get('skip')) || 1);
  sim.keepSaved();
  // A repro (a report's link, a save file) must not replace the player's own save of this town.
  if (until !== undefined || q0.has('save') || q0.has('stand')) sim.autosave = false;
  shell.add({ label: 'Paper', group: 'Town', open: () => openPaper(sim.view) });
  shell.add({ label: 'Save now', group: 'Game', open: () => void sim.saveNow().then((ok) => shell.say(ok ? 'Saved' : 'Could not save here')) });
  shell.add({ label: 'Load last save', group: 'Game', open: () => {
    // The save is played on from a fresh start of the page (the worker loads it while the town builds).
    sim.autosave = false;
    const u = new URL(location.href);
    for (const k of ['be', 'skip', 'street', 'follow']) u.searchParams.delete(k);
    u.searchParams.set('resume', '');
    location.assign(u);
  } });
  shell.add({ label: "What's new", group: 'Game', open: openWhatsNew, note: () => VERSION });
  const street = new Street(sim, people, settings.seed);
  // The traffic runs in the sim worker beside the world; its vehicles come with every street update.
  const vehicles = new VehiclesView(stage, pool, 70 + town.cells);
  const rail = new RailView(stage);
  const streetSounds = new StreetSounds();

  // The drone drift: a slow circle around the town, high enough to see it whole (or fixed by ?at=…).
  const q = new URLSearchParams(location.search);
  const num = (k: string, d: number) => (q.has(k) && Number.isFinite(Number(q.get(k))) ? Number(q.get(k)) : d);
  const [cx, cz] = (q.get('at') ?? `${town.x},${town.z}`).split(',').map(Number);
  const cam = new CameraControl(camera, { cx, cz, y: town.y, r: num('r', town.radius * 1.35), h: num('h', town.radius * 0.55), fixed: q.has('a') ? num('a', 0) : null }, (x, z) => sim.standHeight(x, z));
  cam.pickNear = (x, z) => street.next(x, z);
  if (q.has('street')) { const [sx, sz] = q.get('street')!.split(',').map(Number); cam.toStreet(sx, sz, num('yaw', 0)); }
  // Talking to people (T near someone): the chat panel, the player's key and models (src/game/chat.ts).
  const llm = new LlmSetup();
  const chat = new Chat(sim, street, cam, llm);
  shell.addTool(chat.panel.launcher);
  shell.add({ label: 'Past conversations', group: 'Chat', open: () => chat.panel.open('past') });
  shell.add({ label: 'Usage and costs', group: 'Chat', open: () => chat.panel.open('usage') });
  shell.add({ label: 'Models and key', group: 'Chat', open: () => openLlmSettings(llm) });
  const followId = q.has('follow') ? num('follow', -1) : -1;
  // The picker comes up over the town once it shows; picking someone plays as them (?be=<id> skips the picker).
  // Going into the building the player's person is in: its interior, the people in it, its room lights.
  const goingIn = new GoingInside(sim, street, new InteriorView(pool, stage), (building, shown) => {
    const ref = buildingRef(building), m = ref && 'site' in ref ? view.landmarks[ref.site] : undefined;
    if (m) m.visible = shown;
  });
  const playing = new Playing(sim, cam, street, settings.seed, goingIn);
  shell.add({ label: 'Choose who to be', group: 'Play', open: () => void playing.choose() });
  addDebugTools(debug, { sim, cam, camera, playing, stage, settings, start: play.start });
  const hud = document.getElementById('hud');
  let shown = false, lastT = 0, shadowMode = '';
  const straight = q.has('be') || q.has('street') || q.has('still') || followId >= 0;
  /** The title goes and the town starts: its sounds, and the picker (or the person asked for with `?be`). */
  const startPlay = (): void => {
    if (shown) return;
    shown = true;
    title.dismiss();
    audio.startTown();
    if (q.has('be') || !straight) void playing.takeOver(q.has('be') ? num('be', -1) : null, { stand: parseStand(q.get('stand')), look: parseLook(q.get('look')), autopilot: q.has('autopilot') });
  };
  /** The media the signs last got (the sim's view brings a new one each game minute). */
  let shownMedia: MediaView | undefined;
  let shownFace: TownFace | undefined, lookedFace: TownFace | undefined;
  /** Whether the bus stops (from the sim) have joined the signs. */
  let stopsShown = false;
  const fwd = { x: 0, y: 0, z: 0 };
  shell.add({ label: 'Map', group: 'Town', open: mapOpener(
    async () => (await pool.run<Extract<FromTown, { type: 'map' }>>({ type: 'map' }, 0)).map,
    () => (cam.mode === 'drone' ? null : { x: camera.position.x, z: camera.position.z, fx: fwd.x, fz: fwd.z }),
  ) });
  renderer.setAnimationLoop((t: number) => {
    if (lastT) debug.frame(t - lastT);
    const dt = lastT ? Math.min(0.1, (t - lastT) / 1000) : 0;
    lastT = t;
    stage.frame();
    followSim(time, sim);
    const w = forced(sim.view.weather);
    if (followId >= 0 && cam.following < 0 && cam.mode !== 'follow' && sim.walkers.has(followId)) cam.follow(followId);
    const target = cam.mode === 'follow' ? street.where(cam.following) : null;
    cam.update(dt, t, target);
    const player = cam.mode === 'play' ? playing.track(dt, t, stage.waiting > 0) : null;
    goingIn.update(t);
    const ground = player ?? (cam.mode === 'drone' ? { x: cx, z: cz } : { x: camera.position.x, z: camera.position.z });
    sim.poll(ground.x, ground.z);
    people.draw(cam.mode === 'drone' ? [] : street.figuresNow(), camera.position.x, camera.position.z, dt, t / 1000);
    vehicles.show(camera, sim.clock, sim.traffic, sim.parked);
    rail.animate(camera, dt, sim.clock, sim.crossingPosts, sim.traffic, audio);
    streetSounds.listen(dt, camera.position.x, camera.position.y, camera.position.z, sim.clock, sim.traffic, audio);
    // The sun's shadow covers the whole town from above, the streets around you down there.
    if (cam.mode !== 'drone') fitSunShadow(lights, camera.position.x, camera.position.y, camera.position.z, 70);
    else if (shadowMode !== 'drone') fitSunShadow(lights, town.x, town.y, town.z, town.radius * 1.15);
    shadowMode = cam.mode;
    view.vegetation?.update(camera);
    view.props?.update(camera);
    if (view.signs && sim.view.media !== shownMedia) {
      // The notices up in town: boards, lamp posts, shop windows (a new view each game minute; the signs redraw only what changed).
      shownMedia = sim.view.media;
      view.signs.setNotices(shownMedia?.notices ?? [], Math.floor(sim.view.clock / MINUTES_PER_DAY));
    }
    if (view.signs && sim.town && sim.town !== shownFace) {
      // The town's face (once a game day, and after a time skip): shop names, hours, to-let and for-sale boards.
      shownFace = sim.town;
      view.signs.setFacts({ kind: shownFace.kind, name: shownFace.name, flags: shownFace.looks.flags, hours: shownFace.hours, works: shownFace.rules.works, day: Math.floor(sim.view.clock / MINUTES_PER_DAY) });
    }
    if (view.signs && !stopsShown) { stopsShown = true; void view.signs.addStops(sim.stops); }
    view.signs?.setTime(minuteOfDay(sim.clock));
    view.signs?.update(camera);
    if (sim.town && sim.town !== lookedFace) {
      // The walls' wear and fresh paint from the same face (upkeep and wealth per building).
      lookedFace = sim.town;
      buildingLooksOf(lookedFace.looks, sim.windows, looks);
      setBuildingLooks(looks);
    }
    sky.lampsOffAtMidnight = sim.town.rules.lightsOffAtMidnight;
    sky.update(dt, time, time.clock, w, camera, rate);
    if (cam.mode !== 'drone') placeLamps(lights, view.props?.lamps, camera.position.x, camera.position.z, sky.lamps);
    else placeLamps(lights, undefined, 0, 0, 0);
    precip.fall(dt, camera, w, w.windDir, sky.day, sky.flash);
    smoke.puff(dt, w, minuteOfDay(sim.clock), sky.day);
    renderer.render(scene, camera);
    const e = camera.matrixWorld.elements;
    fwd.x = -e[8]; fwd.y = -e[9]; fwd.z = -e[10];
    audio.frame(dt, { x: camera.position.x, y: camera.position.y, z: camera.position.z, fx: fwd.x, fy: fwd.y, fz: fwd.z, ux: e[4], uy: e[5], uz: e[6] }, soundEnvFromSim(time, sim.view, sim.clock, ears));
    // Asked to start straight away (`?be`, `?street`, `?follow`, `?still`): no title, the town as soon as it shows.
    if (!shown && straight && view.done > 0) startPlay();
    shell.setWhen(`${formatDate(sim.view.date)} ${hhmm(Math.floor(minuteOfDay(sim.clock)))} · ${describeWeather(w)}`);
    if (hud) {
      const n = people.counts;
      const talk = cam.mode === 'drone' ? '' : chat.hint();
      const who = cam.mode === 'play' ? '\nW A S D to walk, Shift to hurry, drag to look around' : cam.mode === 'follow' ? `\n${street.describe(cam.following)}` : cam.mode === 'drone' ? '' : '\nW A S D walk, drag to look, F follow someone, Esc up';
      const door = cam.mode === 'play' ? goingIn.hint() : '';
      const whoTalk = who + (talk ? `\n${talk}` : '') + (door ? `\n${door}` : '');
      hud.textContent = `${sim.people} people, ${sim.walkers.size} out near you, ${n.shown} drawn · ${vehicles.counts.moving} vehicles on the road, ${vehicles.counts.parked} parked · ${town.dwellings} households · ${view.done < view.total ? `building ${view.done}/${view.total} · ` : ''}${stage.hudLine()}${whoTalk}`;
    }
  });
  await view.ready;
  document.documentElement.dataset.town = 'built';
  // Everything is built and its shaders compiled behind the title: offer the way in.
  while (stage.waiting > 0) await new Promise((r) => setTimeout(r, 100));
  if (!shown) title.ready(startPlay);
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
  title.dismiss();
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

/**
 * `?indoors=<cell>/<index>` (`index` in the cell's buildings, as `buildingRef` decodes `Place.building`; `site/<id>` a
 * public building): the whole
 * building as the game shows it when you are inside (src/render/interiorView.ts), seen at eye height from a step in
 * through its street door, turning slowly (or fixed with `a=`, radians from looking straight in). `spot=<k>` stands
 * at the k-th spot instead (a bed, a seat, a desk); `room=0…1` the room light (default 1).
 */
async function showIndoors(arg: string, pool: WorkerPool<ToTown, FromTown>, stage: Stage, renderer: Awaited<ReturnType<typeof createRenderer>>['renderer'], camera: PerspectiveCamera, scene: Scene, outside: () => Promise<TownView>): Promise<void> {
  const q = new URLSearchParams(location.search);
  const [a, b] = arg.split('/');
  step('Planning the rooms', 0.5);
  const view = new InteriorView(pool, stage);
  const r = await view.enter(a === 'site' ? SITE + Number(b) : Number(a) * 65536 + Number(b));
  if (!r) throw new Error('no interior');
  view.setRoomLight(Number(q.get('room') ?? 1));
  // The town round it, to look out of the windows at.
  step('Building the town', 0.6);
  const around = await outside();
  // A public building's own shell goes while you are in it, as in the game.
  const own = a === 'site' ? around.landmarks[Number(b)] : undefined;
  if (own) own.visible = false;
  // (The fog stays: it is part of every shader's key, and the game keeps it when you go in.)
  const { indoors: ind } = r, door = ind.doors[0], spot = q.has('spot') ? ind.spots[Number(q.get('spot'))] : undefined;
  // `leaf=<k>&open=<0…1>`: looking at door leaf k from 2.5 m on the side it opens to, swung open that far.
  const leaf = q.has('leaf') ? ind.leaves[Number(q.get('leaf'))] : undefined;
  if (leaf) view.swing(Number(q.get('leaf')), Number(q.get('open') ?? 0));
  const [x, y, z, look] = leaf
    ? [leaf.x + leaf.dx * leaf.w / 2 + leaf.nx * 2.5, leaf.y, leaf.z + leaf.dz * leaf.w / 2 + leaf.nz * 2.5, Math.atan2(-leaf.nx, -leaf.nz)]
    : spot ? [spot.x, spot.y, spot.z, spot.yaw] : [door.x - door.nx * 1.2, door.y, door.z - door.nz * 1.2, Math.atan2(-door.nx, -door.nz)];
  const fixed = q.has('a') ? Number(q.get('a')) : null;
  title.dismiss();
  const hud = document.getElementById('hud');
  renderer.setAnimationLoop((t: number) => {
    stage.frame();
    const a = look + (fixed ?? Math.sin(t * 0.0002) * 1.2);
    camera.position.set(x, y + 1.6, z);
    camera.lookAt(x + Math.sin(a), y + 1.45, z + Math.cos(a));
    renderer.render(scene, camera);
    if (hud) hud.textContent = `${r.about} · ${ind.colliders.length} colliders, ${ind.ramps.length} flights, ${ind.spots.length} spots · ${stage.hudLine()}`;
  });
}

/**
 * Load the game behind the title: the screen's frame and its menu, then the renderer, the shaders, the town and the
 * sim (`start`). Returns once the way in is offered; a failure is said on the title and thrown.
 */
export async function bootTown(screen: TitleScreen, audio: TownAudio): Promise<void> {
  title = screen;
  // The screen's frame: the top bar and the one menu every window opens from (src/app/shell.ts). What's new sits on
  // the title (plan R2) and goes with it; the menu has it once the town is up.
  shell = new Shell();
  // The debug menu (Shift+Ctrl+F12), out of the normal Menu: "Report this spot" and the tools (src/app/debug.ts, docs/REPORTS.md).
  debug = new DebugMenu();
  const urlQ = new URLSearchParams(location.search);
  const play = playStart(urlQ.get('time'), urlQ.get('date'));
  const time = screenWorld(settingsFromUrl().seed, play);
  const ears = soundOverrides(urlQ);
  shell.add({ label: 'Sound', group: 'Settings', open: soundOpener(audio.engine), note: () => soundNote(audio.engine) });
  // The title music runs while the title is up; the render loop takes over once it is gone.
  const titleMusic = setInterval(() => {
    if (title.shown) audio.tickMusic(0.1, soundEnvOf(time, time.clock, ears));
    else clearInterval(titleMusic);
  }, 100);
  try {
    await start(audio, play, time, ears);
  } catch (err) {
    if (err instanceof WorkerStartError && err.outdated && reloadForUpdate((t) => title.step(t))) return;
    title.fail(err instanceof GraphicsUnavailable ? 'This browser cannot draw 3D graphics (WebGL 2 needed).'
      : err instanceof WorkerStartError && err.outdated ? `${err.message}. Reload the page with Ctrl+F5.`
      : `Start failed: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}

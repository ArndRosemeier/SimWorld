/**
 * The game's own tools in the debug menu (src/app/debug.ts): the info block, "Report this spot" (src/game/report.ts),
 * setting the date and time, autopilot, the shader report. Other threads add theirs to the same `DebugMenu` from
 * where their part of the game is made (docs/REPORTS.md).
 */
import type { PerspectiveCamera } from 'three/webgpu';
import type { DebugMenu } from '../app/debug';
import { recentConsole } from '../app/consoleLog';
import { openReport } from '../app/reportPanel';
import { el, button } from '../app/dom';
import { VERSION } from '../app/whatsNew';
import type { Stage } from '../render/stage';
import { formatDate, type CivilDate } from '../sim/calendar';
import { hhmm, minuteOfDay } from '../sim/time';
import { describeWeather } from '../sim/weather';
import type { TownSettings } from '../world/settings';
import type { CameraControl } from './camera';
import type { Playing } from './playing';
import type { SimClient } from './SimClient';
import { reportText, type ReportFacts } from './report';

export interface DebugContext {
  sim: SimClient;
  cam: CameraControl;
  camera: PerspectiveCamera;
  playing: Playing;
  stage: Stage;
  settings: TownSettings;
  /** The real date play began on. */
  start: CivilDate;
}

const iso = (d: CivilDate): string => `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
const r1 = (v: number): string => v.toFixed(1);

export function addDebugTools(debug: DebugMenu, c: DebugContext): void {
  const { sim, playing, stage } = c;
  debug.addInfo(() => `${VERSION} · seed ${c.settings.seed} · size ${c.settings.size}`);
  debug.addInfo(() => `${formatDate(sim.view.date)} ${hhmm(Math.floor(minuteOfDay(sim.clock)))} · clock ${Math.floor(sim.clock)}${sim.rate !== 1 ? ` · ×${sim.rate}` : ''}`);
  debug.addInfo(() => {
    const b = playing.body, p = c.camera.position;
    const w = b ? playing.where(b.y) : null;
    const inside = w && w.building >= 0 ? ` · in ${w.building} (${w.about}), floor ${w.floor}` : '';
    return b ? `body ${r1(b.x)}, ${r1(b.y)}, ${r1(b.z)} yaw ${b.yaw.toFixed(2)}${inside}` : `camera (${c.cam.mode}) ${r1(p.x)}, ${r1(p.y)}, ${r1(p.z)}`;
  });
  debug.addInfo(() => {
    const s = sim.player;
    return s ? `playing #${s.id} ${s.name} · ${s.autopilot ? 'autopilot' : s.steered ? 'steering' : 'walked by the sim'} · ${s.doing}` : 'playing nobody';
  });
  debug.addInfo(() => debug.fps());
  debug.addInfo(() => stage.hudLine());

  // The save for the report (null when the worker cannot make it: the window says so).
  const report = (): void => openReport(facts(c, debug), () => sim.saveFile().then(
    (bytes) => ({ name: `totaltown-${c.settings.seed}-${Math.floor(sim.clock)}.save.gz`, bytes }),
    () => null,
  ));
  debug.add({ label: 'Report this spot', group: 'Report', run: report, key: { code: 'F8' } });
  // The same text from the console or a headless browser (tools/repro/open.mjs reads it after opening a repro link).
  (globalThis as { debugReport?: () => string }).debugReport = () => reportText(facts(c, debug), '');

  debug.add({ label: 'Date and time', group: 'Time', custom: () => dateTimeForm(sim) });

  debug.add({ label: 'Autopilot', group: 'Play', on: () => sim.player?.autopilot ?? false, set: (on) => playing.setAutopilot(on) });
  debug.add({ label: 'Choose who to be', group: 'Play', run: () => void playing.choose() });

  debug.add({ label: 'Shader report to the console', group: 'Render', run: () => console.info(stage.monitor.report()) });
}

/** A fresh start on another day and time (the same town and person): the page loads again with `date` and `time`. */
function dateTimeForm(sim: SimClient): HTMLElement {
  const f = el('form', 'dbg-form');
  const d = el('input', ''), t = el('input', '');
  d.type = 'date'; t.type = 'time';
  const v = sim.view.date;
  d.value = iso(v);
  t.value = hhmm(Math.floor(minuteOfDay(sim.clock)));
  const go = button('', 'Start there', () => {});
  go.type = 'submit';
  f.append(d, t, go);
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    sim.autosave = false;
    const u = new URL(location.href);
    for (const k of ['clock', 'stand', 'look', 'resume', 'skip', 'save', 'street', 'follow']) u.searchParams.delete(k);
    if (d.value) u.searchParams.set('date', d.value);
    if (t.value) u.searchParams.set('time', t.value);
    if (sim.player) u.searchParams.set('be', String(sim.player.id));
    location.assign(u);
  });
  return f;
}

/** The GPU as the browser names it (WebGL 2's unmasked renderer where it tells). */
function gpuName(): string {
  try {
    const gl = document.querySelector('canvas')?.getContext('webgl2');
    if (!gl) return 'unknown (no WebGL 2 context)';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? `${gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)} / ${gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)}` : String(gl.getParameter(gl.RENDERER));
  } catch {
    return 'unknown';
  }
}

/** Everything the report says, as of now. */
export function facts(c: DebugContext, debug: DebugMenu): ReportFacts {
  const { sim, playing, camera } = c;
  const s = sim.player, body = playing.body;
  const w = body ? playing.where(body.y) : null;
  const e = camera.matrixWorld.elements, p = camera.position;
  const notExact: string[] = [];
  if (sim.resumed) notExact.push('played on from a save');
  if (sim.skipped) notExact.push(`skipped ${sim.skipped} day${sim.skipped === 1 ? '' : 's'}`);
  const now = new Date();
  return {
    version: VERSION,
    realTime: `${iso({ year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() })} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    base: `${location.origin}${location.pathname}`,
    params: [...new URLSearchParams(location.search)],
    seed: c.settings.seed, size: c.settings.size,
    startDate: iso(c.start), clock: sim.clock,
    gameDay: iso(sim.view.date), gameDate: formatDate(sim.view.date), gameTime: hhmm(Math.floor(minuteOfDay(sim.clock))),
    weather: describeWeather(sim.view.weather),
    notExact,
    player: s ? {
      id: s.id, name: s.name, autopilot: s.autopilot, doing: s.doing, placeName: s.placeName,
      building: w && w.building >= 0 ? w.building : body ? -1 : s.building, buildingAbout: w?.about ?? '', floor: w?.floor ?? null,
    } : null,
    body,
    camera: { mode: c.cam.mode, x: p.x, y: p.y, z: p.z, fx: -e[8], fy: -e[9], fz: -e[10], ...c.cam.look, yaw: c.cam.yaw },
    perf: `${debug.fps()} · ${c.stage.hudLine().replace(/\n/g, ' · ')}`,
    browser: { agent: navigator.userAgent, screen: `${innerWidth}×${innerHeight} @${devicePixelRatio}`, gpu: gpuName(), cores: navigator.hardwareConcurrency || 0 },
    console: recentConsole(),
  };
}

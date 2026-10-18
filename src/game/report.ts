/**
 * "Report this spot" (debug menu, F8): everything a thread needs to see what the player saw, as one text block to
 * paste into the project chat, with a repro link that loads that situation again (docs/REPORTS.md).
 *
 * The link is the game's own URL parameters, readable and editable: the town (`seed`, `size`), when (`date` the day
 * play began and `clock` the world's minute now, so a fresh start lives the same history up to the same minute; or,
 * when that cannot give the same world, `date` and `time` of now), who (`be`) and where they stand (`stand`, `look`).
 * Pure: the game gathers the facts, this writes them down (tested in test/report.test.ts).
 */
import type { Stand } from './playing';

/** What the game knows at the moment of the report. */
export interface ReportFacts {
  version: string;
  /** The real time of the report, as the player's clock shows it. */
  realTime: string;
  /** The page's address without its query (origin and path). */
  base: string;
  /** The URL parameters the page was loaded with. */
  params: [string, string][];
  seed: number;
  size: number;
  /** The real date play began on (YYYY-MM-DD: `date` of the start), and the world's clock now (game minutes). */
  startDate: string;
  clock: number;
  /** Today in the game (YYYY-MM-DD), as words, the time of day (HH:MM) and the weather. */
  gameDay: string;
  gameDate: string;
  gameTime: string;
  weather: string;
  /** Why seed, start and clock alone would not give the same world (empty: they do). */
  notExact: string[];
  player: null | {
    id: number; name: string; autopilot: boolean; doing: string; placeName: string;
    /** The building they are in (a `Place.building` code, -1 out of doors), what it is, and the floor (0 ground). */
    building: number; buildingAbout: string; floor: number | null;
  };
  /** The body the player steers (null on autopilot or while the sim walks them). */
  body: null | { x: number; y: number; z: number; yaw: number };
  camera: { mode: string; x: number; y: number; z: number; fx: number; fy: number; fz: number; orbit: number; pitch: number; yaw: number };
  /** Frames and shaders, one line. */
  perf: string;
  browser: { agent: string; screen: string; gpu: string; cores: number };
  /** Recent console errors and warnings, oldest first. */
  console: string[];
}

/** Parameters the repro link sets itself (any the page had are replaced), and ones that would spoil a repro. */
const SETS = ['seed', 'size', 'date', 'time', 'clock', 'be', 'stand', 'look', 'autopilot', 'street', 'yaw', 'follow'];
const DROPS = ['resume', 'skip', 'still', 'save', 'repro'];

const r2 = (v: number): string => String(Math.round(v * 100) / 100);
const r3 = (v: number): string => String(Math.round(v * 1000) / 1000);

/** The URL parameters that load this situation again. */
export function reproParams(f: ReportFacts): URLSearchParams {
  const q = new URLSearchParams();
  for (const [k, v] of f.params) if (!SETS.includes(k) && !DROPS.includes(k)) q.append(k, v);
  q.set('seed', String(f.seed));
  q.set('size', String(f.size));
  if (f.notExact.length === 0) { q.set('date', f.startDate); q.set('clock', String(Math.floor(f.clock))); }
  else { q.set('date', f.gameDay); q.set('time', f.gameTime); }
  const p = f.player;
  if (p) {
    q.set('be', String(p.id));
    if (p.autopilot) q.set('autopilot', '');
    else if (f.body) {
      const b = f.body;
      q.set('stand', [r2(b.x), r2(b.y), r2(b.z), r3(b.yaw), String(p.building)].join(','));
      q.set('look', [r3(f.camera.orbit), r3(f.camera.pitch)].join(','));
    }
  } else if (f.camera.mode === 'street' || f.camera.mode === 'follow') {
    q.set('street', `${r2(f.camera.x)},${r2(f.camera.z)}`);
    q.set('yaw', r3(f.camera.yaw));
  }
  return q;
}

/** The repro link. */
export function reproUrl(f: ReportFacts): string {
  return `${f.base}?${reproParams(f).toString().replace(/=(?=&|$)/g, '').replace(/%2C/g, ',')}`;
}

/** Where to stand (`?stand=x,y,z,yaw,building`), or null when absent or malformed. */
export function parseStand(s: string | null): Stand | null {
  if (s === null) return null;
  const v = s.split(',').map(Number);
  if (v.length < 4 || v.some((n) => !Number.isFinite(n))) return null;
  return { x: v[0], y: v[1], z: v[2], yaw: v[3], building: v.length > 4 ? Math.round(v[4]) : -1 };
}

/** Which way the camera looks (`?look=orbit,pitch`), or null. */
export function parseLook(s: string | null): { orbit: number; pitch: number } | null {
  const v = (s ?? '').split(',').map(Number);
  return s !== null && v.length === 2 && v.every(Number.isFinite) ? { orbit: v[0], pitch: v[1] } : null;
}

/** The report as text to paste: the note first, then the repro link, then the facts. */
export function reportText(f: ReportFacts, note: string, saveFile: string | null = null): string {
  const p = f.player, c = f.camera, b = f.body;
  const lines = [
    `Total Town report · ${f.version} · ${f.realTime}`,
    note.trim() ? `Note: ${note.trim()}` : 'Note: (none)',
    `Repro: ${reproUrl(f)}`,
    f.notExact.length === 0
      ? 'Exact: yes (a fresh start with this seed, date and clock lives the same history to this minute)'
      : `Exact: no (${f.notExact.join('; ')})${saveFile ? `: the save is attached as ${saveFile}, add &save=<its path> to the link` : ': only the spot and the time of day match'}`,
    `Town: seed ${f.seed}, size ${f.size}, loaded with ${f.params.length ? `?${f.params.map(([k, v]) => (v ? `${k}=${v}` : k)).join('&')}` : 'no parameters'}`,
    `Game: ${f.gameDate} ${f.gameTime}, ${f.weather} (clock ${Math.floor(f.clock)}, play began ${f.startDate})`,
    p ? `Playing: #${p.id} ${p.name}, ${p.autopilot ? 'autopilot on' : b ? 'steering' : 'autopilot off, the sim walking them'}, ${p.doing || 'doing nothing'} (${p.placeName})` : 'Playing: nobody (picker or free camera)',
    p && p.building >= 0 ? `Inside: building ${p.building} (${p.buildingAbout || 'not shown'})${p.floor !== null ? `, floor ${p.floor}` : ''}` : 'Inside: out of doors',
    b ? `Body: x ${r2(b.x)} y ${r2(b.y)} z ${r2(b.z)}, facing yaw ${r3(b.yaw)} (0 faces -z)` : 'Body: none',
    `Camera: ${c.mode} at x ${r2(c.x)} y ${r2(c.y)} z ${r2(c.z)}, looking ${r2(c.fx)},${r2(c.fy)},${r2(c.fz)} (orbit ${r3(c.orbit)}, pitch ${r3(c.pitch)})`,
    `Frames: ${f.perf}`,
    `Browser: ${f.browser.agent} · screen ${f.browser.screen} · ${f.browser.cores} cores · GPU ${f.browser.gpu}`,
    f.console.length ? `Console (last ${f.console.length}):` : 'Console: no errors or warnings',
    ...f.console.map((l) => `  ${l}`),
  ];
  return lines.join('\n');
}

/**
 * The town map (town-realism track H): the menu's "Map" entry opens a printed-style map of the town, made from the plan in a
 * town worker (`townMapOf`, src/plan/townMap.ts): water and woods, parks, every building's footprint, the roads by
 * class, the railway, the landmarks by name and the street names along their streets, and where you are now, with
 * your home, the building you are in, the bus stops and the people you know out near you. Drag to move, the wheel or
 * the + and − buttons to zoom; street names show once there is room for them. The minimap in the corner
 * (src/app/minimap.ts) draws with the same `drawTownMap`.
 */
import { buildingRef, FARM, SITE } from '../plan/placeGraph';
import { MAP_WATER, MAP_WOODS, type TownMap } from '../plan/townMap';
import { el, openDialog } from './dom';

/** Where the viewer stands and looks (x, z and the forward direction on the ground). */
export interface MapViewer { x: number; z: number; fx: number; fz: number }

/** A building marked on the map: its `Place.building` code (-1: none, just the point) and its entrance. */
export interface MapSpot { building: number; x: number; z: number }

/** What the game marks on the map besides the town: your home, the building you are in, the bus stops, people you know near you. */
export interface MapMarks {
  home: MapSpot | null;
  inside: MapSpot | null;
  stops: readonly { x: number; z: number }[];
  /** `kin`: family (else someone known by name). */
  people: readonly { x: number; z: number; kin: boolean }[];
}

/** The part of the town shown: the point at the middle, pixels per metre, and the turn (radians; 0 has north up). */
export interface MapView { x: number; z: number; s: number; rot: number }

const INK = '#2b2620', PAPER = '#efe8d8', WATER = '#9fc1d4', WOODS = '#c9d6b0', PARK = '#cfe0b4', HOUSE = '#cdbfa6';
const HOME = '#e0b04a', INSIDE = '#d9822b', MINE = '#c0392b', STOP = '#2f5f8f', KIN = '#2e8b57', KNOWN = '#2f6fb5';
/** Drawn road width by class (m): boulevard, avenue, street, lane, path. */
const ROAD_W = [16, 12, 9, 6, 2.5];

/** The outline index of a building code on the map (-1: not a town building, e.g. a public building or a farm). */
function outlineOf(m: TownMap, code: number): number {
  const ref = buildingRef(code);
  return ref && 'cell' in ref && ref.cell < m.cellFirst.length ? m.cellFirst[ref.cell] + ref.index : -1;
}

/**
 * Draw the town map into `g` (CSS pixels, `w` × `h`): the big map's panel and the minimap both draw with this, so
 * they look alike. `mini` drops the scale bar and puts the north mark on a round rim.
 */
export function drawTownMap(g: CanvasRenderingContext2D, m: TownMap, ground: HTMLCanvasElement, w: number, h: number, view: MapView, me: MapViewer | null, marks: MapMarks | null, mini = false): void {
  const { s, rot } = view, cr = Math.cos(rot), sr = Math.sin(rot);
  const X = (x: number, z: number) => cr * (x - view.x) * s - sr * (z - view.z) * s + w / 2;
  const Z = (x: number, z: number) => sr * (x - view.x) * s + cr * (z - view.z) * s + h / 2;
  /** World metres from the middle that can show (outlines farther than this plus their size are skipped). */
  const reach = Math.hypot(w, h) / 2 / s + 80;
  const inReach = (x: number, z: number) => Math.abs(x - view.x) < reach && Math.abs(z - view.z) < reach;
  g.fillStyle = PAPER;
  g.fillRect(0, 0, w, h);
  g.imageSmoothingEnabled = true;
  g.save();
  g.translate(w / 2, h / 2);
  g.rotate(rot);
  g.drawImage(ground, (m.cx - m.half - view.x) * s, (m.cz - m.half - view.z) * s, 2 * m.half * s, 2 * m.half * s);
  g.restore();
  const outline = (pts: Float32Array, at: number, end: number) => {
    for (let k = at; k < end; k += 2) (k === at ? g.moveTo : g.lineTo).call(g, X(pts[k], pts[k + 1]), Z(pts[k], pts[k + 1]));
    g.closePath();
  };
  const polys = (pts: Float32Array, ends: Uint32Array, fill: string, cull: boolean) => {
    g.fillStyle = fill;
    g.beginPath();
    let at = 0;
    for (const end of ends) {
      if (!cull || inReach(pts[at], pts[at + 1])) outline(pts, at, end);
      at = end;
    }
    g.fill();
  };
  polys(m.parks, m.parkEnds, PARK, false);
  if (s > 0.25) polys(m.buildings, m.buildingEnds, HOUSE, true);
  // Your home filled in its colour; the building you are in drawn round in its own (over the home's when that is where you are).
  for (const [spot, inside] of [[marks?.home, false], [marks?.inside, true]] as const) {
    const i = spot ? outlineOf(m, spot.building) : -1;
    if (i < 0) continue;
    g.beginPath();
    outline(m.buildings, i ? m.buildingEnds[i - 1] : 0, m.buildingEnds[i]);
    if (inside) { g.strokeStyle = INSIDE; g.lineWidth = 3; g.stroke(); continue; }
    g.fillStyle = HOME; g.strokeStyle = INK; g.lineWidth = 1;
    g.fill();
    g.stroke();
  }
  const line = (pts: Float32Array) => {
    g.beginPath();
    for (let k = 0; k < pts.length; k += 2) (k === 0 ? g.moveTo : g.lineTo).call(g, X(pts[k], pts[k + 1]), Z(pts[k], pts[k + 1]));
    g.stroke();
  };
  g.lineCap = 'round';
  g.lineJoin = 'round';
  // Casings first, then the fill, widest class last so main roads read on top.
  for (const pass of [0, 1]) for (let cls = 4; cls >= 0; cls--) {
    const px = Math.max(cls === 4 ? 0.8 : 1.6, ROAD_W[cls] * s);
    g.strokeStyle = pass === 0 ? '#8a7f6e' : cls <= 1 ? '#f4d58d' : '#ffffff';
    g.lineWidth = pass === 0 ? px + 1.5 : px;
    g.setLineDash(cls === 4 && pass === 1 ? [3, 3] : []);
    if (cls === 4 && pass === 0) continue;
    for (const r of m.roads) if (r.cls === cls) line(r.pts);
  }
  g.setLineDash([]);
  if (m.rail) {
    g.strokeStyle = INK; g.lineWidth = 3; line(m.rail);
    g.strokeStyle = PAPER; g.lineWidth = 1.5; g.setLineDash([6, 6]); line(m.rail); g.setLineDash([]);
  }
  // Street names along their longest stretch, where they fit (turned with the map, never upside down).
  g.font = `italic ${Math.round(Math.min(mini ? 12 : 14, Math.max(10, 9 * s)))}px Georgia, serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const placed: [number, number, number][] = [];
  for (const l of [...m.streets].sort((a, b) => b.length - a.length)) {
    const tw = g.measureText(l.name).width;
    if (!l.length || l.length * s < tw + 8) continue;
    const x = X(l.x, l.z), z = Z(l.x, l.z);
    if (x < -50 || z < -50 || x > w + 50 || z > h + 50 || placed.some(([px, pz, r]) => Math.hypot(px - x, pz - z) < r + tw / 2)) continue;
    placed.push([x, z, tw / 2]);
    let a = Math.atan2(Math.sin(l.angle + rot), Math.cos(l.angle + rot));
    if (a > Math.PI / 2) a -= Math.PI; else if (a < -Math.PI / 2) a += Math.PI;
    g.save();
    g.translate(x, z);
    g.rotate(a);
    g.lineWidth = 3; g.strokeStyle = '#ffffffcc'; g.strokeText(l.name, 0, 0);
    g.fillStyle = INK; g.fillText(l.name, 0, 0);
    g.restore();
  }
  // Landmarks: a dot, and the name where it does not run into another (the one you are in or live in ringed).
  g.font = `600 ${mini ? 11 : 12}px "Alegreya Sans", system-ui, sans-serif`;
  g.textAlign = 'left';
  const boxes: [number, number, number, number][] = [];
  for (const lm of m.landmarks) {
    const x = X(lm.x, lm.z), z = Z(lm.x, lm.z);
    if (x < -150 || z < -20 || x > w + 20 || z > h + 20) continue;
    const ringed = [marks?.inside, marks?.home].find((p) => p?.building === SITE + lm.id);
    if (ringed) { g.strokeStyle = ringed === marks?.inside ? INSIDE : HOME; g.lineWidth = 3; g.beginPath(); g.arc(x, z, 8, 0, Math.PI * 2); g.stroke(); }
    g.fillStyle = '#7a2e22';
    g.beginPath(); g.arc(x, z, 4, 0, Math.PI * 2); g.fill();
    const box: [number, number, number, number] = [x + 6, z - 8, x + 9 + g.measureText(lm.name).width, z + 8];
    if (boxes.some((o) => o[0] < box[2] && box[0] < o[2] && o[1] < box[3] && box[1] < o[3])) continue;
    boxes.push(box);
    g.lineWidth = 3; g.strokeStyle = '#ffffffcc'; g.strokeText(lm.name, x + 7, z);
    g.fillStyle = INK; g.fillText(lm.name, x + 7, z);
  }
  if (marks) {
    // A home or building the map has no outline for (a farm): a ring at its door.
    for (const [spot, col] of [[marks.home, HOME], [marks.inside, INSIDE]] as const) {
      if (!spot || outlineOf(m, spot.building) >= 0 || (spot.building >= SITE && spot.building < FARM)) continue;
      g.strokeStyle = col; g.lineWidth = 3; g.beginPath(); g.arc(X(spot.x, spot.z), Z(spot.x, spot.z), 8, 0, Math.PI * 2); g.stroke();
    }
    // Bus stops: a small blue square with a white bar, like the post's flag.
    for (const st of marks.stops) {
      const x = X(st.x, st.z), z = Z(st.x, st.z);
      if (x < -10 || z < -10 || x > w + 10 || z > h + 10) continue;
      g.fillStyle = STOP; g.strokeStyle = '#ffffff'; g.lineWidth = 1.5;
      g.beginPath(); g.rect(x - 4.5, z - 4.5, 9, 9); g.fill(); g.stroke();
      g.fillStyle = '#ffffff'; g.fillRect(x - 2.5, z - 0.75, 5, 1.5);
    }
    // People you know out near you: green for family, blue for the others.
    for (const p of marks.people) {
      g.fillStyle = p.kin ? KIN : KNOWN; g.strokeStyle = '#ffffff'; g.lineWidth = 1.5;
      g.beginPath(); g.arc(X(p.x, p.z), Z(p.x, p.z), 3.5, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    // Your home's door: a small house.
    if (marks.home) {
      const x = X(marks.home.x, marks.home.z), z = Z(marks.home.x, marks.home.z);
      g.fillStyle = HOME; g.strokeStyle = INK; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(x, z - 7); g.lineTo(x + 6, z - 1); g.lineTo(x + 4, z - 1); g.lineTo(x + 4, z + 5); g.lineTo(x - 4, z + 5); g.lineTo(x - 4, z - 1); g.lineTo(x - 6, z - 1); g.closePath();
      g.fill(); g.stroke();
    }
  }
  if (me) {
    const x = X(me.x, me.z), z = Z(me.x, me.z), a = Math.atan2(me.fz, me.fx) + rot;
    g.save();
    g.translate(x, z);
    g.rotate(a);
    g.fillStyle = MINE; g.strokeStyle = '#ffffff'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(11, 0); g.lineTo(-7, 7); g.lineTo(-3, 0); g.lineTo(-7, -7); g.closePath(); g.fill(); g.stroke();
    g.restore();
  }
  g.fillStyle = INK; g.font = '600 13px "Alegreya Sans", system-ui, sans-serif'; g.textAlign = 'center';
  if (mini) {
    // North on the rim, wherever the turn has put it.
    const r = Math.min(w, h) / 2 - 10, x = w / 2 + Math.sin(rot) * r, z = h / 2 - Math.cos(rot) * r;
    g.lineWidth = 3; g.strokeStyle = '#ffffffcc'; g.strokeText('N', x, z);
    g.fillStyle = MINE; g.fillText('N', x, z);
    return;
  }
  // North arrow and scale bar.
  g.fillText('N ↑', w - 26, h - 20);
  const metres = [50, 100, 200, 500, 1000, 2000].find((d) => d * s >= 70) ?? 2000;
  g.fillRect(16, h - 22, metres * s, 3);
  g.textAlign = 'left';
  g.fillText(metres >= 1000 ? `${metres / 1000} km` : `${metres} m`, 16, h - 32);
}

/** The ground raster as a small canvas (scaled up when drawn). */
export function groundImage(m: TownMap): HTMLCanvasElement {
  const c = el('canvas', '');
  c.width = c.height = m.n;
  const g = c.getContext('2d')!;
  const img = g.createImageData(m.n, m.n);
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const cols = { [MAP_WATER]: rgb(WATER), [MAP_WOODS]: rgb(WOODS) } as Record<number, number[]>;
  const paper = rgb(PAPER);
  for (let k = 0; k < m.ground.length; k++) {
    const c3 = cols[m.ground[k]] ?? paper;
    img.data.set([c3[0], c3[1], c3[2], 255], k * 4);
  }
  g.putImageData(img, 0, 0);
  return c;
}

/**
 * What the menu's "Map" entry (src/app/shell.ts) and a click on the minimap run. `map` fetches the town map (once; it
 * is kept), `me` says where the viewer is now (null when there is no one to place, e.g. high above the town), `marks`
 * what else to mark (your home, the building you are in, bus stops, people you know near you).
 */
export function mapOpener(map: () => Promise<TownMap>, me: () => MapViewer | null, marks: () => MapMarks | null = () => null): () => Promise<void> {
  let got: Promise<TownMap> | null = null;
  return async () => {
    got ??= map();
    const m = await got;
    const close = el('button', 'map-close', 'Close');
    close.type = 'button';
    const panel = openDialog('map', 'Town map', close);
    if (!panel) return;
    const canvas = el('canvas', 'map-canvas');
    const zoomIn = el('button', 'map-zoom', '+'), zoomOut = el('button', 'map-zoom', '−');
    zoomIn.type = zoomOut.type = 'button';
    const tools = el('div', 'map-tools');
    tools.append(zoomIn, zoomOut, close);
    panel.append(canvas, tools);
    const g = canvas.getContext('2d')!;
    const ground = groundImage(m);
    const here = me();
    const view: MapView = { x: here?.x ?? m.cx, z: here?.z ?? m.cz, s: 0, rot: 0 };
    let fitted = false;
    const frame = () => {
      if (!panel.isConnected) return;
      const dpr = devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
      if (!fitted && w > 0) { view.s = here ? 1.2 : Math.min(w, h) / (2 * m.half); fitted = true; }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawTownMap(g, m, ground, w, h, view, me(), marks());
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    const zoom = (f: number) => { view.s = Math.min(6, Math.max(0.05, view.s * f)); };
    zoomIn.addEventListener('click', () => zoom(1.5));
    zoomOut.addEventListener('click', () => zoom(1 / 1.5));
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoom(e.deltaY < 0 ? 1.2 : 1 / 1.2); }, { passive: false });
    let drag: { x: number; y: number } | null = null;
    canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      view.x -= (e.clientX - drag.x) / view.s;
      view.z -= (e.clientY - drag.y) / view.s;
      drag = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener('pointerup', () => { drag = null; });
  };
}

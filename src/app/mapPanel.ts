/**
 * The town map (town-realism track H): the menu's "Map" entry opens a printed-style map of the town, made from the plan in a
 * town worker (`townMapOf`, src/plan/townMap.ts): water and woods, parks, every building's footprint, the roads by
 * class, the railway, the landmarks by name and the street names along their streets, and where you are now. Drag
 * to move, the wheel or the + and − buttons to zoom; street names show once there is room for them.
 */
import { MAP_WATER, MAP_WOODS, type TownMap } from '../plan/townMap';
import { el, openDialog } from './dom';

/** Where the viewer stands and looks (x, z and the forward direction on the ground). */
export interface MapViewer { x: number; z: number; fx: number; fz: number }

const INK = '#2b2620', PAPER = '#efe8d8', WATER = '#9fc1d4', WOODS = '#c9d6b0', PARK = '#cfe0b4', HOUSE = '#cdbfa6';
/** Drawn road width by class (m): boulevard, avenue, street, lane, path. */
const ROAD_W = [16, 12, 9, 6, 2.5];

function draw(g: CanvasRenderingContext2D, m: TownMap, ground: HTMLCanvasElement, w: number, h: number, view: { x: number; z: number; s: number }, me: MapViewer | null): void {
  const { s } = view;
  const X = (x: number) => (x - view.x) * s + w / 2, Z = (z: number) => (z - view.z) * s + h / 2;
  g.fillStyle = PAPER;
  g.fillRect(0, 0, w, h);
  g.imageSmoothingEnabled = true;
  g.drawImage(ground, X(m.cx - m.half), Z(m.cz - m.half), 2 * m.half * s, 2 * m.half * s);
  const polys = (pts: Float32Array, ends: Uint32Array, fill: string) => {
    g.fillStyle = fill;
    g.beginPath();
    let at = 0;
    for (const end of ends) {
      for (let k = at; k < end; k += 2) (k === at ? g.moveTo : g.lineTo).call(g, X(pts[k]), Z(pts[k + 1]));
      g.closePath();
      at = end;
    }
    g.fill();
  };
  polys(m.parks, m.parkEnds, PARK);
  if (s > 0.25) polys(m.buildings, m.buildingEnds, HOUSE);
  const line = (pts: Float32Array) => {
    g.beginPath();
    for (let k = 0; k < pts.length; k += 2) (k === 0 ? g.moveTo : g.lineTo).call(g, X(pts[k]), Z(pts[k + 1]));
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
  // Street names along their longest stretch, where they fit.
  g.font = `italic ${Math.round(Math.min(14, Math.max(10, 9 * s)))}px Georgia, serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const placed: [number, number, number][] = [];
  for (const l of [...m.streets].sort((a, b) => b.length - a.length)) {
    const tw = g.measureText(l.name).width;
    if (!l.length || l.length * s < tw + 8) continue;
    const x = X(l.x), z = Z(l.z);
    if (x < -50 || z < -50 || x > w + 50 || z > h + 50 || placed.some(([px, pz, r]) => Math.hypot(px - x, pz - z) < r + tw / 2)) continue;
    placed.push([x, z, tw / 2]);
    let a = l.angle;
    if (a > Math.PI / 2) a -= Math.PI; else if (a < -Math.PI / 2) a += Math.PI;
    g.save();
    g.translate(x, z);
    g.rotate(a);
    g.lineWidth = 3; g.strokeStyle = '#ffffffcc'; g.strokeText(l.name, 0, 0);
    g.fillStyle = INK; g.fillText(l.name, 0, 0);
    g.restore();
  }
  // Landmarks: a dot, and the name where it does not run into another.
  g.font = '600 12px "Alegreya Sans", system-ui, sans-serif';
  g.textAlign = 'left';
  const boxes: [number, number, number, number][] = [];
  for (const lm of m.landmarks) {
    const x = X(lm.x), z = Z(lm.z);
    g.fillStyle = '#7a2e22';
    g.beginPath(); g.arc(x, z, 4, 0, Math.PI * 2); g.fill();
    const box: [number, number, number, number] = [x + 6, z - 8, x + 9 + g.measureText(lm.name).width, z + 8];
    if (boxes.some((o) => o[0] < box[2] && box[0] < o[2] && o[1] < box[3] && box[1] < o[3])) continue;
    boxes.push(box);
    g.lineWidth = 3; g.strokeStyle = '#ffffffcc'; g.strokeText(lm.name, x + 7, z);
    g.fillStyle = INK; g.fillText(lm.name, x + 7, z);
  }
  if (me) {
    const x = X(me.x), z = Z(me.z), a = Math.atan2(me.fz, me.fx);
    g.save();
    g.translate(x, z);
    g.rotate(a);
    g.fillStyle = '#c0392b'; g.strokeStyle = '#ffffff'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(11, 0); g.lineTo(-7, 7); g.lineTo(-3, 0); g.lineTo(-7, -7); g.closePath(); g.fill(); g.stroke();
    g.restore();
  }
  // North arrow and scale bar.
  g.fillStyle = INK; g.font = '600 13px "Alegreya Sans", system-ui, sans-serif'; g.textAlign = 'center';
  g.fillText('N ↑', w - 26, h - 20);
  const metres = [50, 100, 200, 500, 1000, 2000].find((d) => d * s >= 70) ?? 2000;
  g.fillRect(16, h - 22, metres * s, 3);
  g.textAlign = 'left';
  g.fillText(metres >= 1000 ? `${metres / 1000} km` : `${metres} m`, 16, h - 32);
}

/** The ground raster as a small canvas (scaled up when drawn). */
function groundImage(m: TownMap): HTMLCanvasElement {
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
 * What the menu's "Map" entry runs (src/app/shell.ts). `map` fetches the town map (once; it is kept), `me` says where
 * the viewer is now (null when there is no one to place, e.g. high above the town).
 */
export function mapOpener(map: () => Promise<TownMap>, me: () => MapViewer | null): () => Promise<void> {
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
    const view = { x: here?.x ?? m.cx, z: here?.z ?? m.cz, s: 0 };
    let fitted = false;
    const frame = () => {
      if (!panel.isConnected) return;
      const dpr = devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
      if (!fitted && w > 0) { view.s = here ? 1.2 : Math.min(w, h) / (2 * m.half); fitted = true; }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(g, m, ground, w, h, view, me());
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

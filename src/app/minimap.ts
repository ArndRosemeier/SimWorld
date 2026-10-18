/**
 * The minimap: a small round map in the bottom right corner of the play screen (left of the chat panel when it is
 * open), drawn in 2D from the town map (`drawTownMap`, src/app/mapPanel.ts, so it looks like the big one) with no
 * render pass of its own. It shows the streets with their names, the buildings, water and woods, your home and the
 * building you are in, the bus stops, the people you know out near you, and you as an arrow. North stays up; the
 * button on its rim turns it with your facing instead (kept between sessions). The wheel zooms, a click opens the
 * big town map. Indoors it keeps showing the town around your building.
 */
import { readNumPref, readPref, writePref } from '../persist/prefs';
import type { TownMap } from '../plan/townMap';
import { el, showToggle } from './dom';
import { drawTownMap, groundImage, type MapMarks, type MapView, type MapViewer } from './mapPanel';

/** Pixels per metre: the zoom range and the start. */
const S_MIN = 0.3, S_MAX = 4, S_START = 0.8;
/** Redraws at most this often (ms): the map moves slowly, the frame budget is the town's. */
const REDRAW_MS = 80;

export class Minimap {
  readonly root = el('div', 'mm');
  private readonly canvas = el('canvas', 'mm-canvas');
  private readonly turnButton = el('button', 'mm-turn');
  private readonly g = this.canvas.getContext('2d');
  private map: TownMap | null = null;
  private ground: HTMLCanvasElement | null = null;
  private s = Math.min(S_MAX, Math.max(S_MIN, readNumPref('minimap.zoom', S_START)));
  /** Turn with your facing (else north up). */
  private turn = readPref('minimap.turn') === '1';
  private drawnAt = 0;
  private dirty = true;
  private fetching = false;

  /** `map` fetches the town map (the same one the big map uses), `open` opens the big map. */
  constructor(private readonly fetchMap: () => Promise<TownMap>, open: () => void) {
    this.canvas.setAttribute('role', 'button');
    this.canvas.setAttribute('aria-label', 'Open the town map');
    this.canvas.title = 'Open the town map';
    this.turnButton.type = 'button';
    this.showTurn();
    this.root.append(this.canvas, this.turnButton);
    this.root.hidden = true;
    document.body.append(this.root);
    this.canvas.addEventListener('click', open);
    // A press on the minimap is not the start of a camera drag (the camera takes presses on any canvas).
    this.canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); });
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.s = Math.min(S_MAX, Math.max(S_MIN, this.s * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
      writePref('minimap.zoom', this.s.toFixed(3));
      this.dirty = true;
    }, { passive: false });
    this.turnButton.addEventListener('click', () => {
      this.turn = !this.turn;
      writePref('minimap.turn', this.turn ? '1' : '0');
      this.showTurn();
      this.dirty = true;
    });
  }

  private showTurn(): void {
    showToggle(this.turnButton, this.turn, ['⟳', 'N'], ['Turning with you: click for north up', 'North up: click to turn with you']);
    this.turnButton.setAttribute('aria-label', this.turnButton.title);
  }

  /** Each frame: where you are (null hides the minimap, e.g. high above the town) and what to mark (asked only when it redraws). */
  keepUp(me: MapViewer | null, marks: () => MapMarks | null): void {
    this.root.hidden = !me;
    if (!me || !this.g) return;
    if (!this.map) {
      if (!this.fetching) {
        this.fetching = true;
        void this.fetchMap().then((m) => { this.map = m; this.ground = groundImage(m); this.dirty = true; }, () => { this.fetching = false; });
      }
      return;
    }
    const now = performance.now();
    if (!this.dirty && now - this.drawnAt < REDRAW_MS) return;
    this.dirty = false;
    this.drawnAt = now;
    const c = this.canvas, dpr = devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = this.g;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    g.save();
    g.beginPath();
    g.arc(w / 2, h / 2, Math.min(w, h) / 2, 0, Math.PI * 2);
    g.clip();
    // Turned: your forward (fx, fz) points up the screen.
    const view: MapView = { x: me.x, z: me.z, s: this.s, rot: this.turn && (me.fx || me.fz) ? -Math.PI / 2 - Math.atan2(me.fz, me.fx) : 0 };
    drawTownMap(g, this.map, this.ground!, w, h, view, me, marks(), true);
    g.restore();
  }
}

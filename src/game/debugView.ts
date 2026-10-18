/**
 * The debug menu's overlays (src/app/debug.ts, group Show): the physics world's solids round the player (magenta),
 * the doors (the shown interior's door leaves and street doorways in cyan, the street doors near that bring an
 * interior up in yellow with the reach that does it), and everyone's walk on the street (green, yours orange). Drawn
 * as thin bars of the VERTEX_COLOR_SOLID kind (src/build/debugBars.ts), rebuilt twice a second while one is on.
 */
import type { Mesh } from 'three/webgpu';
import { barsData, boxEdges } from '../build/debugBars';
import { leafBox } from '../interior/doors';
import { meshFromData } from '../render/meshes';
import { VERTEX_COLOR_SOLID } from '../render/materials';
import type { Stage } from '../render/stage';
import type { GoingInside } from './inside';
import type { Playing } from './playing';
import type { SimClient } from './SimClient';

/** How far round the point of interest the overlays reach (m). */
const REACH = 60;
/** Real ms between rebuilds. */
const EVERY = 500;
/** How much of each walk is drawn: game minutes back and ahead of now. */
const WALK_BACK = 1, WALK_AHEAD = 6;
/** The reach of a street door (Playing's DOOR_NEAR), drawn round each. */
const DOOR_REACH = 4;

const MAGENTA = [1, 0.1, 0.9], CYAN = [0.1, 0.9, 1], YELLOW = [1, 0.85, 0.1], GREEN = [0.2, 1, 0.3], ORANGE = [1, 0.5, 0.1];

export class DebugView {
  colliders = false;
  doors = false;
  walks = false;
  private mesh: Mesh | null = null;
  private last = -Infinity;
  /** A new mesh is on its way into the scene (the old one stays until it is in). */
  private adding = false;

  constructor(private readonly stage: Stage, private readonly sim: SimClient, private readonly playing: Playing, private readonly goingIn: GoingInside) {}

  /** Once a frame: (x, z) is where the player (or the camera) is; `t` real ms. */
  overlay(t: number, x: number, z: number): void {
    if (!this.colliders && !this.doors && !this.walks) { this.clear(); return; }
    if (this.adding || t - this.last < EVERY) return;
    this.last = t;
    const segs: number[] = [], rgb: number[] = [];
    const paint = (from: number, colour: number[]) => { for (let i = from; i < segs.length; i += 6) rgb.push(...colour); };
    if (this.colliders) {
      const n = segs.length;
      segs.push(...(this.playing.physicsNow?.outlines(x, z, REACH) ?? []));
      paint(n, MAGENTA);
    }
    if (this.doors) this.doorLines(segs, paint, x, z);
    if (this.walks) this.walkLines(segs, paint, x, z);
    if (!segs.length) { this.clear(); return; }
    const m = meshFromData(barsData(segs, rgb), VERTEX_COLOR_SOLID);
    m.frustumCulled = false;
    this.adding = true;
    void this.stage.add(m).finally(() => {
      this.adding = false;
      this.clear();
      if (this.colliders || this.doors || this.walks) this.mesh = m;
      else { this.stage.remove(m); m.geometry.dispose(); }
    });
  }

  private doorLines(segs: number[], paint: (from: number, c: number[]) => void, x: number, z: number): void {
    let n = segs.length;
    const ins = this.goingIn.inside;
    if (ins) {
      for (const leaf of ins.indoors.leaves) boxEdges(leafBox(leaf), segs);
      for (const d of ins.indoors.doors) {
        // The doorway: two posts and a lintel across its width, 2.1 m tall.
        const tx = -d.nz, tz = d.nx, h = d.w / 2;
        segs.push(d.x - tx * h, d.y, d.z - tz * h, d.x - tx * h, d.y + 2.1, d.z - tz * h);
        segs.push(d.x + tx * h, d.y, d.z + tz * h, d.x + tx * h, d.y + 2.1, d.z + tz * h);
        segs.push(d.x - tx * h, d.y + 2.1, d.z - tz * h, d.x + tx * h, d.y + 2.1, d.z + tz * h);
      }
    }
    paint(n, CYAN);
    n = segs.length;
    const pts = this.playing.doorPoints();
    for (let i = 0; i + 1 < pts.length; i += 2) {
      const px = pts[i], pz = pts[i + 1];
      if (Math.hypot(px - x, pz - z) > REACH) continue;
      const y = this.sim.standHeight(px, pz);
      segs.push(px, y, pz, px, y + 3, pz);
      for (let k = 0; k < 12; k++) {
        const a0 = (k * Math.PI) / 6, a1 = ((k + 1) * Math.PI) / 6;
        segs.push(px + Math.cos(a0) * DOOR_REACH, y + 0.1, pz + Math.sin(a0) * DOOR_REACH, px + Math.cos(a1) * DOOR_REACH, y + 0.1, pz + Math.sin(a1) * DOOR_REACH);
      }
    }
    paint(n, YELLOW);
  }

  private walkLines(segs: number[], paint: (from: number, c: number[]) => void, x: number, z: number): void {
    const me = this.sim.player?.id ?? -1;
    const now = this.sim.clock;
    for (const w of this.sim.walkers.values()) {
      const k = w.keys;
      if (k.length < 8 || Math.hypot(k[1] - x, k[3] - z) > REACH * 3) continue;
      const n = segs.length;
      // The stretch from a little before now to where they will be in the next few game minutes.
      for (let i = 4; i + 3 < k.length; i += 4) {
        if (k[i] < now - WALK_BACK || k[i - 4] > now + WALK_AHEAD) continue;
        segs.push(k[i - 3], k[i - 2] + 0.15, k[i - 1], k[i + 1], k[i + 2] + 0.15, k[i + 3]);
      }
      paint(n, w.id === me ? ORANGE : GREEN);
    }
  }

  private clear(): void {
    if (!this.mesh) return;
    this.stage.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh = null;
  }
}

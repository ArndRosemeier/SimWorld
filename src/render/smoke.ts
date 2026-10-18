/**
 * Smoke from the chimneys when homes have the heating on (src/sim/weather.ts `heatingShare`, from the sim's
 * temperature and the hour), bent by the wind, pale by day and faint at night. The chimney tops come with the
 * town's buildings (src/build/massing.ts `buildBuildings`); one geometry-instanced mesh of the `SMOKE_PUFFS`
 * kind, moved in its shader (src/render/tsl/smoke.ts). New in SimWorld.
 */
import type { Mesh } from 'three/webgpu';
import { deriveSeed, hash2i, hashToFloat, lerp, smoothstep } from '@futuremagic/core';
import { MeshBuilder } from '../build/meshBuilder';
import { heatingShare, type Weather } from '../sim/weather';
import { SMOKE_PUFFS } from './materials';
import { instancedFromData, showInstances } from './meshes';
import { SMOKE } from './tsl/smoke';

/** Puffs on the way up from each chimney. */
const PUFFS = 12;
/** Room for this many chimneys. */
const CHIMNEYS = 4096;

export class ChimneySmoke {
  readonly mesh: Mesh;
  private readonly pose = new Float32Array(CHIMNEYS * 4);
  private readonly size = new Float32Array(CHIMNEYS * 2);
  private n = 0;
  private t = 0;
  private readonly seed: number;

  constructor(seed: number) {
    const mb = new MeshBuilder([]);
    for (let k = 0; k < PUFFS; k++) {
      const a = mb.v(-1, -1, k / PUFFS, 0, 0, 1);
      mb.v(1, -1, k / PUFFS, 0, 0, 1);
      mb.v(1, 1, k / PUFFS, 0, 0, 1);
      mb.v(-1, 1, k / PUFFS, 0, 0, 1);
      mb.quad(a, a + 1, a + 2, a + 3);
    }
    this.mesh = instancedFromData(mb.build(), SMOKE_PUFFS, 0, CHIMNEYS);
    this.mesh.renderOrder = 880;
    this.mesh.visible = false;
    this.seed = deriveSeed(seed, 'smoke');
  }

  /** More chimney tops (x, y, z each) as the town's buildings come in. */
  addChimneys(tops: readonly number[]): void {
    for (let i = 0; i + 2 < tops.length && this.n < CHIMNEYS; i += 3, this.n++) {
      // Each chimney's own random from where it stands, whichever order the cells come in.
      const h = hash2i(this.seed, Math.round(tops[i] * 10), Math.round(tops[i + 2] * 10));
      this.pose.set([tops[i], tops[i + 1], tops[i + 2], hashToFloat(h) * Math.PI * 2], this.n * 4);
      this.size.set([0.8 + 0.4 * hashToFloat(hash2i(h, 1, 0)), 1], this.n * 2);
    }
    const all = Array.from({ length: this.n }, (_, i) => i);
    showInstances([this.mesh], { iPose: this.pose, iSize: this.size }, all, 60);
    this.mesh.visible = this.n > 0;
  }

  /** `minute`: of the day; `windDir` where the wind blows to; `day` the daylight 0 … 1. */
  puff(dt: number, w: Weather, minute: number, day: number): void {
    this.t = (this.t + dt) % 1000;
    const S = SMOKE;
    S.t.value = this.t;
    S.heat.value = heatingShare(w.tempC, minute);
    // A breeze bends the plume over; a gale tears it along and keeps it low.
    const along = 0.25 + w.wind * 5;
    S.drift.value.set(Math.cos(w.windDir) * along, 0, Math.sin(w.windDir) * along);
    S.rise.value = lerp(1.2, 0.35, smoothstep(0.2, 0.9, w.wind));
    // Thicker in cold damp air, thinner in the rain that washes it out.
    S.alpha.value = lerp(0.08, 0.26, smoothstep(10, -2, w.tempC)) * lerp(0.3, 1, day) * (1 - 0.5 * w.rain);
    S.col.value.setRGB(lerp(0.16, 0.8, day), lerp(0.16, 0.8, day), lerp(0.18, 0.83, day));
  }
}

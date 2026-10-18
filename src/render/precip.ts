/**
 * Rain and snow falling round the camera, from the weather (src/sim/weather.ts): how many drops, how fast, how
 * slanted by the wind, how bright by daylight and lightning; sleet is a mix of both. Ported from Scale
 * (src/render/Weather.ts `RainFx`); snow is new. One mesh of the `RAIN_SNOW` kind; nothing here changes a shader.
 */
import type { Camera, Mesh } from 'three/webgpu';
import { Rng, clamp, deriveSeed, lerp, smoothstep } from '@futuremagic/core';
import { MeshBuilder } from '../build/meshBuilder';
import type { Weather } from '../sim/weather';
import { RAIN_SNOW } from './materials';
import { meshFromData } from './meshes';
import { PRECIP } from './tsl/precip';

/** Drops at full intensity. */
const DROPS = 12000;

export class Precipitation {
  readonly mesh: Mesh;
  private t = 0;

  constructor(seed: number) {
    const mb = new MeshBuilder([{ name: 'aDrop', size: 4 }]);
    const r = new Rng(deriveSeed(seed, 'precip'));
    for (let i = 0; i < DROPS; i++) {
      mb.set('aDrop', r.float(), r.float(), r.float(), r.float());
      const a = mb.v(-1, 0, 0, 0, 0, 1);
      mb.v(1, 0, 0, 0, 0, 1);
      mb.v(1, 1, 0, 0, 0, 1);
      mb.v(-1, 1, 0, 0, 0, 1);
      mb.quad(a, a + 1, a + 2, a + 3);
    }
    this.mesh = meshFromData(mb.build(), RAIN_SNOW);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 900;
    this.mesh.visible = false;
  }

  /**
   * `windDir`: where the wind blows to (radians, from +x towards +z); `day` the daylight 0 … 1, `flash` lightning.
   * `under`: 0 … 1 how much the camera is under a roof (no drops).
   */
  fall(dt: number, camera: Camera, w: Weather, windDir: number, day: number, flash: number, under = 0): void {
    this.t = (this.t + dt) % 1000;
    const amount = w.precip * (1 - under);
    const n = amount < 0.01 ? 0 : Math.round(DROPS * clamp(0.12 + amount * 0.95, 0, 1));
    this.mesh.geometry.setDrawRange(0, n * 6);
    this.mesh.visible = n > 0;
    if (!n) return;
    const P = PRECIP;
    P.cam.value.copy(camera.position);
    const snow = w.precip > 0 ? w.snow / w.precip : 0;
    P.snow.value = snow;
    const gust = w.wind * 4;
    P.rainVel.value.set(Math.cos(windDir) * gust, -8.5, Math.sin(windDir) * gust);
    P.snowVel.value.set(Math.cos(windDir) * gust * 0.6, -1.1, Math.sin(windDir) * gust * 0.6);
    P.t.value = this.t;
    P.alpha.value = lerp(0.12, 0.3, smoothstep(0.1, 0.9, amount)) * lerp(0.45, 1, day) + flash * 0.4;
    P.rainCol.value.setRGB(lerp(0.32, 0.72, day) + flash, lerp(0.35, 0.76, day) + flash, lerp(0.42, 0.82, day) + flash);
    P.snowCol.value.setRGB(lerp(0.35, 0.95, day) + flash, lerp(0.37, 0.96, day) + flash, lerp(0.42, 1.0, day) + flash);
  }
}

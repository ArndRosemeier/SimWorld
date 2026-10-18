/**
 * The day cycle on screen: the sky dome, the sun and the moon where the calendar puts them (src/sim/calendar.ts),
 * the weather (src/sim/weather.ts) in the clouds, the light and the haze, lightning, and the scene's light state
 * (`LIGHT`: night, daylight, wet streets, lying snow, lit windows) every look reads. Ported from Scale (src/render/SkySystem.ts,
 * the lightning of src/render/Weather.ts); the sun path is the real one for the date, not Scale's equinox loop.
 *
 * Nothing here changes a shader: only uniforms, light intensities and colours, the fog's colour and range, the
 * exposure. The environment map Scale used is left out (it would put a PMREM pass and every lit kind's
 * environment branch into the warm-up); the hemisphere light carries the sky light.
 */
import { Color, Vector3, type Camera, type Fog, type Mesh, type Scene, type WebGPURenderer } from 'three/webgpu';
import { Rng, clamp, deriveSeed, lerp, smoothstep } from '@futuremagic/core';
import { MeshBuilder } from '../build/meshBuilder';
import { dateOf, moonLit, moonPhase, moonPosition, sunAt, sunPosition, type Dated } from '../sim/calendar';
import { minuteOfDay } from '../sim/time';
import type { Weather } from '../sim/weather';
import { aimSun, type Lights } from './lights';
import { SKY_DOME } from './materials';
import { meshFromData } from './meshes';
import { LIGHT, SEASON } from './tsl/common';
import { VEG } from './tsl/vegetation';
import { SKY, clearSkyColor } from './tsl/sky';
import { EXPOSURE } from './renderer';

/** The fog's far distance in clear air (m); weather pulls it in. */
const FOG_FAR = 6500;

const v3 = (d: [number, number, number], out: Vector3) => out.set(d[0], d[1], d[2]);
const _grey = new Color(), _c = new Color(), _dir = new Vector3(), _flashCol = new Color(0.8, 0.85, 1.0), _night = new Vector3(), _perp = new Vector3();

export class DaySky {
  readonly dome: Mesh;
  readonly sunDir = new Vector3();
  readonly moonDir = new Vector3();
  /** Lightning flash 0 … ~1.5 now (the audio hooks thunder onto `onStrike`). */
  flash = 0;
  /** Daylight now, 0 night … 1 day. */
  day = 0;
  /** Called at each strike with its distance (m): thunder follows after distance / 343 m/s. */
  onStrike: ((distance: number) => void) | null = null;
  private pulses: { t: number; amp: number }[] = [];
  private now = 0;
  private nextStrike = 6;
  private strikes = 0;
  private cloudT = 0;

  constructor(private readonly renderer: WebGPURenderer, private readonly scene: Scene, private readonly lights: Lights, private readonly seed: number) {
    const mb = new MeshBuilder([]);
    mb.box(0, 0, 0, 50, 50, 50);
    this.dome = meshFromData(mb.build(), SKY_DOME);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -1000;
  }

  /**
   * Set everything for game minute `clock` (fractional) of `world` (its date and latitude), in weather `w`. `dtReal`: real
   * seconds since the last frame (clouds drift and lightning flickers in real time); `speed`: game minutes per
   * real minute (fast time drifts the clouds a little faster).
   */
  update(dtReal: number, world: Dated & { readonly latitude: number }, clock: number, w: Weather, camera: Camera, speed = 1): void {
    this.now += dtReal;
    const sun = sunPosition(world, clock), moon = moonPosition(world, clock);
    v3(sun.dir, this.sunDir);
    v3(moon.dir, this.moonDir);
    const phase = moonPhase(world, clock), lit = moonLit(phase);
    // The light falls on the moon from the sun's side, turned by the phase angle.
    const pa = phase * Math.PI * 2;
    _perp.copy(this.sunDir).addScaledVector(this.moonDir, -this.sunDir.dot(this.moonDir));
    if (_perp.lengthSq() < 1e-6) _perp.set(0, 1, 0).addScaledVector(this.moonDir, -this.moonDir.y);
    _perp.normalize();
    SKY.moonSun.value.copy(this.moonDir).multiplyScalar(Math.cos(pa)).addScaledVector(_perp, Math.sin(pa) * (pa > Math.PI ? -1 : 1));

    const sunUp = this.sunDir.y;
    const day = (this.day = smoothstep(-0.12, 0.15, sunUp));
    const night = 1 - smoothstep(-0.2, 0.02, sunUp);
    const golden = smoothstep(0.35, 0.02, sunUp) * day;
    this.lightning(dtReal, w);

    // The sky dome.
    SKY.sunDir.value.copy(this.sunDir);
    SKY.moonDir.value.copy(this.moonDir);
    SKY.moonBright.value = lerp(1.5, 0.3, day);
    this.cloudT += dtReal * (1 + Math.sqrt(Math.max(0, speed / 20 - 1)) * 2) * (0.6 + 1.2 * w.wind);
    SKY.time.value = this.cloudT;
    const overcast = smoothstep(0.55, 1, w.cover) * 0.9;
    const skyFog = clamp(w.fog * 1.1 + w.precip * 0.25, 0, 1);
    SKY.cover.value = w.cover; SKY.density.value = w.density; SKY.dark.value = w.dark; SKY.overcast.value = overcast; SKY.fog.value = skyFog;
    SKY.flash.value = this.flash;
    SKY.stars.value = (1 - smoothstep(-0.25, -0.1, sunUp)) * (1 - smoothstep(0.4, 0.85, w.cover)) * (1 - skyFog);
    this.dome.position.copy(camera.position);
    this.dome.updateMatrix();
    this.dome.updateMatrixWorld();

    // Sun or moon light: the moon while it is up (stronger the fuller), else a faint glow from high overhead.
    const moonUp = smoothstep(-0.03, 0.2, this.moonDir.y);
    const L = this.lights;
    if (sunUp > -0.05) {
      aimSun(L, this.sunDir);
      L.sun.color.setRGB(1, lerp(0.95, 0.62, golden), lerp(0.9, 0.42, golden));
      L.sun.intensity = 2.4 * smoothstep(-0.02, 0.12, sunUp) * w.sun;
    } else {
      aimSun(L, _night.set(this.moonDir.x * 0.5, 1, this.moonDir.z * 0.5).normalize().lerp(this.moonDir, moonUp).normalize());
      L.sun.color.setRGB(0.55, 0.65, 0.9);
      L.sun.intensity = 0.22 * night * w.sun * (0.45 + 0.75 * lit * moonUp);
    }
    // Under clouds the light is diffuse: less sun, a little more (greyer) sky light; a flash lights everything.
    const dull = 1 - w.sun;
    const hemi = L.sky;
    const twilight = smoothstep(-0.18, 0.1, sunUp);
    hemi.intensity = lerp(0.06, 0.9, twilight) * (1 + 0.35 * dull) * (1 - 0.4 * w.dark) + this.flash * 1.4;
    hemi.color.setRGB(lerp(0.25, 0.75, day), lerp(0.3, 0.84, day), lerp(0.5, 1.0, day));
    hemi.color.lerp(_grey.setScalar((hemi.color.r + hemi.color.g + hemi.color.b) / 3), dull * 0.75);
    hemi.color.lerp(_flashCol, clamp(this.flash, 0, 1));
    // Snow on the ground throws light back up.
    const snowy = smoothstep(0.5, 4, w.snowCm);
    hemi.groundColor.setRGB(lerp(0.06, 0.38, day), lerp(0.06, 0.34, day), lerp(0.08, 0.28, day)).lerp(_grey.setRGB(lerp(0.1, 0.7, day), lerp(0.1, 0.72, day), lerp(0.12, 0.78, day)), snowy);

    // The haze the land fades into is the sky's own horizon colour (averaged round the compass), greyer under
    // clouds, in fog and rain, lit up by a flash.
    const fog = this.scene.fog as Fog;
    fog.color.setRGB(0, 0, 0);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      fog.color.add(clearSkyColor(_dir.set(Math.cos(a), 0.03, Math.sin(a)).normalize(), this.sunDir, _c));
    }
    fog.color.multiplyScalar(1 / 8);
    fog.color.add(_c.setRGB(0.0025, 0.003, 0.005)); // the night sky is never quite black
    const g = lerp(0.008, 0.4 * (1 - 0.75 * w.dark), day);
    fog.color.lerp(_grey.setRGB(g * 0.96, g, g * 1.03), Math.max(overcast, Math.min(1, w.fog * 1.3)));
    fog.color.addScalar(this.flash * 0.2);
    fog.far = FOG_FAR / (1 + 30 * Math.pow(w.fog, 2.2) + 2.5 * w.precip + 3 * w.snow);
    fog.near = fog.far * 0.15;
    SKY.fogCol.value.copy(fog.color);
    if (this.scene.background instanceof Color) this.scene.background.copy(fog.color);

    // The light state every look reads.
    LIGHT.night.value = night;
    LIGHT.dayLight.value = day;
    LIGHT.wet.value = w.wet;
    LIGHT.snow.value = smoothstep(0.3, 5, w.snowCm);
    this.seasons(dateOf(world, clock).dayOfYear, w);
    this.windows(world, clock, night);

    // Exposure: a little brighter at night, darker under storm clouds.
    this.renderer.toneMappingExposure = EXPOSURE * lerp(1.6, 1, day) * (1 + 0.3 * dull * day) * (1 - 0.3 * w.dark * day);
  }

  /**
   * Lit windows, shops and cafés by the hour of the day and the dusk of the date. For now a town-wide share
   * (Scale's curve); the per-dwelling state from who is home and awake replaces it once the sim runs live.
   */
  private windows(world: Dated & { readonly latitude: number }, clock: number, night: number): void {
    const st = sunAt(world, clock);
    const m = minuteOfDay(clock), h = m / 60;
    const dark = m < st.rise || m > st.set;
    // Evenings: from dusk until people go to bed; mornings: up before it is light.
    const frac = h < 5 ? 0.06 : h < 7 ? 0.28 : h < 9 ? 0.15 : h < 17 ? 0.05 : h < 23 ? (dark ? 0.55 : 0.12) : 0.25;
    LIGHT.litFrac.value = lerp(0.04, frac, Math.max(night, dark ? 1 : 0.15));
    LIGHT.shopLit.value = h > 7.5 && h < 21.5 ? 0.92 : 0.12;
    LIGHT.eatLit.value = h > 6.5 && h < 22 ? 0.97 : h >= 22 ? 0.8 : h < 1.5 ? 0.45 : 0.06;
  }

  /**
   * The trees by the date and the weather: leaves turn from mid-September, fall in
   * November, come back in April after the blossom; the wind in the branches is the weather's.
   */
  private seasons(doy: number, w: Weather): void {
    SEASON.leaf.value = doy > 200 ? smoothstep(255, 295, doy) : 0;
    SEASON.bare.value = doy > 200 ? smoothstep(305, 335, doy) : 1 - smoothstep(95, 125, doy);
    SEASON.blossom.value = smoothstep(95, 110, doy) * (1 - smoothstep(118, 135, doy));
    VEG.wind.value = clamp(w.wind * 2, 0.15, 2);
  }

  /** Strikes now and then in a storm: flash pulses (a few flickers each); thunder is the audio's (`onStrike`). */
  private lightning(dt: number, w: Weather): void {
    if (w.lightning > 0.02) {
      this.nextStrike -= dt * w.lightning;
      if (this.nextStrike <= 0) {
        const r = new Rng(deriveSeed(this.seed, 'strike', this.strikes++));
        this.nextStrike = r.range(4, 22);
        const dist = r.range(300, 6000);
        const amp = lerp(1.5, 0.35, (dist - 300) / 5700);
        const a = r.range(0, Math.PI * 2);
        SKY.flashDir.value.set(Math.cos(a), r.range(0.25, 0.6), Math.sin(a)).normalize();
        let t = this.now;
        this.pulses.push({ t, amp });
        for (let i = r.int(1, 3); i > 0; i--) { t += r.range(0.06, 0.22); this.pulses.push({ t, amp: amp * r.range(0.5, 1.1) }); }
        this.onStrike?.(dist);
      }
    }
    let f = 0;
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const q = this.pulses[i], t = this.now - q.t;
      if (t > 1.2) { this.pulses.splice(i, 1); continue; }
      if (t >= 0) f = Math.max(f, q.amp * Math.exp(-t * 9));
    }
    this.flash = Math.min(1.6, f);
  }
}

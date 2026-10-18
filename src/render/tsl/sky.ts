// @ts-nocheck -- three's TSL typings infer swizzles and vector widths poorly; checked by rendering.
/**
 * The sky as a node material: three's SkyMesh (the TSL port of `Sky`: Rayleigh and Mie scattering) with Scale's
 * changes (a sharp sun disc and glow, the moon with its phase, drifting clouds, weather, lightning, horizon fog),
 * plus SimWorld's stars, drawn in the same shader (no star sprites, so one kind and one build).
 * Ported from Scale (src/render/webgpu/sky.ts, src/render/SkySystem.ts `makeSky`).
 *
 * The uniforms live in `SKY` (one sky, like `LIGHT`); the day cycle (src/render/dayCycle.ts) sets them each frame.
 */
import { Vector3, Color, type NodeMaterial } from 'three/webgpu';
import {
  Fn, float, floor, fract, vec2, vec3, vec4, acos, add, mul, clamp, cos, dot, exp, max, min, mix, modelViewProjection,
  normalize, positionWorld, pow, smoothstep, sub, varyingProperty, uniform, cameraPosition, If, Loop, cross, sqrt, select,
} from 'three/tsl';
import { h21 } from './common';

/** Angular radius of the drawn sun and moon discs (~3× the real ones, so they read on screen). */
export const SUN_R = 0.026;
export const MOON_R = 0.024;

/** The sky's brightness against the lit scene. */
export const SKY_GAIN = 0.55;

export const SKY = {
  sunDir: uniform(new Vector3(0, 1, 0)),
  moonDir: uniform(new Vector3(0, -1, 0)),
  /** The direction sunlight falls on the moon from (its phase). */
  moonSun: uniform(new Vector3(0, 1, 0)),
  /** 0 = no moon drawn; full against the night sky, pale by day. */
  moonBright: uniform(0),
  /** Stars' visibility 0 … 1 (night, thinned by clouds and haze). */
  stars: uniform(0),
  /** Cloud drift time (seconds). */
  time: uniform(0),
  cover: uniform(0.35),
  density: uniform(0.45),
  dark: uniform(0),
  overcast: uniform(0),
  /** A lightning flash 0 … ~1.5 lighting the clouds towards `flashDir`. */
  flash: uniform(0),
  flashDir: uniform(new Vector3(0, 0.5, 1)),
  /** Haze over the sky towards the horizon (everywhere in thick fog), in the fog's colour. */
  fog: uniform(0),
  fogCol: uniform(new Color(0.7, 0.78, 0.88)),
};

const turbidity = float(4), rayleigh = float(1.4), mieCoefficient = float(0.004), mieDirectionalG = float(0.8);
const cloudScale = float(0.0002), cloudSpeed = float(0.00002), cloudElevation = float(0.5);

/** How much twilight glow there is for a sun height (sin of its elevation): none by day or in full night. */
const twilightAmount = (sunY: number) => smoothstepN(-0.2, -0.03, sunY) * (1 - smoothstepN(-0.03, 0.06, sunY));
function smoothstepN(a: number, b: number, x: number): number { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

const twilightGlow = Fn(([sunY, cosSun, y]) => {
  const tw = smoothstep(-0.2, -0.03, sunY).mul(sub(1.0, smoothstep(-0.03, 0.06, sunY)));
  const low = sub(1.0, smoothstep(0.0, 0.35, y));
  const sunSide = pow(max(cosSun.mul(0.5).add(0.5), 0.0), 3.0);
  return vec3(0.05, 0.085, 0.16).mul(sub(1.0, y.mul(0.4))).add(vec3(0.3, 0.13, 0.04).mul(sunSide).mul(low)).mul(tw);
}, { sunY: 'float', cosSun: 'float', y: 'float', return: 'vec3' });

export function skyLook(material: NodeMaterial): void {
  const U = SKY;
  const vSunDirection = varyingProperty('vec3');
  const vSunE = varyingProperty('float');
  const vBetaR = varyingProperty('vec3');
  const vBetaM = varyingProperty('vec3');

  material.vertexNode = Fn(() => {
    const e = float(2.718281828459045);
    const totalRayleigh = vec3(5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5);
    const MieConst = vec3(1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14);
    const cutoffAngle = float(1.6110731556870734);
    const steepness = float(1.5);
    const EE = float(1000.0);
    const sunDirection = normalize(U.sunDir);
    vSunDirection.assign(sunDirection);
    const zenithAngleCos = clamp(sunDirection.y, -1, 1);
    vSunE.assign(EE.mul(max(0.0, float(1.0).sub(pow(e, cutoffAngle.sub(acos(zenithAngleCos)).div(steepness).negate())))));
    const sunfade = float(1.0).sub(clamp(float(1.0).sub(exp(sunDirection.y.div(450000.0))), 0, 1));
    const rayleighCoefficient = rayleigh.sub(float(1.0).mul(float(1.0).sub(sunfade)));
    vBetaR.assign(totalRayleigh.mul(rayleighCoefficient));
    const c = float(0.2).mul(turbidity).mul(10e-18);
    vBetaM.assign(float(0.434).mul(c).mul(MieConst).mul(mieCoefficient));
    const position = modelViewProjection;
    position.z.assign(position.w); // always at the far plane
    return position;
  })();

  material.colorNode = Fn(() => {
    const pi = float(3.141592653589793);
    const rayleighZenithLength = float(8.4e3);
    const mieZenithLength = float(1.25e3);
    const THREE_OVER_SIXTEENPI = float(0.05968310365946075);
    const ONE_OVER_FOURPI = float(0.07957747154594767);
    // Below the horizon (past the end of the world) the sky goes on as it is just above it.
    const view = normalize(positionWorld.sub(cameraPosition));
    const direction = normalize(vec3(view.x, max(view.y, 0.012), view.z)).toVar();
    const zenithAngle = acos(max(0.0, direction.y));
    const inverse = float(1.0).div(cos(zenithAngle).add(float(0.15).mul(pow(float(93.885).sub(zenithAngle.mul(180.0).div(pi)), -1.253))));
    const sR = rayleighZenithLength.mul(inverse);
    const sM = mieZenithLength.mul(inverse);
    const Fex = exp(mul(vBetaR, sR).add(mul(vBetaM, sM)).negate()).toVar();
    const cosTheta = dot(direction, vSunDirection).toVar();
    const cc = cosTheta.mul(0.5).add(0.5);
    const rPhase = THREE_OVER_SIXTEENPI.mul(float(1.0).add(pow(cc, 2.0)));
    const betaRTheta = vBetaR.mul(rPhase);
    const g2 = pow(mieDirectionalG, 2.0);
    const inv = float(1.0).div(pow(float(1.0).sub(float(2.0).mul(mieDirectionalG).mul(cosTheta)).add(g2), 1.5));
    const mPhase = ONE_OVER_FOURPI.mul(float(1.0).sub(g2)).mul(inv);
    const betaMTheta = vBetaM.mul(mPhase);
    const Lin = pow(vSunE.mul(add(betaRTheta, betaMTheta).div(add(vBetaR, vBetaM))).mul(sub(1.0, Fex)), vec3(1.5)).toVar();
    Lin.mulAssign(mix(vec3(1.0), pow(vSunE.mul(add(betaRTheta, betaMTheta).div(add(vBetaR, vBetaM))).mul(Fex), vec3(1.0 / 2.0)), clamp(pow(sub(1.0, vSunDirection.y), 5.0), 0.0, 1.0)));
    const L0 = vec3(0.1).mul(Fex);

    // Sun disc (sharp, our radius), bright but not blown out, so it keeps its colour.
    // The sun's disc and glow by the true view direction, hidden below the horizon.
    const cosV = dot(view, vSunDirection);
    const above = smoothstep(-0.004, 0.004, view.y);
    const sundisc = smoothstep(float(Math.cos(SUN_R)).sub(0.00002), float(Math.cos(SUN_R)).add(0.00002), cosV).mul(above);
    const sundiscColor = Fex.div(max(max(Fex.r, Fex.g), max(Fex.b, 1e-4))).mul(sundisc).mul(sub(1.0, U.overcast))
      .mul(mix(9.0, 30.0, smoothstep(0.0, 0.35, vSunDirection.y))).mul(smoothstep(0.0, 0.05, vSunE.div(1000.0))).toVar();

    // The glare around a low sun is compressed (above a soft knee).
    const skyC = add(Lin, L0).mul(0.04).toVar();
    const skyL = max(max(skyC.r, skyC.g), skyC.b);
    // (Scale used a log knee above 1; the horizon of three's sky still burnt into a white band at the edge of the
    // world here, so the luminance saturates softly towards 1.2.)
    skyC.assign(select(skyL.greaterThan(0.8), skyC.mul(float(0.8).add(float(0.4).mul(sub(1.0, exp(skyL.sub(0.8).negate())))).div(skyL)), skyC));
    const texColor = skyC.add(sundiscColor).add(vec3(0.0, 0.0003, 0.00075)).toVar();
    // Twilight: the scattering above fades out when the sun is ~2° down, but the sky stays light for half an hour
    // (civil twilight): a blue glow overhead and an orange band on the sun's side of the horizon.
    texColor.addAssign(twilightGlow(vSunDirection.y, cosV, direction.y));
    const cz = max(cosV, 0.0).mul(above);
    texColor.addAssign(min(vSunE.mul(Fex), 80.0).mul(float(0.05).mul(pow(cz, 6000.0)).add(float(0.003).mul(pow(cz, 400.0))))
      .mul(sub(1.0, U.overcast)).mul(smoothstep(-0.05, 0.02, direction.y)));

    const gradient = Fn(([i]) => {
      const p = fract(i.xyx.mul(vec3(0.1031, 0.1030, 0.0973))).toVar();
      p.addAssign(dot(p, p.yzx.add(33.33)));
      return fract(p.xx.add(p.yz).mul(p.zy)).mul(2.0).sub(1.0);
    });
    const noise = Fn(([p]) => {
      const i = floor(p);
      const f = fract(p);
      const u = f.mul(f).mul(f).mul(f.mul(f.mul(6.0).sub(15.0)).add(10.0));
      const a = dot(gradient(i), f);
      const b = dot(gradient(i.add(vec2(1.0, 0.0))), f.sub(vec2(1.0, 0.0)));
      const c = dot(gradient(i.add(vec2(0.0, 1.0))), f.sub(vec2(0.0, 1.0)));
      const d = dot(gradient(i.add(vec2(1.0, 1.0))), f.sub(vec2(1.0, 1.0)));
      return mix(mix(a, b, u.x), mix(c, d, u.x), u.y).mul(1.6);
    });
    const fbm = Fn(([position, drift]) => {
      const p = vec2(position).toVar();
      const result = float(0.0).toVar();
      const amplitude = float(1.0).toVar();
      Loop(4, () => {
        result.addAssign(amplitude.mul(noise(p)));
        amplitude.mulAssign(0.5);
        p.mulAssign(2.0).addAssign(drift);
      });
      return result;
    });

    const cosM = dot(direction, U.moonDir).toVar();

    // Stars: one in a few hundred cells of a fine grid over the sky, of random brightness and tint; hidden behind
    // the moon's disc (also its dark side), fading into the haze at the horizon, covered by the clouds below.
    If(U.stars.greaterThan(0.002).and(direction.y.greaterThan(-0.02)), () => {
      const g = direction.mul(420.0);
      const cell = floor(g);
      const hs = h21(cell.xy.add(cell.z.mul(17.13)));
      If(hs.greaterThan(0.985), () => {
        const off = vec3(h21(cell.yz.add(3.7)), h21(cell.zx.add(9.1)), h21(cell.xy.add(5.3))).mul(0.6).add(0.2);
        const d = g.sub(cell.add(off)).length();
        const b = hs.sub(0.985).div(0.015);
        const lum = pow(b, 3.0).mul(2.2).add(0.12).mul(sub(1.0, smoothstep(0.12, 0.42, d)));
        const tint = mix(vec3(1.0, 0.86, 0.72), vec3(0.78, 0.86, 1.0), h21(cell.zy.add(1.3)));
        const behindMoon = select(cosM.greaterThan(Math.cos(MOON_R * 1.15)), 0.0, 1.0);
        texColor.addAssign(tint.mul(lum).mul(U.stars).mul(behindMoon).mul(smoothstep(-0.02, 0.12, direction.y)));
      });
    });

    // The moon: a sphere lit from the sun's side (its phase), maria, craters, reddened low down.
    If(U.moonBright.greaterThan(0.0).and(cosM.greaterThan(Math.cos(MOON_R * 1.05))), () => {
      const mRight = normalize(cross(U.moonDir, vec3(0.0, 1.0, 0.0)));
      const mUp = cross(mRight, U.moonDir);
      const mp = vec2(dot(direction, mRight), dot(direction, mUp)).div(MOON_R).toVar();
      const mr2 = dot(mp, mp);
      const mDisc = float(1.0).sub(smoothstep(0.92, 1.0, mr2));
      const mN = mp.x.mul(mRight).add(mp.y.mul(mUp)).sub(sqrt(max(0.0, float(1.0).sub(mr2))).mul(U.moonDir));
      const mLit = smoothstep(-0.04, 0.12, dot(mN, U.moonSun));
      const maria = smoothstep(0.05, 0.45, noise(mp.mul(1.7).add(vec2(3.1, 7.4))).mul(0.7).add(noise(mp.mul(3.9).add(vec2(1.3, 2.9))).mul(0.3)));
      const craters = smoothstep(0.35, 0.7, noise(mp.mul(6.0).add(vec2(5.7, 0.4)))).mul(0.14);
      const mAlb = float(1.0).sub(maria.mul(0.38)).mul(float(1.0).sub(craters));
      const mCol = vec3(0.92, 0.9, 0.85).mul(mAlb).mul(mLit.add(0.006))
        .mul(mix(vec3(1.0, 0.62, 0.38), vec3(1.0), smoothstep(0.0, 0.22, direction.y)));
      texColor.addAssign(mCol.mul(mDisc).mul(U.moonBright).mul(sub(1.0, U.overcast)).mul(smoothstep(-0.01, 0.02, direction.y)));
    });

    If(direction.y.greaterThan(0.0).and(U.cover.greaterThan(0.0)), () => {
      const elevation = mix(1.0, 0.1, cloudElevation);
      const cloudUV = direction.xz.div(direction.y.mul(elevation)).toVar();
      cloudUV.mulAssign(cloudScale);
      cloudUV.addAssign(U.time.mul(cloudSpeed));
      const evolve = U.time.mul(cloudSpeed).mul(300.0);
      const cloudNoise = fbm(cloudUV.mul(1000.0), evolve).mul(0.7).add(0.5).clamp(0.0, 1.0).toVar();
      const region = noise(cloudUV.mul(300.0)).mul(0.37).add(0.5);
      const cov = clamp(U.cover.add(region.sub(0.5).mul(0.6)), 0.0, 1.0);
      const threshold = sub(1.0, cov).toVar();
      const cloudMask = smoothstep(threshold, threshold.add(0.3), cloudNoise).toVar();
      const horizonFade = smoothstep(0.0, add(0.03, mul(0.06, cloudElevation)), direction.y);
      cloudMask.mulAssign(horizonFade);
      const dayFactor = smoothstep(-0.08, 0.3, vSunDirection.y);
      const sunColor = vSunE.mul(Fex).mul(0.22).mul(0.04).toVar();
      const skyAmbient = Lin.mul(0.04).add(vec3(0.0, 0.0003, 0.00075));
      const depth = max(0.0, cloudNoise.sub(threshold)).toVar();
      const beer = exp(depth.mul(-4.0)).toVar();
      const powder = sub(1.0, beer.mul(beer));
      const shade = mix(0.45, 1.0, beer.mul(powder).mul(2.6).clamp(0.0, 1.0));
      const silver = float(0.51).div(pow(sub(1.49, cosTheta.mul(1.4)), 1.5)).clamp(0.0, 3.0);
      const edge = cloudMask.mul(sub(1.0, cloudMask)).mul(4.0);
      const cloudColor = skyAmbient.add(sunColor.mul(shade)).toVar();
      cloudColor.addAssign(sunColor.mul(silver).mul(edge).mul(0.6));
      // At night the clouds are lit faintly by the moon and the town's glow below.
      cloudColor.mulAssign(dayFactor.max(0.03));
      cloudColor.addAssign(vec3(0.012, 0.011, 0.01).mul(sub(1.0, dayFactor)));
      cloudColor.mulAssign(sub(1.0, U.dark.mul(0.72)));
      cloudColor.addAssign(vec3(0.75, 0.8, 1.0).mul(U.flash).mul(add(0.25, pow(max(dot(direction, U.flashDir), 0.0), 8.0).mul(2.5))).mul(3.0));
      const alpha = sub(1.0, exp(depth.mul(U.density).mul(-12.0))).mul(horizonFade).toVar();
      texColor.subAssign(L0.mul(0.04).mul(alpha));
      const cloudAerial = mix(texColor, cloudColor, Fex);
      texColor.assign(mix(texColor, cloudAerial, alpha));
    });

    // Overcast (grey, no blue), lightning, fog towards the horizon (everywhere in thick fog).
    const skyLum = dot(texColor, vec3(0.2126, 0.7152, 0.0722));
    texColor.assign(mix(texColor, vec3(skyLum).mul(sub(0.72, U.dark.mul(0.4))), U.overcast));
    texColor.addAssign(vec3(0.7, 0.75, 0.9).mul(U.flash).mul(0.5).mul(add(0.3, pow(max(dot(direction, U.flashDir), 0.0), 4.0))));
    // Scale's sky was drawn for an exposure of ~0.55 by day; SimWorld's lit looks are tuned for 1.
    texColor.mulAssign(SKY_GAIN);
    // Past the end of the world, below the horizon: the haze the distant land fades into.
    texColor.assign(mix(texColor, U.fogCol, smoothstep(0.008, -0.012, view.y)));
    const hz = sub(1.0, smoothstep(-0.02, 0.4, direction.y));
    texColor.assign(mix(texColor, U.fogCol, clamp(U.fog.mul(mix(hz, 1.0, U.fog.mul(U.fog))), 0.0, 1.0)));
    return vec4(texColor, 1.0);
  })();
}

/**
 * The clear sky's colour (linear, after the gain) seen towards `dir` with the sun towards `sun` (both unit): the
 * same scattering as the shader above, on the CPU, so the haze the land fades into matches the sky behind it.
 * Without clouds, moon, stars or weather (the day cycle mixes those in).
 */
export function clearSkyColor(dir: { x: number; y: number; z: number }, sun: { x: number; y: number; z: number }, out: Color): Color {
  const TR = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5];
  const MIE = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14];
  const zc = Math.max(-1, Math.min(1, sun.y));
  const sunE = 1000 * Math.max(0, 1 - Math.exp(-(1.6110731556870734 - Math.acos(zc)) / 1.5));
  const sunfade = 1 - Math.max(0, Math.min(1, 1 - Math.exp(sun.y / 450000)));
  const rc = 1.4 - (1 - sunfade);
  const mc = 0.434 * (0.2 * 4 * 10e-18) * 0.004;
  const y = Math.max(dir.y, 0.012);
  const zen = Math.acos(Math.max(0, y));
  const inv = 1 / (Math.cos(zen) + 0.15 * Math.pow(93.885 - (zen * 180) / Math.PI, -1.253));
  const cosT = dir.x * sun.x + y * sun.y + dir.z * sun.z;
  const rPhase = 0.05968310365946075 * (1 + Math.pow(cosT * 0.5 + 0.5, 2));
  const g = 0.8, g2 = g * g;
  const mPhase = 0.07957747154594767 * (1 - g2) / Math.pow(1 - 2 * g * cosT + g2, 1.5);
  const c = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const bR = TR[i] * rc, bM = mc * MIE[i];
    const fex = Math.exp(-(bR * 8.4e3 * inv + bM * 1.25e3 * inv));
    const ratio = (bR * rPhase + bM * mPhase) / (bR + bM);
    let lin = Math.pow(sunE * ratio * (1 - fex), 1.5);
    lin *= 1 + (Math.pow(sunE * ratio * fex, 0.5) - 1) * Math.max(0, Math.min(1, Math.pow(1 - sun.y, 5)));
    c[i] = (lin + 0.1 * fex) * 0.04;
  }
  // The twilight glow, as the shader's `twilightGlow`.
  const tw = twilightAmount(sun.y), low = 1 - smoothstepN(0, 0.35, y), f = 1 - 0.4 * y;
  const side = Math.pow(Math.max(0, (dir.x * sun.x + y * sun.y + dir.z * sun.z) * 0.5 + 0.5), 3);
  const glow = [0.05 * f + 0.3 * side * low, 0.085 * f + 0.13 * side * low, 0.16 * f + 0.04 * side * low].map((v) => v * tw);
  const l = Math.max(c[0], c[1], c[2]);
  const k = l > 0.8 ? (0.8 + 0.4 * (1 - Math.exp(-(l - 0.8)))) / l : 1;
  return out.setRGB((c[0] * k + glow[0]) * SKY_GAIN, (c[1] * k + 0.0003 + glow[1]) * SKY_GAIN, (c[2] * k + 0.00075 + glow[2]) * SKY_GAIN);
}

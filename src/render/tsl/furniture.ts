// @ts-nocheck -- three's TSL typings infer swizzles and vector widths poorly; checked by rendering.
/**
 * The street furniture look (the `FURNITURE` kind; meshes from src/build/furniture.ts): the per
 * vertex material id and sub-material (aFurn.x, aFurn.z) resolved in the shader: steel, paint,
 * timber, concrete, stone, screen-door glass, plastic / foliage, lenses (lamps, traffic and
 * pedestrian signals, charger LEDs), water (falling streaks, ripples), bronze, rubber, signage
 * from the text atlas. Per instance (geometry-instanced): placed by iPose / iSize (`poseByInstance`);
 * iTint: rgb sRGB paint, 0 = the model's own; w = a noise offset so alike props differ. Lamps glow with LIGHT.night; signals cycle on their own.
 * Ported from Scale (src/render/webgpu/furniture.ts), kept close to it; Scale's robot and drone
 * lights and the per-instance signal state stay behind.
 */
import type { MeshStandardNodeMaterial, Texture } from 'three/webgpu';
import {
  Fn, float, int, vec2, vec3, vec4, mix, normalize, max, abs, floor, smoothstep, sub, add, mul, dot, step, sin, cos, pow, clamp, select,
  mod, atan, If, Discard, struct, attribute, varying, texture, positionGeometry, normalGeometry, normalView, cameraViewMatrix,
  screenCoordinate, time,
} from 'three/tsl';
import { h_noise3 as fn } from '@futuremagic/humanoid/three/nodes/peopleNoise';
import { LIGHT, poseByInstance } from './common';
import { setDiffuse } from './ground';

const FurnSurf = struct({ base: 'vec3', rough: 'float', metal: 'float', emis: 'vec3' }, 'FurnitureSurf');

export function furnitureLook(m: MeshStandardNodeMaterial, sign: Texture): void {
  const uNight = LIGHT.night, uTime = time;

  // Vertex.
  const aFurn = attribute('aFurn', 'vec3');
  const vMat = aFurn.x, vEmit = aFurn.y, vSub = aFurn.z;
  const vUvF = attribute('uv', 'vec2');
  const vONrm = varying(normalGeometry, 'vONrm');
  poseByInstance(m);
  const iTint = varying(attribute('iTint', 'vec4'), 'vTint');
  const vPaint = Fn(() => {
    const tint = dot(iTint.xyz, iTint.xyz).greaterThan(0.0).and(vSub.lessThan(8.5))
      .and(vMat.greaterThan(0.5).and(vMat.lessThan(1.5)).or(vMat.greaterThan(5.5).and(vMat.lessThan(6.5))));
    return select(tint, pow(iTint.xyz, vec3(2.2)), attribute('aColor', 'vec3'));
  })();
  const vOPos = varying(positionGeometry, 'vOPos').add(iTint.w);

  const surface = Fn(() => {
    const mid = int(vMat.add(0.5)).toVar();
    const sub_ = int(vSub.add(0.5)).toVar();
    const base = vec3(0.5).toVar();
    const rough = float(0.6).toVar(), metal = float(0.0).toVar();
    const fEmis = vec3(0.0).toVar();
    const n1 = fn(vOPos.mul(7.0)).toVar(), n2 = fn(vOPos.mul(23.0)).toVar(), n0 = fn(vOPos.mul(1.7)).toVar();
    const lightOn = uNight;
    const fc = mod(floor(screenCoordinate.xy), 2.0).toVar();
    // signal phase 0 red / 1 amber / 2 green, cycling (no traffic to follow yet)
    const phase = mod(floor(uTime.div(4.0)), 3.0);
    If(mid.equal(0), () => { // galvanised / stainless steel
      base.assign(vec3(0.56, 0.57, 0.58).mul(add(0.9, mul(0.15, n1)).add(mul(0.06, n2))));
      rough.assign(add(0.32, mul(0.18, n1))); metal.assign(0.85);
    }).ElseIf(mid.equal(1), () => { // painted metal
      base.assign(vPaint.mul(add(0.94, mul(0.08, n2))));
      rough.assign(add(0.38, mul(0.15, n1)).add(mul(0.12, n0).mul(n2))); metal.assign(0.25);
      const scuff = smoothstep(0.78, 0.92, n1.mul(0.6).add(n2.mul(0.4))).mul(0.35).toVar();
      base.assign(mix(base, vec3(0.32, 0.31, 0.3), scuff)); rough.addAssign(scuff.mul(0.3));
    }).ElseIf(mid.equal(2), () => { // timber
      const along = select(abs(vONrm.x).lessThan(0.7), vOPos.x, vOPos.z);
      const grain = fn(vec3(along.mul(2.0), vOPos.y.mul(40.0), vOPos.z.mul(40.0).add(vOPos.x.mul(3.0)))).toVar();
      const rings = add(0.5, mul(0.5, sin(vOPos.y.add(vOPos.z).mul(140.0).add(grain.mul(6.0)))));
      base.assign(vPaint.mul(add(0.68, mul(0.28, grain)).add(mul(0.12, rings))).mul(add(0.85, mul(0.2, n0))));
      rough.assign(add(0.62, mul(0.15, grain)));
    }).ElseIf(mid.equal(3), () => { // concrete
      base.assign(vPaint.mul(add(0.82, mul(0.22, n1)).add(mul(0.1, n2))).mul(sub(1.0, mul(0.25, step(0.86, n2))))); // (pits from the shared noises: each noise call costs build time)
      rough.assign(0.9);
    }).ElseIf(mid.equal(4), () => { // stone (granite / limestone)
      const speck = step(0.82, n2.mul(0.7).add(n1.mul(0.3)));
      base.assign(vPaint.mul(vec3(1.168, 1.098, 1.005)).mul(add(0.82, mul(0.25, n0)).add(mul(0.12, n1)).add(mul(0.06, n2))).mul(sub(1.0, speck.mul(0.3))));
      rough.assign(add(0.72, mul(0.1, n2)));
    }).ElseIf(mid.equal(5), () => { // glass (screen-door transparency)
      If(fc.x.equal(fc.y), () => { Discard(); });
      base.assign(vec3(0.04, 0.05, 0.055));
      rough.assign(0.04); metal.assign(0.6);
    }).ElseIf(mid.equal(6), () => { // plastic / foliage
      base.assign(vPaint);
      rough.assign(add(0.45, mul(0.1, n1)));
      If(sub_.equal(8), () => {
        const leaf = n2.mul(0.6).add(n1.mul(0.4));
        base.assign(vPaint.mul(add(0.55, mul(0.75, leaf))).mul(add(0.8, mul(0.3, n1))));
        rough.assign(0.85);
      });
    }).ElseIf(mid.equal(7), () => { // light lens
      If(sub_.greaterThanEqual(1).and(sub_.lessThanEqual(3)), () => {
        const want = select(sub_.equal(1), float(0.0), select(sub_.equal(2), float(1.0), float(2.0)));
        const lit = select(abs(phase.sub(want)).lessThan(0.5), float(1.0), float(0.0));
        base.assign(vPaint.mul(0.12));
        rough.assign(0.15);
        fEmis.assign(vPaint.mul(vPaint).mul(lit).mul(add(2.2, mul(3.0, uNight))));
      }).ElseIf(sub_.equal(4).or(sub_.equal(5)), () => {
        const walk = select(phase.lessThan(0.5), float(1.0), float(0.0));
        const lit = select(sub_.equal(5), walk, sub(1.0, walk));
        const mask = texture(sign, vUvF).r.toVar();
        base.assign(vec3(0.02).add(vPaint.mul(mask).mul(0.05)));
        rough.assign(0.2);
        fEmis.assign(vPaint.mul(mask).mul(lit).mul(add(3.0, mul(4.0, uNight))));
      }).ElseIf(sub_.equal(10), () => { // charger status light: a steady teal pulse
        const c = vec3(0.12, 0.8, 1.0);
        base.assign(c.mul(0.3));
        rough.assign(0.2);
        fEmis.assign(c.mul(add(0.75, mul(0.25, sin(uTime.mul(2.5).add(iTint.w))))).mul(add(1.4, mul(2.6, uNight))));
      }).ElseIf(sub_.equal(9), () => { // retro-reflective band
        base.assign(vPaint); rough.assign(0.25); metal.assign(0.0);
      }).Else(() => { // lamp: frosted diffuser
        base.assign(vec3(0.82, 0.82, 0.8));
        rough.assign(0.25);
        fEmis.assign(vPaint.mul(vec3(1.0, 0.86, 0.66)).mul(vEmit).mul(lightOn).mul(9.0));
      });
    }).ElseIf(mid.equal(8), () => { // water
      If(sub_.equal(1), () => {
        const ang = atan(vOPos.z, vOPos.x).toVar();
        const streak = fn(vec3(ang.mul(12.0), vOPos.y.mul(6.0).add(uTime.mul(5.0)), 0.0)).toVar();
        If(streak.lessThan(0.42), () => { Discard(); });
        If(streak.lessThan(0.6).and(fc.x.equal(fc.y)), () => { Discard(); });
        base.assign(mix(vec3(0.05, 0.09, 0.1), vec3(0.55, 0.62, 0.64), smoothstep(0.5, 0.85, streak)));
        rough.assign(0.08); metal.assign(0.1);
      }).Else(() => {
        base.assign(vec3(0.025, 0.07, 0.075));
        rough.assign(0.03); metal.assign(0.15);
      });
    }).ElseIf(mid.equal(9), () => { // bronze with verdigris
      const pat = smoothstep(0.35, 0.8, n0.mul(0.5).add(n1.mul(0.3)).add(n2.mul(0.1)).add(max(0.0, vONrm.y).mul(0.3))).toVar();
      base.assign(mix(vec3(0.16, 0.09, 0.045), vec3(0.13, 0.24, 0.19), pat));
      metal.assign(mix(0.85, 0.15, pat)); rough.assign(mix(0.38, 0.75, pat));
    }).ElseIf(mid.equal(10), () => { // rubber
      base.assign(vPaint.mul(add(0.85, mul(0.2, n2))));
      rough.assign(0.95);
    }).ElseIf(mid.equal(11), () => { // signage
      base.assign(texture(sign, vUvF).rgb);
      rough.assign(0.45); metal.assign(0.0);
      If(sub_.equal(7), () => { fEmis.assign(base.mul(vEmit).mul(uNight).mul(1.6).mul(lightOn)); });
    });
    return FurnSurf(base, clamp(rough, 0.02, 1.0), metal, fEmis);
  });

  const S = surface().toVar('furnitureS');
  setDiffuse(m, () => S.get('base'));
  m.roughnessNode = S.get('rough');
  m.metalnessNode = S.get('metal');
  m.emissiveNode = S.get('emis');
  // Still water: ripples in the normal (view space).
  m.normalNode = Fn(() => {
    const nrm = normalView.toVar();
    If(int(vMat.add(0.5)).equal(8).and(vSub.lessThan(0.5)), () => {
      const p = vOPos.xz.mul(3.0).toVar();
      const g = vec2(
        sin(p.x.mul(2.1).add(uTime.mul(1.7))).add(sin(p.y.mul(1.3).sub(uTime.mul(1.3)).add(p.x))),
        cos(p.y.mul(2.4).add(uTime.mul(1.9))).add(sin(p.x.mul(1.7).add(p.y.mul(0.8)).sub(uTime))),
      ).toVar();
      nrm.assign(normalize(nrm.add(cameraViewMatrix.mul(vec4(g.x.mul(0.06), 0.0, g.y.mul(0.06), 0.0)).xyz)));
    });
    return nrm;
  })();
}

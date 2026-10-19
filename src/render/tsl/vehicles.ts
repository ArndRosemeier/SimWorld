// @ts-nocheck -- three's TSL typings infer swizzles and vector widths poorly; checked by rendering.
/**
 * The vehicle look (the `VEHICLE` kind; meshes from src/build/vehicles.ts): the per vertex part
 * id (aPart) picks paint / glass / chrome / tyres / lights; per instance (geometry-instanced) the
 * place (iPose / iSize, tipped by iTilt: pitch and roll on a slope; `poseByInstance`) and the paint (iPaint, sRGB). The state (x headlights, y brake, z indicator −1 left / +1
 * right / ±2 hazards / ±3 emergency, w engine running: daytime running lights) per instance too
 * (iState; all zero for a parked car, the moving traffic's from src/traffic/feed.ts).
 * Ported from Scale (src/render/webgpu/vehicles.ts), kept close to it; Scale's damage (scratches,
 * cracked glass, dents), military paint and the mirrored-instance correction stay behind.
 */
import type { MeshPhysicalNodeMaterial } from 'three/webgpu';
import {
  Fn, float, int, vec2, vec3, mix, min, max, abs, fract, floor, smoothstep, sub, add, mul, dot, step, pow, clamp, select, sign,
  If, struct, attribute, varying, positionGeometry, time,
} from 'three/tsl';
import { h_hash13 as vhHash, h_noise3 as vhNoise } from '@futuremagic/humanoid/three/nodes/peopleNoise';
import { LIGHT, posed, poseByInstance } from './common';
import { WHEEL_PART } from '../../build/vehicles';
import { setDiffuse } from './ground';

const VhSurf = struct({ col: 'vec3', rough: 'float', metal: 'float', cc: 'float', ccr: 'float', emis: 'vec3' }, 'VehicleSurf');

const vhToLinear = Fn(([c]) => mix(c.div(12.92), pow(c.add(0.055).div(1.055), vec3(2.4)), step(0.04045, c)), { c: 'vec3', return: 'vec3' });

export function vehicleLook(mat: MeshPhysicalNodeMaterial): void {
  const uNight = LIGHT.night, uTime = time;
  const aPart = attribute('aPart', 'float');
  // Wheels carry WHEEL_PART (src/build/vehicles.ts) on top of their part: they ride the suspension by the twist
  // (iTilt.z, src/build/drawnGround.ts `Stance`): front right (+X, −Z) and back left up by it, the other two down.
  const wheel = step(WHEEL_PART - 0.5, aPart);
  const vPart = aPart.sub(wheel.mul(WHEEL_PART));
  const vObjPos = varying(positionGeometry, 'vObjPos');
  const vVUv = attribute('uv', 'vec2');
  const corner = sign(positionGeometry.x).mul(sign(positionGeometry.z)).negate();
  const sprung = positionGeometry.add(vec3(0.0, wheel.mul(corner).mul(attribute('iTilt', 'vec3').z), 0.0));
  poseByInstance(mat, posed(sprung, true, true), true);
  const vPaint = varying(vhToLinear(clamp(attribute('iPaint', 'vec3'), 0.0, 1.0)), 'vPaint');
  const vState = varying(attribute('iState', 'vec4'), 'vState');
  const LUM = vec3(0.2126, 0.7152, 0.0722);

  const surface = Fn(() => {
    const vp = int(vPart.add(0.5)).toVar();
    const vhRough = float(0.5).toVar(), vhMetal = float(0.0).toVar(), vhCC = float(0.0).toVar(), vhCCR = float(0.08).toVar();
    const vhEmis = vec3(0.0).toVar();
    const vhCol = vec3(0.5).toVar();
    const head = clamp(vState.x, 0.0, 1.0).toVar();
    const brake = clamp(vState.y, 0.0, 1.0);
    const ind = vState.z.toVar();
    const running = clamp(vState.w, 0.0, 1.0);
    const sideX = select(vObjPos.x.lessThan(0.0), float(-1.0), float(1.0)).toVar();
    const blink = step(0.5, fract(uTime.mul(1.45)));
    If(vp.equal(0).or(vp.equal(13)), () => {
      const pc = vPaint.toVar();
      If(vp.equal(13), () => {
        const l0 = dot(pc, LUM);
        pc.assign(select(l0.greaterThan(0.2), vec3(0.006, 0.03, 0.17), vec3(0.82)));
      });
      const l = dot(pc, LUM).toVar();
      const mxc = max(pc.r, max(pc.g, pc.b)), mnc = min(pc.r, min(pc.g, pc.b));
      const sat = mxc.sub(mnc).div(max(mxc, 1e-3));
      vhMetal.assign(select(sat.lessThan(0.25), select(l.greaterThan(0.05).and(l.lessThan(0.62)), float(0.5), float(0.12)), float(0.3)));
      vhRough.assign(0.3); vhCC.assign(1.0); vhCCR.assign(0.03);
      // (smoothstep(0.6, 0.12, y) = 1 - smoothstep(0.12, 0.6, y): reversed edges are undefined in WGSL)
      const dirt = sub(1.0, smoothstep(0.12, 0.6, vObjPos.y)).mul(add(0.35, mul(0.65, vhNoise(vObjPos.mul(3.0))))).toVar();
      pc.assign(mix(pc, vec3(0.045, 0.04, 0.035), dirt.mul(0.35)));
      vhRough.assign(mix(vhRough, 0.6, dirt.mul(0.5)));
      vhCol.assign(pc);
    }).ElseIf(vp.equal(1), () => {
      vhCol.assign(vec3(0.004, 0.006, 0.007)); vhRough.assign(0.05); vhMetal.assign(0.0); vhCC.assign(1.0); vhCCR.assign(0.02);
    }).ElseIf(vp.equal(2), () => {
      vhCol.assign(vec3(0.92)); vhMetal.assign(1.0); vhRough.assign(0.07);
    }).ElseIf(vp.equal(15), () => {
      vhCol.assign(vec3(0.6, 0.61, 0.63)); vhMetal.assign(1.0); vhRough.assign(0.26);
    }).ElseIf(vp.equal(3), () => {
      vhCol.assign(vec3(0.022)); vhRough.assign(0.86);
      If(vVUv.y.lessThan(-0.5), () => {
        const t = vVUv.y.add(2.0).toVar();
        const zig = fract(vVUv.x.mul(70.0).add(abs(t.sub(0.5)).mul(1.6)));
        const groove = clamp(step(0.86, zig).mul(step(0.1, t)).mul(step(t, 0.9)).add(step(abs(fract(t.mul(2.0)).sub(0.5)), 0.05)), 0.0, 1.0).toVar();
        vhCol.mulAssign(sub(1.0, mul(0.6, groove)));
        vhRough.assign(mix(0.8, 0.95, groove));
      });
    }).ElseIf(vp.equal(4), () => {
      vhCol.assign(vec3(0.018)); vhRough.assign(0.55);
    }).ElseIf(vp.equal(5), () => {
      vhCol.assign(vec3(0.75)); vhMetal.assign(0.85); vhRough.assign(0.1); vhCC.assign(1.0);
      const drl = mul(0.35, sub(1.0, uNight)).mul(running);
      vhEmis.assign(vec3(1.0, 0.95, 0.86).mul(drl.add(head.mul(9.0))));
    }).ElseIf(vp.equal(6), () => {
      vhCol.assign(vec3(0.22, 0.006, 0.006)); vhMetal.assign(0.2); vhRough.assign(0.12); vhCC.assign(1.0);
      vhEmis.assign(vec3(1.0, 0.02, 0.01).mul(add(0.02, mul(0.7, head)).add(mul(2.6, brake))));
    }).ElseIf(vp.equal(8), () => {
      vhCol.assign(vec3(0.42, 0.18, 0.01)); vhMetal.assign(0.2); vhRough.assign(0.12); vhCC.assign(1.0);
      const a = abs(ind).toVar();
      const act = select(a.greaterThan(1.5).and(a.lessThan(2.5)), float(1.0), step(0.5, ind.mul(sideX))).toVar();
      If(a.greaterThan(2.5), () => { act.assign(1.0); });
      vhEmis.assign(vec3(1.0, 0.42, 0.02).mul(10.0).mul(act).mul(blink));
    }).ElseIf(vp.equal(7), () => {
      vhCol.assign(vec3(0.035)); vhRough.assign(0.8);
    }).ElseIf(vp.equal(9), () => {
      const pu = vVUv;
      const border = step(pu.x, 0.025).add(step(0.975, pu.x)).add(step(pu.y, 0.07)).add(step(0.93, pu.y));
      const cx = pu.x.mul(9.0); const ci = floor(cx).toVar(); const f = vec2(fract(cx), pu.y.sub(0.2).div(0.6)).toVar();
      const chars = float(0.0).toVar();
      If(ci.greaterThanEqual(1.0).and(ci.lessThanEqual(7.5)).and(f.y.greaterThan(0.0)).and(f.y.lessThan(1.0)).and(ci.notEqual(3.0)), () => {
        const h = vhHash(vec3(ci, 3.7, floor(vObjPos.z.mul(3.0)))).toVar();
        const stroke = 0.16;
        const vert = step(abs(f.x.sub(0.2)), stroke * 0.5).mul(step(h, 0.7)).add(step(abs(f.x.sub(0.8)), stroke * 0.5).mul(step(0.25, h)));
        const hor = step(0.15, f.x).mul(step(f.x, 0.85)).mul(step(abs(f.y.sub(0.06)), 0.06).add(step(abs(f.y.sub(0.5)), 0.06).mul(step(0.4, h))).add(step(abs(f.y.sub(0.94)), 0.06)));
        chars.assign(clamp(vert.add(hor), 0.0, 1.0));
      });
      vhCol.assign(mix(vec3(0.78, 0.78, 0.74), vec3(0.02), clamp(border.add(chars), 0.0, 1.0)));
      If(pu.x.lessThan(0.085), () => { vhCol.assign(vec3(0.01, 0.04, 0.3)); });
      vhRough.assign(0.4);
      vhEmis.assign(vhCol.mul(0.25).mul(head).mul(uNight));
    }).ElseIf(vp.equal(10), () => {
      vhCol.assign(vec3(0.02)); vhRough.assign(0.92);
    }).ElseIf(vp.equal(11), () => {
      vhCol.assign(vec3(0.9, 0.82, 0.45)); vhRough.assign(0.3); vhCC.assign(1.0);
      vhEmis.assign(vec3(1.0, 0.82, 0.4).mul(add(0.15, mul(2.8, uNight))));
    }).ElseIf(vp.equal(12), () => {
      const lc = select(sideX.lessThan(0.0), vec3(1.0, 0.02, 0.01), vec3(0.02, 0.12, 1.0)).toVar();
      vhCol.assign(lc.mul(0.25)); vhRough.assign(0.1); vhCC.assign(1.0);
      If(abs(ind).greaterThan(2.5), () => {
        const ph = fract(uTime.mul(1.6)).toVar();
        const on = select(sideX.lessThan(0.0), step(ph, 0.5), step(0.5, ph));
        const strobe = step(0.45, fract(uTime.mul(9.0)));
        vhEmis.assign(lc.mul(16.0).mul(on).mul(strobe));
      });
    }).ElseIf(vp.equal(16), () => {
      vhCol.assign(vec3(0.05, 0.35, 0.33)); vhRough.assign(0.1); vhCC.assign(1.0);
      vhEmis.assign(vec3(0.1, 1.0, 0.85).mul(add(0.9, mul(3.5, uNight))).mul(running));
    }).ElseIf(vp.equal(14), () => {
      const rib = smoothstep(0.42, 0.5, abs(fract(vObjPos.z.div(0.31)).sub(0.5)));
      vhCol.assign(vec3(0.8, 0.8, 0.78).mul(sub(1.0, mul(0.12, rib))));
      const dirt = sub(1.0, smoothstep(1.1, 2.0, vObjPos.y)).mul(0.25).add(mul(0.1, vhNoise(vObjPos.mul(2.0))));
      vhCol.assign(mix(vhCol, vec3(0.3, 0.28, 0.25), dirt));
      vhRough.assign(0.45); vhMetal.assign(0.2);
    });
    return VhSurf(vhCol, vhRough, vhMetal, vhCC, vhCCR, vhEmis);
  });

  const S = surface().toVar('vehicleS');
  setDiffuse(mat, () => S.get('col'));
  mat.roughnessNode = S.get('rough');
  mat.metalnessNode = S.get('metal');
  mat.emissiveNode = S.get('emis');
  mat.clearcoatNode = S.get('cc');
  mat.clearcoatRoughnessNode = S.get('ccr');
}

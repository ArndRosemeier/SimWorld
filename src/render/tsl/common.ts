// @ts-nocheck -- three's TSL typings infer swizzles and vector widths poorly; checked by rendering.
/**
 * TSL pieces several looks share: small hashes, the normal-map perturbation from screen
 * derivatives, and the scene's light state as uniforms (night, daylight, lit windows, rain).
 * Ported from Scale (src/render/webgpu/common.ts and src/render/materials/globals.ts); the noise
 * itself comes from `@futuremagic/humanoid/three/nodes/peopleNoise`.
 */
import { Fn, vec3, fract, sin, dot, max, sub, dFdx, dFdy, cross, inverseSqrt, select, sqrt, normalize, uniform } from 'three/tsl';
import { h_hash12 } from '@futuremagic/humanoid/three/nodes/peopleNoise';

/** float → [0, 1) hash. */
export const h11 = Fn(([n]) => fract(sin(n.mul(12.9898).add(4.1414)).mul(43758.5453)), { n: 'float', return: 'float' });
/** vec2 → [0, 1) hash. */
export const h21 = h_hash12;

/** Tangent-space normal (xy, strength) to view space from screen derivatives (no tangents needed). */
export const perturbNormalUV = Fn(([eyePos, N, uv, tn, strength]) => {
  const q0 = dFdx(eyePos), q1 = dFdy(eyePos);
  const st0 = dFdx(uv), st1 = dFdy(uv);
  const q1perp = cross(q1, N), q0perp = cross(N, q0);
  const T = q1perp.mul(st0.x).add(q0perp.mul(st1.x));
  const B = q1perp.mul(st0.y).add(q0perp.mul(st1.y));
  const det = max(dot(T, T), dot(B, B));
  const sc = select(det.equal(0.0), 0.0, inverseSqrt(det));
  const t = tn.mul(strength);
  const mapN = vec3(t, sqrt(max(0.0, sub(1.0, dot(t, t)))));
  return normalize(T.mul(mapN.x.mul(sc)).add(B.mul(mapN.y.mul(sc))).add(N.mul(mapN.z)));
}, { eyePos: 'vec3', N: 'vec3', uv: 'vec2', tn: 'vec2', strength: 'float', return: 'vec3' });

/**
 * The scene's light state, one uniform each, shared by every look that reads it. Daytime values
 * for now; the clock sets them once the day cycle exists (`LIGHT.night.value = …`).
 */
export const LIGHT = {
  /** 0 day … 1 full night. */
  night: uniform(0),
  /** Outdoor light level 0 … 1 (rooms seen through windows). */
  dayLight: uniform(1),
  /** Fraction of home and office windows lit. */
  litFrac: uniform(0.1),
  /** Fraction of shop windows lit. */
  shopLit: uniform(1),
  /** Fraction of café and restaurant windows lit. */
  eatLit: uniform(1),
  /** Wet walls and ground after rain, 0 … 1. */
  wet: uniform(0),
};

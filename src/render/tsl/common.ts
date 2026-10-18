// @ts-nocheck -- three's TSL typings infer swizzles and vector widths poorly; checked by rendering.
/**
 * TSL pieces several looks share: small hashes, the normal-map perturbation from screen
 * derivatives, and the scene's light state as uniforms (night, daylight, lit windows, rain).
 * Ported from Scale (src/render/webgpu/common.ts and src/render/materials/globals.ts); the noise
 * itself comes from `@futuremagic/humanoid/three/nodes/peopleNoise`.
 */
import { Fn, vec3, fract, sin, cos, dot, max, sub, dFdx, dFdy, cross, inverseSqrt, select, sqrt, normalize, uniform, attribute, positionGeometry, normalLocal } from 'three/tsl';
import { Vector3, Vector4, type NodeMaterial } from 'three/webgpu';
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
  /** The street lamps, 0 off … 1 on (night, unless the council switches them off after midnight). */
  lamps: uniform(0),
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
  /** Lying snow, 0 none … 1 a full white cover (from the weather's snow depth). */
  snow: uniform(0),
};

/**
 * The season as the vegetation shows it (src/render/tsl/vegetation.ts), set by the season clock.
 * `leaf` is Scale's autumn turn of the leaves and far canopies; `bare` and `blossom` drop and flower
 * the deciduous trees; `litter` is the fallen leaves on the ground (src/render/tsl/ground.ts).
 */
export const SEASON = {
  /** 0 green … 1 full autumn. */
  leaf: uniform(0),
  /** 0 full … 1 bare. */
  bare: uniform(0),
  /** 0 none … 1 in full blossom. */
  blossom: uniform(0),
  /** Fallen leaves on the town's ground, 0 none … 1 the most (late autumn); snow lies over them. */
  litter: uniform(0),
  /**
   * Each crop's look today (world/landuse `Crop` order, `cropLook`): linear colour and cover (under 0.08 a
   * ploughed field), read by the ground's fields.
   */
  crops: Array.from({ length: 8 }, () => uniform(new Vector4(0.3, 0.3, 0.1, 0.8))),
  /** The fields' average colour (linear), for parcels too far away to resolve. */
  fieldFar: uniform(new Vector3(0.22, 0.24, 0.06)),
};

/**
 * A geometry-instanced copy's placement (`instancedFromData`, src/render/meshes.ts; the
 * attributes src/build/vegetation.ts `INSTANCE_SPECS`: iPose x, y, z, yaw and iSize across, up):
 * `p` scaled, turned by the yaw about +Y (as three's rotation) and moved; `scaled = false` turns
 * a direction only.
 */
export function posed(p, scaled = true) {
  const pose = attribute('iPose', 'vec4'), size = attribute('iSize', 'vec2');
  const c = cos(pose.w), s = sin(pose.w);
  const q = scaled ? p.mul(vec3(size.x, size.y, size.x)) : p;
  const r = vec3(q.x.mul(c).add(q.z.mul(s)), q.y, q.z.mul(c).sub(q.x.mul(s)));
  return scaled ? r.add(pose.xyz) : r;
}

/**
 * Place a kind's geometry-instanced meshes by `posed`: the position (both passes, the shadow's
 * too; `position` if the look moves the posed vertex further, like the wind) and the turned normals.
 */
export function poseByInstance(mat: NodeMaterial, position = posed(positionGeometry)): void {
  mat.positionNode = position;
  const base = mat.setupPosition;
  mat.setupPosition = function (builder) {
    normalLocal.assign(posed(normalLocal, false));
    return base.call(this, builder);
  };
}

/** The look of fresh snow (linear albedo) and of trodden, gritted slush on roads. */
export const SNOW_ALBEDO = [0.86, 0.88, 0.92] as const;
export const SLUSH_ALBEDO = [0.32, 0.31, 0.3] as const;

// @ts-nocheck -- three's TSL typings infer swizzles and vector widths poorly; checked by rendering.
/**
 * The vegetation looks (src/build/vegetation.ts meshes): bark with its atlas and normal map,
 * alpha-tested leaf cards (autumn tints, translucency, crown occlusion), far canopy hulls
 * (noise-dissolved edges), all swaying in the wind. The materials are the `BARK`, `LEAVES` and
 * `TREE_FAR` kinds in src/render/materials.ts; the meshes are instanced (src/render/vegetationView.ts).
 *
 * Instances: geometry instancing (src/render/meshes.ts `instancedFromData`), each copy placed by
 * its iPose / iSize in `positionNode` (which the shadow pass uses too), then swayed by the wind in
 * world space, phased by the instance's position; the main pass turns the normals to match.
 *
 * Ported from Scale (src/render/webgpu/vegetation.ts), with one leaf material for every species
 * (translucency and autumn colour by atlas cell) instead of one per species, and geometry
 * instancing with a yaw and a scale per instance instead of InstancedMesh matrices.
 */
import { PhysicalLightingModel, Vector4, type NodeMaterial, type Texture } from 'three/webgpu';
import {
  Fn, float, int, vec2, vec3, vec4, mix, normalize, max, abs, fract, floor, smoothstep, sub, add, mul, dot, sin, cos, clamp, pow,
  log2, cross, select, If, Discard, attribute, texture, uniform, uniformArray, uv, time, modelWorldMatrix, positionGeometry,
  normalGeometry, normalLocal, positionView, positionViewDirection, normalView, normalViewGeometry, diffuseColor, varying, dFdx, dFdy,
} from 'three/tsl';
import { srgbToLinear } from '@futuremagic/core';
import { SEASON, perturbNormalUV, posed, poseByInstance } from './common';
import { CONIFER_CELLS, LEAF_AUTUMN, LEAF_ATLAS_SIZE } from '../../build/vegetationTex';
import { BARK_STRIPS } from '../../build/vegetation';

/** The vegetation's wind strength (0 calm, 1 breeze, 2 storm); the season is common.ts `SEASON`. */
export const VEG = {
  wind: uniform(0.5),
};

/** The textures the looks sample (src/render/textures.ts `loadVegetationTextures`). */
export interface VegetationTextures { bark: Texture; barkNormal: Texture; leaves: Texture }

// ---------------------------------------------------------------------------------------------
// Wind (Scale's vegWind, in world space)
// ---------------------------------------------------------------------------------------------

const DIR_W = (() => { const l = Math.hypot(1, 0.42); return [1 / l, 0, 0.42 / l]; })();

/** The instance's placement (src/build/vegetation.ts `INSTANCE_SPECS`): scaled, turned by its yaw, moved. */
const place = posed;

/**
 * positionNode: the instance's vertex moved by the wind (`flutter` shakes leaf cards along their
 * normal). The shadow pass draws with it too.
 */
function windPosition(flutter: number) {
  return Fn(() => {
    const p = place(positionGeometry);
    const w = attribute('aWind', 'float');
    const sc = attribute('iSize', 'vec2').y;
    const wo = modelWorldMatrix.mul(vec4(attribute('iPose', 'vec4').xyz, 1.0)).xyz;
    const ph = dot(wo.xz, vec2(0.137, 0.213)).toVar();
    const dir = vec3(DIR_W[0], DIR_W[1], DIR_W[2]);
    const t = time;
    const gust = add(0.55, mul(0.45, sin(t.mul(0.37).add(ph.mul(0.5)))).mul(sin(t.mul(0.23).add(ph.mul(0.9)).add(1.3))));
    const s = VEG.wind.mul(add(0.35, gust)).toVar();
    const w2 = w.mul(w).toVar();
    const sway = add(0.55, mul(0.45, sin(t.mul(1.05).add(ph))));
    const off = dir.mul(s.mul(w2).mul(0.42).mul(sway)).toVar();
    const bp = ph.mul(3.0).add(dot(positionGeometry, vec3(0.45, 0.31, 0.38))).toVar();
    const osc = vec3(sin(t.mul(2.1).add(bp)), mul(0.35, sin(t.mul(2.7).add(bp.mul(1.3)))), sin(t.mul(1.8).add(bp.mul(0.8)).add(1.7)));
    off.addAssign(osc.mul(s.mul(w2).mul(w).mul(0.13).mul(sc)));
    if (flutter !== 0) off.addAssign(place(normalGeometry, false).mul(sin(t.mul(9.0).add(attribute('aLeafTint', 'float').mul(40.0)).add(bp.mul(2.0))).mul(flutter).mul(s).mul(w).mul(0.05).mul(sc)));
    return p.add(vec3(off.x, off.y.sub(dot(off.xz, off.xz).mul(0.12)), off.z));
  })();
}

/** Place a kind's meshes by instance: the wind position (both passes) and, main pass, the turned normals. */
function instanced(mat: NodeMaterial, flutter: number): void {
  poseByInstance(mat, windPosition(flutter));
}

/** Like setDiffuse (tsl/ground.ts) but with a free body run after the default diffuse colour. */
function afterDiffuse(mat: NodeMaterial, body: () => void): void {
  const base = mat.setupDiffuseColor;
  mat.setupDiffuseColor = function (builder) {
    base.call(this, builder);
    body();
  };
}

/** Physical lighting with the crown occlusion and (leaves) the light through the leaves. */
class VegLightingModel extends PhysicalLightingModel {
  constructor(private occ, private trans, private leaf: boolean) { super(); }

  direct(data, builder) {
    super.direct(data, builder);
    if (!this.leaf) return;
    const { lightDirection, lightColor, reflectedLight } = data;
    // Light through the leaves: seen against the light, and wrapped around the crown.
    const bk = pow(clamp(dot(positionViewDirection, lightDirection.negate()), 0.0, 1.0), 6.0);
    const wr = clamp(sub(0.5, mul(0.5, dot(normalView, lightDirection))), 0.0, 1.0);
    reflectedLight.directDiffuse.addAssign(lightColor.mul(diffuseColor.rgb).mul(bk.mul(0.8).add(wr.mul(0.18))).mul(this.trans).mul(sub(1.0, this.occ.mul(0.6))));
  }

  indirect(builder) {
    super.indirect(builder);
    const { reflectedLight } = builder.context;
    if (this.leaf) {
      reflectedLight.indirectDiffuse.mulAssign(sub(1.0, this.occ.mul(0.45)));
      reflectedLight.indirectSpecular.mulAssign(sub(1.0, this.occ.mul(0.8)).mul(0.3));
      // (all direct lights are accumulated before the indirect term)
      reflectedLight.directSpecular.mulAssign(0.45);
    } else {
      reflectedLight.indirectDiffuse.mulAssign(sub(1.0, this.occ.mul(0.5)));
      reflectedLight.indirectSpecular.mulAssign(sub(1.0, this.occ.mul(0.7)));
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Bark
// ---------------------------------------------------------------------------------------------

/** The `BARK` kind's look: uv.x = strip * 16 + u picks the strip of the atlas, aOcc darkens the inner crown. */
export function barkLook(mat: NodeMaterial, tex: VegetationTextures): void {
  instanced(mat, 0);
  const vMapUv = uv();
  const vOcc = attribute('aOcc', 'float');
  const S = float(BARK_STRIPS);
  // The strip's column of the atlas, with the gradients of the unwrapped uv (no seam at the wrap).
  const bStrip = floor(vMapUv.x.div(16.0));
  const bUv = vec2(vMapUv.x.sub(bStrip.mul(16.0)), vMapUv.y);
  const bAt = vec2(bStrip.add(0.012).add(fract(bUv.x).mul(0.976)).div(S), bUv.y);
  const bGx = dFdx(bUv).mul(vec2(float(0.976).div(S), 1.0));
  const bGy = dFdy(bUv).mul(vec2(float(0.976).div(S), 1.0));

  afterDiffuse(mat, () => {
    const c = texture(tex.bark, bAt).grad(bGx, bGy);
    diffuseColor.assign(vec4(diffuseColor.rgb.mul(c.rgb).mul(sub(1.0, vOcc.mul(0.6))), diffuseColor.a));
  });
  mat.normalNode = Fn(() => {
    const m = texture(tex.barkNormal, bAt).grad(bGx, bGy).xyz.mul(2.0).sub(1.0);
    return perturbNormalUV(positionView, normalViewGeometry, vMapUv, m.xy, float(1.1));
  })();
  mat.setupLightingModel = () => new VegLightingModel(vOcc, float(0.0), false);
}

// ---------------------------------------------------------------------------------------------
// Leaves
// ---------------------------------------------------------------------------------------------

/**
 * The `LEAVES` kind's look. The atlas goes in through colorNode (not `map`) so the shadow pass
 * uses the mip-boosted alpha too; the edge-on fade is the opacity (main pass only).
 */
export function leafLook(mat: NodeMaterial, tex: VegetationTextures): void {
  const vTint = attribute('aLeafTint', 'float');
  const vOcc = attribute('aOcc', 'float');
  instanced(mat, 1);
  const autumn = LEAF_AUTUMN.map((a) => new Vector4(srgbToLinear(a[0]), srgbToLinear(a[1]), srgbToLinear(a[2]), a[3]));
  const uAutumn = uniformArray(autumn, 'vec4').setName('uAutumn');
  const vMapUv = uv();
  const cellI = floor(clamp(vMapUv, 0.0, 0.9999).mul(4.0));
  const ci = int(cellI.y).mul(4).add(int(cellI.x));
  const conifer = CONIFER_CELLS.reduce((acc, c) => acc.or(ci.equal(c)), ci.equal(-1));
  const trans = select(conifer, 0.35, 0.85);

  mat.colorNode = Fn(() => {
    const c = texture(tex.leaves, vMapUv).toVar();
    // Keep thin leaves from vanishing in the smaller mips.
    const dxA = dFdx(vMapUv.mul(LEAF_ATLAS_SIZE)), dyA = dFdy(vMapUv.mul(LEAF_ATLAS_SIZE));
    const lodA = max(0.0, mul(0.5, log2(max(dot(dxA, dxA), dot(dyA, dyA)))));
    return vec4(c.rgb, clamp(c.a.mul(add(1.0, lodA.mul(0.32))), 0.0, 1.0));
  })();
  // fade cards seen edge-on (they would read as streaks)
  mat.opacityNode = Fn(() => {
    const fN = normalize(cross(dFdx(positionView), dFdy(positionView)));
    const edgeOn = abs(dot(fN, normalize(positionView)));
    return smoothstep(0.04, 0.32, edgeOn).mul(0.55).add(0.45);
  })();
  afterDiffuse(mat, () => {
    const aut = uAutumn.element(ci).toVar();
    const c = diffuseColor.rgb.toVar();
    const tv = vTint.sub(0.5).toVar();
    c.mulAssign(add(1.0, tv.mul(0.4)));
    c.assign(mix(c, c.mul(vec3(1.12, 1.06, 0.7)), max(tv, 0.0).mul(0.5)));
    const lum = dot(c, vec3(0.3, 0.59, 0.11));
    const turn = clamp(SEASON.leaf.mul(1.6).sub(vTint.mul(0.6)), 0.0, 1.0).mul(aut.a);
    c.assign(mix(c, aut.rgb.mul(lum.mul(3.2).add(0.015)), turn));
    c.mulAssign(sub(1.0, vOcc.mul(0.62)));
    diffuseColor.assign(vec4(c, diffuseColor.a));
  });
  // Crown (spherical) normals on both faces: not flipped on the back side.
  mat.normalNode = normalViewGeometry;
  mat.setupLightingModel = () => new VegLightingModel(vOcc, trans, true);
}

// ---------------------------------------------------------------------------------------------
// Far hulls
// ---------------------------------------------------------------------------------------------

const vhash = Fn(([p0]) => {
  const p = fract(p0.mul(0.3183099).add(0.1)).mul(17.0).toVar();
  return fract(p.x.mul(p.y).mul(p.z).mul(p.x.add(p.y).add(p.z)));
}, { p: 'vec3', return: 'float' });

const vnoise3 = Fn(([x]) => {
  const i = floor(x).toVar();
  const f0 = fract(x);
  const f = f0.mul(f0).mul(sub(3.0, mul(2.0, f0))).toVar();
  return mix(
    mix(mix(vhash(i), vhash(i.add(vec3(1, 0, 0))), f.x), mix(vhash(i.add(vec3(0, 1, 0))), vhash(i.add(vec3(1, 1, 0))), f.x), f.y),
    mix(mix(vhash(i.add(vec3(0, 0, 1))), vhash(i.add(vec3(1, 0, 1))), f.x), mix(vhash(i.add(vec3(0, 1, 1))), vhash(i.add(vec3(1, 1, 1))), f.x), f.y),
    f.z,
  );
}, { x: 'vec3', return: 'float' });

/** The `TREE_FAR` kind's look: vertex colours, noise-dissolved crown edges, autumn by uv.y (deciduous). */
export function farLook(mat: NodeMaterial): void {
  instanced(mat, 0);
  const vAutumn = attribute('aAutumn', 'vec3');
  const vKind = uv();
  const vObjPos = varying(positionGeometry.add(attribute('iPose', 'vec4').xyz.mul(0.37)), 'vObjPos');

  afterDiffuse(mat, () => {
    const nV = normalViewGeometry.toVar();
    const nz = vnoise3(vObjPos.mul(2.2)).mul(0.6).add(vnoise3(vObjPos.mul(5.1)).mul(0.4)).toVar();
    If(vKind.x.greaterThan(0.75), () => {
      const edge = sub(1.0, abs(dot(nV, normalize(positionView.negate()))));
      If(edge.mul(edge).mul(1.25).greaterThan(nz.add(0.12)), () => { Discard(); });
    });
    If(vKind.x.greaterThan(0.25), () => {
      const c = diffuseColor.rgb.mul(add(0.78, nz.mul(0.45))).toVar();
      c.assign(mix(c, vAutumn.mul(add(0.78, nz.mul(0.45))), clamp(SEASON.leaf.mul(1.4).sub(nz.mul(0.4)), 0.0, 1.0).mul(vKind.y)));
      diffuseColor.assign(vec4(c, diffuseColor.a));
    });
  });
}

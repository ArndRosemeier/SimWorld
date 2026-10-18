// @ts-nocheck -- three's TSL typings infer swizzles and vector widths poorly; checked by rendering.
/**
 * The interior look (src/build/interior.ts meshes): one texture array of floor, wall and
 * furniture finishes (src/build/texgen/interior.ts), each layer near neutral and multiplied by the
 * vertex tint (the room's paint, the floor's wood, the sofa's fabric). Layers past the array are
 * lamps: their tint, glowing while `INTERIOR_LIGHT.lamps` is on. One texture fetch pair and a
 * normal perturbation per pixel; no branches on the layer beyond the lamp select.
 *
 * New in SimWorld; the material is made in src/render/materials.ts.
 */
import type { MeshStandardNodeMaterial } from 'three/webgpu';
import { float, int, vec2, min, select, attribute, texture, uniform, uniformArray, positionView, normalView } from 'three/tsl';
import type { MaterialArrays } from '../textures';
import { perturbNormalUV } from './common';
import { setDiffuse } from './ground';

/** Interior light state: `lamps` 0 … 1, how bright the ceiling lamps and lamp shades glow. */
export const INTERIOR_LIGHT = {
  lamps: uniform(1),
};

/** Sets up `mat` as the interior look over the interior texture family; layers from `arrays.layers` on are lamps (src/build/interior.ts `LAMP`). */
export function interiorLook(mat: MeshStandardNodeMaterial, arrays: MaterialArrays): void {
  const n = arrays.layers;
  const uTile = uniformArray(arrays.tileMeters.slice(0, n), 'float').setName('uInteriorTile');
  const vUv = attribute('uv', 'vec2');
  const vLayer = attribute('aLayer', 'float');
  const vTint = attribute('aTint', 'vec3');

  const li = int(vLayer.add(0.5)).toVar();
  const lamp = li.greaterThanEqual(n).toVar();
  const layer = min(li, n - 1).toVar();
  const tuv = vUv.div(uTile.element(layer)).toVar();
  const ar = texture(arrays.albedo, tuv).depth(layer).toVar();
  const nh = texture(arrays.normal, tuv).depth(layer).toVar();
  // The layers average about 0.8: the tint is the surface's colour.
  const albedo = select(lamp, vTint, ar.rgb.mul(vTint).mul(1.25)).toVar();
  const ao = select(lamp, float(1), nh.a).toVar();
  setDiffuse(mat, () => albedo.mul(ao));
  mat.roughnessNode = select(lamp, float(0.5), ar.a);
  mat.metalnessNode = float(0);
  mat.emissiveNode = select(lamp, vTint.mul(INTERIOR_LIGHT.lamps).mul(1.4), vTint.mul(0));
  mat.normalNode = perturbNormalUV(positionView, normalView, tuv, select(lamp, vec2(0), nh.xy.mul(2.0).sub(1.0)), float(1));
}

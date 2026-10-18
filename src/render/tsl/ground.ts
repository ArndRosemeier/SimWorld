// @ts-nocheck -- three's TSL typings infer swizzles and vector widths poorly; checked by rendering.
/**
 * The ground looks as TSL node graphs: natural terrain with the countryside's land use (meadow,
 * forest, the field patchwork), the town's ground surfaces by layer (asphalt, paving, grass, …;
 * src/build/ground.ts `GroundLayer`) and water. Ported from Scale (src/render/webgpu/ground.ts),
 * without its texture arrays for now: the detail is procedural noise, the colours are the
 * textures' averages. The materials themselves are made in src/render/materials.ts.
 */
import type { NodeMaterial } from 'three/webgpu';
import { Vector4 } from 'three/webgpu';
import {
  Fn, float, int, uint, vec2, vec3, vec4, mix, normalize, min, max, abs, fract, floor, fwidth, length, smoothstep, sub, add, mul,
  sin, clamp, select, If, Loop, attribute, uniform, uniformArray, positionWorld, cameraPosition, normalWorldGeometry,
  diffuseColor, cameraViewMatrix, time,
} from 'three/tsl';
import { h_fbm2 as fbm2, h_noise2 as vnoise } from '@futuremagic/humanoid/three/nodes/peopleNoise';
import { WARP_K1, WARP_K2, type ParcelParams } from '../../world/landuse';
import { LIGHT, SEASON, SNOW_ALBEDO, SLUSH_ALBEDO } from './common';

/** Sets the diffuse colour without colorNode (the shadow pass would evaluate colorNode). */
export function setDiffuse(mat: NodeMaterial, node: () => unknown): void {
  const base = mat.setupDiffuseColor;
  mat.setupDiffuseColor = function (builder) {
    base.call(this, builder);
    diffuseColor.assign(vec4(node(), diffuseColor.a));
  };
}

const srgb = (r: number, g: number, b: number) => vec3(...[r, g, b].map((c) => Math.pow(c, 2.2)));

// ---------------------------------------------------------------- the parcel patchwork

/** The seed's parcel grid (world/landuse `parcelParams`), set when a town loads (`setParcels`). */
const P = {
  seed: uniform(uint(0)),
  rot: uniform(new Vector4(1, 0, 200, 140)), // cos, sin, su, sv
  warp: uniform(new Vector4(30, 0, 0, 0)), // warp, ph1, ph2
};
export function setParcels(p: ParcelParams): void {
  P.seed.value = p.seed >>> 0;
  P.rot.value.set(p.cos, p.sin, p.su, p.sv);
  P.warp.value.set(p.warp, p.ph1, p.ph2, 0);
}

/** core's hash32 (lowbias32) and hash2i, as world/landuse's `parcelAt` uses them. */
const lb32 = Fn(([x0]) => {
  const x = uint(x0).toVar();
  x.bitXorAssign(x.shiftRight(16)); x.mulAssign(uint(0x7feb352d));
  x.bitXorAssign(x.shiftRight(15)); x.mulAssign(uint(0x846ca68b));
  x.bitXorAssign(x.shiftRight(16));
  return x;
}, { x: 'uint', return: 'uint' });
const hash2u = (seed, a, b) => lb32(uint(seed).bitXor(lb32(uint(a).mul(uint(0x27d4eb2d)).bitXor(lb32(uint(b).mul(uint(0x165667b1)))))));
const u2f = (h) => float(h.shiftRight(8)).div(16777216.0);

/** x = distance to the parcel's edge (m), y = its id hash, z = row coordinate (m), w = crop (world/landuse `Crop`). */
const parcelAt = Fn(([p]) => {
  const su = P.rot.z, sv = P.rot.w;
  const q = p.add(vec2(sin(p.y.mul(WARP_K1).add(P.warp.y)), sin(p.x.mul(WARP_K2).add(P.warp.z))).mul(P.warp.x));
  const u = q.x.mul(P.rot.x).add(q.y.mul(P.rot.y)), v = q.x.negate().mul(P.rot.y).add(q.y.mul(P.rot.x));
  const vv = v.div(sv);
  const j = int(floor(vv)), fv = vv.sub(floor(vv));
  const off = u2f(hash2u(P.seed, int(7), j)).mul(su);
  const uu = u.add(off).div(su);
  const i = int(floor(uu)), fu = uu.sub(floor(uu));
  const h = hash2u(P.seed, i, j);
  const k = float(uint(1).add(h.mod(uint(3))));
  const fsk = fu.mul(k), si = floor(fsk), fs = fsk.sub(si);
  const id = hash2u(P.seed.bitXor(uint(0x9e37)), i.mul(4).add(int(si)), j);
  const ci = int(id.mod(uint(16)));
  const crop = select(ci.lessThan(3), 0.0, select(ci.equal(3), 1.0, select(ci.lessThan(7), 2.0, select(ci.lessThan(9), 3.0,
    select(ci.lessThan(11), 4.0, select(ci.lessThan(14), 5.0, select(ci.equal(14), 6.0, 7.0)))))));
  const w = su.div(k);
  const border = min(min(fs, sub(1.0, fs)).mul(w), min(fv, sub(1.0, fv)).mul(sv));
  return vec4(border, u2f(id), select(w.lessThan(sv), u, v), crop);
}, { p: 'vec2', return: 'vec4' });

/** A value per crop (world/landuse `Crop` order) as a chain of selects. */
const byCrop = (crop, values: unknown[]) => values.slice(0, -1).reduceRight((rest, v, i) => select(crop.lessThan(i + 0.5), v, rest), values[values.length - 1]);
/** The crop's look today (SEASON.crops, written by the sky from world/landuse `cropLook`): colour, cover. */
const cropLookNow = (crop) => byCrop(crop, SEASON.crops);
const rowPeriod = (crop) => byCrop(crop, [0.17, 0.17, 0.22, 0.75, 0.6, 0.35, 0.35, 0.2]);

// ---------------------------------------------------------------- terrain

/** Natural terrain: grass, dirt on slopes, rock on steep ones, sand on beaches (`aShore`); the countryside's land use from `aLand`. */
export function terrainLook(mat: NodeMaterial): void {
  const S = Fn(() => {
    const wN = normalWorldGeometry.toVar();
    const wPos = positionWorld.toVar();
    const slope = sub(1.0, clamp(wN.y, 0.0, 1.0));
    const n = fbm2(wPos.xz.mul(0.02)).toVar();
    const fine = fbm2(wPos.xz.mul(0.37)).toVar();
    const big = fbm2(wPos.xz.mul(0.0021).add(3.7)).toVar();
    const grass = srgb(0.36, 0.45, 0.2).mul(mix(vec3(1.08, 1.02, 0.78), vec3(0.88, 1.06, 0.84), big)).toVar();
    const dirt = srgb(0.42, 0.34, 0.24);
    const rock = srgb(0.46, 0.44, 0.41);
    const sand = srgb(0.72, 0.65, 0.5);
    const wDirt = smoothstep(0.12, 0.3, slope.add(n.sub(0.5).mul(0.25)));
    const wRock = smoothstep(0.38, 0.6, slope).toVar();
    const wSand = attribute('aShore', 'float');
    const a = mix(grass, dirt, wDirt).toVar();
    a.assign(mix(a, rock, wRock));
    const vLand = attribute('aLand', 'vec4');
    const rural = vLand.x.add(vLand.y).add(vLand.z).toVar();
    If(rural.greaterThanEqual(0.003), () => {
      const camD = length(wPos.sub(cameraPosition));
      const foot = length(fwidth(wPos.xz));
      const meadow = mix(grass, srgb(0.4, 0.5, 0.22).mul(mix(0.88, 1.08, big)), smoothstep(40.0, 320.0, camD).mul(0.85)).toVar();
      const bank = meadow.mul(vec3(0.9, 1.04, 0.86));
      // Forest: litter and moss up close, the canopy's colour from afar.
      const moss = smoothstep(0.35, 0.65, fbm2(wPos.xz.mul(0.09).add(11.0)).add(n.sub(0.5).mul(0.4)));
      const floorC = mix(dirt.mul(vec3(0.6, 0.5, 0.38)), grass.mul(vec3(0.62, 0.78, 0.42)), moss);
      const canopy = srgb(0.2, 0.29, 0.12).mul(mix(0.75, 1.2, fbm2(wPos.xz.mul(0.013)))).mul(mix(0.9, 1.08, big));
      const forest = mix(floorC, canopy, smoothstep(120.0, 700.0, camD));
      // Fields: the parcel patchwork, crop rows (fading out before they alias), tramlines, grass margins.
      const pc = parcelAt(wPos.xz).toVar();
      const crop = pc.w;
      const look = cropLookNow(crop).toVar();
      const pasture = crop.greaterThan(4.5).and(crop.lessThan(5.5)), ploughed = look.w.lessThan(0.08).and(pasture.not());
      const cc = select(pasture, meadow.mul(mix(0.92, 1.1, pc.y)), look.xyz.mul(mix(0.86, 1.12, pc.y)).mul(mix(0.93, 1.05, big)));
      const soil = srgb(0.34, 0.27, 0.19);
      const rowM = pc.z.div(rowPeriod(crop));
      const rows = sub(1.0, smoothstep(0.2, 0.55, fwidth(rowM)));
      const stripe = add(0.5, mul(0.5, sin(rowM.mul(6.2831853))));
      const cover = look.w;
      const soilShare = mix(sub(1.0, cover), mix(sub(1.0, cover), smoothstep(cover.sub(0.15), cover.add(0.15), stripe), 0.75), rows).toVar();
      const field = select(ploughed, cc.mul(mix(1.0, add(0.78, mul(0.4, stripe)), rows)), mix(cc, soil, soilShare)).toVar();
      If(pasture.not().and(ploughed.not()), () => {
        const tm = abs(fract(pc.z.div(18.0)).sub(0.5)).mul(18.0);
        const fwT = fwidth(pc.z);
        field.assign(mix(field, soil.mul(1.05), sub(1.0, smoothstep(0.35, add(0.35, fwT.mul(1.5)), tm)).mul(sub(1.0, smoothstep(0.3, 1.2, fwT))).mul(0.8)));
      });
      const fwB = fwidth(pc.x);
      field.assign(mix(field, meadow.mul(0.95), sub(1.0, smoothstep(1.1, add(1.1, fwB.mul(1.5)), pc.x)).mul(sub(1.0, smoothstep(2.0, 8.0, fwB)))));
      // Too far to resolve the parcels: their average colour.
      field.assign(mix(field, SEASON.fieldFar.mul(mix(0.85, 1.1, big)), smoothstep(25.0, 70.0, foot)));
      const c = vLand.x.mul(forest).add(vLand.y.mul(field)).add(vLand.z.mul(meadow)).div(rural).toVar();
      c.assign(mix(c, bank, clamp(vLand.w.div(rural), 0.0, 1.0)));
      a.assign(mix(a, c, rural.mul(sub(1.0, wRock.mul(0.6)))));
    });
    a.assign(mix(a, sand, wSand));
    a.assign(a.mul(mix(0.85, 1.1, n)).mul(mix(0.92, 1.06, fine)));
    // Rain darkens the ground a little; snow lies on the flat and thins on slopes and under the forest canopy.
    a.mulAssign(sub(1.0, mul(0.18, LIGHT.wet)));
    If(LIGHT.snow.greaterThan(0.001), () => {
      const forest = attribute('aLand', 'vec4').x;
      const lie = smoothstep(0.55, 0.85, wN.y).mul(sub(1.0, mul(0.55, forest))).mul(sub(1.0, wSand.mul(0.7)));
      const patchy = smoothstep(0.15, 0.6, LIGHT.snow.mul(1.3).add(n.sub(0.5).mul(0.5)).sub(fine.mul(0.15)));
      a.assign(mix(a, vec3(...SNOW_ALBEDO).mul(mix(0.9, 1.02, fine)), lie.mul(patchy)));
    });
    return a;
  });
  const albedo = S().toVar('terrainAlbedo');
  setDiffuse(mat, () => albedo);
  mat.roughnessNode = float(0.95);
  mat.metalnessNode = float(0.0);
}

// ---------------------------------------------------------------- the town's ground surfaces

/** Colour and roughness per `GroundLayer` (src/build/ground.ts), the averages of Scale's ground textures. */
const LAYERS: [number, number, number, number][] = [
  [0.2, 0.2, 0.21, 0.85], // Asphalt
  [0.62, 0.6, 0.57, 0.8], // Paving
  [0.66, 0.65, 0.62, 0.75], // Curb
  [0.33, 0.44, 0.2, 0.95], // Grass
  [0.64, 0.59, 0.52, 0.78], // PlazaStone
  [0.45, 0.42, 0.39, 0.82], // Cobble
  [0.56, 0.53, 0.48, 0.95], // Gravel
  [0.7, 0.66, 0.58, 0.8], // Promenade
  [0.3, 0.3, 0.31, 0.85], // AsphaltLight
  [0.85, 0.85, 0.82, 0.6], // PaintWhite
  [0.85, 0.68, 0.2, 0.6], // PaintYellow
  [0.43, 0.35, 0.25, 0.95], // Dirt
  [0.5, 0.48, 0.45, 0.85], // QuayWall
];

/** Streets, sidewalks, plazas, lawns, yards, markings: the layer's colour with procedural variation. */
export function groundLook(mat: NodeMaterial): void {
  const pal = uniformArray(LAYERS.map(([r, g, b, ro]) => new Vector4(r ** 2.2, g ** 2.2, b ** 2.2, ro)), 'vec4');
  const S = Fn(() => {
    const layer = int(attribute('aLayer', 'float').add(0.5)).toVar();
    const p = attribute('uv', 'vec2').toVar();
    const c = pal.element(layer).toVar();
    const macro = fbm2(p.mul(0.035));
    const grain = vnoise(p.mul(3.1));
    const alb = c.rgb.mul(mix(0.86, 1.1, macro)).mul(mix(0.94, 1.05, grain)).toVar();
    If(layer.equal(3), () => { alb.mulAssign(mix(vec3(0.92, 0.95, 0.85), vec3(1.05, 1.0, 1.02), fbm2(p.mul(0.11)))); });
    // Paving joints and cobbles: a faint grid.
    If(layer.equal(1).or(layer.equal(4)).or(layer.equal(5)), () => {
      const s = select(layer.equal(5), 0.25, 0.6);
      const g = abs(fract(p.div(s)).sub(0.5)).mul(2.0);
      alb.mulAssign(mix(1.0, 0.82, smoothstep(0.88, 0.97, max(g.x, g.y))));
    });
    const rough = c.a.toVar();
    // Hard surfaces: asphalt, paving, curbs, plazas, cobbles, promenade, markings, quay walls.
    const soft = layer.equal(3).or(layer.equal(6)).or(layer.equal(11));
    const road = layer.equal(0).or(layer.equal(8)).or(layer.equal(9)).or(layer.equal(10));
    // Rain: hard surfaces darken and turn glossy, puddles gather in the hollows (Scale's wet streets); lawns and
    // gravel only darken.
    If(LIGHT.wet.greaterThan(0.001), () => {
      const dip = fbm2(p.mul(0.15).add(5.3)).add(grain.mul(0.08));
      const pud = select(soft, 0.0, smoothstep(0.7, 0.76, dip.add(LIGHT.wet.mul(0.2)).sub(0.14)).mul(smoothstep(0.45, 0.9, LIGHT.wet)));
      alb.mulAssign(mix(1.0, select(soft, 0.82, 0.62), LIGHT.wet).mul(sub(1.0, mul(0.35, pud))));
      rough.assign(mix(rough, select(soft, rough.mul(0.85), rough.mul(0.38)), LIGHT.wet));
      rough.assign(mix(rough, 0.05, pud));
    });
    // Snow: a white cover on lawns, yards and sidewalks (shovelled thinner), trodden slush on the roads.
    If(LIGHT.snow.greaterThan(0.001), () => {
      const cover = LIGHT.snow.mul(select(soft, 1.0, select(road, 0.4, 0.8)));
      const patchy = smoothstep(0.1, 0.55, cover.mul(1.2).add(macro.sub(0.5).mul(0.5)).sub(grain.mul(0.1)));
      const col = select(road, mix(vec3(...SLUSH_ALBEDO), vec3(...SNOW_ALBEDO), smoothstep(0.55, 0.95, macro).mul(0.6)), vec3(...SNOW_ALBEDO));
      alb.assign(mix(alb, col.mul(mix(0.92, 1.03, grain)), patchy));
      rough.assign(mix(rough, select(road, 0.45, 0.75), patchy));
    });
    return vec4(alb, rough);
  });
  const v = S().toVar('groundS');
  setDiffuse(mat, () => v.rgb);
  mat.roughnessNode = v.a;
  mat.metalnessNode = float(0.0);
}

// ---------------------------------------------------------------- water

/** Animated water: procedural wave normals, a dark green-blue body. */
export function waterLook(mat: NodeMaterial): void {
  const waveGrad = Fn(([p, t]) => {
    const g = vec2(0.0).toVar();
    const a = float(0.5).toVar();
    const dir = vec2(1.0, 0.3).toVar();
    const sc = float(0.35).toVar();
    Loop(4, ({ i }) => {
      const q = p.mul(sc).add(dir.mul(t).mul(add(0.6, mul(0.25, float(i)))));
      const e = 0.07;
      const h0 = vnoise(q), hx = vnoise(q.add(vec2(e, 0.0))), hz = vnoise(q.add(vec2(0.0, e)));
      g.addAssign(vec2(hx.sub(h0), hz.sub(h0)).div(e).mul(a));
      a.mulAssign(0.55);
      sc.mulAssign(1.9);
      dir.assign(vec2(dir.y, dir.x.negate()).mul(1.1));
    });
    return g;
  }, { p: 'vec2', t: 'float', return: 'vec2' });
  mat.normalNode = Fn(() => {
    const wg = waveGrad(positionWorld.xz, time).mul(0.16);
    const nW = normalize(vec3(wg.x.negate(), 1.0, wg.y.negate()));
    return normalize(cameraViewMatrix.mul(vec4(nW, 0.0)).xyz);
  })();
  setDiffuse(mat, () => mix(vec3(0.05, 0.13, 0.14), vec3(0.11, 0.2, 0.2), fbm2(positionWorld.xz.mul(0.01))));
}

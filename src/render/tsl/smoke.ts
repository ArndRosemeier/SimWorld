// @ts-nocheck -- three's TSL typings infer swizzles and vector widths poorly; checked by rendering.
/**
 * Chimney smoke: every chimney (geometry-instanced, `iPose` its top and a random angle, `iSize.x` the plume's
 * scale) carries a few puffs that rise, swell, drift with the wind and fade, one after the other. A chimney
 * smokes while its random is below the share of homes heating (`SMOKE.heat`), so more chimneys smoke as it
 * gets colder and the same ones keep smoking. New in SimWorld.
 *
 * Attributes: `position` is the puff's quad corner (x, y -1 … 1) and its place in the chimney's round (z 0 … 1).
 */
import { Color, Vector3, type NodeMaterial } from 'three/webgpu';
import {
  Fn, vec3, vec4, fract, pow, sin, length, smoothstep, sub, mix, step, attribute, positionGeometry,
  uniform, varyingProperty, cameraProjectionMatrix, cameraViewMatrix,
} from 'three/tsl';

export const SMOKE = {
  /** Share of the chimneys smoking, 0 … 1. */
  heat: uniform(0),
  /** The wind's drift (m/s, horizontal). */
  drift: uniform(new Vector3()),
  /** How fast the smoke rises (m/s). */
  rise: uniform(1.1),
  /** Seconds (wraps every 1000). */
  t: uniform(0),
  alpha: uniform(0),
  col: uniform(new Color(0.8, 0.8, 0.82)),
};

/** Seconds from leaving the chimney to gone. */
const LIFE = 11;

export function smokeLook(m: NodeMaterial): void {
  const U = SMOKE;
  const pose = attribute('iPose', 'vec4'), size = attribute('iSize', 'vec2');
  const corner = positionGeometry;
  const vA = varyingProperty('float', 'vA');
  const vUV = varyingProperty('vec2', 'vUV');
  m.vertexNode = Fn(() => {
    const r = pose.w.mul(0.159155); // the chimney's random, 0 … 1
    const on = step(r, U.heat);
    const age = fract(U.t.div(LIFE).add(corner.z).add(fract(r.mul(17.0)))).toVar();
    const secs = age.mul(LIFE);
    // Up (slowing as it cools) and along the wind; a slow wobble so the puffs do not line up.
    const ph = corner.z.mul(23.0).add(r.mul(61.0));
    const wob = vec3(sin(ph.add(secs.mul(0.7))), 0.0, sin(ph.mul(1.3).add(secs.mul(0.5)))).mul(age.mul(0.9));
    const c = pose.xyz.add(vec3(0.0, pow(age, 0.7).mul(U.rise).mul(LIFE), 0.0)).add(U.drift.mul(secs)).add(wob);
    const s = mix(0.4, 3.4, pow(age, 0.8)).mul(size.x);
    const v = cameraViewMatrix.mul(vec4(c, 1.0)).toVar();
    v.xy.addAssign(corner.xy.mul(s));
    // Fade in at the pot, out as it thins, and far away.
    const far = sub(1.0, smoothstep(900.0, 1800.0, v.z.negate()));
    vA.assign(on.mul(smoothstep(0.0, 0.08, age)).mul(pow(sub(1.0, age), 1.6)).mul(far));
    vUV.assign(corner.xy);
    return cameraProjectionMatrix.mul(v);
  })();
  const puff = sub(1.0, smoothstep(0.25, 1.0, length(vUV)));
  m.fragmentNode = vec4(U.col, vA.mul(U.alpha).mul(puff));
}

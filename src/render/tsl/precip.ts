// @ts-nocheck -- three's TSL typings infer swizzles and vector widths poorly; checked by rendering.
/**
 * Falling rain and snow round the camera, one shader for both (sleet mixes them drop by drop): each drop is a quad
 * that wraps through a box round the camera. A rain drop is a thin streak along its velocity, facing the camera; a
 * snowflake is a small soft disc that drifts and sways as it falls. Ported from Scale (src/render/webgpu/weather.ts,
 * rain streaks as lines); quads instead of lines so the kind warms up like every other mesh kind, and snow is new.
 *
 * Attributes: `position` is the quad corner (x -1 … 1 across, y 0 head … 1 tail), `aDrop` the drop's random
 * (x, y, z in the box, w its own speed and whether it is snow).
 */
import { Color, Vector3, type NodeMaterial } from 'three/webgpu';
import {
  Fn, vec2, vec3, vec4, abs, max, mod, length, smoothstep, sub, add, mul, mix, sin, cross, normalize, step, float,
  attribute, positionGeometry, uniform, varyingProperty, cameraProjectionMatrix, cameraViewMatrix,
} from 'three/tsl';

export const PRECIP = {
  cam: uniform(new Vector3()),
  /** Edge of the box of drops round the camera (m). */
  box: uniform(26),
  /** Rain's velocity (m/s), slanted by the wind. */
  rainVel: uniform(new Vector3(0, -8.5, 0)),
  /** Snow's velocity (m/s). */
  snowVel: uniform(new Vector3(0, -1.1, 0)),
  /** Share of the drops that are snow (0 rain … 1 snow). */
  snow: uniform(0),
  /** Seconds (wraps every 1000). */
  t: uniform(0),
  alpha: uniform(0),
  rainCol: uniform(new Color(0.7, 0.75, 0.8)),
  snowCol: uniform(new Color(0.9, 0.92, 0.95)),
};

export function precipLook(m: NodeMaterial): void {
  const U = PRECIP;
  const aDrop = attribute('aDrop', 'vec4');
  const corner = positionGeometry;
  const vA = varyingProperty('float', 'vA');
  const vSnow = varyingProperty('float', 'vSnow');
  const vUV = varyingProperty('vec2', 'vUV');
  m.vertexNode = Fn(() => {
    const isSnow = step(aDrop.w, U.snow);
    const speed = add(0.9, mul(0.2, aDrop.w));
    const vel = mix(U.rainVel, U.snowVel, isSnow).mul(speed).toVar();
    const o = U.cam.sub(vec3(U.box.mul(0.5))).toVar();
    const head = o.add(mod(aDrop.xyz.mul(U.box).add(vel.mul(U.t)).sub(o), vec3(U.box))).toVar();
    // Snowflakes sway as they fall.
    const ph = aDrop.x.mul(37.0).add(U.t.mul(add(0.8, aDrop.z)));
    head.addAssign(vec3(sin(ph).mul(0.35), 0.0, sin(ph.mul(0.7).add(1.3)).mul(0.35)).mul(isSnow));
    const toCam = normalize(U.cam.sub(head));
    // Rain: a streak along the velocity (tail behind), ~7 mm wide. Snow: a 2–3 cm square facing the camera.
    const along = mix(vel.mul(0.06), vec3(0.0, -0.025, 0.0), isSnow);
    const sideDir = normalize(cross(mix(normalize(vel), vec3(0.0, 1.0, 0.0), isSnow), toCam));
    const width = mix(0.0035, add(0.01, mul(0.008, aDrop.w)), isSnow);
    const p = head.sub(along.mul(corner.y)).add(sideDir.mul(width).mul(corner.x)).add(mix(vec3(0.0), vec3(0.0, 0.0125, 0.0), isSnow));
    // Fade at the box faces (no popping as drops wrap) and right in front of the lens.
    const q = abs(head.sub(U.cam)).div(U.box.mul(0.5));
    const edge = sub(1.0, smoothstep(0.7, 1.0, max(max(q.x, q.y), q.z)));
    const dc = length(head.sub(U.cam)).div(U.box);
    vA.assign(edge.mul(smoothstep(0.03, mix(0.16, 0.06, isSnow), dc)).mul(add(0.55, mul(0.45, aDrop.w))).mul(mix(sub(1.0, mul(0.6, corner.y)), float(1.0), isSnow)));
    vSnow.assign(isSnow);
    vUV.assign(vec2(corner.x, corner.y.mul(2.0).sub(1.0)));
    return cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(p, 1.0));
  })();
  const flake = sub(1.0, smoothstep(0.4, 1.0, length(vUV)));
  const a = vA.mul(U.alpha).mul(mix(float(1.0), flake.mul(2.2), vSnow));
  m.fragmentNode = vec4(mix(U.rainCol, U.snowCol, vSnow), a);
}

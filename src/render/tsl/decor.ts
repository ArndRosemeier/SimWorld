// @ts-nocheck -- three's TSL typings infer swizzles and vector widths poorly; checked by rendering.
/**
 * Holiday decorations seen through a home's window (the facade shader, src/render/tsl/facade.ts), from the
 * building's DECOR_* bits (src/sim/decor.ts, via src/render/windowLight.ts `decorAt`):
 * - on the sill: a jack-o'-lantern for Halloween (its face glows after dark), a Christmas tree with its lights;
 * - along the top of the window: fairy lights at Christmas (orange and purple ones at Halloween), a string of
 *   painted eggs at Easter, bunting for the summer festival.
 * One function inside the facade's one shader; no new material. New in SimWorld.
 */
import { Fn, float, int, vec2, vec3, abs, floor, fract, length, max, min, mix, sin, smoothstep, step, sub, select, If, struct } from 'three/tsl';
import { h11 } from './common';

export const DecorLook = struct({ col: 'vec3', a: 'float', glow: 'vec3' }, 'DecorLook');

const bit = (flags, b: number) => flags.bitAnd(int(b)).notEqual(int(0));

/** Bright bulb colours (Christmas) and Halloween's orange and purple, picked by a hash. */
const bulb = (h, halloween) => select(halloween, mix(vec3(1.0, 0.42, 0.04), vec3(0.55, 0.12, 0.9), step(0.6, h)),
  select(h.lessThan(0.25), vec3(1.0, 0.12, 0.08), select(h.lessThan(0.5), vec3(0.1, 0.9, 0.2), select(h.lessThan(0.75), vec3(0.15, 0.35, 1.0), vec3(1.0, 0.75, 0.2)))));

/**
 * `q`: the point in the window's glass (m from its lower left), `qs` the glass size (m), `flags` the DECOR_* bits,
 * `id` the window's id, `night` 0 … 1.
 */
export const windowDecor = Fn(([q, qs, flags, id, night]) => {
  const col = vec3(0.0).toVar(), a = float(0.0).toVar(), glow = vec3(0.0).toVar();
  const cx = qs.x.mul(0.5).add(h11(id.mul(31.0)).sub(0.5).mul(qs.x).mul(0.3));
  // On the sill.
  If(bit(flags, 4), () => {
    // A Christmas tree: a green cone on a pot, its lights twinkling.
    const th = min(qs.y.mul(0.62), 1.3), ty = q.y.sub(0.08).div(th);
    const half = sub(1.0, ty).mul(th).mul(0.32);
    If(ty.greaterThan(0.0).and(ty.lessThan(1.0)).and(abs(q.x.sub(cx)).lessThan(half)), () => {
      const g = q.div(0.075), cell = floor(g), h = h11(cell.x.mul(7.1).add(cell.y.mul(13.7)).add(id));
      const on = step(length(fract(g).sub(0.5)), 0.2).mul(step(0.45, h));
      const tw = sin(h.mul(40.0)).mul(0.25).add(0.75);
      col.assign(mix(vec3(0.04, 0.2, 0.07), bulb(h11(h.mul(9.0)), false), on));
      glow.assign(bulb(h11(h.mul(9.0)), false).mul(on).mul(tw).mul(night.mul(2.6).add(0.25)));
      a.assign(1.0);
    }).ElseIf(q.y.lessThan(0.08).and(abs(q.x.sub(cx)).lessThan(0.07)), () => {
      col.assign(vec3(0.5, 0.12, 0.08)); a.assign(1.0);
    });
  }).ElseIf(bit(flags, 1), () => {
    // A jack-o'-lantern: an orange ball with a lit face.
    const r = min(0.18, qs.x.mul(0.22)), c = vec2(cx, r.mul(1.05));
    const d = q.sub(c).div(r).mul(vec2(0.85, 1.0));
    If(length(d).lessThan(1.0), () => {
      const rib = abs(sin(d.x.mul(4.0))).mul(0.15).add(0.85);
      const eye = length(vec2(abs(d.x).sub(0.38), d.y.sub(0.22))).lessThan(0.17);
      const mouth = abs(d.y.add(0.3)).lessThan(abs(d.x).mul(-0.25).add(0.14)).and(abs(d.x).lessThan(0.5));
      const face = eye.or(mouth);
      col.assign(select(face, vec3(0.1, 0.05, 0.0), vec3(0.95, 0.42, 0.05).mul(rib)));
      glow.assign(select(face, vec3(1.0, 0.55, 0.12).mul(night.mul(3.0)), vec3(0.0)));
      a.assign(1.0);
    }).ElseIf(length(q.sub(c.add(vec2(0.0, r))).mul(vec2(2.5, 1.0))).lessThan(r.mul(0.3)), () => {
      col.assign(vec3(0.2, 0.3, 0.1)); a.assign(1.0);
    });
  });
  // Along the top: a string that sags between the corners.
  const kind = select(bit(flags, 2), 1, select(bit(flags, 8), 3, select(bit(flags, 16), 4, select(bit(flags, 1), 2, 0))));
  If(kind.greaterThan(0), () => {
    const u = q.x.div(qs.x);
    const gy = qs.y.sub(0.07).sub(sin(u.mul(3.14159)).mul(min(0.1, qs.y.mul(0.08))));
    const step_ = select(kind.equal(4), 0.14, 0.1);
    const k = floor(q.x.div(step_)), h = h11(k.add(id.mul(3.7)));
    const p = vec2(fract(q.x.div(step_)).sub(0.5).mul(step_), q.y.sub(gy));
    // The string itself.
    If(abs(p.y).lessThan(0.006), () => { col.assign(vec3(0.05)); a.assign(max(a, 0.9)); });
    If(kind.lessThan(3), () => {
      // Bulbs.
      If(length(p.sub(vec2(0.0, -0.02))).lessThan(0.018), () => {
        const c = bulb(h, kind.equal(2));
        col.assign(c); a.assign(1.0);
        glow.assign(c.mul(night.mul(3.2).add(0.3)).mul(sin(h.mul(50.0)).mul(0.2).add(0.8)));
      });
    }).ElseIf(kind.equal(3), () => {
      // Painted eggs.
      If(length(p.sub(vec2(0.0, -0.04)).div(vec2(0.022, 0.03))).lessThan(1.0), () => {
        col.assign(mix(mix(vec3(0.95, 0.6, 0.75), vec3(0.6, 0.85, 0.95), step(0.33, h)), vec3(0.98, 0.9, 0.45), step(0.66, h))
          .mul(select(abs(p.y.add(0.04)).lessThan(0.005), 0.75, 1.0)));
        a.assign(1.0);
      });
    }).Else(() => {
      // Bunting: a pennant hanging from each knot.
      const t = p.y.negate().div(0.09);
      If(t.greaterThan(0.0).and(t.lessThan(1.0)).and(abs(p.x).lessThan(sub(1.0, t).mul(0.05))), () => {
        col.assign(select(h.lessThan(0.33), vec3(0.85, 0.1, 0.1), select(h.lessThan(0.66), vec3(0.95, 0.85, 0.2), vec3(0.15, 0.35, 0.8))));
        a.assign(1.0);
      });
    });
  });
  // Soften the edges seen from afar.
  return DecorLook(col, a.mul(smoothstep(0.0, 0.02, min(q.y, qs.y.sub(q.y)))), glow);
});

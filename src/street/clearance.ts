/**
 * Keeping clear of what stands on the ground (src/plan/footprints.ts): a walk's path bent around the trees,
 * lamps, benches, café tables and parked cars on it, and the place to cross a street where no parked car or
 * lamp is in the way. Pure.
 */
import { closestOnPolyline, polylineCum, alongLine, type MeasuredLine } from '../geom/geom2';
import type { Footprints } from '../plan/footprints';

/** A walker's own radius (m), shoulders and a little room. */
export const BODY = 0.3;
/** Spacing (m) at which a path is checked. */
const CHECK = 0.5;
/** The furthest (m) a walk steps aside. */
const SIDESTEP = 3;
/** How far (m) before and after a thing the path starts to bend around it. */
const EASE = 1.5;

/**
 * `path` (x, z, …) bent sideways around everything in `fp` it would walk through. Points the path keeps
 * its own; around a thing it gains points every CHECK metres. Each bend goes to the side that is clear (the
 * nearer one when both are); where neither is (a car parked over the whole sidewalk), to the one that
 * overlaps least.
 */
export function avoid(fp: Footprints, path: number[], body = BODY): number[] {
  const n = path.length >> 1;
  if (n < 2) return path;
  // Dense points with their arc length, normal (left of travel) and whether they are a vertex of the path.
  const xs: number[] = [], zs: number[] = [], ss: number[] = [], nx: number[] = [], nz: number[] = [], vert: boolean[] = [];
  let s = 0;
  for (let i = 0; i + 1 < n; i++) {
    const ax = path[i * 2], az = path[i * 2 + 1], bx = path[i * 2 + 2], bz = path[i * 2 + 3];
    const L = Math.hypot(bx - ax, bz - az);
    const k = Math.max(1, Math.ceil(L / CHECK));
    const ux = L > 1e-6 ? (bx - ax) / L : 0, uz = L > 1e-6 ? (bz - az) / L : 0;
    for (let j = 0; j < k; j++) {
      xs.push(ax + (bx - ax) * (j / k)); zs.push(az + (bz - az) * (j / k)); ss.push(s + (L * j) / k);
      nx.push(-uz); nz.push(ux); vert.push(j === 0);
    }
    s += L;
  }
  xs.push(path[n * 2 - 2]); zs.push(path[n * 2 - 1]); ss.push(s); nx.push(nx[nx.length - 1]); nz.push(nz[nz.length - 1]); vert.push(true);
  const m = xs.length, off = new Float64Array(m);
  let any = false;
  const blockedBy = (i: number, o: number) => {
    const x = xs[i] + nx[i] * o, z = zs[i] + nz[i] * o;
    return fp.overlap(x, z, body) + (fp.insideBuilding(x, z, body) ? 1 : 0);
  };
  const blocked = new Uint8Array(m);
  for (let i = 0; i < m; i++) blocked[i] = blockedBy(i, 0) > 0 ? 1 : 0;
  // Each stretch of blocked points (and what lies within EASE between them) steps aside to one side, the side
  // that clears it with the smaller step: someone does not pass a parked car half on each side.
  for (let i = 0; i < m; i++) {
    if (!blocked[i]) continue;
    let j = i;
    for (let q = i + 1; q < m && ss[q] - ss[j] <= EASE * 2; q++) if (blocked[q]) j = q;
    let bestScore = Infinity, bestSide: number[] = [];
    for (const sign of [1, -1]) {
      const side: number[] = [];
      let score = 0;
      for (let q = i; q <= j; q++) {
        if (!blocked[q]) { side.push(0); continue; }
        let o = 0, least = blockedBy(q, 0);
        for (let k = 1; k <= SIDESTEP / 0.1 && least > 0; k++) {
          const c = blockedBy(q, sign * k * 0.1);
          if (c < least) { least = c; o = sign * k * 0.1; }
        }
        side.push(o);
        score = Math.max(score, Math.abs(o)) + least * 100;
      }
      if (score < bestScore) { bestScore = score; bestSide = side; }
    }
    for (let q = i; q <= j; q++) if (bestSide[q - i] !== 0) { off[q] = bestSide[q - i]; any = true; }
    i = j;
  }
  if (!any) return path;
  // Ease each bend in and out (the largest eased offset wins where bends meet).
  const eased = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    if (off[i] === 0) continue;
    for (let j = i; j >= 0 && ss[i] - ss[j] <= EASE; j--) ease(eased, j, off[i] * (1 - (ss[i] - ss[j]) / EASE));
    for (let j = i + 1; j < m && ss[j] - ss[i] <= EASE; j++) ease(eased, j, off[i] * (1 - (ss[j] - ss[i]) / EASE));
  }
  const out: number[] = [];
  for (let i = 0; i < m; i++) {
    const bent = eased[i] !== 0 || (i > 0 && eased[i - 1] !== 0) || (i + 1 < m && eased[i + 1] !== 0);
    // The ends stay put (doors, the spot they stand on).
    const o = i === 0 || i === m - 1 ? 0 : eased[i];
    // Around a bend every other check point is enough (a metre apart), its first and last kept.
    const edge = bent && ((i > 0 && eased[i - 1] === 0) || (i + 1 < m && eased[i + 1] === 0));
    if (vert[i] || edge || (bent && i % 2 === 0)) out.push(xs[i] + nx[i] * o, zs[i] + nz[i] * o);
  }
  return out;
}

function ease(arr: Float64Array, j: number, v: number): void {
  if (Math.abs(v) > Math.abs(arr[j])) arr[j] = v;
}

/** Is the straight line from (ax, az) to (bx, bz) clear of everything in `fp` for a walker? */
export function lineClear(fp: Footprints, ax: number, az: number, bx: number, bz: number, body = BODY): boolean {
  const L = Math.hypot(bx - ax, bz - az), k = Math.max(1, Math.ceil(L / 0.4));
  for (let j = 0; j <= k; j++) if (fp.overlap(ax + ((bx - ax) * j) / k, az + ((bz - az) * j) / k, body) > 0) return false;
  return true;
}

/**
 * Where to cross from walking line `here` to walking line `there` (the two sides of one street, both oriented
 * the same way): the arc length on `here` nearest to `ideal`, within [lo, hi], whose straight crossing is clear;
 * `ideal` itself when none is. Returns s on `here` and the matching s on `there`.
 */
export function crossing(fp: Footprints, here: number[], there: number[], ideal: number, lo: number, hi: number): [number, number] {
  const H: MeasuredLine = { pts: here, cum: polylineCum(here) }, T: MeasuredLine = { pts: there, cum: polylineCum(there) };
  const at = (s: number): [number, number, number] => {
    const [x, z] = alongLine(H, s);
    const c = closestOnPolyline(there, x, z);
    return [x, z, c.s];
  };
  const s0 = Math.min(hi, Math.max(lo, ideal));
  for (let k = 0; k <= 40; k++) {
    for (const sgn of k ? [-1, 1] : [1]) {
      const s = s0 + sgn * k * 1.5;
      if (s < lo || s > hi) continue;
      const [x, z, t] = at(s);
      const [tx, tz] = alongLine(T, t);
      if (lineClear(fp, x, z, tx, tz)) return [s, t];
    }
  }
  return [s0, at(s0)[2]];
}

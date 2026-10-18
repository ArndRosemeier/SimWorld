/**
 * Keeping clear of what stands on the ground (src/plan/footprints.ts): a walk's path bent around the trees,
 * lamps, benches, café tables and parked cars on it, taken the long way round what it cannot just step aside
 * from (a building, a car park, a fountain), and the place to cross a street where no parked car or lamp is in
 * the way. Pure.
 */
import { MinHeap } from '@futuremagic/core';
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

/** Is the straight line from (ax, az) to (bx, bz) clear of everything in `fp` (props, cars, walls) for a walker? */
export function lineClear(fp: Footprints, ax: number, az: number, bx: number, bz: number, body = BODY): boolean {
  return along(ax, az, bx, bz, (x, z) => free(fp, x, z, body));
}

/** Is the straight line clear of props and cars for a body of radius `body` (walls aside: a walk out of a door)? */
function circlesClear(fp: Footprints, ax: number, az: number, bx: number, bz: number, body: number): boolean {
  return along(ax, az, bx, bz, (x, z) => fp.overlap(x, z, body) === 0);
}

/** Does `ok` hold at every point along the line, LINE_STEP apart? */
function along(ax: number, az: number, bx: number, bz: number, ok: (x: number, z: number) => boolean): boolean {
  const L = Math.hypot(bx - ax, bz - az), k = Math.max(1, Math.ceil(L / LINE_STEP));
  for (let j = 0; j <= k; j++) if (!ok(ax + ((bx - ax) * j) / k, az + ((bz - az) * j) / k)) return false;
  return true;
}
/** Step (m) of the line checks. */
const LINE_STEP = 0.4;

const free = (fp: Footprints, x: number, z: number, body: number): boolean => fp.overlap(x, z, body) === 0 && !fp.insideBuilding(x, z, body);

/** Grid step (m) and margin (m) of a detour's search, and the most cells it searches. */
const GRID = 0.75, MARGIN = 25, MAX_CELLS = 150_000, END = 1, REACH = 1.2;
/** Legs longer than FAR (m) that find no way close by search FAR_MARGIN (m) round. */
const FAR = 8, FAR_MARGIN = 80;
/** The body (m) of someone squeezing through a gap. */
const SQUEEZE = 0.05;

/**
 * A way from (ax, az) to (bx, bz) round whatever stands between them (a building, a car park, a fountain):
 * the straight line when it is clear, else the shortest way over a fine grid of free ground, pulled tight
 * (x, z, … from a to b). Null when there is no way within reach (b is boxed in).
 */
export function detour(fp: Footprints, ax: number, az: number, bx: number, bz: number, body = BODY): number[] | null {
  if (lineClear(fp, ax, az, bx, bz, body)) return [ax, az, bx, bz];
  // Round the thing close by first; a long leg that cuts across a whole block may need to go round it.
  // Last, squeeze through: between two parked cars, sideways.
  return search(fp, ax, az, bx, bz, body, MARGIN) ?? (Math.hypot(bx - ax, bz - az) > FAR ? search(fp, ax, az, bx, bz, body, FAR_MARGIN) : null)
    ?? search(fp, ax, az, bx, bz, SQUEEZE, MARGIN);
}

/** The A* search of `detour` within `margin` m of the two ends; null when there is no way there. */
function search(fp: Footprints, ax: number, az: number, bx: number, bz: number, body: number, margin: number): number[] | null {
  const x0 = Math.min(ax, bx) - margin, z0 = Math.min(az, bz) - margin;
  const nx = Math.ceil((Math.max(ax, bx) + margin - x0) / GRID) + 1, nz = Math.ceil((Math.max(az, bz) + margin - z0) / GRID) + 1;
  if (nx * nz > MAX_CELLS) return null;
  const cx = (i: number) => x0 + (i % nx) * GRID, cz = (i: number) => z0 + Math.floor(i / nx) * GRID;
  // 0 unknown, 1 free, 2 blocked. Near an end that stands against a wall (a door) the wall does not count, so
  // the walk gets out of the door; what stands in front of it still does.
  const state = new Uint8Array(nx * nz);
  const ra = free(fp, ax, az, body) ? 0 : END, rb = free(fp, bx, bz, body) ? 0 : END;
  const nearEnd = (x: number, z: number) => Math.hypot(x - ax, z - az) < ra || Math.hypot(x - bx, z - bz) < rb;
  const open = (i: number) => (state[i] ||= (nearEnd(cx(i), cz(i)) ? fp.overlap(cx(i), cz(i), body) === 0 : free(fp, cx(i), cz(i), body)) ? 1 : 2) === 1;
  // The ends join the grid by a short straight step to a cell they can see (from a door: past the wall, and
  // only just clear of what stands at it).
  const link = (x: number, z: number, i: number, wall: boolean) =>
    Math.hypot(cx(i) - x, cz(i) - z) <= REACH && (wall ? circlesClear(fp, x, z, cx(i), cz(i), 0) : lineClear(fp, x, z, cx(i), cz(i), body));
  const g = new Float64Array(nx * nz).fill(Infinity), from = new Int32Array(nx * nz).fill(-1);
  const estimate = (i: number) => { const dx = Math.abs(cx(i) - bx), dz = Math.abs(cz(i) - bz); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
  const heap = new MinHeap();
  const ix0 = Math.round((ax - x0) / GRID), iz0 = Math.round((az - z0) / GRID), span = Math.ceil(REACH / GRID);
  for (let jz = Math.max(0, iz0 - span); jz <= Math.min(nz - 1, iz0 + span); jz++)
    for (let jx = Math.max(0, ix0 - span); jx <= Math.min(nx - 1, ix0 + span); jx++) {
      const j = jz * nx + jx;
      if (!open(j) || !link(ax, az, j, ra > 0)) continue;
      g[j] = Math.hypot(cx(j) - ax, cz(j) - az);
      heap.push(g[j] + estimate(j), j);
    }
  const steps = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
  let last = -1;
  while (heap.size) {
    const i = heap.pop();
    if (heap.lastPriority > g[i] + estimate(i) + 1e-9) continue; // a stale entry
    if (link(bx, bz, i, rb > 0)) { last = i; break; }
    const ix = i % nx, iz = Math.floor(i / nx);
    for (const [dx, dz, c] of steps) {
      const jx = ix + dx, jz = iz + dz;
      if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
      const j = jz * nx + jx;
      if (!open(j)) continue;
      // No cutting a corner diagonally between two blocked cells.
      if (dx && dz && (!open(iz * nx + jx) || !open(jz * nx + ix))) continue;
      const gj = g[i] + c * GRID;
      if (gj < g[j]) { g[j] = gj; from[j] = i; heap.push(gj + estimate(j), j); }
    }
  }
  if (last < 0) return null;
  const cells: number[] = [];
  for (let i = last; i >= 0; i = from[i]) cells.push(i);
  cells.reverse();
  const pts: number[] = [ax, az];
  for (const c of cells) pts.push(cx(c), cz(c));
  pts.push(bx, bz);
  // Pull it tight: from each kept point straight to the furthest one still in clear sight.
  const out = [pts[0], pts[1]];
  for (let i = 0, n = pts.length >> 1; i < n - 1;) {
    let j = n - 1;
    while (j > i + 1 && !lineClear(fp, pts[i * 2], pts[i * 2 + 1], pts[j * 2], pts[j * 2 + 1], body)) j--;
    out.push(pts[j * 2], pts[j * 2 + 1]);
    i = j;
  }
  return out;
}

/**
 * A path (x, z, …) with every stretch that runs into something (a building, a car park, a fountain) taken round
 * it by `detour`. Bends that stand in something, or in a pocket there is no way into (between parked cars), are
 * dropped (the ends stay: a door, a spot).
 */
export function clearWay(fp: Footprints, path: number[], body = BODY): number[] {
  const n = path.length >> 1, out = [path[0], path[1]];
  let ax = path[0], az = path[1];
  for (let i = 1; i < n; i++) {
    const bx = path[i * 2], bz = path[i * 2 + 1], end = i === n - 1;
    if (!end && !free(fp, bx, bz, body)) continue;
    const d = detour(fp, ax, az, bx, bz, body);
    if (!d && !end) continue;
    if (d) for (let k = 2; k < d.length; k++) out.push(d[k]);
    else out.push(bx, bz);
    ax = bx; az = bz;
  }
  return out;
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

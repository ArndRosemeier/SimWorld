/**
 * Small indexed solids for procedural props (street furniture, src/build/furniture.ts): boxes,
 * cylinders, lathes, spheres, tori, icospheres, planes and tubes along a Catmull-Rom curve, and
 * the 4×4 transforms that place them. Pure (no three.js): each generator follows the vertex
 * layout, normals and winding of the three.js geometry of the same name (BoxGeometry,
 * CylinderGeometry, LatheGeometry, SphereGeometry, TorusGeometry, IcosahedronGeometry,
 * PlaneGeometry, TubeGeometry with a centripetal CatmullRomCurve3), so models ported from Scale
 * (src/props/furniture.ts) come out the same. New in SimWorld.
 */

export type V3 = [number, number, number];

/** An indexed triangle mesh: positions, normals, uvs (flat arrays), triangle indices (CCW outside). */
export interface Prim { pos: number[]; nrm: number[]; uv: number[]; idx: number[] }

const PI = Math.PI;

// ---------------------------------------------------------------- transforms

/** A 4×4 matrix, column-major (as three.js stores it). */
export type Mat4 = number[];

export function identity(): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** Quaternion [x, y, z, w] of Euler angles applied in 'YXZ' order (three's Euler order string). */
export function quatYXZ(x: number, y: number, z: number): [number, number, number, number] {
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 - s1 * s2 * c3,
    c1 * c2 * c3 + s1 * s2 * s3,
  ];
}

/** Quaternion turning unit vector `a` onto unit vector `b` (three's setFromUnitVectors). */
export function quatFromUnit(a: V3, b: V3): [number, number, number, number] {
  let r = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + 1;
  let x: number, y: number, z: number, w: number;
  if (r < 1e-8) {
    r = 0;
    if (Math.abs(a[0]) > Math.abs(a[2])) { x = -a[1]; y = a[0]; z = 0; w = r; } else { x = 0; y = -a[2]; z = a[1]; w = r; }
  } else {
    x = a[1] * b[2] - a[2] * b[1]; y = a[2] * b[0] - a[0] * b[2]; z = a[0] * b[1] - a[1] * b[0]; w = r;
  }
  const l = Math.hypot(x, y, z, w) || 1;
  return [x / l, y / l, z / l, w / l];
}

/** Translation, rotation (quaternion), scale → matrix (three's Matrix4.compose). */
export function compose(p: V3, q: [number, number, number, number], s: V3 = [1, 1, 1]): Mat4 {
  const [x, y, z, w] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
  const [sx, sy, sz] = s;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    p[0], p[1], p[2], 1,
  ];
}

/** Placement as Scale's furniture builder writes it: position, Euler rotation ('YXZ'), scale. */
export function M(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): Mat4 {
  return compose([x, y, z], quatYXZ(rx, ry, rz), [sx, sy, sz]);
}

/** a · b */
export function mul(a: Mat4, b: Mat4): Mat4 {
  const o = new Array<number>(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}

export const rotX = (a: number): Mat4 => M(0, 0, 0, a);
export const rotY = (a: number): Mat4 => M(0, 0, 0, 0, a);
export const rotZ = (a: number): Mat4 => M(0, 0, 0, 0, 0, a);
export const move = (x: number, y: number, z: number): Mat4 => M(x, y, z);

/** The inverse transpose of the upper 3×3 (for normals), row-major [9]. */
function normalMatrix(m: Mat4): number[] {
  const a = m[0], b = m[4], c = m[8], d = m[1], e = m[5], f = m[9], g = m[2], h = m[6], i = m[10];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C || 1;
  // inverse = adj / det; transpose of inverse = cofactor matrix / det (row-major)
  return [A / det, B / det, C / det,
    -(b * i - c * h) / det, (a * i - c * g) / det, -(a * h - b * g) / det,
    (b * f - c * e) / det, -(a * f - c * d) / det, (a * e - b * d) / det];
}

/** `p` transformed in place by `m` (normals by its inverse transpose, renormalised); returns `p`. */
export function xform(p: Prim, m: Mat4): Prim {
  const N = normalMatrix(m);
  for (let i = 0; i < p.pos.length; i += 3) {
    const x = p.pos[i], y = p.pos[i + 1], z = p.pos[i + 2];
    p.pos[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
    p.pos[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    p.pos[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    const nx = p.nrm[i], ny = p.nrm[i + 1], nz = p.nrm[i + 2];
    const ox = N[0] * nx + N[1] * ny + N[2] * nz, oy = N[3] * nx + N[4] * ny + N[5] * nz, oz = N[6] * nx + N[7] * ny + N[8] * nz;
    const l = Math.hypot(ox, oy, oz) || 1;
    p.nrm[i] = ox / l; p.nrm[i + 1] = oy / l; p.nrm[i + 2] = oz / l;
  }
  return p;
}

/** The same solid seen from inside: normals flipped, winding reversed (a new Prim). */
export function flipped(p: Prim): Prim {
  const idx = p.idx.slice();
  for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  return { pos: p.pos.slice(), nrm: p.nrm.map((v) => -v), uv: p.uv.slice(), idx };
}

/** Smooth normals of an indexed mesh: area-weighted face normals summed per vertex (three's computeVertexNormals). */
export function computeNormals(p: Prim): Prim {
  const n = new Array<number>(p.pos.length).fill(0), P = p.pos, I = p.idx;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = P[c] - P[b], uy = P[c + 1] - P[b + 1], uz = P[c + 2] - P[b + 2];
    const vx = P[a] - P[b], vy = P[a + 1] - P[b + 1], vz = P[a + 2] - P[b + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    for (const k of [a, b, c]) { n[k] += cx; n[k + 1] += cy; n[k + 2] += cz; }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
  }
  p.nrm = n;
  return p;
}

// ---------------------------------------------------------------- solids

function prim(): Prim { return { pos: [], nrm: [], uv: [], idx: [] }; }

/** Box centred at the origin (BoxGeometry, one segment per side). */
export function box(w: number, h: number, d: number): Prim {
  const p = prim();
  // u, v axes and the normal of each face, in three's order (+x, -x, +y, -y, +z, -z)
  const face = (u: number, v: number, wAx: number, udir: number, vdir: number, W: number, H: number, D: number) => {
    const base = p.pos.length / 3;
    for (let iy = 0; iy < 2; iy++) for (let ix = 0; ix < 2; ix++) {
      const q: V3 = [0, 0, 0], nn: V3 = [0, 0, 0];
      q[u] = (ix * W - W / 2) * udir;
      q[v] = (iy * H - H / 2) * vdir;
      q[wAx] = D / 2;
      nn[wAx] = D > 0 ? 1 : -1;
      p.pos.push(...q); p.nrm.push(...nn); p.uv.push(ix, 1 - iy);
    }
    const a = base, b = base + 2, c = base + 3, dd = base + 1;
    p.idx.push(a, b, dd, b, c, dd);
  };
  face(2, 1, 0, -1, -1, d, h, w);
  face(2, 1, 0, 1, -1, d, h, -w);
  face(0, 2, 1, 1, 1, w, d, h);
  face(0, 2, 1, 1, -1, w, d, -h);
  face(0, 1, 2, 1, -1, w, h, d);
  face(0, 1, 2, -1, -1, w, h, -d);
  return p;
}

/** CylinderGeometry: centred at the origin (y from -h/2 to h/2), one height segment. */
export function cylinder(rTop: number, rBot: number, h: number, radial = 12, open = false, thetaStart = 0, thetaLen = PI * 2): Prim {
  const p = prim();
  const half = h / 2, slope = (rBot - rTop) / h;
  const rows: number[][] = [];
  for (let y = 0; y <= 1; y++) {
    const row: number[] = [];
    const r = y * (rBot - rTop) + rTop;
    for (let x = 0; x <= radial; x++) {
      const u = x / radial, th = u * thetaLen + thetaStart, s = Math.sin(th), c = Math.cos(th);
      p.pos.push(r * s, -y * h + half, r * c);
      const l = Math.hypot(s, slope, c);
      p.nrm.push(s / l, slope / l, c / l);
      p.uv.push(u, 1 - y);
      row.push(p.pos.length / 3 - 1);
    }
    rows.push(row);
  }
  for (let x = 0; x < radial; x++) {
    const a = rows[0][x], b = rows[1][x], c = rows[1][x + 1], d = rows[0][x + 1];
    p.idx.push(a, b, d, b, c, d);
  }
  if (!open) {
    for (const top of [true, false]) {
      const r = top ? rTop : rBot, sign = top ? 1 : -1;
      if (r <= 0) continue;
      const c0 = p.pos.length / 3;
      for (let x = 1; x <= radial; x++) { p.pos.push(0, half * sign, 0); p.nrm.push(0, sign, 0); p.uv.push(0.5, 0.5); }
      const e0 = p.pos.length / 3;
      for (let x = 0; x <= radial; x++) {
        const th = (x / radial) * thetaLen + thetaStart, s = Math.sin(th), c = Math.cos(th);
        p.pos.push(r * s, half * sign, r * c); p.nrm.push(0, sign, 0); p.uv.push(c * 0.5 + 0.5, s * 0.5 * sign + 0.5);
      }
      for (let x = 0; x < radial; x++) {
        const c = c0 + x, i = e0 + x;
        if (top) p.idx.push(i, i + 1, c); else p.idx.push(i + 1, i, c);
      }
    }
  }
  return p;
}

/** LatheGeometry: the profile [r, y] turned about the y axis (x = r sin φ, z = r cos φ). */
export function lathe(points: [number, number][], segments = 12, phiStart = 0, phiLen = PI * 2): Prim {
  const p = prim();
  const n = points.length;
  // profile normals (three r151+: from the neighbouring segments, averaged inside)
  const nrm: [number, number][] = [];
  let px = 0, py = 0;
  for (let j = 0; j < n; j++) {
    if (j === n - 1) { nrm.push([px, py]); break; }
    const dx = points[j + 1][0] - points[j][0], dy = points[j + 1][1] - points[j][1];
    const cx = dy, cy = -dx;
    if (j === 0) { nrm.push([cx, cy]); px = cx; py = cy; continue; }
    const l = Math.hypot(px + cx, py + cy) || 1;
    nrm.push([(px + cx) / l, (py + cy) / l]);
    px = cx; py = cy;
  }
  for (let i = 0; i <= segments; i++) {
    const phi = phiStart + (i / segments) * phiLen, s = Math.sin(phi), c = Math.cos(phi);
    for (let j = 0; j < n; j++) {
      const [r, y] = points[j];
      p.pos.push(r * s, y, r * c);
      const [nx, ny] = nrm[j], l = Math.hypot(nx, ny) || 1;
      p.nrm.push((nx * s) / l, ny / l, (nx * c) / l);
      p.uv.push(i / segments, j / (n - 1));
    }
  }
  for (let i = 0; i < segments; i++) for (let j = 0; j < n - 1; j++) {
    const a = j + i * n, b = j + i * n + n, c = j + i * n + n + 1, d = j + i * n + 1;
    p.idx.push(a, b, d, c, d, b);
  }
  return p;
}

/** SphereGeometry centred at the origin. */
export function sphere(r: number, ws = 12, hs = 8, phiStart = 0, phiLen = PI * 2, thetaStart = 0, thetaLen = PI): Prim {
  const p = prim();
  const thetaEnd = Math.min(thetaStart + thetaLen, PI);
  const grid: number[][] = [];
  for (let iy = 0; iy <= hs; iy++) {
    const row: number[] = [], v = iy / hs;
    for (let ix = 0; ix <= ws; ix++) {
      const u = ix / ws;
      const x = -r * Math.cos(phiStart + u * phiLen) * Math.sin(thetaStart + v * thetaLen);
      const y = r * Math.cos(thetaStart + v * thetaLen);
      const z = r * Math.sin(phiStart + u * phiLen) * Math.sin(thetaStart + v * thetaLen);
      p.pos.push(x, y, z);
      const l = Math.hypot(x, y, z) || 1;
      p.nrm.push(x / l, y / l, z / l);
      p.uv.push(u, 1 - v);
      row.push(p.pos.length / 3 - 1);
    }
    grid.push(row);
  }
  for (let iy = 0; iy < hs; iy++) for (let ix = 0; ix < ws; ix++) {
    const a = grid[iy][ix + 1], b = grid[iy][ix], c = grid[iy + 1][ix], d = grid[iy + 1][ix + 1];
    if (iy !== 0 || thetaStart > 0) p.idx.push(a, b, d);
    if (iy !== hs - 1 || thetaEnd < PI) p.idx.push(b, c, d);
  }
  return p;
}

/** TorusGeometry in the XY plane centred at the origin. */
export function torus(r: number, tube: number, radialSeg = 8, tubularSeg = 6, arc = PI * 2): Prim {
  const p = prim();
  for (let j = 0; j <= radialSeg; j++) for (let i = 0; i <= tubularSeg; i++) {
    const u = (i / tubularSeg) * arc, v = (j / radialSeg) * PI * 2;
    const x = (r + tube * Math.cos(v)) * Math.cos(u), y = (r + tube * Math.cos(v)) * Math.sin(u), z = tube * Math.sin(v);
    p.pos.push(x, y, z);
    const nx = x - r * Math.cos(u), ny = y - r * Math.sin(u), l = Math.hypot(nx, ny, z) || 1;
    p.nrm.push(nx / l, ny / l, z / l);
    p.uv.push(i / tubularSeg, j / radialSeg);
  }
  for (let j = 1; j <= radialSeg; j++) for (let i = 1; i <= tubularSeg; i++) {
    const a = (tubularSeg + 1) * j + i - 1, b = (tubularSeg + 1) * (j - 1) + i - 1, c = (tubularSeg + 1) * (j - 1) + i, d = (tubularSeg + 1) * j + i;
    p.idx.push(a, b, d, b, c, d);
  }
  return p;
}

const ICO_T = (1 + Math.sqrt(5)) / 2;
const ICO_V = [-1, ICO_T, 0, 1, ICO_T, 0, -1, -ICO_T, 0, 1, -ICO_T, 0, 0, -1, ICO_T, 0, 1, ICO_T, 0, -1, -ICO_T, 0, 1, -ICO_T, ICO_T, 0, -1, ICO_T, 0, 1, -ICO_T, 0, -1, -ICO_T, 0, 1];
const ICO_F = [0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1];

/**
 * IcosahedronGeometry(r, detail) with its vertices welded (one per position), normals from the
 * faces: deform the positions, then `computeNormals` again (Scale's foliage balls).
 */
export function icosphere(r: number, detail: number): Prim {
  const p = prim();
  const key = new Map<string, number>();
  const vert = (x: number, y: number, z: number): number => {
    const l = Math.hypot(x, y, z);
    x = (x / l) * r; y = (y / l) * r; z = (z / l) * r;
    const k = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
    let i = key.get(k);
    if (i === undefined) { i = p.pos.length / 3; key.set(k, i); p.pos.push(x, y, z); p.nrm.push(0, 1, 0); p.uv.push(0, 0); }
    return i;
  };
  const cols = detail + 1;
  for (let f = 0; f < ICO_F.length; f += 3) {
    const A = ICO_F[f] * 3, B = ICO_F[f + 1] * 3, C = ICO_F[f + 2] * 3;
    // three's subdivide: rows of points between A–C and B–C
    const v: number[][] = [];
    for (let i = 0; i <= cols; i++) {
      v[i] = [];
      const ax = ICO_V[A] + (ICO_V[C] - ICO_V[A]) * (i / cols), ay = ICO_V[A + 1] + (ICO_V[C + 1] - ICO_V[A + 1]) * (i / cols), az = ICO_V[A + 2] + (ICO_V[C + 2] - ICO_V[A + 2]) * (i / cols);
      const bx = ICO_V[B] + (ICO_V[C] - ICO_V[B]) * (i / cols), by = ICO_V[B + 1] + (ICO_V[C + 1] - ICO_V[B + 1]) * (i / cols), bz = ICO_V[B + 2] + (ICO_V[C + 2] - ICO_V[B + 2]) * (i / cols);
      const rows = cols - i;
      for (let j = 0; j <= rows; j++) {
        if (j === 0 && i === cols) v[i][j] = vert(ax, ay, az);
        else { const t = j / rows; v[i][j] = vert(ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t); }
      }
    }
    for (let i = 0; i < cols; i++) for (let j = 0; j < 2 * (cols - i) - 1; j++) {
      const k = Math.floor(j / 2);
      if (j % 2 === 0) p.idx.push(v[i][k + 1], v[i + 1][k], v[i][k]);
      else p.idx.push(v[i][k + 1], v[i + 1][k + 1], v[i + 1][k]);
    }
  }
  return computeNormals(p);
}

/** PlaneGeometry in the XY plane facing +Z. */
export function plane(w: number, h: number): Prim {
  const p = prim();
  for (let iy = 0; iy < 2; iy++) for (let ix = 0; ix < 2; ix++) {
    p.pos.push(ix * w - w / 2, -(iy * h - h / 2), 0); p.nrm.push(0, 0, 1); p.uv.push(ix, 1 - iy);
  }
  p.idx.push(0, 2, 1, 2, 3, 1);
  return p;
}

// ---------------------------------------------------------------- tubes along a curve

/** A centripetal Catmull-Rom curve through `pts` (three's CatmullRomCurve3, open), arc-length parametrised. */
export class CatmullRom {
  private lens: number[] = [];
  constructor(readonly pts: V3[]) {
    const D = 200; // three's arcLengthDivisions
    let last = this.raw(0), sum = 0;
    this.lens.push(0);
    for (let i = 1; i <= D; i++) {
      const q = this.raw(i / D);
      sum += Math.hypot(q[0] - last[0], q[1] - last[1], q[2] - last[2]);
      this.lens.push(sum);
      last = q;
    }
  }

  /** Point at curve parameter t (not arc length). */
  raw(t: number): V3 {
    const P = this.pts, l = P.length;
    const p = (l - 1) * t;
    let i = Math.floor(p), w = p - i;
    if (w === 0 && i === l - 1) { i = l - 2; w = 1; }
    const p0: V3 = i > 0 ? P[i - 1] : [2 * P[0][0] - P[1][0], 2 * P[0][1] - P[1][1], 2 * P[0][2] - P[1][2]];
    const p1 = P[i], p2 = P[i + 1];
    const p3: V3 = i + 2 < l ? P[i + 2] : [2 * P[l - 1][0] - P[l - 2][0], 2 * P[l - 1][1] - P[l - 2][1], 2 * P[l - 1][2] - P[l - 2][2]];
    const d = (a: V3, b: V3) => Math.pow((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2, 0.25);
    let dt0 = d(p0, p1), dt1 = d(p1, p2), dt2 = d(p2, p3);
    if (dt1 < 1e-4) dt1 = 1.0;
    if (dt0 < 1e-4) dt0 = dt1;
    if (dt2 < 1e-4) dt2 = dt1;
    const out: V3 = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const x0 = p0[k], x1 = p1[k], x2 = p2[k], x3 = p3[k];
      let t1 = (x1 - x0) / dt0 - (x2 - x0) / (dt0 + dt1) + (x2 - x1) / dt1;
      let t2 = (x2 - x1) / dt1 - (x3 - x1) / (dt1 + dt2) + (x3 - x2) / dt2;
      t1 *= dt1; t2 *= dt1;
      const c0 = x1, c1 = t1, c2 = -3 * x1 + 3 * x2 - 2 * t1 - t2, c3 = 2 * x1 - 2 * x2 + t1 + t2;
      out[k] = c0 + c1 * w + c2 * w * w + c3 * w * w * w;
    }
    return out;
  }

  /** Curve parameter at arc-length fraction u (three's getUtoTmapping). */
  private uToT(u: number): number {
    const L = this.lens, n = L.length, target = u * L[n - 1];
    let lo = 0, hi = n - 1;
    while (lo <= hi) {
      const i = Math.floor(lo + (hi - lo) / 2), c = L[i] - target;
      if (c < 0) lo = i + 1; else if (c > 0) hi = i - 1; else { hi = i; break; }
    }
    const i = hi;
    if (i < 0) return 0;
    if (L[i] === target) return i / (n - 1);
    const a = L[i], b = L[i + 1] ?? a;
    return (i + (b > a ? (target - a) / (b - a) : 0)) / (n - 1);
  }

  /** Point at arc-length fraction u. */
  at(u: number): V3 { return this.raw(this.uToT(u)); }

  /** Unit tangent at arc-length fraction u. */
  tangent(u: number): V3 {
    const t = this.uToT(u), e = 0.0001;
    const a = this.raw(Math.max(0, t - e)), b = this.raw(Math.min(1, t + e));
    const x = b[0] - a[0], y = b[1] - a[1], z = b[2] - a[2], l = Math.hypot(x, y, z) || 1;
    return [x / l, y / l, z / l];
  }
}

/**
 * TubeGeometry: a circle of radius r (radius rEnd at the far end) swept along the curve with
 * Frenet frames (three's computeFrenetFrames, open curve).
 */
export function tube(curve: CatmullRom, segs: number, r: number, radial: number, rEnd = r): Prim {
  const p = prim();
  const T: V3[] = [], N: V3[] = [], B: V3[] = [];
  for (let i = 0; i <= segs; i++) T.push(curve.tangent(i / segs));
  // initial normal: the axis the first tangent is least aligned with
  const t0 = T[0];
  let min = Infinity;
  let nv: V3 = [0, 0, 0];
  const ax = Math.abs(t0[0]), ay = Math.abs(t0[1]), az = Math.abs(t0[2]);
  if (ax <= min) { min = ax; nv = [1, 0, 0]; }
  if (ay <= min) { min = ay; nv = [0, 1, 0]; }
  if (az <= min) nv = [0, 0, 1];
  const crs = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const nrm = (a: V3): V3 => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const vec = nrm(crs(t0, nv));
  N.push(crs(t0, vec)); B.push(crs(t0, N[0]));
  for (let i = 1; i <= segs; i++) {
    let n = N[i - 1];
    const v = crs(T[i - 1], T[i]);
    if (Math.hypot(...v) > Number.EPSILON) {
      const axis = nrm(v);
      const th = Math.acos(Math.max(-1, Math.min(1, T[i - 1][0] * T[i][0] + T[i - 1][1] * T[i][1] + T[i - 1][2] * T[i][2])));
      // rotate n about axis by th (Rodrigues)
      const c = Math.cos(th), s = Math.sin(th), d = axis[0] * n[0] + axis[1] * n[1] + axis[2] * n[2], k = crs(axis, n);
      n = [n[0] * c + k[0] * s + axis[0] * d * (1 - c), n[1] * c + k[1] * s + axis[1] * d * (1 - c), n[2] * c + k[2] * s + axis[2] * d * (1 - c)];
    }
    N.push(n);
    B.push(crs(T[i], n));
  }
  for (let i = 0; i <= segs; i++) {
    const P = curve.at(i / segs), rr = r + (rEnd - r) * (i / segs);
    for (let j = 0; j <= radial; j++) {
      const v = (j / radial) * PI * 2, s = Math.sin(v), c = -Math.cos(v);
      const nx = c * N[i][0] + s * B[i][0], ny = c * N[i][1] + s * B[i][1], nz = c * N[i][2] + s * B[i][2];
      const l = Math.hypot(nx, ny, nz) || 1;
      p.nrm.push(nx / l, ny / l, nz / l);
      p.pos.push(P[0] + rr * nx, P[1] + rr * ny, P[2] + rr * nz);
      p.uv.push(i / segs, j / radial);
    }
  }
  for (let j = 1; j <= segs; j++) for (let i = 1; i <= radial; i++) {
    const a = (radial + 1) * (j - 1) + (i - 1), b = (radial + 1) * j + (i - 1), c = (radial + 1) * j + i, d = (radial + 1) * (j - 1) + i;
    p.idx.push(a, b, d, b, c, d);
  }
  return p;
}

/**
 * The kit landmark structures are built with (ported from Scale, src/plan/landmarkParts.ts): the
 * part primitives (boxes, cylinders, domes, roofs, stands, beams, vaults, flats …), their facade
 * materials, the walkable insides, and the Kit that adds parts in a site's local frame.
 * Pure data; plan/landmarkParts and plan/civicParts build the structures with it.
 */
import { frameToWorld, type Poly } from '../geom/geom2';
import type { Terrain } from '../world/terrain';
import type { Landmark } from './landmarks';

export const enum PK { Box = 0, Cyl = 1, Dome = 2, Gable = 3, Pyramid = 4, Ramp = 5, Beam = 6, Tube = 7, Vault = 8, Flat = 9, Quad = 10, Lathe = 11, Prism = 12, Perf = 13, Helix = 14, Strut = 15 }

/** Surface material: facade atlas layer (walls 0–15, roofs 16–23), tint, facade flags and window grammar. */
export interface PartMat { layer: number; tint: [number, number, number]; flags: number; bay: number; fh: number; gh: number }

export interface LmPart {
  k: PK;
  /** Centre (Beam: start point) and the axis angle of the part (its u = (cos a, sin a)). */
  x: number;
  z: number;
  a: number;
  /** Half sizes along u and v. Ramp: hx at the front (low) edge, hx2 at the back (high) edge. Vault: hz = radius across. Dome: radii. */
  hx: number;
  hz: number;
  hx2?: number;
  /** Bottom and top. Ramp: front edge top yLo, back edge top y1. Dome: y1 = apex (below y0: hanging). Tube: y0/y1 = centre ∓ radius. */
  y0: number;
  y1: number;
  yLo?: number;
  /** Cylinder bottom / top radius (cone: r2 = 0). Tube: radius at -u / +u. Pyramid: r2 = top scale (0 = apex). */
  r?: number;
  r2?: number;
  /** Segments around (cylinders, domes, tubes, vaults). */
  seg?: number;
  /** Ramp: seat rows (stepped top in the near LOD). */
  rows?: number;
  /** Beam end and half thickness. */
  bx?: number;
  by?: number;
  bz?: number;
  w?: number;
  /** Quad: corners (x, y, z) × 4. Ramp: ground corners (x, z) × 4 — front left, front right, back right, back left. */
  q?: number[];
  m: PartMat;
  /** Material of top surfaces and roof slopes (default: m without openings). */
  top?: PartMat;
  /** Ramp: material of the back face (the outer facade of a stand). */
  back?: PartMat;
  /** Collision solid. */
  solid?: boolean;
  /** Close-range detail (left out of the far LOD and the map). */
  detail?: boolean;
  /** Foundation from this height up to y0 (walls standing on uneven ground). */
  foot?: number;
  /** Map category: 0 none, 1 building, 2 paving, 3 lawn / pitch, 4 running track, 5 road. */
  map?: number;
  /** Ramp: no end faces (segments of a ring). Lathe: no caps (a band of a longer body, a balustrade). */
  noSides?: boolean;
  /** Collision only (a simple volume standing in for an open structure): not drawn. */
  hidden?: boolean;
  /** Counts as solid ground cover for the planner and the map (a hollow building's outline) without being a solid. */
  footprint?: boolean;
  /**
   * Lathe: profile (r, y) pairs, bottom to top (closed when the last pair repeats the first: a
   * ring), radii scaled by hx along u and hz along v. Prism: outline (u, y) pairs in the part's
   * frame (u along its axis), extruded ±hz across. Perf: holes (u, y, radius) through the slab
   * along v.
   */
  pts?: number[];
  /** Helix: turns (the sign is the sense of rotation, + counter-clockwise from above). */
  turns?: number;
  /** Helix: clear height of the walkway. */
  hh?: number;
  /** Clear glass: drawn by the transparent glass mesh, not the facade one. */
  clear?: boolean;
  /** A floor to walk on however thin (PartObstacle.deck). */
  deck?: boolean;
  /** Vault, dome, cylinder: seen from inside (the faces turned inward, no end caps). */
  inward?: boolean;
  /** Dome or cylinder: only the half on the part's +v side (an apse's half dome or roof). */
  half?: boolean;
  /**
   * Inward dome as pendentives: the sphere through the corners of the square ±hx × ±hz (from y0
   * there) cut by the square's sides, up to the ring of radius r it reaches at y1.
   */
  pend?: boolean;
  /**
   * Window glass of a breakable landmark: diced into pieces of its own (beside the wall's in the
   * same grid cell) that break as easily as glass and hold nothing up. Its collision box (a
   * hidden solid) goes with them.
   */
  pane?: boolean;
  /**
   * Part of a walkable inside that the outside hides (a hall's galleries, rooms and furniture):
   * built into a mesh of its own (build/landmarks) that is only drawn close by.
   */
  inner?: boolean;
  /**
   * A box one can walk into (SimWorld): its storeys (the material's ground floor height `gh`, then `fh` each). The
   * interior planner furnishes it for the landmark's kind (src/interior/landmark.ts).
   */
  body?: number;
  /**
   * A clock face (a thin box): its dial looks out on the part's +v side (1) or -v side (-1). The
   * hands are not parts: the signs draw the time on it (src/plan/signs.ts `clockSpots`).
   */
  clock?: 1 | -1;
}

/** A walkable inside (the town hall's): its outline, height range and where its room lights hang. */
export interface LmRoom {
  /** Outline (world, CCW). */
  poly: Poly;
  y0: number;
  y1: number;
}

export interface LmInterior {
  rooms: LmRoom[];
  /** Light positions (x, y, z world). */
  lights: number[];
  /** Where people walk: a graph of points (x, y, z world) and their links (sim/LandmarkCrowds). */
  nav: number[];
  links: number[][];
  /** Ways out: a nav point at a door and the points on from it (x, y, z …) down to the square. */
  exits: { node: number; pts: number[] }[];
  /** Where people sit or stand, and who. */
  spots: LmSpot[];
}

/** Who uses a spot inside a landmark: visitors and the faithful, and the people who work there. */
export type SpotWho = 'visitor' | 'faithful' | 'priest' | 'server' | 'clerk' | 'client' | 'mayor' | 'aide' | 'councillor' | 'registrar' | 'couple' | 'guest' | 'porter';

/** A place to sit or stand inside a landmark (world), reached from a nav point over `via` (x, z pairs). */
export interface LmSpot {
  x: number; y: number; z: number;
  /** Facing (PedAgent.heading convention). */
  h: number;
  sit: boolean;
  who: SpotWho;
  node: number;
  via: number[];
  /** Where they look (x, y, z) while there: a window, the dome, a portrait. */
  look?: [number, number, number];
}

/** A solid for the walker (same shape as world/Collision's Obstacle). */
export interface PartObstacle {
  cyl: boolean;
  x: number; z: number;
  r: number;
  hx: number; hz: number;
  ux: number; uz: number;
  y0: number; y1: number;
  /** Broken away (breakable landmarks: world/LandmarkSolids). */
  dead?: boolean;
  /** Window glass (LmPart.pane): follows the glass pieces, not the wall's. */
  pane?: boolean;
  /** Walkable however thin (world/Collision: ground for any walker). */
  deck?: boolean;
  /** A ramp's walking surface (world/Collision Obstacle.floorAt). */
  floorAt?: (x: number, z: number, top: number) => number;
}

// Facade flags (build/buildingShell FF): windows, curtain wall, arched, roof, front, stained glass.
export const WIN = 1, CURTAIN = 4, ARCH = 8, ROOF = 128, GLOW = 4096;
// Wall layers (plan/building WallMat) and roof layers (16 + RoofMat).
export const BRICK = 0, BRICK_BROWN = 1, LIME = 4, SAND = 5, PLASTER = 6, STUCCO = 7, CONC = 8, PANEL = 9, GLASS = 10, METAL = 11, GRANITE = 13, BRICK_WHITE = 15;
export const TAR = 16, CLAY = 17, SLATE = 18, ZINC = 19, ASPHALT = 20, METAL_ROOF = 21, GRAVEL = 22, GREEN_ROOF = 23;

export type RGB = [number, number, number];
export const mat = (layer: number, tint: RGB = [1, 1, 1], flags = 0, bay = 3, fh = 4, gh = 4.5): PartMat => ({ layer, tint, flags, bay, fh, gh });
export const WHITE: RGB = [1, 1, 1];
export const COPPER: RGB = [0.48, 0.72, 0.62];
export const GOLD: RGB = [1.25, 1.0, 0.45];
export const BRONZE: RGB = [0.55, 0.42, 0.3];
/** Paint colours (team colours, wheels, liveries). */
export const PAINT: RGB[] = [[0.85, 0.15, 0.12], [0.15, 0.3, 0.75], [0.95, 0.8, 0.15], [0.15, 0.6, 0.3], [0.95, 0.95, 0.95], [0.55, 0.15, 0.55], [0.95, 0.45, 0.1], [0.12, 0.12, 0.14]];
export const STONES = [LIME, SAND, GRANITE, BRICK_WHITE];

export interface Opt {
  /** Turn relative to the current frame. */
  rot?: number;
  top?: PartMat;
  back?: PartMat;
  solid?: boolean;
  detail?: boolean;
  /** true: a foundation down to the site's lowest ground; a number: down to that height. */
  foot?: boolean | number;
  map?: number;
  seg?: number;
  /** Clear glass (see LmPart.clear). */
  clear?: boolean;
  /** Walkable however thin (LmPart.deck). */
  deck?: boolean;
  /** The walk-in box, with this many storeys (LmPart.body). */
  body?: number;
}

/** Builds parts in a local frame (nested frames for sub-assemblies like planes). */
export class Kit {
  readonly parts: LmPart[] = [];
  readonly inside: LmInterior = { rooms: [], lights: [], nav: [], links: [], exits: [], spots: [] };
  private ox: number;
  private oz: number;
  private oa: number;
  /** Floor level and the foundation bottom. */
  readonly B: number;
  readonly F: number;

  constructor(readonly lm: Landmark, readonly T: Terrain) {
    this.ox = lm.x; this.oz = lm.z; this.oa = lm.angle;
    this.B = lm.base;
    this.F = lm.low - 0.4;
  }

  W(u: number, v: number): [number, number] {
    return frameToWorld({ x: this.ox, z: this.oz, angle: this.oa }, u, v);
  }

  /** Natural ground at a local point. */
  ground(u: number, v: number): number {
    const [x, z] = this.W(u, v);
    return this.T.height(x, z);
  }

  /** Lowest ground under a local rectangle (for walls that follow the terrain). */
  groundMin(u: number, v: number, hu: number, hv: number, rot = 0): number {
    let m = Infinity;
    const c = Math.cos(rot), s = Math.sin(rot);
    for (const [a, b] of [[0, 0], [-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) m = Math.min(m, this.ground(u + a * hu * c - b * hv * s, v + a * hu * s + b * hv * c));
    return m;
  }

  groundMax(u: number, v: number, hu: number, hv: number, rot = 0): number {
    let m = -Infinity;
    const c = Math.cos(rot), s = Math.sin(rot);
    for (const [a, b] of [[0, 0], [-1, -1], [1, -1], [1, 1], [-1, 1]]) m = Math.max(m, this.ground(u + a * hu * c - b * hv * s, v + a * hu * s + b * hv * c));
    return m;
  }

  /** Run `fn` in a sub-frame at (u, v) turned by rot. */
  sub(u: number, v: number, rot: number, fn: () => void): void {
    const [x, z] = this.W(u, v);
    const s = [this.ox, this.oz, this.oa] as const;
    this.ox = x; this.oz = z; this.oa += rot;
    fn();
    [this.ox, this.oz, this.oa] = s;
  }

  private foot(o: Opt): number | undefined {
    return o.foot === true ? this.F : typeof o.foot === 'number' ? o.foot : undefined;
  }

  private add(k: PK, u: number, v: number, p: Partial<LmPart> & { hx: number; hz: number; y0: number; y1: number; m: PartMat }, o: Opt, solid: boolean, map: number): LmPart {
    const [x, z] = this.W(u, v);
    const part: LmPart = {
      k, x, z, a: this.oa + (o.rot ?? 0), ...p,
      top: o.top, back: o.back, solid: o.solid ?? (solid && !o.detail && !o.clear), detail: o.detail, foot: this.foot(o),
      map: o.map ?? (o.detail ? 0 : map), seg: o.seg ?? p.seg,
    };
    if (o.clear) part.clear = true;
    if (o.deck) part.deck = true;
    if (o.body) part.body = o.body;
    this.parts.push(part);
    return part;
  }

  box(u: number, v: number, hu: number, hv: number, y0: number, y1: number, m: PartMat, o: Opt = {}): LmPart {
    return this.add(PK.Box, u, v, { hx: hu, hz: hv, y0, y1, m }, o, true, 1);
  }

  /**
   * A square clock face of half size `half` centred at height `y` on the wall through (u, v) whose
   * outside is (ou, ov) (a unit axis of the frame): a light plate the signs draw the dial and the
   * time on.
   */
  clockFace(u: number, v: number, ou: number, ov: number, half: number, y: number): LmPart {
    const rot = ou !== 0 ? Math.PI / 2 : 0;
    const f = this.box(u + ou * 0.12, v + ov * 0.12, half, 0.12, y - half, y + half, mat(PLASTER, [1.15, 1.12, 1.02]), { rot, detail: true, solid: false });
    // Outward along the part's v, which is (-sin rot, cos rot) in the frame.
    f.clock = -ou * Math.sin(rot) + ov * Math.cos(rot) >= 0 ? 1 : -1;
    return f;
  }

  cyl(u: number, v: number, r: number, r2: number, y0: number, y1: number, m: PartMat, o: Opt = {}): LmPart {
    return this.add(PK.Cyl, u, v, { hx: r, hz: r, r, r2, y0, y1, m, seg: 20 }, o, true, 1);
  }

  /** Half ellipsoid with radii (rx, rz), springing at y0, apex at y1 (below y0: hanging). */
  dome(u: number, v: number, rx: number, rz: number, y0: number, y1: number, m: PartMat, o: Opt = {}): LmPart {
    return this.add(PK.Dome, u, v, { hx: rx, hz: rz, y0, y1, m, seg: 20 }, o, false, 0);
  }

  /** Gable roof over a rectangle, ridge along the part's u (hu along it; with rot π/2 along the frame's v): eaves at y0, ridge at y1 (gable ends in m, slopes in top). */
  gable(u: number, v: number, hu: number, hv: number, y0: number, y1: number, m: PartMat, top: PartMat, o: Opt = {}): LmPart {
    return this.add(PK.Gable, u, v, { hx: hu, hz: hv, y0, y1, m }, { ...o, top }, false, 0);
  }

  /** Pyramid / spire / hipped roof: rectangle at y0 tapering to `t` of its size at y1. */
  pyramid(u: number, v: number, hu: number, hv: number, y0: number, y1: number, t: number, m: PartMat, o: Opt = {}): LmPart {
    return this.add(PK.Pyramid, u, v, { hx: hu, hz: hv, y0, y1, r2: t, m }, o, false, 0);
  }

  /** Sloped stand: front edge (-v) of half length hu at yLo, back edge (+v) of half length hu2 at y1. */
  ramp(u: number, v: number, hu: number, hu2: number, hv: number, y0: number, yLo: number, y1: number, rows: number, m: PartMat, o: Opt & { noSides?: boolean } = {}): LmPart {
    const p = this.add(PK.Ramp, u, v, { hx: hu, hx2: hu2, hz: hv, y0, yLo, y1, rows, m }, o, true, 1);
    p.noSides = o.noSides;
    return p;
  }

  /** Sloped stand on a quadrilateral (local corners: front left, front right, back right, back left). */
  rampQ(c: [number, number][], y0: number, yLo: number, y1: number, rows: number, m: PartMat, o: Opt & { noSides?: boolean } = {}): LmPart {
    const w = c.map(([u, v]) => this.W(u, v));
    const fx = (w[1][0] - w[0][0]), fz = (w[1][1] - w[0][1]);
    const cu = (c[0][0] + c[1][0] + c[2][0] + c[3][0]) / 4, cv = (c[0][1] + c[1][1] + c[2][1] + c[3][1]) / 4;
    const dm = Math.hypot((w[2][0] + w[3][0] - w[0][0] - w[1][0]) / 2, (w[2][1] + w[3][1] - w[0][1] - w[1][1]) / 2);
    const p = this.add(PK.Ramp, cu, cv, {
      hx: Math.hypot(fx, fz) / 2, hx2: Math.hypot(w[2][0] - w[3][0], w[2][1] - w[3][1]) / 2, hz: dm / 2, y0, yLo, y1, rows, m,
      q: w.flat(),
    }, { ...o, rot: Math.atan2(fz, fx) - this.oa }, true, 1);
    p.noSides = o.noSides;
    return p;
  }

  beam(u0: number, v0: number, y0: number, u1: number, v1: number, y1: number, w: number, m: PartMat, o: Opt = {}): LmPart {
    const [bx, bz] = this.W(u1, v1);
    return this.add(PK.Beam, u0, v0, { hx: 0, hz: 0, y0, y1: y0, bx, by: y1, bz, w, m }, o, false, 0);
  }

  /** Horizontal cylinder along u (centre height y, half length hu), radius r at -u and r2 at +u. */
  tube(u: number, v: number, y: number, hu: number, r: number, r2: number, m: PartMat, o: Opt = {}): LmPart {
    return this.add(PK.Tube, u, v, { hx: hu, hz: Math.max(r, r2), r, r2, y0: y - Math.max(r, r2), y1: y + Math.max(r, r2), m, seg: 14 }, o, false, 0);
  }

  /** Barrel vault along u over a strip 2 hv wide, springing at y0, crown at y1. */
  vault(u: number, v: number, hu: number, hv: number, y0: number, y1: number, m: PartMat, o: Opt = {}): LmPart {
    return this.add(PK.Vault, u, v, { hx: hu, hz: hv, y0, y1, m, seg: 14 }, o, true, 1);
  }

  /** Flat horizontal surface at height y (pavement, pitch, markings). */
  flat(u: number, v: number, hu: number, hv: number, y: number, m: PartMat, o: Opt = {}): LmPart {
    return this.add(PK.Flat, u, v, { hx: hu, hz: hv, y0: y, y1: y, m }, o, false, 2);
  }

  /** An invisible solid box (collision volume of an open structure: a wheel, a sphere). */
  solidBox(u: number, v: number, hu: number, hv: number, y0: number, y1: number, map = 0): void {
    const p = this.box(u, v, hu, hv, y0, y1, mat(CONC), { solid: true, map });
    p.hidden = true;
  }

  solidCyl(u: number, v: number, r: number, y0: number, y1: number): void {
    const p = this.cyl(u, v, r, r, y0, y1, mat(CONC), { solid: true, map: 0 });
    p.hidden = true;
  }

  /**
   * Surface of revolution about a vertical axis at (u, v): profile (r, y) pairs from bottom to top
   * (repeat the first pair at the end for a closed ring), radii scaled by sx along u and sz along v.
   */
  lathe(u: number, v: number, prof: number[], sx: number, sz: number, m: PartMat, o: Opt = {}): LmPart {
    let y0 = Infinity, y1 = -Infinity;
    for (let i = 1; i < prof.length; i += 2) { y0 = Math.min(y0, prof[i]); y1 = Math.max(y1, prof[i]); }
    return this.add(PK.Lathe, u, v, { hx: sx, hz: sz, y0, y1, pts: prof.slice(), m, seg: 32 }, o, true, 1);
  }

  /** A slab in the vertical plane along u: outline (du, y) pairs around (u, v) (CCW), 2 hv thick. */
  prism(u: number, v: number, outline: number[], hv: number, m: PartMat, o: Opt = {}): LmPart {
    let y0 = Infinity, y1 = -Infinity;
    for (let i = 1; i < outline.length; i += 2) { y0 = Math.min(y0, outline[i]); y1 = Math.max(y1, outline[i]); }
    return this.add(PK.Prism, u, v, { hx: 0, hz: hv, y0, y1, pts: outline.slice(), m }, o, true, 1);
  }

  /** A slab (2 hu × 2 hv, y0–y1) pierced along v by round holes (du, y, radius). */
  perf(u: number, v: number, hu: number, hv: number, y0: number, y1: number, holes: number[], m: PartMat, o: Opt = {}): LmPart {
    return this.add(PK.Perf, u, v, { hx: hu, hz: hv, y0, y1, pts: holes.slice(), m, seg: 24 }, o, true, 1);
  }

  /**
   * A walkway winding up around a vertical axis at (u, v) between radii r and r2: its floor rises
   * from yA to yB over `turns` turns (sign: sense), starting at angle a0 (local), hh high inside.
   * Two parts: the floor slabs and roof edge (m), and the clear glass walls and roof (glass).
   */
  helix(u: number, v: number, r: number, r2: number, yA: number, yB: number, turns: number, a0: number, hh: number, m: PartMat, glass: PartMat, o: Opt = {}): void {
    const p = { hx: r2, hz: r2, r, r2, y0: yA, y1: yB, turns, hh, m, seg: 48 };
    this.add(PK.Helix, u, v, p, { ...o, rot: a0 }, true, 1);
    this.add(PK.Helix, u, v, { ...p, m: glass }, { ...o, rot: a0, clear: true, solid: false, map: 0 }, false, 0);
  }

  /** A walkable room over the local rectangle (u0, v0)–(u1, v1), from y0 to y1. */
  room(u0: number, v0: number, u1: number, v1: number, y0: number, y1: number): void {
    this.inside.rooms.push({ poly: [...this.W(u0, v0), ...this.W(u1, v0), ...this.W(u1, v1), ...this.W(u0, v1)], y0, y1 });
  }

  /** Mark the parts `fn` adds as inside parts (LmPart.inner). */
  inner(fn: () => void): void {
    const n0 = this.parts.length;
    fn();
    for (let i = n0; i < this.parts.length; i++) this.parts[i].inner = true;
  }

  /** A walkable room of any outline (local points, CCW), from y0 to y1. */
  roomPoly(pts: [number, number][], y0: number, y1: number): void {
    this.inside.rooms.push({ poly: pts.flatMap(([u, v]) => this.W(u, v)), y0, y1 });
  }

  /** A nav point (sim/LandmarkCrowds) at a local point, standing height y; returns its index. */
  node(u: number, v: number, y: number): number {
    const [x, z] = this.W(u, v);
    this.inside.nav.push(x, y, z);
    this.inside.links.push([]);
    return this.inside.links.length - 1;
  }

  /** Nav links along a chain of points. */
  path(...ids: number[]): void {
    for (let i = 0; i + 1 < ids.length; i++) {
      const a = ids[i], b = ids[i + 1], L = this.inside.links;
      if (a === b || L[a].includes(b)) continue;
      L[a].push(b);
      L[b].push(a);
    }
  }

  /**
   * A spot to sit or stand at a local point, facing local +v turned by `rot` (as chairs), reached
   * from nav point `node` over local points `via`; `look` (local u, v, y) is where they look.
   */
  spot(u: number, v: number, y: number, rot: number, sit: boolean, who: SpotWho, node: number, via: [number, number][] = [], look?: [number, number, number]): void {
    const [x, z] = this.W(u, v);
    const vw: number[] = [];
    for (const [a, b] of via) vw.push(...this.W(a, b));
    const l = look ? this.W(look[0], look[1]) : null;
    this.inside.spots.push({ x, y, z, h: Math.PI - (this.oa + rot), sit, who, node, via: vw, look: l && look ? [l[0], look[2], l[1]] : undefined });
  }

  /** A way out from nav point `node` (at a door) over local points (u, v, y) to the ground at (u, v). */
  exit(node: number, way: [number, number, number][], u: number, v: number): void {
    const pts: number[] = [];
    for (const [a, b, y] of way) { const [x, z] = this.W(a, b); pts.push(x, y, z); }
    const [x, z] = this.W(u, v);
    pts.push(x, this.T.height(x, z), z);
    this.inside.exits.push({ node, pts });
  }

  /** A room light at a local point. */
  light(u: number, v: number, y: number): void {
    const [x, z] = this.W(u, v);
    this.inside.lights.push(x, y, z);
  }

  /** A round strut (cylinder of radius rad) between two local points at any slope. */
  strut(u0: number, v0: number, y0: number, u1: number, v1: number, y1: number, rad: number, m: PartMat, o: Opt = {}): LmPart {
    const [bx, bz] = this.W(u1, v1);
    return this.add(PK.Strut, u0, v0, { hx: 0, hz: 0, y0, y1: y0, bx, by: y1, bz, w: rad, m, seg: 10 }, o, false, 0);
  }

  /** Free quad (world corners, x y z × 4, counter-clockwise from above). */
  quad(q: number[], m: PartMat, o: Opt = {}): LmPart {
    const part: LmPart = { k: PK.Quad, x: (q[0] + q[6]) / 2, z: (q[2] + q[8]) / 2, a: 0, hx: 0, hz: 0, y0: Math.min(q[1], q[4], q[7], q[10]), y1: Math.max(q[1], q[4], q[7], q[10]), q, m, map: o.map ?? 5, detail: o.detail };
    this.parts.push(part);
    return part;
  }
}


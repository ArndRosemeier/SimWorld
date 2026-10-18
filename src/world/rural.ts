/**
 * The countryside round the town: farmsteads with their yards (some with an orchard), the
 * country roads that leave the town for "elsewhere" at the edge of the world, the access roads
 * of the sites just outside the town (the station, sometimes the sports ground) and the farm
 * tracks.
 *
 * Ported from Scale (src/world/rural.ts). Scale's countryside held villages and small towns
 * between its cities; SimWorld's town is the whole world, so the villages, their lanes and their
 * layouts are gone, and the roads run out of the town to the edge of the world instead of from
 * village to village. New: river bridges and level crossings with the railway on those roads.
 *
 * A pure function of the terrain, the land use and the macro plan. The farm buildings are laid
 * out lazily (`layout`) as ordinary `BuildingDesc`s, so the town's building shells draw them.
 *
 * The land use reads the plan back (`clearing`, `roadEdge`): fields and forest keep off the
 * yards and roads, so it must be built from the land use before it is attached to it.
 */
import { Rng, deriveSeed, clamp, smoothstep, angleDiff } from '@futuremagic/core';
import { chaikin, ensureCCW, resample, closestOnPolyline, pointInPoly, segIntersect, frameToWorld, worldToFrame, type Poly, polyBounds } from '../geom/geom2';
import { STYLES, WallMat, RoofMat, type BuildingDesc, type StyleId, type RoofKind } from '../plan/building';
import type { MacroPlan } from '../plan/types';
import { inSite, type Landmark } from '../plan/landmarks';
import { riverSpans, type Terrain } from './terrain';
import { newLandSample, type LandUse } from './landuse';

export const enum RoadKind { Main = 0, Lane = 1, Track = 2 }
/** Half widths of the road kinds (m). */
export const ROAD_HW = [3.3, 2.5, 1.6];

export interface RuralRoad {
  id: number;
  kind: RoadKind;
  /** Centreline (x, z, …), ~8 m spacing. */
  pts: number[];
  hw: number;
  /** Metres at the start drawn by the town's ground (a road leaving from an arterial node). */
  trim: number;
  /** Farm at its far end (-1: none, the edge of the world or a site). */
  farm: number;
  /** Outside site (landmark id) it serves, or -1. */
  site: number;
  /** Bridges over rivers, as arc-length ranges along `pts`. */
  bridges: [number, number][];
}

/** A level crossing of a road and the railway. */
export interface LevelCrossing {
  x: number;
  z: number;
  road: number;
  /** Arc length along the road. */
  s: number;
}

export interface Farm {
  id: number;
  x: number;
  z: number;
  /** Radius of the yard. */
  r: number;
  seed: number;
  /** Frame angle (u axis) and yard half extents; the gate is on the -u side. */
  angle: number;
  hu: number;
  hv: number;
  /** Orchard rectangle in the frame (u0, v0, u1, v1), or null. */
  orchard: [number, number, number, number] | null;
  /** Its track. */
  road: number;
}

export interface PavedArea {
  poly: Poly;
  /** GroundLayer (build/ground). */
  layer: number;
}

export interface FarmLayout {
  buildings: BuildingDesc[];
  /** Per building: oriented box cx, cz, hu, hv, ux, uz (BOX_STRIDE). */
  boxes: number[];
  paved: PavedArea[];
}
export const BOX_STRIDE = 6;

/** Farms keep this far beyond the town's outline and within this distance of it (m). */
export const FARM_RING: [number, number] = [250, 2200];

const RB = 64;
/** Road segments are indexed this far beyond their edge (the widest query margin). */
const ROAD_PAD = 16;
const SB = 512;
const key = (i: number, j: number) => (i + 32768) * 65536 + (j + 32768);

/** Ground layers used here (kept in sync with the ground layers of the render). */
const L_GRAVEL = 6, L_DIRT = 11;
/** Roads and yards keep this far from the railway's centreline unless they cross it. */
const RAIL_CLEAR = 14;
/** Longest river crossing a country road takes (abutments included, m). */
const MAX_BRIDGE = 160;

interface Gate { x: number; z: number; trim: number }

export class RuralPlan {
  readonly farms: Farm[] = [];
  readonly roads: RuralRoad[] = [];
  readonly crossings: LevelCrossing[] = [];
  private roadHash = new Map<number, number[]>();
  private farmHash = new Map<number, number[]>();
  private layouts = new Map<number, FarmLayout>();
  private seed: number;
  private ls = newLandSample();
  private cells: { poly: Poly; box: [number, number, number, number] }[] = [];
  private sites: Landmark[];

  constructor(readonly terrain: Terrain, readonly land: LandUse, private macro: MacroPlan) {
    this.seed = deriveSeed(terrain.profile.seed, 'rural');
    for (const c of macro.cells) this.cells.push({ poly: c.poly, box: polyBounds(c.poly) });
    this.sites = macro.landmarks.filter((l) => l.cell < 0);
    this.accessRoads();
    this.outRoads(this.gates());
    this.planFarms();
    for (const f of this.farms) {
      const R = Math.hypot(f.hu, f.hv) + 80;
      for (let i = Math.floor((f.x - R) / SB); i <= Math.floor((f.x + R) / SB); i++) {
        for (let j = Math.floor((f.z - R) / SB); j <= Math.floor((f.z + R) / SB); j++) {
          const k = key(i, j);
          let l = this.farmHash.get(k);
          if (!l) this.farmHash.set(k, (l = []));
          l.push(f.id);
        }
      }
    }
  }

  // ------------------------------------------------------------------ queries

  /**
   * Distance from (x, z) to the edge of the nearest road (negative on it); Infinity farther than
   * ROAD_PAD beyond every edge. `kind` (when given) receives the road's kind.
   */
  roadEdge(x: number, z: number, kind?: { k: RoadKind; road: number }): number {
    const l = this.roadHash.get(key(Math.floor(x / RB), Math.floor(z / RB)));
    if (!l) return Infinity;
    let best = Infinity;
    for (let q = 0; q < l.length; q += 2) {
      const R = this.roads[l[q]], i = l[q + 1] * 2, P = R.pts;
      const ax = P[i], az = P[i + 1], dx = P[i + 2] - ax, dz = P[i + 3] - az, l2 = dx * dx + dz * dz;
      const t = l2 > 0 ? clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1) : 0;
      const d = Math.hypot(ax + dx * t - x, az + dz * t - z) - R.hw;
      if (d < best) { best = d; if (kind) { kind.k = R.kind; kind.road = R.id; } }
    }
    return best;
  }

  /** Farms whose yard may reach (x, z). */
  near(x: number, z: number): readonly number[] {
    return this.farmHash.get(key(Math.floor(x / SB), Math.floor(z / SB))) ?? EMPTY;
  }

  /** How much (x, z) belongs to a yard or orchard (0..1): fields and forest give way. */
  clearing(x: number, z: number): number {
    let c = 0;
    for (const id of this.near(x, z)) {
      const f = this.farms[id];
      const [u, v] = this.toFrame(f, x, z);
      c = Math.max(c, 1 - smoothstep(1, 6, Math.max(Math.abs(u) - f.hu, Math.abs(v) - f.hv)));
      const o = f.orchard;
      if (o) c = Math.max(c, 1 - smoothstep(1, 6, Math.max(o[0] - u, u - o[2], o[1] - v, v - o[3])));
      if (c >= 1) break;
    }
    return c;
  }

  /** Is (x, z) within `margin` of a farm building? */
  onBuilding(x: number, z: number, margin: number): boolean {
    for (const id of this.near(x, z)) {
      const f = this.farms[id];
      const R = Math.hypot(f.hu, f.hv) + 10;
      if (Math.abs(x - f.x) > R + margin || Math.abs(z - f.z) > R + margin) continue;
      const B = this.layout(id).boxes;
      for (let o = 0; o < B.length; o += BOX_STRIDE) {
        const dx = x - B[o], dz = z - B[o + 1];
        if (Math.abs(dx * B[o + 4] + dz * B[o + 5]) < B[o + 2] + margin && Math.abs(-dx * B[o + 5] + dz * B[o + 4]) < B[o + 3] + margin) return true;
      }
    }
    return false;
  }

  /** In a farmyard? */
  onPaved(x: number, z: number, margin: number): boolean {
    for (const id of this.near(x, z)) {
      const f = this.farms[id];
      const [u, v] = this.toFrame(f, x, z);
      if (Math.abs(u) < f.hu + margin && Math.abs(v) < f.hv + margin) return true;
    }
    return false;
  }

  /** Farm frame coordinates of a world point. */
  toFrame(f: Farm, x: number, z: number): [number, number] { return worldToFrame(f, x, z); }
  fromFrame(f: Farm, u: number, v: number): [number, number] { return frameToWorld(f, u, v); }

  // ------------------------------------------------------------------ gates

  /** Width the town's ground draws round an arterial node (where a country road starts). */
  private nodeTrim(i: number): number {
    let trim = 0;
    for (const e of this.macro.nodes[i].edges) trim = Math.max(trim, this.macro.edges[e].width / 2 + this.macro.edges[e].sidewalk + 2);
    return trim;
  }

  /** Outermost arterial nodes, outermost first: where country roads may leave the town. */
  private gates(): Gate[] {
    const macro = this.macro, T = this.terrain;
    // On the outer ring: nothing of the town lies just beyond the node, radially outward.
    const cands = macro.nodes.map((n, i) => ({ n, i, e: this.land.edge(n.x, n.z) })).filter((c) => {
      if (c.n.edges.length < 2 || T.isWater(c.n.x, c.n.z, 25) || (T.profile.coastal && T.coastDistance(c.n.x, c.n.z) < 150)) return false;
      const l = Math.hypot(c.n.x, c.n.z) || 1;
      for (const d of [25, 60, 150]) if (this.inTown(c.n.x + (c.n.x / l) * d, c.n.z + (c.n.z / l) * d)) return false;
      return true;
    });
    cands.sort((a, b) => b.e - a.e || a.i - b.i);
    return cands
      // Not where a site's access road already leaves.
      .filter((c) => !this.roads.some((R) => Math.hypot(R.pts[0] - c.n.x, R.pts[1] - c.n.z) < 1))
      .map((c) => ({ x: c.n.x, z: c.n.z, trim: this.nodeTrim(c.i) }));
  }

  /** Inside one of the town's cells? */
  private inTown(x: number, z: number): boolean {
    for (const c of this.cells) if (x >= c.box[0] && x <= c.box[2] && z >= c.box[1] && z <= c.box[3] && pointInPoly(c.poly, x, z)) return true;
    return false;
  }

  // ------------------------------------------------------------------ roads

  /** Index a road's segments (padded by its half width plus ROAD_PAD). */
  private indexRoad(R: RuralRoad): void {
    const P = R.pts, m = R.hw + ROAD_PAD;
    for (let i = 0; i + 3 < P.length; i += 2) {
      const x0 = Math.min(P[i], P[i + 2]) - m, x1 = Math.max(P[i], P[i + 2]) + m, z0 = Math.min(P[i + 1], P[i + 3]) - m, z1 = Math.max(P[i + 1], P[i + 3]) + m;
      for (let a = Math.floor(x0 / RB); a <= Math.floor(x1 / RB); a++) for (let b = Math.floor(z0 / RB); b <= Math.floor(z1 / RB); b++) {
        const k = key(a, b);
        let l = this.roadHash.get(k);
        if (!l) this.roadHash.set(k, (l = []));
        l.push(R.id, i >> 1);
      }
    }
  }

  private addRoad(kind: RoadKind, pts: number[], trim: number, farm: number, site: number, bridges: [number, number][] = []): RuralRoad {
    const R: RuralRoad = { id: this.roads.length, kind, pts, hw: ROAD_HW[kind], trim, farm, site, bridges };
    this.roads.push(R);
    this.indexRoad(R);
    this.levelCrossings(R);
    return R;
  }

  /** Record where a road crosses the railway. */
  private levelCrossings(R: RuralRoad): void {
    const rail = this.macro.rail;
    if (!rail) return;
    const P = R.pts, Q = rail.pts;
    let s = 0;
    for (let i = 0; i + 3 < P.length; i += 2) {
      const L = Math.hypot(P[i + 2] - P[i], P[i + 3] - P[i + 1]);
      for (let j = 0; j + 3 < Q.length; j += 2) {
        const h = segIntersect(P[i], P[i + 1], P[i + 2], P[i + 3], Q[j], Q[j + 1], Q[j + 2], Q[j + 3]);
        const t = h && h[0] < 1 ? h[0] : -1;
        if (t >= 0) this.crossings.push({ x: P[i] + (P[i + 2] - P[i]) * t, z: P[i + 1] + (P[i + 3] - P[i + 1]) * t, road: R.id, s: s + L * t });
      }
      s += L;
    }
  }

  /**
   * Does the polyline cross (or run within `gap` of) an existing road, other than within
   * `skipA` / `skipB` metres of its two ends?
   */
  private crosses(pts: number[], hw: number, gap: number, skipA: number, skipB: number): boolean {
    const n = pts.length >> 1;
    const ex = pts[pts.length - 2], ez = pts[pts.length - 1];
    for (let i = 0; i < n; i++) {
      const x = pts[i * 2], z = pts[i * 2 + 1];
      if (Math.hypot(x - pts[0], z - pts[1]) < skipA || Math.hypot(x - ex, z - ez) < skipB) continue;
      if (this.roadEdge(x, z) < hw + gap) return true;
    }
    return false;
  }

  /** Is (x, z) on (or within `m` of) a site outside the town? */
  private onSite(x: number, z: number, m: number): boolean {
    return this.sites.some((s) => inSite(s, x, z, m));
  }

  /**
   * Walk a planned road: where it meets the sea, a lake, the town (past `townOk` metres from its
   * start), a site outside the town or the railway at a glancing angle, it ends there; it
   * crosses a river on a bridge where the crossing is short (fairly square to the river),
   * otherwise it ends before the river. Returns the (possibly shortened) road and its bridges.
   */
  private course(pts: number[], hw: number, townOk: number): { pts: number[]; bridges: [number, number][] } {
    const T = this.terrain, n = pts.length >> 1, rail = this.macro.rail;
    let cut = n;
    for (let i = 0; i < n; i++) {
      const x = pts[i * 2], z = pts[i * 2 + 1];
      const d0 = Math.hypot(x - pts[0], z - pts[1]);
      if ((d0 > townOk && (this.land.edge(x, z) < 40 || this.inTown(x, z))) || this.onSite(x, z, hw + 4)) { cut = i; break; }
      if ((T.profile.coastal && T.coastDistance(x, z) < hw + 6) || T.lakeAt(x, z).e < hw + 6) { cut = i; break; }
      // The railway: across it, not along it.
      if (rail && i + 1 < n) {
        const c = closestOnPolyline(rail.pts, x, z);
        if (c.d < RAIL_CLEAR) {
          const k = Math.min(rail.pts.length - 4, c.seg * 2);
          const rx = rail.pts[k + 2] - rail.pts[k], rz = rail.pts[k + 3] - rail.pts[k + 1];
          const dx = pts[i * 2 + 2] - x, dz = pts[i * 2 + 3] - z;
          const sin = Math.abs(rx * dz - rz * dx) / ((Math.hypot(rx, rz) * Math.hypot(dx, dz)) || 1);
          if (sin < 0.6) { cut = i; break; }
        }
      }
    }
    let out = pts.slice(0, cut * 2);
    const spans = riverSpans(this.terrain, out, hw + 6);
    const long = spans.findIndex(([a, b]) => b - a > MAX_BRIDGE);
    if (long < 0) return { pts: out, bridges: spans };
    // Stop short of the river (before the first abutment).
    let s = 0, i = 2;
    for (; i < out.length; i += 2) { s += Math.hypot(out[i] - out[i - 2], out[i + 1] - out[i - 1]); if (s >= spans[long][0]) break; }
    out = out.slice(0, i);
    return { pts: out, bridges: spans.slice(0, long) };
  }

  /** A gently wandering polyline from a to b (ends fixed, straight for `lead` metres at each end). */
  private wavyLine(r: Rng, ax: number, az: number, bx: number, bz: number, amp: number, lead: number): number[] {
    const L = Math.hypot(bx - ax, bz - az);
    const ux = (bx - ax) / L, uz = (bz - az) / L;
    const n = Math.max(2, Math.round(L / 240));
    const ctrl: number[] = [ax, az];
    const ph = r.range(0, 100), f = r.range(0.6, 1.4);
    if (L > lead * 3) ctrl.push(ax + ux * lead, az + uz * lead);
    for (let i = 1; i < n; i++) {
      const s = (i / n) * L;
      if (s < lead * 1.5 || s > L - lead * 1.5) continue;
      const off = Math.sin(i * f + ph) * amp * 0.6 + Math.sin(i * f * 2.3 + ph * 1.7) * amp * 0.4;
      ctrl.push(ax + ux * s - uz * off, az + uz * s + ux * off);
    }
    if (L > lead * 3) ctrl.push(bx - ux * lead, bz - uz * lead);
    ctrl.push(bx, bz);
    const pts = resample(chaikin(ctrl, 3), 8);
    pts[0] = ax; pts[1] = az; pts[pts.length - 2] = bx; pts[pts.length - 1] = bz;
    return pts;
  }

  /** The access roads of the sites outside the town, from their arterial node to the site. */
  private accessRoads(): void {
    for (const s of this.sites) {
      if (!s.road) continue;
      const P = s.road, n = P.length >> 1;
      const back: number[] = [];
      for (let i = n - 1; i >= 0; i--) back.push(P[i * 2], P[i * 2 + 1]);
      const node = this.macro.nodes.findIndex((q) => q.x === back[0] && q.z === back[1]);
      const pts = resample(back, 8);
      this.addRoad(RoadKind.Main, pts, node >= 0 ? this.nodeTrim(node) : 0, -1, s.id, riverSpans(this.terrain, pts, ROAD_HW[RoadKind.Main] + 6));
    }
  }

  /**
   * Country roads out of the town, three to five, spread round it: from a gate radially for a
   * stretch, then wandering on to the edge of the world, keeping apart from each other and off
   * the sea and the lakes (rivers are bridged). Where the radial way is blocked (a coastal town)
   * the road turns, up to running along the shore.
   */
  private outRoads(gates: Gate[]): void {
    const rng = new Rng(deriveSeed(this.seed, 'roads'));
    const T = this.terrain, reach = T.worldExtent - 300, hw = ROAD_HW[RoadKind.Main];
    const want = clamp(Math.round(T.profile.radius / 150), 3, 5);
    const exits: number[] = [];
    for (const [gi, G] of gates.entries()) {
      if (exits.length >= want) break;
      const ga = Math.atan2(G.z, G.x);
      if (exits.some((e) => Math.abs(angleDiff(e, ga)) < (Math.PI * 2) / want * 0.6)) continue;
      const r = rng.fork(gi);
      const gx = Math.cos(ga), gz = Math.sin(ga), stub = 220;
      const sx = G.x + gx * stub, sz = G.z + gz * stub;
      // Bend a little off the radial, towards wherever "elsewhere" lies; turn harder when blocked.
      const bend = r.range(-0.35, 0.35), sgn = r.sign();
      for (const turn of [0, 0.45, -0.45, 0.9, -0.9, 1.35, -1.35]) {
        const a = ga + bend + turn * sgn;
        const ex = Math.cos(a), ez = Math.sin(a);
        const t = reach / Math.max(Math.abs(ex), Math.abs(ez));
        const bx = ex * t, bz = ez * t;
        const D = Math.hypot(bx - sx, bz - sz);
        const pts = [...resample([G.x, G.z, sx, sz], 8).slice(0, -2), ...this.wavyLine(r.fork(turn), sx, sz, bx, bz, Math.min(260, D * 0.04), 60)];
        const c = this.course(pts, hw, stub + 40);
        // Only a road that reaches the edge of the world is a way out.
        const n = c.pts.length;
        if (n < 4 || Math.max(Math.abs(c.pts[n - 2]), Math.abs(c.pts[n - 1])) < reach - 40) continue;
        if (this.crosses(c.pts, hw, 6, G.trim + 30, 0)) continue;
        this.addRoad(RoadKind.Main, c.pts, G.trim, -1, -1, c.bridges);
        exits.push(ga);
        break;
      }
    }
  }

  // ------------------------------------------------------------------ farms

  /** Farmsteads out in the fields of the farm ring, each with a track to the nearest road. */
  private planFarms(): void {
    const T = this.terrain, ls = this.ls, P = this.land.parcels, rail = this.macro.rail;
    const rng = new Rng(deriveSeed(this.seed, 'farms'));
    const G = 420, W = Math.min(T.worldExtent - 900, T.profile.radius * 1.3 + FARM_RING[1]);
    const n = Math.ceil(W / G);
    const base = Math.atan2(P.sin, P.cos);
    const bounds: [number, number, number, number][] = [];
    const nearRail = (x: number, z: number, m: number) => !!rail && closestOnPolyline(rail.pts, x, z).d < m;
    for (let j = -n; j < n; j++) for (let i = -n; i < n; i++) {
      const r = rng.fork(i, j);
      if (!r.chance(0.6)) continue;
      const x = (i + r.range(0.2, 0.8)) * G, z = (j + r.range(0.2, 0.8)) * G;
      const e = this.land.edge(x, z);
      if (e < FARM_RING[0] || e > FARM_RING[1]) continue;
      this.land.sample(x, z, ls);
      if (ls.rural < 0.99 || ls.forest > 0.25) continue;
      if (ls.field < 0.45 && !(ls.meadow > 0.6 && r.chance(0.35))) continue;
      const hu = r.range(21, 25), hv = r.range(16, 19);
      // Nearest road (country and access roads), at most 1.3 km away.
      let best: { d: number; px: number; pz: number } | null = null;
      for (const R of this.roads) {
        if (R.kind === RoadKind.Track) continue;
        const b = bounds[R.id] ??= polyBounds(R.pts);
        if (x < b[0] - 1300 || x > b[2] + 1300 || z < b[1] - 1300 || z > b[3] + 1300) continue;
        const c = closestOnPolyline(R.pts, x, z);
        if (c.s < R.trim + 30) continue;
        if (!best || c.d < best.d) best = { d: c.d, px: c.px, pz: c.pz };
      }
      if (!best || best.d > 1300 || best.d < hu + 40) continue;
      // Frame: along the parcel grid, the gate (-u side) facing the road.
      const ta = Math.atan2(best.pz - z, best.px - x);
      let angle = base;
      for (let q = 0; q < 4; q++) { const a = base + (q * Math.PI) / 2; if (Math.cos(angleDiff(a + Math.PI, ta)) > Math.cos(angleDiff(angle + Math.PI, ta))) angle = a; }
      const f: Farm = { id: this.farms.length, x, z, r: Math.hypot(hu, hv), seed: r.nextU32(), angle, hu, hv, orchard: null, road: -1 };
      // The yard and its surroundings: dry, level enough, off the roads, the railway, the sites,
      // the lakes and other farms.
      let ok = true;
      const hs: number[] = [];
      for (let a = -1; a <= 1 && ok; a++) for (let b = -1; b <= 1; b++) {
        const [px, pz] = this.fromFrame(f, a * (hu + 8), b * (hv + 8));
        if (T.isWater(px, pz, 12) || this.roadEdge(px, pz) < 6 || this.land.edge(px, pz) < FARM_RING[0] - 50 || this.onSite(px, pz, 30) || nearRail(px, pz, RAIL_CLEAR + 10)) { ok = false; break; }
        hs.push(T.height(px, pz));
      }
      if (!ok || Math.max(...hs) - Math.min(...hs) > 7) continue;
      if (this.farms.some((o) => Math.hypot(o.x - x, o.z - z) < 260)) continue;
      // Track: from the gate straight to the road, dry, not across the railway or another road.
      const [gx, gz] = this.fromFrame(f, -hu, 0);
      const [ox, oz] = this.fromFrame(f, -hu - 10, 0);
      const L = Math.hypot(best.px - ox, best.pz - oz);
      const track = resample([gx, gz, ox, oz, best.px, best.pz], 8);
      const thw = ROAD_HW[RoadKind.Track];
      if (L < 12 || this.crosses(track, thw, 3, 0, ROAD_HW[RoadKind.Main] + 6)) continue;
      let clear = true;
      for (let q = 0; q < track.length && clear; q += 2) {
        const x = track[q], z = track[q + 1];
        if (T.isWater(x, z, thw + 5) || this.onSite(x, z, thw + 2) || this.land.edge(x, z) < 40 || nearRail(x, z, RAIL_CLEAR)) clear = false;
      }
      if (!clear) continue;
      // An orchard beside the yard now and then.
      if (r.chance(0.4)) {
        const side = r.sign(), depth = r.range(30, 55);
        const o: [number, number, number, number] = side > 0 ? [-hu + 6, hv + 6, hu, hv + 6 + depth] : [-hu + 6, -hv - 6 - depth, hu, -hv - 6];
        let free = true;
        for (const [u, v] of [[o[0], o[1]], [o[2], o[1]], [o[2], o[3]], [o[0], o[3]], [(o[0] + o[2]) / 2, (o[1] + o[3]) / 2]]) {
          const [px, pz] = this.fromFrame(f, u, v);
          if (T.isWater(px, pz, 5) || this.roadEdge(px, pz) < 4 || nearRail(px, pz, RAIL_CLEAR)) free = false;
        }
        if (free) f.orchard = o;
      }
      this.farms.push(f);
      f.road = this.addRoad(RoadKind.Track, track, 0, f.id, -1).id;
    }
  }

  // ------------------------------------------------------------------ layouts

  /** Buildings and yard of a farm (laid out on first use, then cached). */
  layout(id: number): FarmLayout {
    let L = this.layouts.get(id);
    if (!L) {
      L = this.farmLayout(this.farms[id]);
      this.layouts.set(id, L);
    }
    return L;
  }

  private desc(r: Rng, id: number, poly: Poly, front: number, style: StyleId, opt: { floors?: number; roof?: RoofKind; pitch?: number; floorH?: number; walls?: WallMat[]; roofMats?: RoofMat[]; use?: BuildingDesc['use'] }): BuildingDesc {
    const rule = STYLES[style];
    const floorH = opt.floorH ?? r.range(rule.floorH[0], rule.floorH[1]);
    let roof = opt.roof ?? r.pick(rule.roofs);
    if (roof === 'flat' && style !== 'warehouse' && r.chance(0.8)) roof = r.chance(0.6) ? 'gable' : 'hip';
    if (roof === 'mansard' || roof === 'sawtooth') roof = 'gable';
    return {
      id, poly, front, style,
      use: opt.use ?? (rule.use === 'mixed' ? 'residential' : rule.use),
      floors: opt.floors ?? 1, floorH, groundH: opt.floorH ?? r.range(rule.groundH[0], rule.groundH[1]),
      roof, pitch: opt.pitch ?? (roof === 'gable' || roof === 'hip' ? r.range(0.5, 0.95) : 0.2),
      setbacks: [], wall: r.pick(opt.walls ?? rule.walls), trim: r.int(0, 7), roofMat: r.pick(opt.roofMats ?? rule.roofMats), accent: r.int(0, 7),
      bay: r.range(rule.bay[0], rule.bay[1]), shopfront: false, seed: r.nextU32(), attached: false,
      units: rule.use === 'residential' || rule.use === 'mixed' ? 1 : 0, landmark: false,
    };
  }

  /**
   * A rectangle (centre, axis u, half extents) as a CCW footprint; `front` = the edge whose
   * outward normal points along `fdir` (x, z).
   */
  private rect(cx: number, cz: number, ux: number, uz: number, hu: number, hv: number, fx: number, fz: number): { poly: Poly; front: number } {
    const vx = -uz, vz = ux;
    const poly = ensureCCW([
      cx - ux * hu - vx * hv, cz - uz * hu - vz * hv,
      cx + ux * hu - vx * hv, cz + uz * hu - vz * hv,
      cx + ux * hu + vx * hv, cz + uz * hu + vz * hv,
      cx - ux * hu + vx * hv, cz - uz * hu + vz * hv,
    ]);
    let front = 0, best = -Infinity;
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const mx = (poly[i * 2] + poly[j * 2]) / 2 - cx, mz = (poly[i * 2 + 1] + poly[j * 2 + 1]) / 2 - cz;
      const d = (mx * fx + mz * fz) / (Math.hypot(mx, mz) || 1);
      if (d > best) { best = d; front = i; }
    }
    return { poly, front };
  }

  /** Can a box stand here: dry, fairly level, off the roads and the other boxes? */
  private fits(boxes: number[], cx: number, cz: number, ux: number, uz: number, hu: number, hv: number): boolean {
    const T = this.terrain, vx = -uz, vz = ux;
    let lo = Infinity, hi = -Infinity;
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0], [0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const x = cx + ux * hu * a + vx * hv * b, z = cz + uz * hu * a + vz * hv * b;
      if (T.isWater(x, z, 3) || this.roadEdge(x, z) < 1.2) return false;
      const h = T.height(x, z);
      lo = Math.min(lo, h); hi = Math.max(hi, h);
    }
    if (hi - lo > 3.5) return false;
    // Oriented boxes apart (separating axes, with a gap).
    const gap = 1.2;
    for (let o = 0; o < boxes.length; o += BOX_STRIDE) {
      if (Math.hypot(boxes[o] - cx, boxes[o + 1] - cz) > Math.hypot(hu, hv) + Math.hypot(boxes[o + 2], boxes[o + 3]) + gap) continue;
      if (obbOverlap(cx, cz, ux, uz, hu + gap / 2, hv + gap / 2, boxes[o], boxes[o + 1], boxes[o + 4], boxes[o + 5], boxes[o + 2] + gap / 2, boxes[o + 3] + gap / 2)) return false;
    }
    return true;
  }

  private barnDesc(r: Rng, id: number, poly: Poly, front: number): BuildingDesc {
    const a = this.terrain.profile.arch;
    const walls = a.american > a.oldWorld ? [WallMat.WoodSiding, WallMat.WoodSiding, WallMat.BrickRed, WallMat.MetalPanel] : [WallMat.BrickRed, WallMat.Plaster, WallMat.Timber, WallMat.WoodSiding, WallMat.BrickBrown];
    const d = this.desc(r, id, poly, front, 'warehouse', { floors: 1, roof: 'gable', pitch: r.range(0.45, 0.8), floorH: r.range(5.5, 7.5), walls, roofMats: [RoofMat.Metal, RoofMat.ClayTile, RoofMat.Slate, RoofMat.Asphalt], use: 'industrial' });
    // Few, widely spaced openings: a barn, not a hall full of windows.
    d.bay = r.range(8, 11);
    return d;
  }

  private farmLayout(f: Farm): FarmLayout {
    const r = new Rng(deriveSeed(f.seed, 'layout'));
    const out: FarmLayout = { buildings: [], boxes: [], paved: [] };
    const c = Math.cos(f.angle), n = Math.sin(f.angle);
    // The yard: trodden earth or gravel between the buildings, rounded and a little uneven at the edge.
    const yard: number[] = [];
    const yu = f.hu - 2.5, yv = f.hv - 2.5, rc = 7;
    for (let q = 0; q < 4; q++) {
      const su = q === 0 || q === 3 ? 1 : -1, sv = q < 2 ? 1 : -1;
      for (let k = 0; k <= 4; k++) {
        const a = ((q + k / 4) * Math.PI) / 2;
        const j = r.range(-1, 1);
        yard.push(...this.fromFrame(f, su * (yu - rc) + Math.cos(a) * (rc + j), sv * (yv - rc) + Math.sin(a) * (rc + j)));
      }
    }
    out.paved.push({ poly: ensureCCW(yard), layer: r.chance(0.6) ? L_DIRT : L_GRAVEL });
    // Frame-aligned boxes: (u, v) centre, half extents along u and v, front direction in the frame.
    const put = (u: number, v: number, hu: number, hv: number, fu: number, fv: number, mk: (poly: Poly, front: number) => BuildingDesc) => {
      const [cx, cz] = this.fromFrame(f, u, v);
      if (!this.fits(out.boxes, cx, cz, c, n, hu, hv)) return;
      const R = this.rect(cx, cz, c, n, hu, hv, fu * c - fv * n, fu * n + fv * c);
      out.buildings.push(mk(R.poly, R.front));
      out.boxes.push(cx, cz, hu, hv, c, n);
    };
    const a = this.terrain.profile.arch;
    // Farmhouse on the +v side near the gate, facing the yard.
    const hw = r.range(6, 7.5), hd = r.range(4.5, 5.5);
    put(-f.hu + 4 + hw, f.hv - hd - 1, hw, hd, 0, -1, (p, fr) => this.desc(r, out.buildings.length, p, fr, a.warm > 0.5 ? 'mediterranean' : r.chance(a.oldWorld) ? 'oldstone' : 'house', { floors: 2, roof: r.chance(0.7) ? 'gable' : 'hip' }));
    // The barn along the -v side.
    const bl = r.range(11, 15), bw = r.range(6.5, 8);
    put(Math.min(f.hu - 1 - bl, -f.hu + 10 + bl), -f.hv + bw + 1, bl, bw, 0, 1, (p, fr) => this.barnDesc(r, out.buildings.length, p, fr));
    // A shed or stable at the far end.
    const sl = r.range(4, 5.5), sw = r.range(7, 9);
    put(f.hu - sl - 1, f.hv - sw - 1, sl, sw, -1, 0, (p, fr) => this.barnDesc(r, out.buildings.length, p, fr));
    // Sometimes a second, smaller barn behind the house.
    if (r.chance(0.35)) {
      const ql = r.range(6, 8), qw = r.range(4.5, 5.5);
      put(-f.hu + 6 + hw * 2 + ql, f.hv - qw - 1, ql, qw, 0, -1, (p, fr) => this.barnDesc(r, out.buildings.length, p, fr));
    }
    return out;
  }
}

const EMPTY: readonly number[] = [];

/** Do two oriented boxes overlap (separating axis test)? */
function obbOverlap(ax: number, az: number, aux: number, auz: number, ahu: number, ahv: number, bx: number, bz: number, bux: number, buz: number, bhu: number, bhv: number): boolean {
  const dx = bx - ax, dz = bz - az;
  const axes = [[aux, auz], [-auz, aux], [bux, buz], [-buz, bux]];
  for (const [x, z] of axes) {
    const ra = ahu * Math.abs(aux * x + auz * z) + ahv * Math.abs(-auz * x + aux * z);
    const rb = bhu * Math.abs(bux * x + buz * z) + bhv * Math.abs(-buz * x + bux * z);
    if (Math.abs(dx * x + dz * z) > ra + rb) return false;
  }
  return true;
}

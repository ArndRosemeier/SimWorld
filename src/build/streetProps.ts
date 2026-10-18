/**
 * The town's street props as instance lists, one per model: every planned prop (`plan.props`,
 * src/plan/cell.ts) mapped to a furniture or vehicle model, a place on the ground and its paint.
 * Pure; the town workers run it once and build each listed model (`propModel`), the main thread
 * instances them (src/render/propsView.ts). Ported from Scale: the prop → model mapping of
 * src/props/PropRenderer.ts (addCell, the terrace colours, EV chargers by parked cars, signals at
 * the corners of a junction as its rebuildSignals does from the road net) and the parked cars of
 * src/game/Game.ts (addParked, with src/sim/VehicleRenderer.ts paintColor). Trees and shrubs are
 * src/build/vegetation.ts's.
 */
import { hash32, hashToFloat } from '@futuremagic/core';
import { townGround } from './ground';
import { PropType, type CellPlan, type StreetSeg } from '../plan/cell';
import { RoadClass, type District } from '../plan/types';
import { TERRACE_PALETTE } from '../plan/terrace';
import type { Terrain } from '../world/terrain';
import { FURNITURE_KINDS, furnitureModel, type FurnitureKind } from './furniture';
import { farVehicle, paintColor, standingVehicle, type VehicleKind } from './vehicles';
import type { MeshData } from './meshBuilder';
import { InstanceLists, type ModelInstances } from './instanceLists';
import { yawToward } from '../geom/geom2';

/** Floats per instance: x, y, z, yaw, scale, then four for the kind's instance attributes (furniture: tint rgb + noise offset; vehicles: paint rgb + 0). */
export const PROP_STRIDE = 9;

/** One model's instances. `model`: 'f:<FurnitureKind>:<variant>' or 'v:<VehicleKind>:<variant>'. */
export type PropGroup = ModelInstances;

/** Mesh data of a model named by a `PropGroup.model` key (a furniture mesh, or a standing vehicle with its wheels). */
export function propModel(key: string): MeshData {
  const [t, kind, v] = key.split(':');
  return t === 'f' ? furnitureModel(kind as FurnitureKind, Number(v)).mesh : standingVehicle(kind as VehicleKind, Number(v));
}

/** A vehicle model's far stand-in (`farVehicle` filling the model's bounds); null for furniture. */
export function propFar(key: string): MeshData | null {
  if (!isVehicleModel(key)) return null;
  // (A bicycle is too thin for a box: itself at every distance.)
  if (key.startsWith('v:bicycle:')) return propModel(key);
  const P = propModel(key).attrs.position.array;
  const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i++) { const k = i % 3; min[k] = Math.min(min[k], P[i]); max[k] = Math.max(max[k], P[i]); }
  return farVehicle(min, max);
}

/** Is a model key a vehicle's (the `VEHICLE` kind) rather than furniture's? */
export const isVehicleModel = (key: string): boolean => key.startsWith('v:');

/** Parked car kinds by the prop's seed (Scale's addParked). */
const PARKED: VehicleKind[] = ['sedan', 'sedan', 'hatch', 'suv', 'wagon', 'suv', 'hatch', 'van', 'pickup', 'sports', 'sedan', 'delivery'];
/** Share of parking bays with an EV charging post, by district. */
const EV_SHARE: Partial<Record<District, number>> = { downtown: 0.14, commercial: 0.12, apartments: 0.1, rowhouses: 0.07, oldtown: 0.05, suburban: 0.04, industrial: 0.04, port: 0.03 };
/** A manhole stands this much above the street: its flat rim clears the draped carriageway (DRAPE_TOL) on a sloping street. */
const MANHOLE_LIFT = 0.035;

/** Every cell's props (trees and shrubs excepted) as instance lists. */
export function propInstances(cells: readonly CellPlan[], terrain: Terrain, opts: { kerbCars?: boolean } = {}): PropGroup[] {
  const kerbCars = opts.kerbCars ?? true;
  const lists = new InstanceLists();
  const put = (key: string, x: number, y: number, z: number, yaw: number, scale: number, c: [number, number, number] = [0, 0, 0], w = 0) =>
    lists.add(key, x, y, z, yaw, scale, c[0], c[1], c[2], w);
  /** A noise offset per prop (so alike props differ in the shader). */
  const jitter = (x: number, z: number) => hashToFloat(hash32(Math.round(x * 10) * 7919 + Math.round(z * 10) * 104729)) * 50;
  const curb = townGround(cells, terrain);
  const furn = (kind: FurnitureKind, v: number, x: number, z: number, yaw: number, scale: number, c?: [number, number, number]) =>
    put(`f:${kind}:${v & 1}`, x, curb(x, z), z, yaw, scale, c, jitter(x, z));
  const ends = streetEnds(cells);
  const signalled = new Set<string>();

  for (const plan of cells) {
    const P = plan.props, seed = plan.id * 7919;
    for (let i = 0; i < P.length; i += 6) {
      const t = P[i] as PropType, x = P[i + 1], z = P[i + 2], yaw = P[i + 3], sc = P[i + 4], v = P[i + 5];
      switch (t) {
        case PropType.Lamp: furn(v === 1 ? 'lampDouble' : plan.district === 'oldtown' || plan.district === 'park' ? 'lampClassic' : 'lampModern', 0, x, z, yaw, sc); break;
        case PropType.Bench: furn('bench', v, x, z, yaw, sc); break;
        case PropType.Bin: furn('bin', v, x, z, yaw, sc); break;
        case PropType.Hydrant: furn('hydrant', v, x, z, yaw, sc); break;
        case PropType.Mailbox: furn('mailbox', v, x, z, yaw, sc); break;
        case PropType.Bollard: furn('bollard', v, x, z, yaw, sc); break;
        case PropType.Planter: furn('planter', v, x, z, yaw, sc); break;
        case PropType.Fountain: furn('fountain', v, x, z, yaw, sc); break;
        case PropType.Statue: furn('statue', v, x, z, yaw, sc); break;
        case PropType.Kiosk: furn('kiosk', v, x, z, yaw, sc); break;
        case PropType.PlayGround: furn('playground', v, x, z, yaw, sc); break;
        case PropType.BusStop: furn('busStop', v, x, z, yaw, sc); break;
        case PropType.Manhole: put('f:manhole:0', x, terrain.height(x, z) + MANHOLE_LIFT, z, yaw, sc, undefined, jitter(x, z)); break;
        case PropType.TrafficLight: case PropType.StopSign: {
          const k = `${Math.round(x)},${Math.round(z)}`;
          if (signalled.has(k)) break;
          signalled.add(k);
          for (const a of ends.around(x, z)) {
            // Scale's signal: at the kerb, its arm over the approach, the heads facing the traffic.
            const back = Math.min(a.len * 0.3, a.width * 0.55 + 2.5) + 1.5;
            const lx = a.dz, lz = -a.dx; // left of travel
            if (t === PropType.TrafficLight) {
              const px = x - a.dx * back + lx * (a.width / 2 + 0.7), pz = z - a.dz * back + lz * (a.width / 2 + 0.7);
              furn('trafficLight', plan.id & 1, px, pz, Math.atan2(-a.dz, a.dx) + Math.PI, 1);
            } else {
              const px = x - a.dx * back - lx * (a.width / 2 + 0.5), pz = z - a.dz * back - lz * (a.width / 2 + 0.5);
              furn('stopSign', 0, px, pz, Math.atan2(a.dx, a.dz), 1);
            }
          }
          break;
        }
        // Café terraces (plan/terrace.ts): variant = colour scheme * 2 + model; `tint`: 0 fabric, 1 chair paint, -1 none.
        case PropType.CafeTable: case PropType.CafeChair: case PropType.Parasol: case PropType.Awning:
        case PropType.MenuBoard: case PropType.TerraceRail: case PropType.Parklet: {
          const [kind, tint] = TERRACE[t];
          const pal = TERRACE_PALETTE[(v >> 1) % TERRACE_PALETTE.length];
          const c = tint >= 0 && !(kind === 'cafeChair' && (v & 1)) ? pal[tint] : undefined;
          furn(kind, v, x, z, yaw, sc, c);
          break;
        }
        case PropType.CemWall: furn('cemWall', v, x, z, yaw, sc); break;
        case PropType.Gravestone: furn('gravestone', v, x, z, yaw, sc); break;
        case PropType.Grave: furn('grave', v, x, z, yaw, sc); break;
        case PropType.Tomb: furn('tomb', v, x, z, yaw, sc); break;
        case PropType.GardenFence: furn('gardenFence', v, x, z, yaw, sc); break;
        case PropType.Garage: furn('garage', v, x, z, yaw, sc); break;
        case PropType.ParkedCar: case PropType.KerbCar: {
          // Kerbside bays hold the traffic's household cars instead when it draws them (`kerbCars` false).
          if (t === PropType.ParkedCar || kerbCars) {
            const kind = PARKED[v % PARKED.length], variant = (v >> 4) % 4;
            // Level on the road: the higher of the centre and the mean of front and back (Scale's settle).
            const fx = -Math.sin(yaw), fz = -Math.cos(yaw), h = (dx: number, dz: number) => terrain.height(x + dx, z + dz);
            const y = Math.max(h(0, 0), (h(fx * 2, fz * 2) + h(-fx * 2, -fz * 2)) / 2);
            put(`v:${kind}:${variant}`, x, y, z, yaw, sc, paintColor(kind, 1_000_000 + plan.id * 4096 + i / 6));
          }
          // Near-future kerbs: some parking bays have an EV charging post (more in dense districts).
          if (hashToFloat(hash32(seed * 31 + i * 7 + 11)) < (EV_SHARE[plan.district] ?? 0.03)) {
            const ev = evChargerSpot(plan.streets, x, z, yaw);
            if (ev) furn('evCharger', v % 3 === 0 ? 1 : 0, ev.x, ev.z, ev.yaw, 1);
          }
          break;
        }
        default: break; // trees and shrubs: vegetation
      }
    }
  }
  return lists.groups();
}

/** Floats per lamp head in `lampsOf`: x, y, z (world, the light's place in the head), kind. */
export const LAMP_STRIDE = 4;

/**
 * Every street lamp head of these instance lists (`propInstances`), for a pool of real lights at
 * night: per head x, y, z in world space (the model's light position, `FurnitureModel.lights`,
 * turned and scaled with its instance) and the lamp's kind as its index in FURNITURE_KINDS
 * (lampModern, lampClassic, lampDouble; a double lamp has two heads, a classic one up to three).
 */
export function lampsOf(groups: readonly PropGroup[]): Float32Array {
  const out: number[] = [];
  for (const g of groups) {
    const [t, kind, v] = g.model.split(':');
    if (t !== 'f' || !kind.startsWith('lamp')) continue;
    const lights = furnitureModel(kind as FurnitureKind, Number(v)).lights, k = FURNITURE_KINDS.indexOf(kind as FurnitureKind);
    const I = g.inst;
    for (let o = 0; o < I.length; o += PROP_STRIDE) {
      const c = Math.cos(I[o + 3]), s = Math.sin(I[o + 3]), sc = I[o + 4];
      // (Turned like the instance: three's rotation about +Y by the yaw.)
      for (const { pos: [lx, ly, lz] } of lights) out.push(I[o] + (lx * c + lz * s) * sc, I[o + 1] + ly * sc, I[o + 2] + (lz * c - lx * s) * sc, k);
    }
  }
  return Float32Array.from(out);
}

const TERRACE: Record<number, [FurnitureKind, number]> = {
  [PropType.CafeTable]: ['cafeTable', -1], [PropType.CafeChair]: ['cafeChair', 1], [PropType.Parasol]: ['parasol', 0], [PropType.Awning]: ['awning', 0],
  [PropType.MenuBoard]: ['menuBoard', -1], [PropType.TerraceRail]: ['terraceRail', 0], [PropType.Parklet]: ['parklet', -1],
};

/** A street arriving at a junction: its travel direction into it (unit), width, length. */
interface Approach { dx: number; dz: number; width: number; len: number }

/** The ends of every street of the town, to find the approaches of a junction. */
function streetEnds(cells: readonly CellPlan[]): { around(x: number, z: number): Approach[] } {
  const G = 16, grid = new Map<string, { x: number; z: number; a: Approach }[]>();
  for (const plan of cells) for (const s of plan.streets) {
    if (s.cls === RoadClass.Path) continue;
    const p = s.pts, n = p.length >> 1;
    if (n < 2) continue;
    let len = 0;
    for (let k = 1; k < n; k++) len += Math.hypot(p[k * 2] - p[k * 2 - 2], p[k * 2 + 1] - p[k * 2 - 1]);
    for (const [e, f] of [[0, 1], [n - 1, n - 2]]) {
      const x = p[e * 2], z = p[e * 2 + 1], dx = x - p[f * 2], dz = z - p[f * 2 + 1], l = Math.hypot(dx, dz);
      if (l < 1e-6) continue;
      const k = `${Math.floor(x / G)},${Math.floor(z / G)}`;
      let c = grid.get(k);
      if (!c) grid.set(k, (c = []));
      c.push({ x, z, a: { dx: dx / l, dz: dz / l, width: s.width, len } });
    }
  }
  return {
    around(x, z) {
      const out: Approach[] = [];
      const i0 = Math.floor(x / G), j0 = Math.floor(z / G);
      for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) {
        for (const e of grid.get(`${i},${j}`) ?? []) {
          if (Math.hypot(e.x - x, e.z - z) > 2) continue;
          // The same street end seen from two cells (an arterial): once.
          if (out.some((o) => o.dx * e.a.dx + o.dz * e.a.dz > 0.985)) continue;
          out.push(e.a);
        }
      }
      return out.length >= 3 ? out : [];
    },
  };
}

/**
 * Kerb spot beside a parked car (x, z, yaw: forward = (−sin, −cos)) for a charging post: level
 * with the front wheels, on the side away from the carriageway (the farther point from every
 * street centreline), facing the car.
 */
function evChargerSpot(streets: StreetSeg[], x: number, z: number, yaw: number): { x: number; z: number; yaw: number } | null {
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  const lx = -fz, lz = fx;
  const dist = (px: number, pz: number) => {
    let best = Infinity;
    for (const s of streets) for (let k = 0; k + 3 < s.pts.length; k += 2) {
      const ax = s.pts[k], az = s.pts[k + 1], dx = s.pts[k + 2] - ax, dz = s.pts[k + 3] - az, l2 = dx * dx + dz * dz;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
      best = Math.min(best, Math.hypot(ax + dx * t - px, az + dz * t - pz));
    }
    return best;
  };
  const cx = x + fx * 1.2, cz = z + fz * 1.2;
  const a = { x: cx + lx * 1.75, z: cz + lz * 1.75 }, b = { x: cx - lx * 1.75, z: cz - lz * 1.75 };
  const da = dist(a.x, a.z), db = dist(b.x, b.z);
  if (!isFinite(da) || Math.abs(da - db) < 0.5) return null;
  const p = da > db ? a : b;
  // Front (−Z) of the post towards the car.
  return { x: p.x, z: p.z, yaw: yawToward(p.x, p.z, cx, cz) };
}

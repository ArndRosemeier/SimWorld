/**
 * The town's signs on the stage (town-realism track A): shop fascias, hanging signs, brass plates
 * and works' names, opening hours on the doors, estate agents' boards, public buildings' name
 * boards, street-name posts and the town signs. The town workers list the instances per model
 * (src/build/signs.ts, the mounts from src/plan/signs.ts); here each model is a geometry-instanced
 * mesh of the `FURNITURE` kind, every instance with its own lettering slot of the text atlas
 * (`iSign`). What a sign says comes from the facts (`SignFacts`: the sim's town face, the planner's
 * places until it comes): a shop that closes shows the agent's TO LET board on its fascia and its
 * hours go; a new one has its own name; a home for sale gets a board in the garden.
 *
 * Signs near the camera get their words first; when the atlas is full the farthest give their slot
 * up (and show a plain board until they are near again). New in SimWorld.
 */
import { Group, Vector3, type Camera, type Mesh } from 'three/webgpu';
import type { WorkerPool } from '../workers/pool';
import type { FromTown, ToTown } from '../workers/townProtocol';
import { SIGN_STRIDE, type SignWhat } from '../build/signs';
import type { AtlasRect } from '../build/textAtlasLayout';
import { PLACE_KINDS } from '../sim/places';
import { LOOK_FOR_SALE, LOOK_TO_LET } from '../sim/economy';
import { hoursLines } from '../sim/hours';
import { FURNITURE } from './materials';
import { instancedFromData, showInstances } from './meshes';
import { lettering, type Painter } from './textAtlas';
import * as paint from './signPaint';
import type { SignFacts } from './signFacts';
import type { Stage } from './stage';

/** Lettered boards show up to this far (m, 3D); posts and frames up to POST_RANGE. Words are drawn for boards within WORDS. */
const RANGE = 260, POST_RANGE = 360, WORDS = 220;
/** The camera moves this far (m) before the signs are checked again. */
const RECHECK = 8;

export interface SignsShown {
  /** Instances placed (all, shown or not). */
  instances: number;
  /** Give the signs the town's face (the sim's, once a game day); they redraw what changed at the next update. */
  setFacts(facts: SignFacts): void;
  /** Once a frame: show the signs in range of the camera, with their words. */
  update(camera: Camera): void;
}

interface ModelSigns {
  mesh: Mesh;
  n: number;
  pose: Float32Array;
  size: Float32Array;
  tint: Float32Array;
  sign: Float32Array;
  what: Int32Array;
  range: number;
  radius: number;
}

/** Ask the town workers for the signs and their models, then put them into `root`. */
export async function showSigns(stage: Stage, pool: WorkerPool<ToTown, FromTown>, root: Group, priority = 45): Promise<SignsShown> {
  const r = await pool.run({ type: 'signs' }, priority);
  if (r.type !== 'signs') throw new Error(`town worker: signs answered ${r.type}`);
  const { signs } = r;
  let facts: SignFacts = r.facts;
  const group = new Group();
  group.name = 'signs';
  const models = await Promise.all(signs.groups.map(async (g, i): Promise<ModelSigns> => {
    const m = await pool.run({ type: 'propModel', model: g.model }, priority + 1 + i * 0.01);
    if (m.type !== 'propModel') throw new Error(`town worker: propModel answered ${m.type}`);
    const I = g.inst, n = I.length / SIGN_STRIDE;
    const pose = new Float32Array(n * 4), size = new Float32Array(n * 2), tint = new Float32Array(n * 4), what = new Int32Array(n);
    for (let k = 0, o = 0; k < n; k++, o += SIGN_STRIDE) {
      pose.set([I[o], I[o + 1], I[o + 2], I[o + 3]], k * 4);
      // Posts and frames at scale 1 come as (1, 1); a board's size is its width and height.
      size[k * 2] = I[o + 4] || 1; size[k * 2 + 1] = I[o + 5] || 1;
      what[k] = I[o + 6];
      tint.set([I[o + 7], I[o + 8], I[o + 9], (k * 7.31) % 50], k * 4);
    }
    const mesh = instancedFromData(m.mesh, FURNITURE, 0, n);
    mesh.name = g.model;
    group.add(mesh);
    const s = mesh.geometry.boundingSphere!;
    return { mesh, n, pose, size, tint, sign: new Float32Array(n * 4), what, range: g.model.startsWith('f:signBoard') ? RANGE : POST_RANGE, radius: s.center.length() + s.radius };
  }));

  const words = lettering();
  const blankRect = words.put('sign:blank', 'strip', 'blank', paint.blank)!;
  /** Per what: is it there today, and what it says (its key in the atlas, its slot size, its painter). */
  const sayings = new Map<number, { said: string; paint: Painter } | null>();
  const agentName = () => {
    for (let p = 0; p < facts.name.length; p++) if (PLACE_KINDS[facts.kind[p]] === 'estateagent' && facts.name[p]) return facts.name[p];
    return `${signs.town} Property`;
  };
  /** What sign `w` says today, or null when it is not there. */
  const sayingOf = (w: SignWhat, agent: string): { said: string; paint: Painter } | null => {
    switch (w.t) {
      case 'front': {
        const kind = PLACE_KINDS[facts.kind[w.place]], name = facts.name[w.place];
        if (kind === 'vacant' || facts.flags[w.place] & LOOK_TO_LET) return w.style === 'fascia' ? { said: `vacant|${agent}`, paint: paint.vacantFascia(agent) } : null;
        if (!name) return null;
        const p = w.style === 'fascia' ? paint.fascia(name, kind) : w.style === 'hanging' ? paint.hanging(name, kind) : w.style === 'plate' ? paint.plate(name) : paint.wallSign(name);
        return { said: `${w.style}|${kind}|${name}`, paint: p };
      }
      case 'hours': {
        const kind = PLACE_KINDS[facts.kind[w.place]], hours = facts.hours[w.place];
        if (kind === 'vacant' || !hours || hours.length === 0) return null;
        const lines = hoursLines(hours), name = facts.name[w.place];
        return { said: `hours|${name}|${lines.join('/')}`, paint: paint.hoursCard(name, lines) };
      }
      case 'estate': {
        const f = facts.flags[w.place];
        if (!(f & (LOOK_FOR_SALE | LOOK_TO_LET))) return null;
        const what = f & LOOK_FOR_SALE ? 'FOR SALE' : 'TO LET';
        return { said: `estate|${what}|${agent}`, paint: paint.estateBoard(what, agent) };
      }
      case 'site': return { said: `site|${facts.name[w.place]}`, paint: paint.siteBoard(facts.name[w.place]) };
      case 'street': return { said: `street|${w.name}`, paint: paint.streetBlade(w.name) };
      case 'town': return { said: `town|${w.back}|${signs.town}`, paint: paint.townSign(signs.town, w.back) };
      case 'post': return { said: 'post', paint: paint.blank };
    }
  };
  const readFacts = () => {
    const agent = agentName();
    signs.what.forEach((w, i) => sayings.set(i, sayingOf(w, agent)));
  };
  readFacts();

  const last = new Vector3(Infinity, 0, 0), cam = new Vector3();
  let stale = true;
  const reshow = (camera: Camera, force = false) => {
    camera.getWorldPosition(cam);
    if (!force && !stale && cam.distanceToSquared(last) < RECHECK * RECHECK) return;
    stale = false;
    last.copy(cam);
    // Which lettered signs are near enough for words, nearest first.
    const near = new Map<number, number>();
    for (const m of models) for (let k = 0; k < m.n; k++) {
      const w = m.what[k], d = Math.hypot(m.pose[k * 4] - cam.x, m.pose[k * 4 + 1] - cam.y, m.pose[k * 4 + 2] - cam.z);
      if (signs.what[w].slot && d < WORDS && sayings.get(w) && d < (near.get(w) ?? Infinity)) near.set(w, d);
    }
    const order = [...near].sort((a, b) => a[1] - b[1]).map(([w]) => w);
    // Give up the slots of signs no longer near, then letter the near ones (nearest first).
    for (let w = 0; w < signs.what.length; w++) if (!near.has(w) && words.holds(`sign:${w}`)) words.drop(`sign:${w}`);
    const rects = new Map<number, AtlasRect>();
    for (const w of order) {
      const s = sayings.get(w)!, rect = words.put(`sign:${w}`, signs.what[w].slot!, s.said, s.paint);
      if (rect) rects.set(w, rect);
    }
    words.flush();
    for (const m of models) {
      const picked: number[] = [];
      for (let k = 0; k < m.n; k++) {
        const w = m.what[k];
        if (!sayings.get(w)) continue;
        const d = Math.hypot(m.pose[k * 4] - cam.x, m.pose[k * 4 + 1] - cam.y, m.pose[k * 4 + 2] - cam.z);
        if (d > m.range) continue;
        picked.push(k);
        m.sign.set(rects.get(w) ?? (signs.what[w].slot ? blankRect : [0, 0, 0, 0]), k * 4);
      }
      showInstances([m.mesh], { iPose: m.pose, iSize: m.size, iTint: m.tint, iSign: m.sign }, picked, m.radius);
    }
  };
  reshow(stage.camera, true);
  // (FURNITURE's shader comes from the warm-up: this only checks, and builds nothing.)
  await stage.prepare(group);
  root.add(group);

  return {
    instances: models.reduce((n, m) => n + m.n, 0),
    setFacts(f) { facts = f; readFacts(); stale = true; },
    update: (camera) => reshow(camera),
  };
}

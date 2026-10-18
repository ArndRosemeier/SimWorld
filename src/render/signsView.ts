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
import type { AtlasRect, SlotSize } from '../build/textAtlasLayout';
import type { Notice } from '../sim/media';
import { PLACE_KINDS } from '../sim/places';
import { LOOK_FOR_SALE, LOOK_TO_LET } from '../sim/economy';
import { hoursLines } from '../sim/hours';
import { FURNITURE } from './materials';
import { instancedFromData, showInstances } from './meshes';
import { lettering, type Painter } from './textAtlas';
import * as paint from './signPaint';
import type { SignFacts } from './signFacts';
import type { Stage } from './stage';

/**
 * Lettered boards show up to this far (m, 3D); posts and frames up to POST_RANGE. Words are drawn for
 * a board within WORDS_PER_M times its width (at least MIN_WORDS, at most WORDS): what can be read.
 */
const RANGE = 260, POST_RANGE = 360, WORDS = 220, WORDS_PER_M = 100, MIN_WORDS = 24;
/** The camera moves this far (m) before the signs are checked again. */
const RECHECK = 8;

export interface SignsShown {
  /** Instances placed (all, shown or not). */
  instances: number;
  /** Give the signs the town's face (the sim's, once a game day); they redraw what changed at the next update. */
  setFacts(facts: SignFacts): void;
  /** Give the signs the notices up in town (the sim's media, `day` today's game day); they redraw what changed at the next update. */
  setNotices(notices: readonly Notice[], day: number): void;
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
  /** What a sign says: its key in the atlas (signs saying the same share one), slot size and painter. */
  interface Saying { key: string; said: string; size: SlotSize; paint: Painter }
  /** Per what: what it says today, or null when it is not there. */
  const sayings = new Map<number, Saying | null>();
  /** The notices up at each place, oldest first. */
  let noticesAt = new Map<number, Notice[]>();
  let noticesSaid = '';
  const agentName = () => {
    for (let p = 0; p < facts.name.length; p++) if (PLACE_KINDS[facts.kind[p]] === 'estateagent' && facts.name[p]) return facts.name[p];
    return `${signs.town} Property`;
  };
  /** What sign `w` (index `i`) says today, or null when it is not there. */
  const sayingOf = (w: SignWhat, i: number, agent: string): Saying | null => {
    const own = (said: string, p: Painter): Saying => ({ key: `sign:${i}`, said, size: w.slot!, paint: p });
    switch (w.t) {
      case 'front': {
        const kind = PLACE_KINDS[facts.kind[w.place]], name = facts.name[w.place];
        if (kind === 'vacant' || facts.flags[w.place] & LOOK_TO_LET) return w.style === 'fascia' ? own(`vacant|${agent}`, paint.vacantFascia(agent)) : null;
        if (!name) return null;
        const p = w.style === 'fascia' ? paint.fascia(name, kind) : w.style === 'hanging' ? paint.hanging(name, kind) : w.style === 'plate' ? paint.plate(name) : paint.wallSign(name);
        return own(`${w.style}|${kind}|${name}`, p);
      }
      case 'hours': {
        const kind = PLACE_KINDS[facts.kind[w.place]], hours = facts.hours[w.place];
        if (kind === 'vacant' || !hours || hours.length === 0) return null;
        const lines = hoursLines(hours), name = facts.name[w.place];
        return own(`hours|${name}|${lines.join('/')}`, paint.hoursCard(name, lines));
      }
      case 'estate': {
        const f = facts.flags[w.place];
        if (!(f & (LOOK_FOR_SALE | LOOK_TO_LET))) return null;
        const what = f & LOOK_FOR_SALE ? 'FOR SALE' : 'TO LET';
        return own(`estate|${what}|${agent}`, paint.estateBoard(what, agent));
      }
      case 'site': return own(`site|${facts.name[w.place]}`, paint.siteBoard(facts.name[w.place]));
      case 'street': return own(`street|${w.name}`, paint.streetBlade(w.name));
      case 'town': return own(`town|${w.back}|${signs.town}`, paint.townSign(signs.town, w.back));
      case 'post': return { key: '', said: 'post', size: 'strip', paint: paint.blank };
      case 'cork': return own('cork', paint.cork(w.stand ? 1.4 / 0.8 : 1.0 / 0.75));
      case 'notice': {
        const list = noticesAt.get(w.place);
        const n = list && (w.every ? list[w.k % list.length] : list[w.k]);
        if (!n) return null;
        return { key: `notice:${n.id}`, said: `${n.kind}|${n.title}|${n.lines.join('/')}`, size: 'sheet', paint: paint.notice(n) };
      }
    }
  };
  const readFacts = () => {
    const agent = agentName();
    signs.what.forEach((w, i) => sayings.set(i, sayingOf(w, i, agent)));
  };
  readFacts();

  const last = new Vector3(Infinity, 0, 0), cam = new Vector3();
  let stale = true;
  /** The atlas keys lettered now. */
  const held = new Set<string>();
  const sizeOf = new Map<string, SlotSize>();
  const reshow = (camera: Camera, force = false) => {
    camera.getWorldPosition(cam);
    if (!force && !stale && cam.distanceToSquared(last) < RECHECK * RECHECK) return;
    stale = false;
    last.copy(cam);
    // Which lettered signs are near enough for words, nearest first (by atlas key: signs saying the same share it).
    const near = new Map<string, number>();
    for (const m of models) for (let k = 0; k < m.n; k++) {
      const s = sayings.get(m.what[k]);
      if (!s?.key) continue;
      const d = Math.hypot(m.pose[k * 4] - cam.x, m.pose[k * 4 + 1] - cam.y, m.pose[k * 4 + 2] - cam.z);
      // Small boards only get words where they can be read (a door plate from a few steps, a fascia from down the street).
      if (d < Math.min(WORDS, Math.max(MIN_WORDS, m.size[k * 2] * WORDS_PER_M)) && d < (near.get(s.key) ?? Infinity)) near.set(s.key, d);
    }
    const order = [...near].sort((a, b) => a[1] - b[1]).map(([key]) => key);
    const byKey = new Map<string, Saying>();
    for (const s of sayings.values()) if (s?.key && near.has(s.key)) byKey.set(s.key, s);
    // Give up the slots of signs no longer near, then letter the near ones (nearest first).
    for (const key of held) if (!near.has(key)) { words.drop(key); held.delete(key); }
    const rects = new Map<string, AtlasRect>();
    for (const key of order) {
      const s = byKey.get(key)!;
      let rect = words.put(key, s.size, s.said, s.paint);
      // Atlas full: a farther sign of the same slot size gives its slot up.
      while (!rect) {
        let victim: string | null = null;
        for (const h of held) if (!rects.has(h) && sizeOf.get(h) === s.size && (!victim || near.get(h)! > near.get(victim)!)) victim = h;
        if (!victim || near.get(victim)! <= near.get(key)!) break;
        words.drop(victim); held.delete(victim);
        rect = words.put(key, s.size, s.said, s.paint);
      }
      if (rect) { rects.set(key, rect); held.add(key); sizeOf.set(key, s.size); }
    }
    words.flush();
    for (const m of models) {
      const picked: number[] = [];
      for (let k = 0; k < m.n; k++) {
        const s = sayings.get(m.what[k]);
        if (!s) continue;
        const d = Math.hypot(m.pose[k * 4] - cam.x, m.pose[k * 4 + 1] - cam.y, m.pose[k * 4 + 2] - cam.z);
        if (d > m.range) continue;
        picked.push(k);
        m.sign.set(s.key ? rects.get(s.key) ?? blankRect : [0, 0, 0, 0], k * 4);
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
    setNotices(notices, day) {
      const up = notices.filter((n) => n.from <= day && day <= n.until);
      const said = up.map((n) => `${n.id}|${n.title}|${n.lines.join('/')}|${n.at.join(',')}`).join(';');
      if (said === noticesSaid) return;
      noticesSaid = said;
      noticesAt = new Map();
      for (const n of [...up].sort((a, b) => a.id - b.id)) for (const p of n.at) {
        let list = noticesAt.get(p);
        if (!list) noticesAt.set(p, (list = []));
        list.push(n);
      }
      readFacts();
      stale = true;
    },
    update: (camera) => reshow(camera),
  };
}

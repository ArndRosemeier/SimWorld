/**
 * Live model comparison for every LLM task (slow tier, by hand only; needs OPENROUTER_API_KEY or
 * OPEN_ROUTER_KEY, skips without it; behind a proxy, Node's fetch needs NODE_USE_ENV_PROXY=1).
 * Every candidate gets the same fixed inputs, so the numbers compare like with like:
 *
 *  - npc.speech (the NPC's written chat reply) on the scenes in test/fixtures/llm/scenes.ts, printed
 *    for reading against each scene's `expect`, with time to first text.
 *  - npc.appraisal on the same scenes, each with a fixed NPC reply and a checklist of what a correct
 *    appraisal contains; a run is clean when it passes all of its scene's checks. `LLM_RUNS` per scene.
 *  - memory.summary, npc.reflection and skip.digest, with a few mechanical checks, printed for reading.
 *
 * Prints a table per task (valid replies, clean runs or checks passed, median latency, cost per call);
 * LLM_REPORT=<file> also writes every output as JSON. Candidates come from LLM_CHAT, LLM_APPRAISAL,
 * LLM_SUMMARY, LLM_REFLECTION and LLM_DIGEST (comma-separated OpenRouter ids), so a re-check after an
 * alias moves needs no code change. The default run costs about $0.15. Narrow it with
 * --test-name-pattern (e.g. 'appraisal').
 *
 *   NODE_USE_ENV_PROXY=1 npm run test:slow -- test/slow/llm-models.slow.test.ts
 */
import { test } from 'node:test';
import fs from 'node:fs';
import {
  createLlm, openRouterTransport, fetchCatalog, entryFromCatalog, UsageLedger,
  type Capability, type CatalogModel, type Roster, type TaskName, type TaskIO,
} from '../../src/llm';
import { EVAL_SCENES } from '../fixtures/llm/scenes';
import { bakeryScene, ANNA, FOUNTAIN, TOM } from '../fixtures/llm/town';

/** The cloud environments name it OPEN_ROUTER_KEY. */
const KEY = process.env.OPENROUTER_API_KEY ?? process.env.OPEN_ROUTER_KEY ?? '';
const RUNS = Number(process.env.LLM_RUNS ?? 2);
const list = (env: string | undefined, dflt: string) => (env ?? dflt).split(',').map((s) => s.trim()).filter(Boolean);

// The default roster (src/llm/roster.ts).
const ROSTER = '~z-ai/glm-latest,~google/gemini-flash-latest,mistralai/mistral-large-4-0,~anthropic/claude-haiku-latest,~openai/gpt-luna-latest,~z-ai/glm-flash-latest,~deepseek/deepseek-flash-latest';
const CHAT = list(process.env.LLM_CHAT, ROSTER);
const APPRAISAL = list(process.env.LLM_APPRAISAL, ROSTER);
const SUMMARY = list(process.env.LLM_SUMMARY, ROSTER);
const REFLECTION = list(process.env.LLM_REFLECTION, '~anthropic/claude-haiku-latest,~google/gemini-flash-latest,~z-ai/glm-latest');
const DIGEST = list(process.env.LLM_DIGEST, ROSTER);

/** Every tag, so a single-model roster qualifies for any task: the comparison is about the model, not the routing. */
const ALL: Capability[] = ['fast', 'cheap', 'structured', 'writing', 'reasoning', 'long_context'];

interface Row { model: string; calls: number; ok: number; checks: number; passed: number; ms: number[]; cost: number; notes: string[] }
const report: Record<string, unknown[]> = {};

async function runOne<K extends TaskName>(catalog: CatalogModel[], id: string, task: K, input: TaskIO[K]['input'], onFirst?: (ms: number) => void) {
  const m = catalog.find((x) => x.id === id);
  if (!m) throw new Error(`${id} is not in the catalog`);
  const roster: Roster = { models: [entryFromCatalog(m, ALL)] };
  const ledger = new UsageLedger();
  const llm = createLlm({ transport: openRouterTransport({ apiKey: KEY }), roster: () => roster, ledger, session: 'eval' });
  const t0 = performance.now();
  try {
    let first = false;
    const r = await llm.run(task, input, { onText: (t) => { if (t && !first) { first = true; onFirst?.(performance.now() - t0); } } });
    return { ok: true as const, output: r.output, ms: performance.now() - t0, cost: ledger.total().cost };
  } catch (e) {
    return { ok: false as const, error: (e as Error).message, ms: performance.now() - t0, cost: ledger.total().cost };
  }
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

function table(title: string, rows: Row[]) {
  console.log(`\n== ${title}`);
  console.log('model'.padEnd(36) + 'valid'.padStart(7) + 'checks'.padStart(9) + 'median ms'.padStart(11) + '$/call'.padStart(11));
  for (const r of rows.sort((a, b) => b.passed / (b.checks || 1) - a.passed / (a.checks || 1) || median(a.ms) - median(b.ms))) {
    console.log(r.model.padEnd(36) + `${r.ok}/${r.calls}`.padStart(7) + (r.checks ? `${r.passed}/${r.checks}` : '-').padStart(9) + String(Math.round(median(r.ms))).padStart(11) + (r.cost / r.calls).toFixed(6).padStart(11));
    for (const n of r.notes) console.log(`    ${n}`);
  }
}

function save() {
  if (process.env.LLM_REPORT) fs.writeFileSync(process.env.LLM_REPORT, JSON.stringify(report, null, 1) + '\n');
}

test('live: chat reply candidates on the eval scenes', { skip: !KEY && 'no OPENROUTER_API_KEY' }, async () => {
  const catalog = await fetchCatalog();
  const rows = await Promise.all(CHAT.map(async (id) => {
    const row: Row = { model: id, calls: 0, ok: 0, checks: 0, passed: 0, ms: [], cost: 0, notes: [] };
    const firsts: number[] = [];
    for (const s of EVAL_SCENES) {
      const r = await runOne(catalog, id, 'npc.speech', s.input, (ms) => firsts.push(ms));
      row.calls++; row.ms.push(r.ms); row.cost += r.cost;
      if (!r.ok) { row.notes.push(`${s.name}: FAILED ${r.error.slice(0, 160)}`); continue; }
      row.ok++;
      row.notes.push(`${s.name}: ${r.output.replace(/\n+/g, ' / ')}`);
      (report[`chat ${id}`] ??= []).push({ scene: s.name, output: r.output, ms: Math.round(r.ms), cost: r.cost });
    }
    row.notes.unshift(`first text after ${Math.round(median(firsts))} ms (median)`);
    return row;
  }));
  table('npc.speech (chat reply; judge by reading, see each scene\'s expect)', rows);
  save();
});

test('live: appraisal candidates on the eval scenes', { skip: !KEY && 'no OPENROUTER_API_KEY' }, async () => {
  const catalog = await fetchCatalog();
  const rows = await Promise.all(APPRAISAL.map(async (id) => {
    const row: Row = { model: id, calls: 0, ok: 0, checks: 0, passed: 0, ms: [], cost: 0, notes: [] };
    for (const s of EVAL_SCENES) {
      for (let i = 0; i < RUNS; i++) {
        const r = await runOne(catalog, id, 'npc.appraisal', { context: s.input, reply: s.reply });
        row.calls++; row.ms.push(r.ms); row.cost += r.cost;
        if (!r.ok) { row.notes.push(`${s.name}: FAILED ${r.error.slice(0, 160)}`); continue; }
        row.ok++;
        const fails = s.check(r.output.proposal);
        // A run passes when it gets every check of its scene right.
        row.checks++; if (!fails.length) row.passed++;
        for (const f of fails) row.notes.push(`${s.name}: ${f}`);
        if (r.output.dropped.length) row.notes.push(`${s.name}: dropped ${r.output.dropped.join('; ').slice(0, 200)}`);
        (report[`appraisal ${id}`] ??= []).push({ scene: s.name, run: i, proposal: r.output.proposal, dropped: r.output.dropped, ms: Math.round(r.ms), cost: r.cost });
      }
    }
    return row;
  }));
  table('npc.appraisal', rows);
  save();
});

test('live: memory.summary candidates', { skip: !KEY && 'no OPENROUTER_API_KEY' }, async () => {
  const catalog = await fetchCatalog();
  const scenes = EVAL_SCENES;
  const rows = await Promise.all(SUMMARY.map(async (id) => {
    const row: Row = { model: id, calls: 0, ok: 0, checks: 0, passed: 0, ms: [], cost: 0, notes: [] };
    for (const s of scenes) {
      const r = await runOne(catalog, id, 'memory.summary', { ...s.input, turns: [...s.input.turns, { speaker: 'npc', text: s.reply }] });
      row.calls++; row.ms.push(r.ms); row.cost += r.cost;
      if (!r.ok) { row.notes.push(`${s.name}: FAILED ${r.error.slice(0, 160)}`); continue; }
      row.ok++;
      const refsLeft = /\[?\b[PL]\d+\b\]?/.test(r.output.summary);
      const long = r.output.summary.split(/(?<=[.!?])\s+/).length > 2;
      const thirdPerson = new RegExp(`\\b${s.input.npc.name.split(' ')[0]}\\b`).test(r.output.summary);
      row.checks += 3; row.passed += (refsLeft ? 0 : 1) + (long ? 0 : 1) + (thirdPerson ? 0 : 1);
      row.notes.push(`${s.name} (${r.output.importance}): ${r.output.summary}${refsLeft ? '  [REFS LEFT]' : ''}${long ? '  [OVER 2 SENTENCES]' : ''}${thirdPerson ? '  [NOT FIRST PERSON]' : ''}`);
      (report[`summary ${id}`] ??= []).push({ scene: s.name, ...r.output, ms: Math.round(r.ms), cost: r.cost });
    }
    return row;
  }));
  table('memory.summary', rows);
  save();
});

test('live: npc.reflection candidates', { skip: !KEY && 'no OPENROUTER_API_KEY' }, async () => {
  const catalog = await fetchCatalog();
  const s = bakeryScene();
  const input: TaskIO['npc.reflection']['input'] = {
    npc: s.npc,
    people: [{ id: TOM, name: 'Tom Brandt', bonds: ['customer'] }, { id: ANNA, name: 'Anna Keller', bonds: ['sister'] }],
    places: [{ id: FOUNTAIN, name: 'the market fountain', kind: 'square' }],
    memories: [
      { when: 'three weeks ago', summary: 'Tom complained the rye was too dark and left without paying for his coffee.' },
      { when: 'two weeks ago', summary: 'Tom came back and paid for the coffee, a bit embarrassed. He asked how my son is doing.' },
      { when: 'last Saturday', summary: 'Tom stayed after closing and helped me carry flour sacks up from the cellar.' },
      { when: 'on Monday', summary: 'Anna phoned in tears: her landlord is selling and she has to be out by spring.' },
      { when: 'on Wednesday', summary: 'Tom told me the mill might close. I did not repeat it, but I could not sleep.' },
      { when: 'yesterday', summary: 'Anna said she cannot find anything she can afford. I thought of the empty room above the bakery.' },
      { when: 'this morning', summary: 'Tom met me at the fountain at five as promised and said the mill closure is now official.' },
    ],
  };
  const rows = await Promise.all(REFLECTION.map(async (id) => {
    const row: Row = { model: id, calls: 1, ok: 0, checks: 0, passed: 0, ms: [], cost: 0, notes: [] };
    const r = await runOne(catalog, id, 'npc.reflection', input);
    row.ms.push(r.ms); row.cost += r.cost;
    if (!r.ok) { row.notes.push(`FAILED ${r.error.slice(0, 160)}`); return row; }
    row.ok = 1;
    row.checks = 2;
    row.passed = (r.output.insights.length >= 1 && r.output.insights.length <= 3 ? 1 : 0) + (r.output.insights.every((i) => i.about.people.length + i.about.places.length > 0) && !r.output.dropped.length ? 1 : 0);
    for (const i of r.output.insights) row.notes.push(`(${i.importance}) ${i.text}  -> ${JSON.stringify(i.about)}`);
    if (r.output.dropped.length) row.notes.push(`dropped ${r.output.dropped.join('; ')}`);
    (report[`reflection ${id}`] ??= []).push({ ...r.output, ms: Math.round(r.ms), cost: r.cost });
    return row;
  }));
  table('npc.reflection', rows);
  save();
});

test('live: skip.digest candidates', { skip: !KEY && 'no OPENROUTER_API_KEY' }, async () => {
  const catalog = await fetchCatalog();
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const filler = ['Baked for the church fair.', 'The oven thermostat played up again.', 'Mrs Patel bought three dozen rolls for a christening.', 'Rain all day; the shop was quiet.', 'Tom bought his two rye loaves.', 'Delivered bread to the school kitchen.'];
  const events: TaskIO['skip.digest']['input']['events'] = [];
  for (let w = 0; w < 3; w++) for (const [d, day] of days.entries()) events.push({ when: `${day}, week ${w + 1}`, text: filler[(w * 7 + d) % filler.length], importance: 2 });
  events.splice(4, 0, { when: 'Friday, week 1', text: 'The mill announced it will close in March; 140 jobs.', importance: 8 });
  events.splice(12, 0, { when: 'Tuesday, week 2', text: 'Anna moved into the room above the bakery.', importance: 7 });
  events.splice(30, 0, { when: 'Saturday, week 3', text: 'Tom asked me to the summer festival dance. I said yes.', importance: 7 });
  const input = { pov: bakeryScene().npc, from: 'Monday 2 June', to: 'Sunday 22 June', events };
  const rows = await Promise.all(DIGEST.map(async (id) => {
    const row: Row = { model: id, calls: 1, ok: 0, checks: 0, passed: 0, ms: [], cost: 0, notes: [] };
    const r = await runOne(catalog, id, 'skip.digest', input);
    row.ms.push(r.ms); row.cost += r.cost;
    if (!r.ok) { row.notes.push(`FAILED ${r.error.slice(0, 160)}`); return row; }
    row.ok = 1;
    const t = r.output;
    const has = [/mill/i, /anna/i, /dance|festival/i].map((re) => re.test(t));
    const invented = /\b(I think|perhaps|maybe)\b/i.test(t) ? 0 : 1; // rough: hedging hints at made-up filler
    row.checks = 5; row.passed = has.filter(Boolean).length + (/#|\*\*/.test(t) ? 0 : 1) + invented;
    row.notes.push(t.replace(/\n+/g, ' / '));
    (report[`digest ${id}`] ??= []).push({ output: t, ms: Math.round(r.ms), cost: r.cost });
    return row;
  }));
  table('skip.digest', rows);
  save();
});

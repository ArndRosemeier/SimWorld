/**
 * Live OpenRouter checks (slow tier, by hand only; needs OPENROUTER_API_KEY, skips without it).
 *
 *  - Runs every task once through `llm.run` with the default roster and prints model, latency and cost.
 *  - Compares appraisal candidates on the bakery fixture: valid JSON, what they extracted, speed, cost.
 *  - With LLM_RECORD=1, writes each exchange to test/fixtures/llm/recorded/ for the fast tests.
 *
 *   OPENROUTER_API_KEY=sk-or-... npm run test:slow -- test/slow/openrouter.slow.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  createLlm, openRouterTransport, recordingTransport, fetchCatalog, rosterFromCatalog, entryFromCatalog, DEFAULT_ROSTER, UsageLedger,
  type Recording, type Roster, type Transport,
} from '../../src/llm';
import { bakeryScene } from '../fixtures/llm/town';

const KEY = process.env.OPENROUTER_API_KEY ?? '';
const RECORD_DIR = path.resolve(import.meta.dirname, '../fixtures/llm/recorded');

function transport(label: string): Transport {
  const real = openRouterTransport({ apiKey: KEY });
  if (!process.env.LLM_RECORD) return real;
  fs.mkdirSync(RECORD_DIR, { recursive: true });
  let n = 0;
  return recordingTransport(real, (_req, rec) => {
    const r: Recording = { name: `${label} #${++n}`, ...rec };
    fs.writeFileSync(path.join(RECORD_DIR, `${label}-${n}.json`), JSON.stringify(r, null, 1) + '\n');
  });
}

async function liveRoster(): Promise<Roster> {
  try { return rosterFromCatalog(await fetchCatalog()); } catch { return DEFAULT_ROSTER; }
}

test('live: every task once with the default roster', { skip: !KEY && 'no OPENROUTER_API_KEY' }, async () => {
  const roster = await liveRoster();
  const ledger = new UsageLedger();
  const llm = createLlm({ transport: transport('tasks'), roster: () => roster, ledger, session: 'live' });
  const scene = bakeryScene();
  const speech = await llm.run('npc.speech', scene);
  console.log(`speech (${speech.model}): ${speech.output}`);
  const appraisal = await llm.run('npc.appraisal', { context: scene, reply: speech.output });
  console.log(`appraisal (${appraisal.model}):`, JSON.stringify(appraisal.output, null, 1));
  const summary = await llm.run('memory.summary', { ...scene, turns: [...scene.turns, { speaker: 'npc', text: speech.output }] });
  console.log(`summary (${summary.model}):`, summary.output);
  const digest = await llm.run('skip.digest', { pov: scene.npc, from: 'Monday', to: 'Sunday', events: [{ when: 'Tuesday', text: 'Anna moved into the flat on Elm Road.', importance: 6 }, { when: 'Friday', text: 'The mill announced it will close in March.', importance: 8 }] });
  console.log(`digest (${digest.model}): ${digest.output}`);
  for (const [k, t] of ledger.by('model')) console.log(`${k}: ${t.calls} calls, ${t.promptTokens}+${t.completionTokens} tokens, $${t.cost.toFixed(5)}`);
  assert.ok(speech.output.length > 0);
});

test('live: appraisal candidates side by side', { skip: !KEY && 'no OPENROUTER_API_KEY' }, async () => {
  const catalog = await fetchCatalog();
  const roster = rosterFromCatalog(catalog);
  const candidates = (process.env.LLM_CANDIDATES ?? 'anthropic/claude-haiku-5.5,openai/gpt-6-luna,deepseek/deepseek-v4.1-flash-1017,z-ai/glm-5.3-flash,google/gemini-3.8-flash').split(',');
  const reply = "Closing? Says who? *wipes hands* Look, love, I'll ask Anna tonight. Meet me at the fountain at five and I'll tell you what she says.";
  for (const id of candidates) {
    const ledger = new UsageLedger();
    const only: Roster = { models: roster.models.filter((m) => m.id === id) };
    if (!only.models.length) {
      const m = catalog.find((x) => x.id === id);
      if (!m) { console.log(`${id}: not in the catalog`); continue; }
      only.models.push({ ...entryFromCatalog(m), tags: ['fast', 'structured', 'cheap'] });
    }
    const llm = createLlm({ transport: transport(`appraisal-${id.replace(/\W+/g, '_')}`), roster: () => only, ledger, session: 'live' });
    const t0 = performance.now();
    try {
      const r = await llm.run('npc.appraisal', { context: bakeryScene(), reply });
      const p = r.output.proposal;
      console.log(`${id}: ${Math.round(performance.now() - t0)} ms, $${ledger.total().cost.toFixed(6)}, intentions ${p.intentions.map((i) => i.kind).join('/') || '-'}, beliefs ${p.beliefs.length}, relations ${p.relations.length}, dropped ${r.output.dropped.length}`);
    } catch (e) {
      console.log(`${id}: FAILED ${(e as Error).message}`);
    }
  }
});

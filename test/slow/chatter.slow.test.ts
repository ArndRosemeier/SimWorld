/**
 * An LLM judge for the background chatter (slow tier, by hand only; needs OPENROUTER_API_KEY or OPEN_ROUTER_KEY,
 * skips without it; behind a proxy, Node's fetch needs NODE_USE_ENV_PROXY=1). A day of talk in a British and an
 * American town (tools/talk/samples.ts) goes to the `talk.judge` task in batches; it prints the mean coherence and
 * naturalness (1-5) and the worst exchanges with the judge's note, which is what to fix next.
 *
 * JUDGE_MODEL picks the model (default: the task's first default), JUDGE_N the number of exchanges per town
 * (default 40), LLM_REPORT=<file> writes every score as JSON. A default run costs well under a cent.
 *
 *   NODE_USE_ENV_PROXY=1 npm run test:slow -- test/slow/chatter.slow.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createLlm, DEFAULT_TASK_MODELS, entryFromCatalog, fetchCatalog, openRouterTransport, UsageLedger, type JudgeScore, type Roster } from '../../src/llm';
import { asText, sampleDay, sampleTown, type Sample } from '../../tools/talk/samples';

const KEY = process.env.OPENROUTER_API_KEY ?? process.env.OPEN_ROUTER_KEY ?? '';
const MODEL = process.env.JUDGE_MODEL ?? DEFAULT_TASK_MODELS['talk.judge'][0];
const N = Number(process.env.JUDGE_N ?? 40);
const BATCH = 10;

test('chatter: an LLM judge scores coherence and naturalness', { skip: !KEY && 'no OpenRouter key' }, async () => {
  const catalog = await fetchCatalog();
  const m = catalog.find((x) => x.id === MODEL);
  assert.ok(m, `${MODEL} is not in the catalog`);
  const roster: Roster = { models: [entryFromCatalog(m, ['structured', 'cheap'])] };
  const ledger = new UsageLedger();
  const llm = createLlm({ transport: openRouterTransport({ apiKey: KEY }), roster: () => roster, ledger, session: 'judge' });

  // Only exchanges with something to judge: two people and at least three lines.
  const samples: Sample[] = [];
  for (const american of [false, true]) {
    samples.push(...sampleDay(sampleTown(american), 400, american ? 2 : 1).filter((s) => s.kind === 'talk' && s.lines.length >= 3).slice(0, N));
  }
  const scored: { sample: Sample; score: JudgeScore }[] = [];
  for (let i = 0; i < samples.length; i += BATCH) {
    const batch = samples.slice(i, i + BATCH);
    const r = await llm.run('talk.judge', { exchanges: batch.map(asText) });
    r.output.forEach((score, k) => scored.push({ sample: batch[k], score }));
  }
  const mean = (f: (s: JudgeScore) => number) => scored.reduce((a, s) => a + f(s.score), 0) / scored.length;
  const coherence = mean((s) => s.coherence), naturalness = mean((s) => s.naturalness);
  console.log(`\n${MODEL}: ${scored.length} exchanges, coherence ${coherence.toFixed(2)}, naturalness ${naturalness.toFixed(2)}, cost $${ledger.total().cost.toFixed(4)}`);
  const worst = [...scored].sort((a, b) => a.score.coherence + a.score.naturalness - b.score.coherence - b.score.naturalness).slice(0, 12);
  for (const w of worst) console.log(`\n[${w.score.coherence}/${w.score.naturalness}] ${w.score.note}\n${asText(w.sample).replace(/^/gm, '  ')}`);
  if (process.env.LLM_REPORT) fs.writeFileSync(process.env.LLM_REPORT, JSON.stringify(scored, null, 2));
  // A floor, so a regression shows: the engine should read as people talking.
  assert.ok(coherence >= 3.5, `coherence ${coherence.toFixed(2)}`);
});

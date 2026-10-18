/**
 * Judges for the background chatter (slow tier, by hand only; needs OPENROUTER_API_KEY or OPEN_ROUTER_KEY, skips
 * without it; behind a proxy, Node's fetch needs NODE_USE_ENV_PROXY=1). Development time only: the game's chatter
 * never calls an LLM (Arnd, 2026-10-18: chatter costs nothing unless the player opts in).
 *
 * A day of talk in the game's town of two seeds (tools/talk/samples.ts):
 * - every exchange goes to a decision model (`talk.rate`, Jev): naturalness 1-5 and whether every reply fits, the
 *   share of natural ones (naturalness ≥ 4 and fits);
 * - a sample goes to the LLM judge (`talk.judge`) with the lines that recur across the whole day, for coherence and
 *   naturalness 1-5 and a note on the worst problem, which is what to fix next;
 * - the mechanical repetition figure (sentences said more than once).
 *
 * JUDGE_MODEL picks the judge (default: the task's first default), JUDGE_N the exchanges per town for the judge
 * (default 40), LLM_REPORT=<file> writes every score as JSON. A run costs about a cent.
 *
 *   NODE_USE_ENV_PROXY=1 npm run test:slow -- test/slow/chatter.slow.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createLlm, DEFAULT_TASK_MODELS, entryFromCatalog, fetchCatalog, openRouterTransport, UsageLedger, type JudgeScore, type RateOutput, type Roster } from '../../src/llm';
import { asText, repetition, sampleDay, sampleTown, type Sample } from '../../tools/talk/samples';

const KEY = process.env.OPENROUTER_API_KEY ?? process.env.OPEN_ROUTER_KEY ?? '';
const MODEL = process.env.JUDGE_MODEL ?? DEFAULT_TASK_MODELS['talk.judge'][0];
const N = Number(process.env.JUDGE_N ?? 40);
const BATCH = 10;

test('chatter: a decision model and an LLM judge score a day of talk', { skip: !KEY && 'no OpenRouter key' }, async () => {
  const catalog = await fetchCatalog();
  const m = catalog.find((x) => x.id === MODEL);
  assert.ok(m, `${MODEL} is not in the catalog`);
  const roster: Roster = { models: [entryFromCatalog(m, ['structured', 'cheap'])] };
  const ledger = new UsageLedger();
  const llm = createLlm({ transport: openRouterTransport({ apiKey: KEY }), roster: () => roster, ledger, session: 'judge' });

  // Exchanges with something to judge: two people and at least three lines.
  const all: Sample[] = [];
  for (const seed of [1, 2]) all.push(...sampleDay(sampleTown(seed), 150, seed));
  const talk = all.filter((s) => s.kind === 'talk' && s.lines.length >= 3);
  const rep = repetition(all, 30);

  // Every exchange through the decision model, a few at a time.
  const rated: { sample: Sample; rate: RateOutput }[] = [];
  for (let i = 0; i < talk.length; i += 8) {
    const part = talk.slice(i, i + 8);
    const out = await Promise.all(part.map((s) => llm.decide('talk.rate', { exchange: asText(s) })));
    out.forEach((r, k) => rated.push({ sample: part[k], rate: r.output }));
  }
  const good = (r: RateOutput) => r.naturalness >= 4 && r.fits >= 0.5;
  const natural = rated.filter((r) => good(r.rate)).length / rated.length;

  // A sample through the judge, which sees what recurs across the whole day.
  const repeated = rep.worst.filter(([, c]) => c >= 3).map(([line, count]) => ({ line, count }));
  const judged = [...talk.filter((_, i) => i % 2 === 0).slice(0, N), ...talk.filter((_, i) => i % 2 === 1).slice(0, N)];
  const scored: { sample: Sample; score: JudgeScore }[] = [];
  for (let i = 0; i < judged.length; i += BATCH) {
    const batch = judged.slice(i, i + BATCH);
    const r = await llm.run('talk.judge', { exchanges: batch.map(asText), repeated, sampleSize: all.length });
    r.output.forEach((score, k) => scored.push({ sample: batch[k], score }));
  }
  const mean = (f: (s: JudgeScore) => number) => scored.reduce((a, s) => a + f(s.score), 0) / scored.length;
  const coherence = mean((s) => s.coherence), naturalness = mean((s) => s.naturalness);

  console.log(`\nrepetition: ${rep.sentences} sentences of 4+ words, ${(rep.repeated * 100).toFixed(0)}% said more than once; top: ${rep.worst.slice(0, 8).map(([t, c]) => `"${t}" ×${c}`).join(', ')}`);
  console.log(`decision model: ${rated.length} exchanges, ${(natural * 100).toFixed(0)}% natural, mean naturalness ${(rated.reduce((a, r) => a + r.rate.naturalness, 0) / rated.length).toFixed(2)}`);
  console.log(`${MODEL}: ${scored.length} exchanges, coherence ${coherence.toFixed(2)}, naturalness ${naturalness.toFixed(2)}, judge ${((coherence + naturalness) / 2).toFixed(2)}; total cost $${ledger.total().cost.toFixed(4)}`);
  const worst = [...scored].sort((a, b) => a.score.coherence + a.score.naturalness - b.score.coherence - b.score.naturalness).slice(0, 12);
  for (const w of worst) console.log(`\n[${w.score.coherence}/${w.score.naturalness}] ${w.score.note}\n${asText(w.sample).replace(/^/gm, '  ')}`);
  const flagged = rated.filter((r) => !good(r.rate)).slice(0, 8);
  for (const f of flagged) console.log(`\n[jev ${f.rate.naturalness.toFixed(1)}, fits ${f.rate.fits.toFixed(2)}]\n${asText(f.sample).replace(/^/gm, '  ')}`);
  if (process.env.LLM_REPORT) fs.writeFileSync(process.env.LLM_REPORT, JSON.stringify({ repetition: rep, rated, scored }, null, 2));
  // Floors, so a regression shows: the engine should read as people talking.
  assert.ok(coherence >= 3.5, `coherence ${coherence.toFixed(2)}`);
  assert.ok(natural >= 0.6, `natural ${(natural * 100).toFixed(0)}%`);
});

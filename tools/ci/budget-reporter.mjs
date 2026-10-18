/**
 * A node:test reporter that keeps the fast suite fast (docs/CI.md): it prints one line per failure
 * (with its error) and a summary, and then checks tools/ci/budget.json: no single top-level test over `perTestMs`, no test file over
 * `perFileMs`, the whole run under `totalMs`. A breach fails the run (exit code 1) and names the
 * slowest offenders, so a slow test is moved to test/slow/ or made faster before it can pile up.
 *
 * Node built-ins only. Used by `npm test` (`--test-reporter=./tools/ci/budget-reporter.mjs`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUDGET = JSON.parse(fs.readFileSync(path.join(HERE, 'budget.json'), 'utf8'));
// A machine much slower than CI (a busy laptop) can scale the limits: CI_BUDGET_SCALE=2.
const SCALE = Number(process.env.CI_BUDGET_SCALE || 1);

/** Budget breaches for collected timings (pure, tested). */
export function breaches(tests, files, totalMs, budget = BUDGET, scale = SCALE) {
  const out = [];
  for (const t of tests) if (t.ms > budget.perTestMs * scale) out.push(`test over ${budget.perTestMs * scale} ms: ${t.ms.toFixed(0)} ms  ${t.name}  (${t.file})`);
  for (const [file, ms] of files) if (ms > budget.perFileMs * scale) out.push(`file over ${budget.perFileMs * scale} ms: ${ms.toFixed(0)} ms  ${file}`);
  if (totalMs > budget.totalMs * scale) out.push(`suite over ${budget.totalMs * scale} ms: ${totalMs.toFixed(0)} ms`);
  return out;
}

export default async function* budgetReporter(source) {
  const tests = [];
  const files = new Map();
  const t0 = performance.now();
  let pass = 0, fail = 0;
  for await (const event of source) {
    if (event.type === 'test:diagnostic' && event.data.nesting === 0) continue;
    if (event.type !== 'test:pass' && event.type !== 'test:fail') continue;
    const d = event.data;
    if (d.details?.type === 'suite') continue;
    const file = d.file ? path.relative(process.cwd(), d.file) : '?';
    if (event.type === 'test:fail') {
      fail++;
      const err = d.details?.error;
      yield `FAIL ${file} > ${d.name}\n${String(err?.cause?.stack ?? err?.cause ?? err?.message ?? err).split('\n').map((l) => '    ' + l).join('\n')}\n`;
    } else pass++;
    if (d.nesting === 0) {
      const ms = d.details?.duration_ms ?? 0;
      tests.push({ name: d.name, file, ms });
      files.set(file, (files.get(file) ?? 0) + ms);
    }
  }
  const totalMs = performance.now() - t0;
  const out = breaches(tests, files, totalMs);
  const slowest = [...tests].sort((a, b) => b.ms - a.ms).slice(0, 5);
  yield `${pass} passed, ${fail} failed, ${files.size} files.\n`;
  yield `CI budget (tools/ci/budget.json): ${(totalMs / 1000).toFixed(1)} s of ${(BUDGET.totalMs * SCALE / 1000).toFixed(0)} s. Slowest: ${slowest.map((t) => `${t.name} ${t.ms.toFixed(0)} ms`).join(', ') || 'none'}\n`;
  if (out.length) {
    yield `CI BUDGET BREACHED. Make it faster or move it to test/slow/ (docs/CI.md):\n${out.map((l) => '  ' + l).join('\n')}\n`;
    process.exitCode = 1;
  }
}

/**
 * What a PR's tests cost: compares this run's suite timings with main's last green run (both written by the
 * budget reporter with CI_TIMES_OUT) and prints the change in total time and the files that moved most.
 * `node tools/ci/suite-diff.mjs <main.json> <pr.json>`; CI appends the output to the job summary. Report only:
 * runner timing jitters by a few hundred ms, the budget (tools/ci/budget.json) is what fails a run.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const s = (ms) => `${(ms / 1000).toFixed(1)} s`;
const signed = (ms) => `${ms >= 0 ? '+' : '−'}${(Math.abs(ms) / 1000).toFixed(1)} s`;

/** Markdown lines for the change from `base` to `head` (pure, tested). */
export function suiteDiff(base, head, top = 6) {
  const lines = [`**Fast suite: ${s(head.totalMs)}** (main ${s(base.totalMs)}, ${signed(head.totalMs - base.totalMs)}; ${head.tests} tests, main ${base.tests}).`];
  const files = new Set([...Object.keys(base.files), ...Object.keys(head.files)]);
  const moved = [...files].map((f) => ({ f, a: base.files[f], b: head.files[f], d: (head.files[f] ?? 0) - (base.files[f] ?? 0) }))
    .filter((x) => Math.abs(x.d) >= 100).sort((x, y) => Math.abs(y.d) - Math.abs(x.d)).slice(0, top);
  if (moved.length) {
    lines.push('', '| File | main | this PR | change |', '|---|---|---|---|');
    for (const x of moved) lines.push(`| ${x.f} | ${x.a === undefined ? 'new' : s(x.a)} | ${x.b === undefined ? 'gone' : s(x.b)} | ${signed(x.d)} |`);
  }
  return lines;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [basePath, headPath] = process.argv.slice(2);
  const head = JSON.parse(fs.readFileSync(headPath, 'utf8'));
  if (!basePath || !fs.existsSync(basePath)) console.log(`**Fast suite: ${s(head.totalMs)}** (${head.tests} tests; no timings from main to compare).`);
  else console.log(suiteDiff(JSON.parse(fs.readFileSync(basePath, 'utf8')), head).join('\n'));
}

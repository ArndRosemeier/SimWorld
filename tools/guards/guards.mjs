/**
 * SimWorld's code guards: the tripwires of docs/design/no-duplicates.md, layer 3.
 *
 *  - banned:      patterns that may only appear in the one file that owns them (rules.json "banned").
 *  - layers:      which folders may import which (rules.json "layers").
 *  - duplication: the Toolbox finders (repeated-code, duplicate-candidates) run over src/ AND the shared
 *                 packages; every finding must be listed in duplication-baseline.json with a reason, and
 *                 every baseline entry must still be found (a folded copy goes red as stale).
 *
 * Node built-ins only, like the Toolbox. Each check returns a list of problems (empty: green).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findBodyClones, findIdioms } from '../repeated-code/find-repeated-code.mjs';
import { scanTree, groupCandidates, extractFunctions, listSourceFiles, DEFAULT_CONFIRM_FLOOR } from '../duplicate-candidates/find-duplicate-candidates.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '..', '..');
export const RULES = JSON.parse(fs.readFileSync(path.join(HERE, 'rules.json'), 'utf8'));
export const BASELINE_FILE = path.join(HERE, 'duplication-baseline.json');

const EXT = /\.(ts|tsx|mts|js|mjs)$/;

/** Every source file under `dir` (relative to `root`), sorted, skipping node_modules and declaration files. */
export function listFiles(root, dir) {
  const out = [];
  const walk = (d) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (e.isSymbolicLink() || e.name === 'node_modules') continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (EXT.test(e.name) && !e.name.endsWith('.d.ts')) out.push(path.relative(root, full).split(path.sep).join('/'));
    }
  };
  walk(path.join(root, dir));
  return out;
}

/** Blank out comments and string contents so patterns only match code. */
export function codeOnly(src) {
  return src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|(['"`])(?:\\.|(?!\1)[^\\\n])*\1/g, (m) => (m.startsWith('/') ? m.replace(/[^\n]/g, ' ') : m[0] + ' '.repeat(Math.max(0, m.length - 2)) + m[0]));
}

const prefixMatch = (file, p) => file === p || file.startsWith(p.endsWith('/') ? p : p + '/');

/** Banned patterns: `{ id, pattern, flags?, only: [files or folders], why }`. */
export function checkBanned(root, files, rules = RULES.banned) {
  const problems = [];
  for (const file of files) {
    const code = codeOnly(fs.readFileSync(path.join(root, file), 'utf8'));
    for (const r of rules) {
      if ((r.only || []).some((p) => prefixMatch(file, p))) continue;
      const re = new RegExp(r.pattern, r.flags || 'g');
      let m;
      while ((m = re.exec(code))) {
        const line = code.slice(0, m.index).split('\n').length;
        problems.push(`${file}:${line}  ${r.id}: ${r.why}${r.only?.length ? ` (only in ${r.only.join(', ')})` : ''}`);
        if (!re.global) break;
      }
    }
  }
  return problems;
}

/** The index of the bracket closing the one at `open` (code from `codeOnly`), or -1. */
function closing(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    const c = code[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if ((c === ')' || c === ']' || c === '}') && --depth === 0) return i;
  }
  return -1;
}

/** Where the top-level argument after `i` starts: the index past the last top-level comma inside `[from, to)`. */
function lastArgStart(code, from, to) {
  let depth = 0, at = -1;
  for (let i = from; i < to; i++) {
    const c = code[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) at = i + 1;
  }
  return at;
}

const SHADER_INPUT = '(?:uniform|uniformArray|attribute|texture|storage)';

/**
 * A typed TSL Fn (one with a layout: `Fn(f, { p: 'vec2', return: 'vec4' })`) reads only its parameters (docs/SHADERS.md):
 * three builds its code once per backend and reuses it in every later build, so a uniform, attribute or texture it
 * closed over is declared only in the first build and the next one fails. Flags a typed Fn's body that names an
 * uppercase bag's member (`P.rot`, `LIGHT.night`), makes a shader input, or names one the file made at its top.
 */
export function checkTypedFns(root, files) {
  const problems = [];
  for (const file of files) {
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    if (!/\bFn\s*\(/.test(src)) continue;
    const code = codeOnly(src);
    const inputs = new Set([...code.matchAll(new RegExp(`\\b(?:const|let)\\s+(\\w+)\\s*=\\s*${SHADER_INPUT}\\s*\\(`, 'g'))].map((m) => m[1]));
    for (const m of code.matchAll(/\bFn\s*\(/g)) {
      const open = m.index + m[0].length - 1, close = closing(code, open);
      const split = close < 0 ? -1 : lastArgStart(code, open + 1, close);
      if (split < 0 || !/^\s*\{[\s\S]*\breturn\s*:/.test(code.slice(split, close))) continue;
      const body = code.slice(open + 1, split - 1), names = new Set();
      // Its own names: the parameters it destructures and whatever it declares or assigns.
      const own = new Set([...(/^\s*\(\s*[[{]([^\]}]*)[\]}]/.exec(body)?.[1].match(/\w+/g) ?? []), ...[...body.matchAll(/\b(\w+)\s*=(?![=>])/g)].map((h) => h[1])]);
      for (const h of body.matchAll(/\b([A-Z][A-Z0-9_]*)\s*\.\s*[A-Za-z_]/g)) if (!own.has(h[1])) names.add(`${h[1]}.`);
      for (const h of body.matchAll(new RegExp(`\\b(${SHADER_INPUT})\\s*\\(`, 'g'))) names.add(`${h[1]}()`);
      for (const h of body.matchAll(/\b\w+\b/g)) if (inputs.has(h[0]) && !own.has(h[0])) names.add(h[0]);
      if (names.size) problems.push(`${file}:${code.slice(0, m.index).split('\n').length}  typed Fn reads ${[...names].join(', ')}: a typed Fn reads only its parameters; pass them in, or leave the layout off (docs/SHADERS.md)`);
    }
  }
  return problems;
}

const IMPORT_RE = /(?:import|export)\s[^'"]*?from\s*(['"])([^'"]+)\1|import\s*\(\s*(['"])([^'"]+)\3\s*\)|import\s*(['"])([^'"]+)\5/g;
/** `import type { … } from` / `export type { … } from`: erased at build time, no code dependency. */
const TYPE_ONLY_RE = /^(?:import|export)\s+type\s/;

/** The specifiers a file imports, resolved to repo paths for relative ones; with `withKind`, each as `{ spec, typeOnly }`. */
export function importsOf(root, file, opts = {}) {
  const src = fs.readFileSync(path.join(root, file), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
  const out = [];
  let m;
  while ((m = IMPORT_RE.exec(src))) {
    const spec = m[2] || m[4] || m[6];
    const typeOnly = TYPE_ONLY_RE.test(m[0]);
    const resolved = spec.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(file), spec)) : spec;
    out.push(opts.withKind ? { spec: resolved, typeOnly } : resolved);
  }
  return out;
}

/**
 * Layer rules: `{ from: folder, deny: [folders or package names], why, types?, allow? }`. A package
 * name also denies its subpaths. `types`: denied folders whose `import type` is fine (erased, no code
 * dependency). `allow`: modules inside a denied folder that may be imported anyway (named exceptions).
 */
export function checkLayers(root, files, rules = RULES.layers) {
  const problems = [];
  for (const file of files) {
    const rs = rules.filter((r) => prefixMatch(file, r.from));
    if (!rs.length) continue;
    for (const { spec: imp, typeOnly } of importsOf(root, file, { withKind: true })) {
      for (const r of rs) {
        const hit = r.deny.find((d) => prefixMatch(imp, d) || imp === d);
        if (!hit) continue;
        if (typeOnly && (r.types || []).some((t) => prefixMatch(imp, t) || imp === t)) continue;
        if ((r.allow || []).some((a) => imp === a || imp === a.replace(/\.ts$/, ''))) continue;
        problems.push(`${file}  imports ${imp}: ${r.from} may not import ${hit} (${r.why})`);
      }
    }
  }
  return problems;
}

/** Copy the scanned roots into one temp tree so cross-root copies are found too. */
function stage(root, roots) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'simworld-dup-'));
  for (const [name, dir] of Object.entries(roots)) {
    for (const f of listFiles(root, dir)) {
      if (/\.test\.|\/test\//.test(f)) continue;
      const dst = path.join(tmp, 'scan', name, path.relative(dir, f));
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(path.join(root, f), dst);
    }
  }
  return path.join(tmp, 'scan');
}

/** The current duplication findings as stable keys (names and files, never line numbers). */
/**
 * Duplication keys of the tree. `finders` picks which Toolbox finders run: 'clones' (bodies
 * copied under other names), 'idioms' (inline snippets recurring across files) and 'names'
 * (same-name candidates). The ratchet runs them as separate tests so each stays inside the
 * per-test CI budget; together they are what the Toolbox `scan` functions report.
 */
export function duplicationFindings(root = REPO, roots = RULES.duplication.roots, finders = ['clones', 'idioms', 'names']) {
  const dir = stage(root, roots);
  try {
    const out = [];
    if (finders.includes('clones') || finders.includes('idioms')) {
      const { files, display } = listSourceFiles(dir, { displayBase: dir });
      const sources = files.map((f) => ({ file: display(f), source: fs.readFileSync(f, 'utf8') }));
      if (finders.includes('clones')) {
        const fns = [];
        for (const { file, source } of sources) for (const fn of extractFunctions(source)) fns.push({ name: fn.name, file, line: fn.line, kind: fn.kind, size: fn.tokens.length, endLine: fn.tokens.length ? fn.tokens[fn.tokens.length - 1].line : fn.line, tokens: fn.tokens });
        fns.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)));
        for (const c of findBodyClones(fns).clusters) out.push(`clone: ${[...new Set(c.fns.map((f) => `${f.file}#${f.name}`))].sort().join(' + ')}`);
      }
      if (finders.includes('idioms')) {
        for (const d of findIdioms(sources).idioms) out.push(`idiom: [${d.names.join(' ')}] in ${[...new Set(d.at.map((a) => a.file))].sort().join(' + ')}`);
      }
    }
    if (finders.includes('names')) {
      const tree = scanTree(dir, { displayBase: dir });
      const g = groupCandidates(tree.functions, { nearNames: false }); // tiers 1 and 2 only
      for (const p of [...g.tier1, ...g.tier2]) {
        if ((p.status === 'compared' || p.status === 'confirmed') && p.sim >= DEFAULT_CONFIRM_FLOOR) out.push(`same name: ${[`${p.a.file}#${p.a.name}`, `${p.b.file}#${p.b.name}`].sort().join(' + ')}`);
      }
    }
    return [...new Set(out)].sort();
  } finally {
    fs.rmSync(path.dirname(dir), { recursive: true, force: true });
  }
}

/** Ratchet: findings not in the baseline are new copies; baseline entries no longer found are stale. */
export function checkDuplication(findings, baseline) {
  const known = new Map(baseline.map((b) => [b.key, b]));
  const found = new Set(findings);
  const problems = [];
  for (const f of findings) if (!known.has(f)) problems.push(`NEW ${f}\n    Fold it into one seam (docs/ARCHITECTURE.md), or add it to tools/guards/duplication-baseline.json with a reason.`);
  for (const b of baseline) {
    if (!b.reason || !b.reason.trim()) problems.push(`UNEXPLAINED ${b.key}: a baseline entry needs a reason.`);
    if (!found.has(b.key)) problems.push(`STALE ${b.key}\n    No longer found: delete its line from tools/guards/duplication-baseline.json.`);
  }
  return problems;
}

export function readBaseline() {
  return JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
}

// `node tools/guards/guards.mjs` prints every check; `--keys` prints the current duplication keys.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--keys')) {
    console.log(JSON.stringify(duplicationFindings().map((key) => ({ key, reason: '' })), null, 2));
  } else {
    // The repo check, run first by `npm test`: banned patterns, layers and the duplication ratchet in one scan,
    // under its own time cap (tools/ci/budget.json `guardsMs`; it grows with the code, not with the tests).
    const t0 = performance.now();
    const files = listFiles(REPO, 'src');
    const stray = readBaseline().filter((b) => !/^(clone|idiom|same name):/.test(b.key)).map((b) => `STRAY baseline line (no finder makes such keys): ${b.key}`);
    const all = [...checkBanned(REPO, files), ...checkTypedFns(REPO, files), ...checkLayers(REPO, files), ...checkDuplication(duplicationFindings(), readBaseline()), ...stray];
    const ms = performance.now() - t0;
    const cap = JSON.parse(fs.readFileSync(path.join(HERE, '../ci/budget.json'), 'utf8')).guardsMs * Number(process.env.CI_BUDGET_SCALE || 1);
    if (ms > cap) all.push(`guards over ${cap} ms: ${ms.toFixed(0)} ms (docs/CI.md)`);
    console.log(all.length ? all.join('\n') : `guards: all green (${(ms / 1000).toFixed(1)} s of ${(cap / 1000).toFixed(0)} s)`);
    if (all.length) process.exitCode = 1;
  }
}

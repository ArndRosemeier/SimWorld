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
import { scan as scanRepeated } from '../repeated-code/find-repeated-code.mjs';
import { scanTree, groupCandidates, DEFAULT_CONFIRM_FLOOR } from '../duplicate-candidates/find-duplicate-candidates.mjs';

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

const IMPORT_RE = /(?:import|export)\s[^'"]*?from\s*(['"])([^'"]+)\1|import\s*\(\s*(['"])([^'"]+)\3\s*\)|import\s*(['"])([^'"]+)\5/g;

/** The specifiers a file imports, resolved to repo paths for relative ones. */
export function importsOf(root, file) {
  const src = fs.readFileSync(path.join(root, file), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
  const out = [];
  let m;
  while ((m = IMPORT_RE.exec(src))) {
    const spec = m[2] || m[4] || m[6];
    if (spec.startsWith('.')) out.push(path.posix.normalize(path.posix.join(path.posix.dirname(file), spec)));
    else out.push(spec);
  }
  return out;
}

/** Layer rules: `{ from: folder, deny: [folders or package names], why }`. A package name also denies its subpaths. */
export function checkLayers(root, files, rules = RULES.layers) {
  const problems = [];
  for (const file of files) {
    const rs = rules.filter((r) => prefixMatch(file, r.from));
    if (!rs.length) continue;
    for (const imp of importsOf(root, file)) {
      for (const r of rs) {
        const hit = r.deny.find((d) => prefixMatch(imp, d) || imp === d);
        if (hit) problems.push(`${file}  imports ${imp}: ${r.from} may not import ${hit} (${r.why})`);
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
export function duplicationFindings(root = REPO, roots = RULES.duplication.roots) {
  const dir = stage(root, roots);
  try {
    const rep = scanRepeated(dir, { displayBase: dir });
    const clones = rep.clones.clusters.map((c) => `clone: ${[...new Set(c.fns.map((f) => `${f.file}#${f.name}`))].sort().join(' + ')}`);
    const idioms = rep.idioms.idioms.map((d) => `idiom: [${d.names.join(' ')}] in ${[...new Set(d.at.map((a) => a.file))].sort().join(' + ')}`);
    const tree = scanTree(dir, { displayBase: dir });
    const g = groupCandidates(tree.functions);
    const names = [...g.tier1, ...g.tier2]
      .filter((p) => (p.status === 'compared' || p.status === 'confirmed') && p.sim >= DEFAULT_CONFIRM_FLOOR)
      .map((p) => `same name: ${[`${p.a.file}#${p.a.name}`, `${p.b.file}#${p.b.name}`].sort().join(' + ')}`);
    return [...new Set([...clones, ...idioms, ...names])].sort();
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
    const files = listFiles(REPO, 'src');
    const all = [...checkBanned(REPO, files), ...checkLayers(REPO, files), ...checkDuplication(duplicationFindings(), readBaseline())];
    console.log(all.length ? all.join('\n') : 'guards: all green');
  }
}

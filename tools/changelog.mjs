/**
 * Folds the change notes in changes/ (one file per PR, see changes/README.md) into CHANGELOG.md,
 * numbered in the order they were merged, and deletes them. Runs on main after each merge
 * (.github/workflows/changelog.yml), so no branch picks a version and PRs never fight over the top
 * of CHANGELOG.md. `node tools/changelog.mjs` folds; `--check` only validates the notes.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** A change note: `# Title`, a blank line, then `- ` bullets. Returns its title and body, or throws. */
export function parseNote(name, md) {
  const lines = md.replace(/\r/g, '').trim().split('\n');
  const head = /^# (.+)$/.exec(lines[0] ?? '');
  if (!head) throw new Error(`${name}: the first line must be "# Title"`);
  const body = lines.slice(1).join('\n').trim();
  if (!/^- /m.test(body)) throw new Error(`${name}: needs at least one "- " bullet`);
  if (/^#{1,2} /m.test(body)) throw new Error(`${name}: one note per file, no further headings (and no version: it is given on merge)`);
  return { title: head[1].trim(), body };
}

/** CHANGELOG.md with `notes` (oldest merged first) added on top as the next versions. */
export function fold(changelog, notes) {
  const top = /^## v0\.(\d+)/m.exec(changelog);
  let n = top ? Number(top[1]) : 0;
  const entries = notes.map((note) => `## v0.${String(++n).padStart(3, '0')} — ${note.title}\n\n${note.body}\n\n`);
  const at = changelog.indexOf('## ');
  return at < 0 ? `${changelog.trimEnd()}\n\n${entries.reverse().join('')}` : changelog.slice(0, at) + entries.reverse().join('') + changelog.slice(at);
}

/** The notes in `dir`, oldest merged first (when git added each file; then by name). */
export function notesIn(dir) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'README.md');
  const added = (f) => {
    const log = execFileSync('git', ['log', '--diff-filter=A', '--format=%ct', '--', `${dir}/${f}`], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    return log.length ? Number(log[log.length - 1]) : Infinity; // (not committed yet: last)
  };
  return files.map((f) => ({ f, t: added(f), ...parseNote(f, readFileSync(`${dir}/${f}`, 'utf8')) })).sort((a, b) => a.t - b.t || a.f.localeCompare(b.f));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const notes = notesIn('changes');
  if (process.argv.includes('--check')) { console.log(`${notes.length} change notes ok`); process.exit(0); }
  if (!notes.length) { console.log('nothing to fold'); process.exit(0); }
  writeFileSync('CHANGELOG.md', fold(readFileSync('CHANGELOG.md', 'utf8'), notes));
  for (const note of notes) rmSync(`changes/${note.f}`);
  console.log(notes.map((x) => x.title).join('\n'));
}

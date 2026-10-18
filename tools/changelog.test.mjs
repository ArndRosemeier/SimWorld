import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fold, lastMerge, notesIn, parseNote, versionName } from './changelog.mjs';

test('changelog: 0.001 per merge, rolling over to 1.000 at merge 1000', () => {
  assert.equal(versionName(1), 'v0.001');
  assert.equal(versionName(999), 'v0.999');
  assert.equal(versionName(1000), 'v1.000');
  assert.equal(lastMerge('# Changelog\n\n## v1.002 — x\n\n## v1.001 — y\n'), 1002);
  assert.equal(lastMerge('# Changelog\n'), 0);
});

test('changelog: notes fold on top in merge order, continuing the numbers', () => {
  const notes = [parseNote('a.md', '# First\n\n- one'), parseNote('b.md', '# Second\n\n- two')];
  const out = fold('# Changelog\n\n## v0.999 — Old\n\n- old\n', notes);
  assert.match(out, /## v1\.001 — Second[\s\S]*## v1\.000 — First[\s\S]*## v0\.999 — Old/);
  assert.match(fold('# Changelog\n', notes), /## v0\.002 — Second[\s\S]*## v0\.001 — First/);
});

test('changelog: a note needs a title and a bullet, and no version of its own', () => {
  assert.throws(() => parseNote('x.md', 'no title\n\n- a'), /first line/);
  assert.throws(() => parseNote('x.md', '# T\n\njust text'), /bullet/);
  assert.throws(() => parseNote('x.md', '# T\n\n- a\n\n## v0.002'), /no version/);
});

test('changelog: the notes waiting in changes/ are valid', () => {
  assert.doesNotThrow(() => notesIn('changes'));
});

# Change notes

Each PR adds one file here instead of editing CHANGELOG.md: `changes/<short-slug>.md`, like

```md
# Rats that stop fidgeting

- What a player notices, in plain words.
- Another bullet if needed.
```

No version number: after the merge, `.github/workflows/changelog.yml` folds every note on main into CHANGELOG.md as the next version (v0.001 + 0.001 per merge, in merge order; merge 1000 is v1.000) and deletes the file. Several PRs may merge at once: the fold runs one at a time and always takes every note on main, so the numbers never collide. The newest version is the game's version, and the What's new button (`src/app/whatsNew.ts`) shows the whole file.

CI fails a PR that adds no note, since every merge is a version. `node tools/changelog.mjs --check` validates the notes (npm test does too).

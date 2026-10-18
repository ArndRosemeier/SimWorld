# Change notes

Each PR adds one file here instead of editing CHANGELOG.md: `changes/<short-slug>.md`, like

```md
# Rats that stop fidgeting

- What a player notices, in plain words.
- Another bullet if needed.
```

No version number: after the merge, `.github/workflows/changelog.yml` folds every note on main into CHANGELOG.md as the next version (v0.001 + 0.001 per merge, in merge order) and deletes the file. Then the What's new panel and the Pages build carry it. `node tools/changelog.mjs --check` validates the notes (npm test does too).

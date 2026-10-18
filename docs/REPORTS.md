# Reports and the debug menu

## For Arnd: reporting a spot

1. Press **F8** (or **Shift+Ctrl+F12** for the debug menu, then **Report this spot**).
2. Type what is wrong (optional), press **Copy report** and paste it into the project chat.
3. When the window says the world cannot be rebuilt from seed and time alone (you loaded a save or skipped time), also press **Download the save too** and attach the file to the same message.

## For threads: picking up a report

A report is a text block that starts `Total Town report`. The lines that matter most:

| Line | What it is |
|---|---|
| `Note:` | What Arnd saw. |
| `Repro:` | A link that loads the same situation: the town (`seed`, `size`), the time (`date` the day play began and `clock` the world's minute, or `date` and `time` when not exact), who (`be`), where they stand (`stand=x,y,z,yaw,building`) and look (`look=orbit,pitch`), `autopilot` if their routine ran them, plus any other parameters the page had (`wx`, `speed`, `tex`, …). |
| `Exact:` | `yes`: a fresh start with that seed, start date and clock lives the same history to the same minute (the live tick is one step per game minute either way), so the link alone reproduces everyone. Only the player's own person can differ (from the moment they were picked, their routine stopped). `no`: the world came from a save or a time skip; the attached save file reproduces it (`&save=<url>`); without it only the spot, the person and the time of day match. |
| `Playing:`, `Inside:`, `Body:` | The person, their building (`Place.building` code, decoded by `buildingRef`), floor, and where the body stands. |
| `Camera:`, `Frames:`, `Browser:` | Camera mode, position and direction; FPS and shader stats; browser, screen and GPU. |
| `Console` | The last 30 console errors and warnings of the page (main thread), repeats counted. |

### Reproducing it headless

```sh
npm run build
node tools/repro/open.mjs "<the Repro: link, or a file holding the report>" [--save <the save file>] [--out repro-out] [--wait 25]
```

It serves `dist/` locally, swaps the link's host for it, opens it in headless Chromium (software WebGL, slow: the town takes a minute or two), waits for the town and then `--wait` seconds for the take-over, and writes `repro.png` plus `report.txt`, the game's own report of where it ended up (compare its `Body:` with the original). A save Arnd attached lands in `/mnt/project-files/uploads/hearth/`; pass it with `--save`.

In any browser, `debugReport()` in the console prints the same text as the window.

Opening a repro link (`clock`, `stand` or `save` in the URL) never replaces the player's own save of that town: autosave is off for it.

### Fixing from a report

Reproduce first, fix, then open the same link on your build and check the `Body:` and screenshot again. Say in the PR which report it fixes (the note line).

## Looking into a spot

The debug menu's own tools, for Arnd and for threads in a headless browser:

- **Go to**: `#123` a person (beside them, or inside their building), `b 65539` a building (just inside its first street door; the code as `Inside:` shows it), `x, z` a point. The body moves there; on autopilot you take the wheel first.
- **Free camera**: from where the camera is, W A S D along the view (Shift faster), Q and E down and up, drag to look, through walls and floors; Escape or the switch goes back.
- **Colliders** (magenta): what the player's body bumps into round where you are, as the physics world has it: walls, furniture, door leaves, ramps, posts, trees, parked cars, the body itself.
- **Door boxes and reach**: the shown interior's door leaves and street doorways (cyan), and the street doors near with the 4 m reach that brings their interior up (yellow).
- **Walk lines**: where everyone out of doors is walking, from a minute ago to six minutes ahead (green; yours orange).

## Adding to the debug menu

The debug menu is the one place for developer tools: no thread adds its own debug key, overlay or button. It is made once in `bootTown` (src/game/boot.ts) as `debug`; the game's own tools are in `addDebugTools` (src/game/debugTools.ts). Add yours where your part of the game is made, or in `addDebugTools` when it needs the game's pieces:

```ts
debug.add({ label: 'Show door boxes', group: 'Show', isOn: () => shown, set: (on) => { shown = on; } });
debug.add({ label: 'Rebuild the signs', group: 'Render', run: () => signs.rebuild(), key: { code: 'F9' } });
debug.add({ label: 'Weather', group: 'Time', custom: () => weatherSelect() });
debug.addInfo(() => `signs ${signs.count} drawn`);
```

Groups: `Report`, `Time`, `Play`, `Go`, `Show`, `Render`. A switch reads `isOn()` each time the panel opens; an info line is read four times a second while it is open, so keep it cheap. A `key` works with the panel shut too (check `docs/ARCHITECTURE.md` and the panel for keys already taken: F8 is the report, Shift+Ctrl+F12 the panel).

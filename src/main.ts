/**
 * Entry point: the small first chunk. It puts up the title screen (src/app/title.ts: the name, the alpha badge, a
 * town at dusk, the title music on the first click) and only then loads the game (src/game/boot.ts: three.js, the
 * shaders' warm-up, the town's build, the sim's year of history), which offers the way in once everything is ready.
 * Nothing here may import three or the renderer: that is what keeps the title quick. URL options are listed in
 * src/game/boot.ts.
 */
import { settingsFromQuery } from './world/settings';
import { TitleScreen } from './app/title';
import { VERSION, whatsNewButton } from './app/whatsNew';
import { reloadForUpdate } from './app/update';
import { TownAudio } from './audio/townAudio';

const { seed } = settingsFromQuery(new URLSearchParams(location.search));
// Sound starts with the first click or key (browsers allow nothing earlier): the title music, then the town.
const audio = new TownAudio(seed);
const title = new TitleScreen(seed, audio.engine, VERSION);
title.root.append(whatsNewButton());
void audio.init();

import('./game/boot').then(
  ({ bootTown }) => bootTown(title, audio),
  (err: unknown) => {
    // The game's chunk is not on the server any more: this page is from an earlier deploy.
    if (reloadForUpdate((t) => title.step(t))) return;
    title.fail('Total Town was updated. Reload the page with Ctrl+F5.');
    throw err;
  },
);

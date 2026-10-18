# Sound library

Every clip in `public/sounds/`, where it came from and under what terms. The manifest
`public/sounds/manifest.json` lists each sound id with its files (variations), whether it loops, its playback gain and its
mix category (`src/audio/engine.ts`). The music is in [MUSIC.md](MUSIC.md). There is no speech audio (no text to speech,
decided).

## New for SimWorld (2026-10-18)

Made with **ByteDance Seed Audio** (`bytedance-seed/seed-audio-1-0`) through OpenRouter's speech endpoint: a speech
model that renders a sound instead of reading the words when the input starts with "The sound of …" (Arnd's find in
Scale). `tools/sounds/studio.mjs seed` makes the takes (4 to 9 per sound, about 1.2 cents each), `studio.mjs listen` has
`google/gemini-3.8-flash` describe each take blind and then score what it heard against the wanted sound
(`tools/sounds/prompts.json`); the best-scored take won, and the cut clips were listened to again the same way (a cut that
read as something else was dropped). `tools/sounds/build.mjs` cuts them per `tools/sounds/cuts.json`: mono 32 kHz,
one-shots trimmed to the onset, faded out and peak-normalised to −1 dBFS; loops cross-faded tail into head and set to
−24 dBFS RMS; Ogg Vorbis. Raw takes and verdicts: `/mnt/project-files/simworld/sounds/raw/<id>/` (project files).

Synthesized versions of the bell, peal, school bell, dog, rooster, mower and trains were tried first and lost every
blind comparison (the toll came closest, 8.5 against 10), so none is in the game.

Weakest clip: `lawnmower` (the listener heard "a small two-stroke engine, like a chainsaw or weed whacker"; no take did
better). `kids_playground` is screams and laughter more than a schoolyard's murmur, played quietly. Both are worth
replacing when a better source exists (Arnd's Sound Studio with Stable Audio is the obvious one).

| id | files | category | Seed Audio input | cut from |
|---|---|---|---|---|
| amb_country_day | amb_country_day.ogg | ambience | "The sound of a quiet open meadow on a dry sunny afternoon, a gentle breeze, skylarks singing high above, a distant tractor, continuous" | `amb_country_day/seed5` 0–22.0 s (loop) |
| amb_country_night | amb_country_night.ogg | ambience | "The sound of crickets chirping steadily in a field on a warm summer night, continuous, no birds" | `amb_country_night/seed9` 0–26.5 s (loop) |
| bell_toll | bell_toll.ogg | bells | "The sound of a single toll of a big church bell in a small town, ringing out and slowly fading" | `bell_toll/seed1` 0–8.5 s |
| bell_peal | bell_peal.ogg | bells | "The sound of a ring of church bells pealing in rounds from a stone tower on a Sunday morning, many bells ringing one after another, continuous, outdoors" | `bell_peal/seed5` 0.5–15.0 s (loop) |
| school_bell | school_bell.ogg | bells | "The sound of an old electric school bell ringing loudly for three seconds at the end of a lesson" | `school_bell/seed2` 0–4.5 s |
| crossing_bells | crossing_bells.ogg | traffic | "The sound of the warning bells of a railway level crossing ringing steadily" | `crossing_bells/seed4` 0.5–11.5 s (loop) |
| kids_playground | kids_playground.ogg | people | "The sound of children playing and laughing in a schoolyard during break time, heard from across the street, continuous" | `kids_playground/seed2` 0.3–23.4 s (loop) |
| lawnmower | lawnmower.ogg | people | "The sound of someone mowing the lawn with a petrol push mower in the back garden, the four-stroke engine running steadily at full speed, continuous" | `lawnmower/seed2` 1.5–12.8 s (loop) |
| dog_bark | dog_bark_1.ogg, dog_bark_2.ogg, dog_bark_3.ogg, dog_bark_4.ogg | animals | "The sound of a medium-sized dog barking once outside in a back garden, a single loud woof" | `dog_bark/seed1` 0.3–0.8 s, `dog_bark/seed2` 1.75–2.3 s, `dog_bark/seed3` 0.25–0.8 s, `dog_bark/seed4` 1.5–2.05 s |
| dog_yap | dog_yap.ogg | animals | "The sound of a small terrier yapping a few times in a front garden" | `dog_yap/seed2` 0–2.4 s |
| rooster_crow | rooster_crow_1.ogg, rooster_crow_2.ogg | animals | "The sound of a rooster crowing once at dawn in a farmyard" | `rooster_crow/seed1` 0–2.5 s, `rooster_crow/seed3` 0–3.0 s |
| cow_moo | cow_moo_1.ogg, cow_moo_2.ogg, cow_moo_3.ogg | animals | "The sound of a cow mooing once in a meadow on a farm" | `cow_moo/seed1` 0–2.0 s, `cow_moo/seed2` 0–2.5 s, `cow_moo/seed4` 0–2.0 s |
| train_horn | train_horn_1.ogg, train_horn_2.ogg | traffic | "The sound of a train horn blowing once, one long blast, as a train approaches a level crossing" | `train_horn/seed3` 0–5.0 s, `train_horn/seed2` 0–4.5 s |
| train_pass | train_pass.ogg | traffic | "The sound of a regional passenger train passing by on the tracks, approaching, clattering past and fading away" | `train_pass/seed1` 0–19.5 s |

**Licence:** generated through OpenRouter with Seed Audio for SimWorld. OpenRouter's terms leave ownership of output to
each model provider's terms; ByteDance's terms for Seed Audio output were not checked from here, the same open point as
Scale's Seed Audio clips.

## From Scale

Copied from Scale (`ArndRosemeier/Scale`, commit `eee2b85`, `public/sounds/`), the same author's project; provenance in
Scale's `docs/SOUNDS.md`. Scale's `.wav` clips were re-encoded to Ogg Vorbis (q4) to keep the repo small; nothing else
changed. Stable Audio clips are under the [Stability AI Community License](https://stability.ai/license) (free below
USD 1M annual revenue); procedural ones are Scale's own code.

| id | files | category | how it was made |
|---|---|---|---|
| amb_city_day | amb_city_day.ogg | ambience | Stable Audio 3 Small-SFX (Scale docs/SOUNDS.md) |
| amb_city_night | amb_city_night.ogg | ambience | Stable Audio 3 Small-SFX (Scale docs/SOUNDS.md) |
| amb_park | amb_park.ogg | ambience | Stable Audio 3 Small-SFX (Scale docs/SOUNDS.md) |
| amb_river | amb_river.ogg | ambience | Stable Audio 3 Small-SFX (Scale docs/SOUNDS.md) |
| amb_sea | amb_sea.ogg | ambience | Stable Audio 3 Small-SFX (Scale docs/SOUNDS.md) |
| amb_interior | amb_interior.ogg | ambience | Stable Audio 3 Small-SFX (Scale docs/SOUNDS.md) |
| amb_crowd | amb_crowd.ogg | ambience | Stable Audio 3 Small-SFX (Scale docs/SOUNDS.md) |
| amb_rain_light | amb_rain_light.ogg | weather | procedural, Scale `tools/synthWeather.mjs` |
| amb_rain_heavy | amb_rain_heavy.ogg | weather | Stable Audio 3 Small-SFX (Scale docs/SOUNDS.md) |
| amb_wind_gust | amb_wind_gust.ogg | weather | Stable Audio 3 Small-SFX (Scale docs/SOUNDS.md) |
| thunder_near | thunder_near_1.ogg, thunder_near_2.ogg, thunder_near_3.ogg | weather | Scale: procedural (`tools/synthWeather.mjs`), some variants replaced by Stable Audio 3 Small-SFX |
| thunder_far | thunder_far_1.ogg, thunder_far_2.ogg, thunder_far_3.ogg | weather | Scale: Seed Audio (v0.254) |
| terrace_clatter | terrace_clatter.ogg | people | Seed Audio (Scale v0.254) |
| crowd_cheer | crowd_cheer.ogg | people | Stable Audio 3 Small-SFX (Scale docs/SOUNDS.md) |
| ref_whistle | ref_whistle.ogg | people | Stable Audio 3 Small-SFX (Scale docs/SOUNDS.md) |
| ball_kick | ball_kick.ogg | people | procedural, Scale `tools/synthSoccer.mjs` |
| bird_flutter | bird_flutter.ogg | animals | Seed Audio (Scale v0.254) |
| car_idle | car_idle.ogg | traffic | Stable Audio 3 Small-SFX (Scale docs/SOUNDS.md) |
| car_passby | car_passby.ogg | traffic | Stable Audio 3 Small-SFX (Scale docs/SOUNDS.md) |
| car_horn_short | car_horn_short_1.ogg, car_horn_short_2.ogg | traffic | Stable Audio 3 Small-SFX (Scale docs/SOUNDS.md) |
| car_horn_long | car_horn_long.ogg | traffic | Stable Audio 3 Small-SFX (Scale docs/SOUNDS.md) |
| bus_airbrake | bus_airbrake.ogg | traffic | Stable Audio 3 Small-SFX (Scale docs/SOUNDS.md) |
| ambulance_siren | ambulance_siren.ogg | traffic | procedural, Scale `tools/synthAftermath.mjs` |
| door_open | door_open.ogg | steps | Stable Audio 3 Small-SFX (Scale docs/SOUNDS.md) |
| door_close | door_close.ogg | steps | Stable Audio 3 Small-SFX (Scale docs/SOUNDS.md) |
| step_concrete | step_concrete_1.ogg, step_concrete_2.ogg, step_concrete_3.ogg, step_concrete_4.ogg | steps | Stable Audio 3 Small-SFX (Scale docs/SOUNDS.md) |
| step_grass | step_grass_1.ogg, step_grass_2.ogg | steps | Stable Audio 3 Small-SFX (Scale docs/SOUNDS.md) |
| splash_small | splash_small.ogg | steps | Stable Audio 3 Small-SFX (Scale docs/SOUNDS.md) |

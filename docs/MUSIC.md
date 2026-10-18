# Music

SimWorld's music: seven instrumental pieces generated with Google Lyria 3 Pro through OpenRouter on 2026-10-18, screened blind by listening models, then trimmed and loudness-normalised. They live in `public/music/` with a manifest `public/music/tracks.json` (`{"tracks": {name: {file, seconds, mood}}}`). The brief: a warm, calm, slightly nostalgic modern small western town (church bells, a school, gardens, a pub, a railway station, farms); acoustic piano, guitar, soft strings, light woodwinds; no vocals, no drums (light percussion at most in the title), nothing epic. In-game pieces are sparse because they play under the ambient soundscape.

The tool is `tools/music/lyria.mjs` (Node, no dependencies, reads `OPEN_ROUTER_KEY`); the prompts, briefs and chosen takes are in `tools/music/prompts.json`. Raw takes, generation metadata (`*.gen.json`), technical checks (`*.check.json`) and the listeners' verdicts (`*.verdict.json` from `google/gemini-3.8-flash`, `*.verdict-pro.json` from `google/gemini-3.1-pro-preview` for the shortlisted takes) are kept in the project files at `/mnt/project-files/simworld/music/raw/`.

## Pieces

| Piece | File | Length | Mood | Take | Flash / Pro score |
|---|---|---|---|---|---|
| title | `public/music/title.mp3` | 2:28 (148.06 s) | title | title-2 of 4 | 8 / 10 |
| day-1 | `public/music/day-1.mp3` | 1:52 (112.79 s) | day | day-1-1 of 3 | 9 / 9 |
| day-2 | `public/music/day-2.mp3` | 2:06 (126.48 s) | day | day-2-2 of 3 | 10 / 10 |
| evening | `public/music/evening.mp3` | 1:59 (119.04 s) | evening | evening-4 of 4 | 8 / 10 |
| night | `public/music/night.mp3` | 1:55 (115.93 s) | night | night-3 of 3 | 9 / 10 |
| rain | `public/music/rain.mp3` | 1:58 (118.93 s) | rain | rain-2 of 3 | 8 / 9 |
| sunday | `public/music/sunday.mp3` | 1:58 (118.12 s) | sunday | sunday-1 of 4 | 7 / 9 |

### title

- File: `public/music/title.mp3`, 148.06 s, 3.0 MB; raw take `title-2.mp3` (150.6 s).
- Model: `google/lyria-3-pro-preview`. Takes generated: 4 (1 sang, 1 used Chinese instruments, 1 was retried with a sharpened prompt and sang again).
- Listener (blind): piano, acoustic guitar, flute, strings, shaker, glockenspiel, percussion; moderate, ~88 BPM; drums light, vocals false; ends with gentle final chord.
- Verdict: Flash 8/10, "The acoustic instrumentation, gentle nostalgic mood, and rural journey feel fit the small-town life-sim theme wonderfully, though its slightly cinematic, swelling strings push it a touch beyond the requested non-cinematic intimacy." Pro 10/10, "The track perfectly captures the warm, nostalgic, and peaceful small-town atmosphere requested through its gentle, acoustic instrumentation of guitar, piano, and accordion, while strictly adhering to the no drums and no vocals constraints."
- Why this take: The only usable take: of four, two had voices (choir/backing vocals) and one used East Asian instruments. The listeners disagree on the percussion (Flash heard a shaker and light percussion, Pro none); either way it is light. Flash found the string swells "slightly cinematic".
- Prompt:

  > Instrumental only, no vocals, no singing, no humming. A warm, gentle main theme for a cozy small-town life game, about 2 minutes 30 seconds long. Solo felt piano opens with a simple, memorable, slightly nostalgic melody; fingerpicked nylon-string acoustic guitar joins, then soft warm strings, a little clarinet and flute answering the melody; very light brushed snare only in the middle section. Moderate unhurried tempo around 84 BPM, major key, sunny and homely, like a morning in a small town with gardens and a railway station. Builds gently, never epic or cinematic, then returns to solo piano and ends with a soft, natural, complete ending.

### day-1

- File: `public/music/day-1.mp3`, 112.79 s, 2.3 MB; raw take `day-1-1.mp3` (113.5 s).
- Model: `google/lyria-3-pro-preview`. Takes generated: 3 (one request returned no audio).
- Listener (blind): acoustic guitar, piano, ambient synth pad; slow, approx 68 BPM; drums none, vocals false; ends with fade.
- Verdict: Flash 9/10, "The track fits the brief almost perfectly with its sparse acoustic guitar and warm piano instrumentation, unhurried tempo, and lack of drums or vocals, with only a slight touch of melancholy compared to a purely light daytime vibe." Pro 9/10, "The track excellently fits the need for an unhurried, drumless, and vocalless acoustic piece, though it features gentle strings and a slightly melancholic mood rather than the specifically requested warm woodwinds."
- Why this take: Guitar, piano and a soft pad; both listeners call it a touch melancholic rather than purely light.
- Prompt:

  > Instrumental only, no vocals, no drums, no percussion. Sparse, light ambient background music for a peaceful small-town morning, about 2 minutes long. Gentle acoustic piano playing a few unhurried phrases with plenty of space and silence between them, a soft nylon-string guitar answering now and then, a very quiet warm string pad underneath. Calm, warm, slightly nostalgic, like Minecraft or Stardew Valley ambient music. Slow tempo around 70 BPM, major key, soft dynamics throughout, ends softly.

### day-2

- File: `public/music/day-2.mp3`, 126.48 s, 2.5 MB; raw take `day-2-2.mp3` (127.2 s).
- Model: `google/lyria-3-pro-preview`. Takes generated: 3.
- Listener (blind): acoustic guitar, flute; moderate, ~75 BPM; drums none, vocals false; ends with fade.
- Verdict: Flash 10/10, "The piece perfectly aligns with the brief, featuring an unhurried, warm acoustic guitar and flute arrangement with no drums or vocals, making it ideal background ambient music." Pro 10/10, "The track perfectly matches the brief, offering a gentle, drumless, and vocal-free pastoral atmosphere driven by acoustic guitar and light woodwinds."
- Why this take: Steel guitar and flute, pastoral: the best fit of all (10/10 from both listeners).
- Prompt:

  > Instrumental only, no vocals, no drums, no percussion. Light, unhurried daytime background music for a small town with gardens and a market, about 2 minutes long. Fingerpicked steel-string acoustic guitar with a simple pastoral pattern, a soft flute and clarinet trading short gentle phrases, a little celesta, warm pizzicato strings very quietly. Sparse arrangement with room to breathe, relaxed and content, soft dynamics, around 76 BPM, major key, ends gently.

### evening

- File: `public/music/evening.mp3`, 119.04 s, 2.4 MB; raw take `evening-4.mp3` (119.1 s).
- Model: `google/lyria-3-pro-preview`. Takes generated: 4 (the 4th with a sharpened prompt).
- Listener (blind): acoustic guitar, piano, string section, ambient synth pad; slow, approx 72 BPM; drums none, vocals false; ends with gentle final chord fading out to silence.
- Verdict: Flash 8/10, "The warm, bittersweet acoustic instrumentation and lack of drums or vocals fit the golden-hour small-town mood well, though the lush orchestral swells make it slightly more cinematic than strictly sparse." Pro 10/10, "The delicate fingerpicked acoustic guitar and soft cello perfectly capture the warm, wistful, and sparse qualities needed for a golden-hour small-town setting, completely avoiding drums and vocals as requested."
- Why this take: Won over three takes from the first prompt, which swelled into dramatic climaxes (one also had soaring vocals).
- Prompt:

  > Instrumental only, no vocals, no choir, no wordless voices, no drums, no percussion. A quiet, warm golden-hour background piece for a small western town at dusk, about 2 minutes long. Soft felt piano with slow warm chords and a simple tender melody, a gentle nylon-string guitar, a faint warm string pad, an occasional soft cello note. Wistful but content, a little nostalgic, like Stardew Valley or The Sims neighbourhood music. Slow tempo around 64 BPM, sparse with lots of space, stays soft and intimate the whole time: no crescendo, no swelling climax, no dramatic orchestra. Fades out gently at the end.

### night

- File: `public/music/night.mp3`, 115.93 s, 2.3 MB; raw take `night-3.mp3` (116.9 s).
- Model: `google/lyria-3-pro-preview`. Takes generated: 3.
- Listener (blind): acoustic piano, synthesizer pad, synth bass, atmospheric textures; slow, approx 65 BPM; drums none, vocals false; ends with gentle final chord with piano decay and fading synth atmosphere.
- Verdict: Flash 9/10, "The track matches the brief exceptionally well with its sparse soft piano, warm pads, gentle dynamics, and absence of drums or vocals, leaning only slightly more melancholic than purely peaceful." Pro 10/10, "The track perfectly matches the brief with its sparse, soft piano and subtle string textures, maintaining a peaceful, drum-free, and vocal-free atmosphere ideal for quiet night ambiance."
- Why this take: Chosen over night-2 (Flash 10, Pro 5: Pro heard a moderate string swell) because both listeners call night-3 consistently soft with no build-up.
- Prompt:

  > Instrumental only, no vocals, no drums, no percussion. A very sparse, very quiet night ambient piece for a sleeping small town, about 2 minutes long. Soft felt piano playing single notes and gentle open chords far apart, long pauses, a warm, slow evolving synth pad and faint soft strings underneath. Very slow, around 56 BPM, peaceful and still, intimate and calm, pianissimo throughout, no sudden loud moments, fades out softly.

### rain

- File: `public/music/rain.mp3`, 118.93 s, 2.4 MB; raw take `rain-2.mp3` (120.3 s).
- Model: `google/lyria-3-pro-preview`. Takes generated: 3.
- Listener (blind): piano, solo violin, cello, string section; slow, approx 60 BPM; drums none, vocals false; ends with gentle final chord with natural decay.
- Verdict: Flash 8/10, "The track matches the gentle, melancholic, drumless mood requested, though the swelling string section may feel slightly more dramatic than strictly sparse background music." Pro 9/10, "The gentle piano and cello duet perfectly captures the requested melancholy, contemplative, and drum-free atmosphere, though the emotional swells might slightly contrast with the desired sparseness."
- Why this take: Piano, violin and cello; the strings swell a little, which both listeners note. The two other takes had vocals or a grand orchestral climax.
- Prompt:

  > Instrumental only, no vocals, no drums, no percussion, no rain sound effects. A contemplative, gentle piece for a grey rainy afternoon in a small town, about 2 minutes long. Soft felt piano with slow, thoughtful phrases in a minor-to-major mood, a warm solo viola or cello line, a quiet nylon-string guitar, a faint soft pad. Cozy and introspective, a little melancholy but comforting, slow around 66 BPM, sparse with space between phrases, soft dynamics, ends quietly.

### sunday

- File: `public/music/sunday.mp3`, 118.12 s, 2.4 MB; raw take `sunday-1.mp3` (119.6 s).
- Model: `google/lyria-3-pro-preview`. Takes generated: 4 (the 4th with a sharpened prompt).
- Listener (blind): piano, strings, french horn, brass, woodwinds; slow, around 70 BPM; drums none, vocals false; ends with gentle final piano chord fading into silence.
- Verdict: Flash 7/10, "While it meets all negative constraints and features peaceful, warm acoustic instrumentation, its dramatic cinematic swell leans more romantic and intense than the gentle, hymn-like backdrop intended for a calm small town." Pro 9/10, "The gentle, peaceful combination of piano and clarinet perfectly captures the warm Sunday-morning atmosphere with no drums or vocals, though the waltz-like rhythm is slightly less hymn-like than requested."
- Why this take: Optional piece and the weakest fit: more romantic/waltz-like than hymn-like, with a swell that Flash called cinematic. The sharpened 4th take was worse (sorrowful climax). Keep it out of rotation if it does not sound right in game.
- Prompt:

  > Instrumental only, no vocals, no choir, no singing, no drums. A calm, slightly hymn-like piece for a quiet Sunday morning in a small village, about 2 minutes long. A soft reed organ or harmonium playing a simple chorale with warm sustained chords, joined by gentle acoustic piano and soft strings, a lone french horn or clarinet carrying the melody in the middle. Peaceful, devotional but homely, slow around 66 BPM, major key, soft dynamics, ends on a gentle sustained chord.

## How it was made

1. **Generate**: `OPEN_ROUTER_KEY=… node tools/music/lyria.mjs gen RAW_DIR [piece …] --n 3`. The request is `POST https://openrouter.ai/api/v1/chat/completions` with `{"model": "google/lyria-3-pro-preview", "messages": [{"role": "user", "content": <prompt>}], "modalities": ["text", "audio"], "audio": {"format": "mp3"}, "stream": true}`. Audio output only works streamed: the whole MP3 (48 kHz stereo, ~192 kbps, with a C2PA manifest in its ID3 tag) arrives base64 in a single SSE chunk's `delta.audio.data`; the text part is Lyria's section plan (`[[A0]] [[B1]] …`, or `<instrumental>` from the clip model). Pro takes came back 110-150 s (the "about 2 minutes" in the prompt is honoured roughly); each took ~20-35 s and cost $0.08 (`google/lyria-3-clip-preview`: 30 s clips, $0.04, used once to learn the format). Asking for "2 minutes 30 seconds" got 131-151 s.
`prompts.json` holds the prompt of each winning take; the sharpened prompts tried for title-4 and sunday-4 lost and are only in their `.gen.json`.

2. **Listen**: `node tools/music/lyria.mjs listen RAW_DIR` sends each take (downmixed to 64 kbps mono) to `google/gemini-3.8-flash` as `{"type": "input_audio", "input_audio": {"data": <base64>, "format": "mp3"}}` and asks for a blind JSON description (instruments, tempo, mood, dynamics, vocals, drums, ending, issues); a second, text-only call scores that description against the piece's `brief` 0-10 (vocals or heavy drums cap it at 2). The shortlisted takes were re-judged with `MUSIC_LISTENER=google/gemini-3.1-pro-preview`. It is a ranking only; nobody has listened with human ears yet.
3. **Check**: `node tools/music/lyria.mjs check RAW_DIR` reports length, integrated loudness, true peak, silences longer than 2 s below -50 dB, and the level of the last 2 s against the 8 s before (an abrupt stop stays loud to the end). Every raw take is peak-normalised by Lyria to about 0 dBFS at about -11 LUFS with no flat-topped clipping (astats flat factor 0), had no inner silences, and ended in a natural decay (last 2 s at -36 to -62 dB).
4. **Build**: set `"take": k` on a piece in `prompts.json`, then `node tools/music/lyria.mjs build RAW_DIR`. Per piece, equivalent to:

   ```sh
   ffmpeg -i RAW/<piece>-<k>.mp3 -af "silenceremove=start_periods=1:start_threshold=-55dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-55dB:start_silence=0.3,areverse" -ar 44100 -ac 2 trim.wav
   ffmpeg -i trim.wav -af loudnorm=I=<L>:TP=-1.5:LRA=11:print_format=json -f null -      # measure
   ffmpeg -i trim.wav -af "loudnorm=I=<L>:TP=-1.5:LRA=11:measured_I=…:measured_TP=…:measured_LRA=…:measured_thresh=…:offset=…:linear=true,afade=t=out:st=<len-2>:d=2" \
     -ar 44100 -ac 2 -c:a libmp3lame -b:a 176k -map_metadata -1 public/music/<piece>.mp3
   ```

   `<L>` is -16 LUFS for the title and -18 LUFS for the in-game pieces (measured afterwards: title -16.4, the others -18.4 to -18.9; true peaks -3 to -7 dBFS). The 2 s fade only smooths the already-decayed tail; set `"fade"` on a piece for a longer one. It rewrites `public/music/tracks.json`. Re-encoding drops the C2PA manifest (the raw takes keep it); Lyria's SynthID watermark is in the audio itself and stays.

## Cost

25 Lyria requests: 1 clip ($0.04) and 24 Pro ($0.08 each; 23 returned audio, $1.84 recorded; the failed one returned only its section plan, its cost was not reported). Listening: about $0.38. Total about $2.30.

## Licence

Generated with Google Lyria 3 (`google/lyria-3-pro-preview`, served by the "Google AI Studio" provider) via OpenRouter on 2026-10-18 for SimWorld.

- OpenRouter's Terms of Service (openrouter.ai/terms, read 2026-10-18): "Your ownership rights in the Output are set forth in the Model Terms for each Model you use." OpenRouter takes a licence to user content only to operate the service. The Lyria model page links Google's terms (ai.google.dev/terms and cloud.google.com/terms).
- Google Cloud's Service Specific Terms (cloud.google.com/terms/service-terms, last modified 2026-10-12, section 20 "Generative AI Services"): "Generated Output is Customer Data. As between Customer and Google, Google does not assert any ownership rights in any new intellectual property created in the Generated Output."
- The Gemini API terms (ai.google.dev/gemini-api/terms), which govern the Google AI Studio route OpenRouter used, could **not** be read from this environment (the host is blocked), so their wording on generated content, and anything Lyria-specific, is **not verified**. Check them before a commercial release.
- Not verified either: whether AI-generated music is protectable by copyright at all in the relevant countries (often it is not), and whether a take resembles existing music. Google's own position is not to claim ownership; that is not a guarantee that no one else has rights.

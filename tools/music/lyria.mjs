// SimWorld's music: Google Lyria 3 takes through OpenRouter, a blind listening test, and the build
// into public/music/. Node, no dependencies; needs ffmpeg (with libmp3lame) for `check` and `build`.
// Modelled on Scale's tools/music/build_tracks.py (trim, optional fade, loudness-normalise, MP3) and
// SimWorld's tools/sounds/studio.mjs (the two-step blind listen).
//
//   OPEN_ROUTER_KEY=… node tools/music/lyria.mjs gen    RAW_DIR [piece …] [--n 3] [--model id]
//   OPEN_ROUTER_KEY=… node tools/music/lyria.mjs listen RAW_DIR [piece …]
//                     node tools/music/lyria.mjs check  RAW_DIR [piece …]
//                     node tools/music/lyria.mjs build  RAW_DIR [piece …]
//
// gen     Takes land in RAW_DIR/<piece>-<k>.mp3 (k = next free number) with <piece>-<k>.gen.json beside
//         them (model, prompt, Lyria's text part, the generation id and its cost). Request: POST
//         /api/v1/chat/completions {model, messages, modalities: ['text','audio'], audio: {format:'mp3'},
//         stream: true}; the whole MP3 arrives base64 in one SSE chunk's delta.audio.data.
// listen  A Gemini model first describes each take blind (naming the brief first biases it), then a
//         text-only call scores the description against the piece's brief (tools/music/prompts.json).
//         Verdict: <piece>-<k>.verdict.json. A ranking only: the ear decides.
// check   Technical facts per take: length, peak, loudness, silences, how loud the last seconds are.
// build   For each piece with a "take" in prompts.json: trim leading/trailing silence, fade the end
//         (prompts.json "fade" seconds, default 2: Lyria's endings decay naturally, this only smooths the tail), normalise
//         (title -16 LUFS, the rest -18 LUFS, true peak -1.5 dB), 44.1 kHz stereo MP3 at 176 kbps, to
//         public/music/<piece>.mp3; then public/music/tracks.json.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const API = 'https://openrouter.ai/api/v1';
const LISTENER = process.env.MUSIC_LISTENER ?? 'google/gemini-3.8-flash';
const KEY = process.env.OPEN_ROUTER_KEY;
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const OUT = path.join(ROOT, 'public', 'music');
const PROMPTS = JSON.parse(fs.readFileSync(new URL('./prompts.json', import.meta.url), 'utf8'));
const PIECES = Object.keys(PROMPTS).filter((k) => !k.startsWith('_'));

const headers = () => ({ Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' });
const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-nostats', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 });
/** ffmpeg's log (where its analysis filters report), whatever the exit code. */
function ffLog(args) {
  return execFileSync('sh', ['-c', 'ffmpeg -hide_banner -nostats "$@" 2>&1 >/dev/null', 'sh', ...args], { encoding: 'utf8', maxBuffer: 1 << 26 });
}

function nextTake(raw, piece) {
  let k = 1;
  while (fs.existsSync(path.join(raw, `${piece}-${k}.mp3`)) || fs.existsSync(path.join(raw, `${piece}-${k}.gen.json`))) k++;
  return k;
}

async function gen(raw, piece, model) {
  const p = PROMPTS[piece];
  model ??= p.model;
  const k = nextTake(raw, piece);
  const base = path.join(raw, `${piece}-${k}`);
  fs.writeFileSync(`${base}.gen.json`, JSON.stringify({ piece, model, prompt: p.prompt, status: 'pending' }, null, 1));
  const body = JSON.stringify({ model, messages: [{ role: 'user', content: p.prompt }], modalities: ['text', 'audio'], audio: { format: 'mp3' }, stream: true });
  const t0 = Date.now();
  const r = await fetch(`${API}/chat/completions`, { method: 'POST', headers: headers(), body });
  if (!r.ok) throw new Error(`${piece}-${k}: ${r.status} ${(await r.text()).slice(0, 300)}`);
  const sse = await r.text();
  let audio = '', text = '', id = null, usage = null, finish = null;
  for (const line of sse.split('\n')) {
    if (!line.startsWith('data: ') || line.startsWith('data: [DONE]')) continue;
    const c = JSON.parse(line.slice(6));
    id ??= c.id;
    if (c.usage) usage = c.usage;
    if (c.error) throw new Error(`${piece}-${k}: ${JSON.stringify(c.error)}`);
    const ch = c.choices?.[0];
    if (!ch) continue;
    if (ch.finish_reason) finish = ch.finish_reason;
    if (ch.delta?.content) text += ch.delta.content;
    if (ch.delta?.audio?.data) audio += ch.delta.audio.data;
  }
  if (!audio) {
    fs.writeFileSync(`${base}.gen.json`, JSON.stringify({ piece, model, prompt: p.prompt, id, text, finish, cost: usage?.cost ?? null, status: 'no audio', tail: sse.slice(-600) }, null, 1));
    throw new Error(`${piece}-${k}: no audio (finish ${finish}, cost ${usage?.cost ?? '?'})`);
  }
  fs.writeFileSync(`${base}.mp3`, Buffer.from(audio, 'base64'));
  const meta = { piece, model, prompt: p.prompt, id, text, finish, cost: usage?.cost ?? null, seconds: duration(`${base}.mp3`), took: Math.round((Date.now() - t0) / 1000) };
  fs.writeFileSync(`${base}.gen.json`, JSON.stringify(meta, null, 1));
  console.log(`${piece}-${k}: ${meta.seconds.toFixed(1)} s, $${meta.cost}, ${meta.took} s, text ${JSON.stringify(text.slice(0, 80))}`);
}

function duration(file) {
  const s = ffLog(['-i', file, '-f', 'null', '-']);
  const m = [...s.matchAll(/time=(\d+):(\d+):([\d.]+)/g)].pop() ?? s.match(/Duration: (\d+):(\d+):([\d.]+)/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}

async function chat(content) {
  const r = await fetch(`${API}/chat/completions`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify({ model: LISTENER, messages: [{ role: 'user', content }], response_format: { type: 'json_object' } }),
  });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  const txt = j.choices[0].message.content;
  return { json: JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1)), cost: j.usage?.cost ?? 0 };
}

/** Blind description, then a text-only score against the piece's brief. */
async function listen(file, piece) {
  const small = `${file}.listen.mp3`;
  ff(['-loglevel', 'error', '-y', '-i', file, '-ac', '1', '-ar', '22050', '-b:a', '64k', small]);
  const data = fs.readFileSync(small).toString('base64');
  fs.unlinkSync(small);
  const heard = await chat([
    { type: 'text', text: 'Listen to this whole piece of music and describe it, blind and honestly. Answer ONLY with JSON '
      + '{"instruments": [..], "tempo": "slow|moderate|fast and approx BPM", "mood": "a few words", "dynamics": "how loud/busy and how it develops", '
      + '"vocals": true/false (any singing, humming, choir or speech), "drums": "none|light|moderate|heavy", "genre": "..", '
      + '"ending": "how it ends: fade, gentle final chord, or abrupt cut", "abrupt_ending": true/false, "issues": "anything odd: glitches, distortion, sudden loud moments, silences", '
      + '"description": "2-3 sentences"}.' },
    { type: 'input_audio', input_audio: { data, format: 'mp3' } },
  ]);
  const judged = await chat([{ type: 'text', text: `A game needs this music: ${PROMPTS[piece].brief}\nA listener heard a candidate and described it as: ${JSON.stringify(heard.json)}\n`
    + 'Score how well it fits that brief, 0-10 (10 = exactly right, 5 = usable with reservations, 0 = wrong). Vocals or heavy drums make it unusable (max 2). '
    + 'Answer ONLY with JSON {"score": number, "reason": "one sentence"}.' }]);
  const verdict = { listener: LISTENER, heard: heard.json, score: Number(judged.json.score), reason: judged.json.reason, cost: heard.cost + judged.cost };
  fs.writeFileSync(file.replace(/\.mp3$/, '.verdict.json'), JSON.stringify(verdict, null, 1));
  console.log(`${path.basename(file)}: ${verdict.score} | ${verdict.reason} | vocals ${heard.json.vocals}, drums ${heard.json.drums}, ending ${heard.json.ending}`);
}

/** Loudness, peak, silences and the level of the last seconds (an abrupt stop is loud to the end). */
function check(file) {
  const secs = duration(file);
  const s = ffLog(['-i', file, '-af', 'ebur128=peak=true,silencedetect=n=-50dB:d=2', '-f', 'null', '-']);
  const lufs = Number(s.match(/I:\s+(-?[\d.]+) LUFS/g)?.pop()?.match(/-?[\d.]+/)?.[0]);
  const peak = Number(s.match(/Peak:\s+(-?[\d.]+) dBFS/g)?.pop()?.match(/-?[\d.]+/)?.[0]);
  const silences = [...s.matchAll(/silence_start: (-?[\d.]+)[\s\S]*?silence_end: ([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  const tailDb = (from, len) => {
    const t = ffLog(['-ss', String(Math.max(0, from)), '-t', String(len), '-i', file, '-af', 'volumedetect', '-f', 'null', '-']);
    return Number(t.match(/mean_volume: (-?[\d.]+)/)?.[1]);
  };
  const end = silences.length && Math.abs(silences.at(-1)[1] - secs) < 0.5 ? silences.at(-1)[0] : secs;
  return { seconds: +secs.toFixed(2), lufs, truePeak: peak, silences, musicEnds: +end.toFixed(2), meanDb: tailDb(0, secs), last2sDb: tailDb(end - 2, 2), before10sDb: tailDb(end - 12, 8) };
}

function build(raw, piece) {
  const p = PROMPTS[piece];
  if (!p.take) { console.log(`${piece}: no take chosen in prompts.json, skipped`); return null; }
  const src = path.join(raw, `${piece}-${p.take}.mp3`);
  const lufs = p.mood === 'title' ? -16 : -18;
  const fade = p.fade ?? 2;
  const tmp = path.join(OUT, `.${piece}.trim.wav`);
  // Trim silence at both ends (-55 dB), reversing for the tail as Scale did with librosa.trim.
  const trim = 'silenceremove=start_periods=1:start_threshold=-55dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-55dB:start_silence=0.3,areverse';
  ff(['-loglevel', 'error', '-y', '-i', src, '-af', trim, '-ar', '44100', '-ac', '2', tmp]);
  const secs = duration(tmp);
  const fadeAf = fade > 0 ? `,afade=t=out:st=${(secs - fade).toFixed(2)}:d=${fade}` : '';
  // Two-pass loudnorm: measure, then apply linearly.
  const m = ffLog(['-i', tmp, '-af', `loudnorm=I=${lufs}:TP=-1.5:LRA=11:print_format=json`, '-f', 'null', '-']);
  const j = JSON.parse(m.slice(m.lastIndexOf('{'), m.lastIndexOf('}') + 1));
  const norm = `loudnorm=I=${lufs}:TP=-1.5:LRA=11:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true`;
  const out = path.join(OUT, `${piece}.mp3`);
  ff(['-loglevel', 'error', '-y', '-i', tmp, '-af', `${norm}${fadeAf}`, '-ar', '44100', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '176k', '-map_metadata', '-1', '-id3v2_version', '0', out]);
  fs.unlinkSync(tmp);
  const c = check(out);
  console.log(`${piece}: take ${p.take} → ${path.relative(ROOT, out)} ${c.seconds} s, ${c.lufs} LUFS, peak ${c.truePeak} dBFS, ${(fs.statSync(out).size / 1e6).toFixed(2)} MB`);
  return { file: `${piece}.mp3`, seconds: c.seconds, mood: p.mood };
}

/** Run jobs with at most `n` at a time. */
async function pool(jobs, n) {
  const run = async () => { while (jobs.length) { const j = jobs.shift(); try { await j(); } catch (e) { console.log('error', String(e)); } } };
  await Promise.all(Array.from({ length: n }, run));
}

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); if (i < 0) return def; const v = args[i + 1]; args.splice(i, 2); return v; };
const n = Number(opt('--n', 3));
const model = opt('--model', undefined);
const [cmd, raw, ...rest] = args;
const pieces = rest.length ? rest : PIECES;
const takes = (piece) => fs.readdirSync(raw).filter((f) => f.startsWith(`${piece}-`) && /^.+-\d+\.mp3$/.test(f) && f.slice(piece.length + 1).match(/^\d+\.mp3$/));
if ((cmd === 'gen' || cmd === 'listen') && !KEY) { console.error('OPEN_ROUTER_KEY is not set'); process.exit(1); }
if (!raw) { console.error('usage: lyria.mjs gen|listen|check|build RAW_DIR [piece …] [--n 3] [--model id]'); process.exit(1); }
fs.mkdirSync(raw, { recursive: true });
if (cmd === 'gen') {
  // gen reserves its take number (a .gen.json) before its first await, so parallel takes never collide.
  const jobs = pieces.flatMap((piece) => Array.from({ length: n }, () => () => gen(raw, piece, model)));
  await pool(jobs, 4);
} else if (cmd === 'listen') {
  const jobs = pieces.flatMap((piece) => takes(piece).filter((f) => !fs.existsSync(path.join(raw, f.replace(/\.mp3$/, '.verdict.json'))))
    .map((f) => () => listen(path.join(raw, f), piece)));
  await pool(jobs, 4);
} else if (cmd === 'check') {
  for (const piece of pieces) for (const f of takes(piece)) {
    const c = check(path.join(raw, f));
    fs.writeFileSync(path.join(raw, f.replace(/\.mp3$/, '.check.json')), JSON.stringify(c, null, 1));
    console.log(`${f}: ${c.seconds} s, ${c.lufs} LUFS, peak ${c.truePeak}, silences ${JSON.stringify(c.silences)}, mean ${c.meanDb} dB, last 2 s ${c.last2sDb} dB (before ${c.before10sDb})`);
  }
} else if (cmd === 'build') {
  fs.mkdirSync(OUT, { recursive: true });
  const manifestPath = path.join(OUT, 'tracks.json');
  const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : { tracks: {} };
  for (const piece of pieces) { const t = build(raw, piece); if (t) manifest.tracks[piece] = t; }
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
} else console.error(`unknown command ${cmd}`);

// Sound candidates from ByteDance Seed Audio and a blind listening test, both through OpenRouter.
// Ported from Scale's tools/sfx/seed.py and screen.py (Python → Node, no dependencies).
//
//   OPEN_ROUTER_KEY=… node tools/sounds/studio.mjs seed RAW_DIR [id …] [--n 4]
//   OPEN_ROUTER_KEY=… node tools/sounds/studio.mjs listen RAW_DIR [id …]
//   OPEN_ROUTER_KEY=… node tools/sounds/studio.mjs listen-file FILE id   (any clip, e.g. a synthesized one)
//
// Seed Audio is a speech model, but an input starting with "The sound of" makes it render the
// sound instead of reading the words (Arnd's find in Scale). Takes land in RAW_DIR/<id>/seedK.wav.
// `listen` has a Gemini model describe each take blind (naming the target first biases it), then a
// text-only call scores what it heard against the wanted sound (tools/sounds/prompts.json); the
// verdict goes next to the take as seedK.json. A ranking only: the ear decides.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const API = 'https://openrouter.ai/api/v1';
const LISTENER = process.env.SFX_LISTENER ?? 'google/gemini-3.8-flash';
const KEY = process.env.OPEN_ROUTER_KEY;
const PROMPTS = JSON.parse(fs.readFileSync(new URL('./prompts.json', import.meta.url), 'utf8'));

const headers = () => ({ Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' });

async function seed(raw, id, k) {
  const dir = path.join(raw, id);
  fs.mkdirSync(dir, { recursive: true });
  const wav = path.join(dir, `seed${k}.wav`);
  if (fs.existsSync(wav)) return;
  const body = JSON.stringify({ model: 'bytedance-seed/seed-audio-1-0', input: `The sound of ${PROMPTS[id].seed ?? PROMPTS[id].sound}`, response_format: 'mp3' });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(`${API}/audio/speech`, { method: 'POST', headers: headers(), body });
      if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
      const mp3 = wav.replace(/\.wav$/, '.mp3');
      fs.writeFileSync(mp3, Buffer.from(await r.arrayBuffer()));
      execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', mp3, '-ac', '1', '-ar', '48000', wav]);
      fs.unlinkSync(mp3);
      console.log(id, k, 'ok');
      return;
    } catch (e) { console.log(id, k, 'error', String(e)); }
  }
}

async function chat(content) {
  const r = await fetch(`${API}/chat/completions`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify({ model: LISTENER, messages: [{ role: 'user', content }], response_format: { type: 'json_object' } }),
  });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
  const txt = (await r.json()).choices[0].message.content;
  return JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
}

/** Blind listening, then a text-only match against the wanted sound. */
async function listen(file, id) {
  const mp3 = `${file}.listen.mp3`;
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', file, '-b:a', '160k', mp3]);
  const data = fs.readFileSync(mp3).toString('base64');
  fs.unlinkSync(mp3);
  const heard = await chat([
    { type: 'text', text: 'Listen to this audio and identify, blind, every separate sound event with exact times. Answer ONLY with JSON '
      + '{"music": true/false, "speech": true/false, "synthetic": true/false, "events": [{"start": seconds, "end": seconds, "what": "what makes the sound, how it sounds"}]}. '
      + '"music" = any melody, chords, beat or instruments; "speech" = any words or voices talking; "synthetic" = it sounds artificial or electronic rather than recorded.' },
    { type: 'input_audio', input_audio: { data, format: 'mp3' } },
  ]);
  const events = heard.events ?? [];
  const judged = await chat([{ type: 'text', text: `A game needs this sound: ${PROMPTS[id].sound}. A listener heard these events in a clip: `
    + `${JSON.stringify(events)}${heard.synthetic ? ' (the listener found it synthetic-sounding)' : ''}. For each event give a score 0-10: how well it serves as that sound `
    + '(10 = clearly and naturally that sound, 5 = plausible stand-in, 0 = something else). Answer ONLY with JSON {"scores": [numbers in the same order]}.' }]);
  events.forEach((e, i) => { e.score = Math.min(heard.music || heard.speech ? 4 : 10, Number(judged.scores?.[i] ?? 0)); });
  const verdict = { music: !!heard.music, speech: !!heard.speech, synthetic: !!heard.synthetic, takes: events, best: Math.max(0, ...events.map((e) => e.score)) };
  fs.writeFileSync(file.replace(/\.\w+$/, '.json'), JSON.stringify(verdict, null, 1));
  console.log(`${id} ${path.basename(file)}: best ${verdict.best}${verdict.synthetic ? ' (synthetic)' : ''} | ${events.slice(0, 3).map((e) => `${e.score} ${String(e.what).slice(0, 60)}`).join('; ')}`);
  return verdict;
}

/** Run jobs with at most `n` at a time. */
async function pool(jobs, n) {
  const run = async () => { while (jobs.length) { const j = jobs.shift(); try { await j(); } catch (e) { console.log('error', String(e)); } } };
  await Promise.all(Array.from({ length: n }, run));
}

const args = process.argv.slice(2);
if (!KEY) { console.error('OPEN_ROUTER_KEY is not set'); process.exit(1); }
let n = 4;
const ni = args.indexOf('--n');
if (ni >= 0) { n = Number(args[ni + 1]); args.splice(ni, 2); }
const [cmd, raw, ...rest] = args;
const ids = rest.length ? rest : Object.keys(PROMPTS);
if (cmd === 'seed') await pool(ids.flatMap((id) => Array.from({ length: n }, (_, k) => () => seed(raw, id, k + 1))), 6);
else if (cmd === 'listen') {
  const jobs = [];
  for (const id of ids) for (const f of fs.existsSync(path.join(raw, id)) ? fs.readdirSync(path.join(raw, id)) : []) {
    if (f.endsWith('.wav') && !fs.existsSync(path.join(raw, id, f.replace(/\.wav$/, '.json')))) jobs.push(() => listen(path.join(raw, id, f), id));
  }
  await pool(jobs, 6);
} else if (cmd === 'listen-file') await listen(raw, rest[0]);
else console.error('usage: studio.mjs seed|listen RAW_DIR [id …] | listen-file FILE id');

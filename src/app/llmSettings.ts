/**
 * The language-model settings (D5, D11; plan R6): the player's own OpenRouter key, which model runs each task (the
 * player's picks first, then the router's choice), and the model roster itself (on or off, capability tags, prices,
 * models added by their OpenRouter id). Defaults are the live-tested picks (src/llm/roster.ts); the big expensive
 * models are never defaults, but the player may choose anything.
 */
import {
  blendedPrice, CAPABILITIES, DEFAULT_TASK_MODELS, entryFromCatalog, fetchCatalog, OPENROUTER_KEYS_URL, qualifies, TASKS,
  type Capability, type ModelEntry, type TaskName,
} from '../llm';
import type { LlmSetup } from '../game/llmSetup';
import { button, checkbox, el, openDialog } from './dom';
import { money } from './chatPanel';

const CSS = `
.llm-panel { width: min(720px, 100%); }
.llm-panel section { padding: 6px 18px 14px; border-bottom: 1px solid #4f423244; }
.llm-panel h3 { margin: 12px 0 6px; font: 600 14px/1.3 'Alegreya Sans', system-ui, sans-serif; color: #ece3d0; }
.llm-panel p { margin: 4px 0; color: #b9ad96; font-size: 13px; }
.llm-panel a { color: #e9b85c; }
.llm-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 6px 0; }
.llm-row input[type=password], .llm-row input[type=text] { flex: 1; min-width: 180px; padding: 5px 8px; border: 1px solid #4f4232; border-radius: 3px; background: #050607; color: #ece3d0; font: 13px/1.3 ui-monospace, monospace; }
.llm-panel button { padding: 4px 10px; border: 1px solid #4f4232; border-radius: 3px; background: none; color: #b9ad96; font: 13px/1.2 'Alegreya Sans', system-ui, sans-serif; cursor: pointer; }
.llm-panel button:hover { color: #ece3d0; border-color: #e9b85c; }
.llm-panel select { max-width: 180px; padding: 3px 4px; border: 1px solid #4f4232; border-radius: 3px; background: #050607; color: #cfd6dc; font: 12.5px/1.2 'Alegreya Sans', system-ui, sans-serif; }
.llm-task { padding: 6px 0; border-top: 1px solid #4f423222; }
.llm-task .what { color: #ece3d0; }
.llm-task .plan { color: #7a6f5e; font-size: 12px; }
.llm-roster { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.llm-roster td, .llm-roster th { padding: 4px; border-bottom: 1px solid #4f423222; vertical-align: top; text-align: left; }
.llm-roster th { color: #7a6f5e; font-weight: 400; }
.llm-roster .id { color: #7a6f5e; font: 11px/1.2 ui-monospace, monospace; }
.llm-tag { display: inline-flex; align-items: center; gap: 2px; margin: 0 6px 2px 0; color: #b9ad96; white-space: nowrap; }
.llm-tag input, .llm-roster input { accent-color: #e9b85c; }
.llm-msg { color: #d9a15c; font-size: 12.5px; min-height: 1.2em; }
`;

/** The tasks the player configures (a task without text here, like the tests' chatter judge, is not shown). */
const TASK_TEXT: Partial<Record<TaskName, [string, string]>> = {
  'npc.speech': ['Chat replies', 'What people say to you. Natural, in-character writing matters most; some of the smartest models are poor role-players.'],
  'npc.appraisal': ['Reading the replies', 'After each reply: how it changed their feelings, beliefs and plans, as strict JSON. A fast, cheap model that keeps to a schema.'],
  'memory.summary': ['Memories of a talk', 'What they remember of a conversation once it ends. Cheap.'],
  'npc.reflection': ['Reflections', 'Occasional conclusions from many memories. Rare.'],
  'skip.digest': ['Time-skip digest', 'What your inhabitant lived through while time was skipped. Cheap, long context.'],
};

let styled = false;

export function openLlmSettings(setup: LlmSetup): void {
  if (document.querySelector('.llm-panel')) return;
  if (!styled) { const s = el('style', ''); s.textContent = CSS; document.head.append(s); styled = true; }
  const close = el('button', 'wn-close', 'Close');
  // The What's new dialog's frame and look (prefix "wn"), widened by .llm-panel.
  const panel = openDialog('wn', 'Language models', close);
  if (!panel) return;
  panel.classList.add('llm-panel');
  const head = el('div', 'wn-head');
  head.append(el('h2', '', 'Language models'), close);
  const list = el('div', 'wn-list');
  const msg = el('div', 'llm-msg');
  panel.append(head, list);
  // Keys typed into the dialog are not the game's (WASD, T).
  panel.addEventListener('keydown', (e) => e.stopPropagation());
  const render = (): void => { const top = list.scrollTop; list.replaceChildren(keySection(setup, msg), tasksSection(setup), rosterSection(setup, msg), usageSection(setup)); list.scrollTop = top; };
  const stopChange = setup.onChange(() => {
    if (!panel.isConnected) { stopChange(); return; }
    if (!panel.contains(document.activeElement) || document.activeElement === close) render();
  });
  render();
}

function keySection(setup: LlmSetup, msg: HTMLElement): HTMLElement {
  const s = el('section', '');
  s.append(el('h3', '', 'Your OpenRouter key'));
  const p = el('p', '');
  p.append(document.createTextNode('People answer with a language model when a key is set; without one, the town answers on its own (simpler, but free). The key is kept only in this browser and sent only to OpenRouter. Make one at '));
  const a = el('a', '', OPENROUTER_KEYS_URL.replace(/^https:\/\//, ''));
  a.href = OPENROUTER_KEYS_URL; a.target = '_blank'; a.rel = 'noopener';
  p.append(a, document.createTextNode('. Keys can carry their own spending limit there.'));
  const row = el('div', 'llm-row');
  const input = el('input', '');
  input.type = 'password';
  input.autocomplete = 'off';
  input.placeholder = 'sk-or-…';
  input.value = setup.key;
  const show = button('', 'Show', () => { input.type = input.type === 'password' ? 'text' : 'password'; show.textContent = input.type === 'password' ? 'Show' : 'Hide'; });
  const save = button('', 'Save', () => { setup.setKey(input.value); msg.textContent = setup.hasKey ? 'Key saved.' : 'Key removed.'; });
  const remove = button('', 'Remove', () => { input.value = ''; setup.setKey(''); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save.click(); });
  row.append(input, show, save, remove);
  s.append(p, row, el('p', '', setup.hasKey ? 'A key is set: chats use the models below.' : 'No key set: chats are answered procedurally.'), msg);
  return s;
}

function tasksSection(setup: LlmSetup): HTMLElement {
  const s = el('section', '');
  s.append(el('h3', '', 'Which model does what'), el('p', '', 'Pick up to three models per task, best first. The rest of the roster that can do the task fills in behind them if a model fails.'));
  for (const task of Object.keys(TASKS) as TaskName[]) {
    const text = TASK_TEXT[task];
    if (!text) continue;
    const [what, why] = text;
    const box = el('div', 'llm-task');
    box.append(el('div', 'what', what), el('p', '', why));
    const able = setup.roster.models.filter((m) => qualifies(m, TASKS[task].routing));
    const current = setup.pins[task] ?? DEFAULT_TASK_MODELS[task];
    const row = el('div', 'llm-row');
    for (let i = 0; i < 3; i++) {
      const sel = el('select', '');
      sel.append(new Option(i === 0 ? '(router decides)' : '(none)', ''));
      for (const m of able) sel.append(new Option(`${m.label} · ${money(blendedPrice(m))}/M`, m.id));
      sel.value = able.some((m) => m.id === current[i]) ? current[i] : '';
      sel.addEventListener('change', () => {
        const picks = [...current];
        picks[i] = sel.value;
        setup.setPins({ ...setup.pins, [task]: picks.filter((x, k) => x && picks.indexOf(x) === k) });
      });
      row.append(sel);
    }
    const reset = button('', 'Default', () => { const p = { ...setup.pins }; delete p[task]; setup.setPins(p); });
    row.append(reset);
    const plan = setup.llm.plan(task);
    box.append(row, el('div', 'plan', plan.length ? `Tries: ${plan.map((m) => m.label).join(' → ')}` : `No enabled model can do this (needs ${TASKS[task].routing.needs.join(', ')}).`));
    s.append(box);
  }
  return s;
}

function rosterSection(setup: LlmSetup, msg: HTMLElement): HTMLElement {
  const s = el('section', '');
  s.append(el('h3', '', 'Your models'), el('p', '', 'Tags tell the router what a model is good for: a task only uses models with the tags it needs (chat replies need "writing"; reading replies needs "structured" and "fast"). Prices are per million tokens, input / output.'));
  const t = el('table', 'llm-roster');
  const hr = el('tr', '');
  for (const h of ['On', 'Model', 'Price', 'Good for']) hr.append(el('th', '', h));
  t.append(hr);
  const update = (id: string, f: (m: ModelEntry) => ModelEntry) => setup.setRoster({ models: setup.roster.models.map((m) => (m.id === id ? f(m) : m)) });
  for (const m of setup.roster.models) {
    const tr = el('tr', '');
    const on = checkbox(m.enabled, (v) => update(m.id, (x) => ({ ...x, enabled: v })));
    const name = el('td', '');
    name.append(el('div', '', m.label), el('div', 'id', m.id));
    const tags = el('td', '');
    for (const c of CAPABILITIES) {
      const lab = el('label', 'llm-tag');
      const box = checkbox(m.tags.includes(c), (v) => update(m.id, (x) => ({ ...x, tags: v ? [...x.tags, c] : x.tags.filter((y: Capability) => y !== c) })));
      lab.append(box, document.createTextNode(c.replace('_', ' ')));
      tags.append(lab);
    }
    const tdOn = el('td', '');
    tdOn.append(on);
    tr.append(tdOn, name, el('td', '', `$${m.price.prompt} / $${m.price.completion}`), tags);
    t.append(tr);
  }
  const add = el('div', 'llm-row');
  const id = el('input', '');
  id.type = 'text';
  id.placeholder = 'Add a model by its OpenRouter id, e.g. mistralai/mistral-small-4';
  const addBtn = button('', 'Add', async () => {
    const want = id.value.trim();
    if (!want) return;
    if (setup.roster.models.some((m) => m.id === want)) { msg.textContent = 'That model is already in the list.'; return; }
    msg.textContent = 'Looking it up…';
    try {
      const found = (await fetchCatalog()).find((m) => m.id === want);
      if (!found) { msg.textContent = `OpenRouter does not list "${want}".`; return; }
      setup.setRoster({ models: [...setup.roster.models, entryFromCatalog(found)] });
      msg.textContent = `Added ${found.name}. Tick "writing" if it should voice people, "fast" for quick tasks.`;
    } catch (e) { msg.textContent = `Could not reach OpenRouter: ${e instanceof Error ? e.message : String(e)}`; }
  });
  add.append(id, addBtn);
  const tools = el('div', 'llm-row');
  const refresh = button('', 'Update prices from OpenRouter', async () => {
    msg.textContent = 'Updating…';
    try { await setup.refreshFromCatalog(); msg.textContent = 'Prices and limits updated.'; } catch (e) { msg.textContent = `Could not reach OpenRouter: ${e instanceof Error ? e.message : String(e)}`; }
  });
  const reset = button('', 'Back to the default models', () => { setup.resetModels(); msg.textContent = 'Models and picks reset to the defaults.'; });
  tools.append(refresh, reset);
  s.append(t, add, tools);
  return s;
}

function usageSection(setup: LlmSetup): HTMLElement {
  const s = el('section', '');
  const t = setup.ledger.total();
  s.append(el('h3', '', 'Usage so far'), el('p', '', t.calls ? `${money(t.cost)} over ${t.calls} calls${t.estimated ? ' (partly estimated from list prices)' : ''}. Details in the chat panel's Usage tab.` : 'Nothing yet.'));
  return s;
}

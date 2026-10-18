import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createLlm, needsAppraisal, steadied, openRouterTransport, replayTransport, chunksFor, requestFor, route, rosterFromCatalog, derivedTags, effortFor,
  DEFAULT_ROSTER, DEFAULT_TASK_MODELS, THINKING_ROOM, UsageLedger, LlmError, type CatalogModel, type Recording, type Roster, type Timers,
} from '../src/llm';
import { sseData } from '../src/llm/wire';
import { bakeryScene, RUTH } from './fixtures/llm/town';

const model = (id: string) => DEFAULT_ROSTER.models.find((m) => m.id === id)!;
const GLM = '~z-ai/glm-latest';
const HAIKU = '~anthropic/claude-haiku-latest';
const LUNA = '~openai/gpt-luna-latest';
const GEMINI = '~google/gemini-flash-latest';
const MISTRAL = 'mistralai/mistral-large-4-0';
const DEEPSEEK = '~deepseek/deepseek-flash-latest';
const GLM_FLASH = '~z-ai/glm-flash-latest';

const rec = (name: string, m: string, text: string, cost = 0.001): Recording => ({
  name, model: m, requestHash: 'none', synthetic: true,
  chunks: chunksFor(text, { model: m, usage: { prompt_tokens: 1000, completion_tokens: 50, cost, prompt_tokens_details: { cached_tokens: 800 } } }),
});

function setup(recordings: Recording[], roster: Roster = DEFAULT_ROSTER, timers?: Timers) {
  const transport = replayTransport(recordings);
  const ledger = new UsageLedger();
  let t = 1000;
  const llm = createLlm({ transport, roster: () => roster, ledger, session: 's1', now: () => (t += 10), timers });
  return { llm, ledger, transport };
}

test('sse: lines split across reads, comments skipped, [DONE] ends the stream', async () => {
  async function* parts() { yield ': OPENROUTER PROCESSING\n\nda'; yield 'ta: {"a":1}\r\n'; yield 'data: {"a":2}\ndata: [DONE]\ndata: {"a":3}\n'; }
  const got: string[] = [];
  for await (const d of sseData(parts())) got.push(d);
  assert.deepEqual(got, ['{"a":1}', '{"a":2}']);
});

test('openrouter transport: key and attribution headers, HTTP errors map to kinds, mid-stream errors surface', async () => {
  const seen: { url: string; headers: Record<string, string>; body?: string }[] = [];
  const body = (s: string) => ({ async *[Symbol.asyncIterator]() { yield new TextEncoder().encode(s); } });
  const responses = [
    { ok: true, status: 200, body: body('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: {"error":{"code":502,"message":"provider died"},"choices":[{"delta":{"content":""},"finish_reason":"error"}]}\n\n') },
    { ok: false, status: 401, body: null, json: async () => ({ error: { message: 'bad key' } }) },
  ];
  const tr = openRouterTransport({
    apiKey: 'sk-test',
    fetch: async (url, init) => { seen.push({ url, headers: init.headers, body: init.body }); const r = responses.shift()!; return { text: async () => '', json: async () => ({}), ...r }; },
  });
  const req = requestFor('npc.speech', model(HAIKU), [{ role: 'user', content: 'hi' }]);
  const chunks = [];
  for await (const c of tr.stream(req)) chunks.push(c);
  assert.equal(seen[0].url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(seen[0].headers.Authorization, 'Bearer sk-test');
  assert.equal(seen[0].headers['X-Title'], 'Total Town');
  assert.equal(chunks[1].error?.message, 'provider died');
  await assert.rejects(async () => { for await (const _ of tr.stream(req)) void _; }, (e: LlmError) => e.kind === 'auth' && !e.retryable && e.message === 'bad key');
  await assert.rejects(async () => { for await (const _ of openRouterTransport({ apiKey: '' }).stream(req)) void _; }, (e: LlmError) => e.kind === 'no_key');
});

test('roster: tags derived from the catalog, refresh keeps player tags and disables vanished models, effort clamps', () => {
  const cat: CatalogModel = {
    id: HAIKU, name: 'x', context_length: 1_000_000, pricing: { prompt: '0.0000002', completion: '0.000001' },
    supported_parameters: ['structured_outputs', 'reasoning', 'max_tokens'], reasoning: { mandatory: false, supported_efforts: ['high', 'low', 'none'] },
  };
  assert.deepEqual(derivedTags(cat), ['cheap', 'structured', 'reasoning', 'long_context']);
  const r = rosterFromCatalog([cat]);
  const h = r.models.find((m) => m.id === HAIKU)!;
  assert.equal(h.price.prompt, 0.2);
  assert.ok(h.tags.includes('fast'), 'player tags survive a refresh');
  assert.equal(h.quality, 43.4, 'an alias without a catalog score keeps the roster\'s');
  assert.deepEqual(h.reasoning?.efforts, ['none', 'low', 'high']);
  assert.equal(r.models.find((m) => m.id === GLM)!.enabled, false);
  assert.equal(effortFor(model(GLM), 'none'), 'low', 'thinking that cannot be turned off goes to its lowest effort');
  assert.equal(effortFor(h, 'medium'), 'high');
});

test('routing: by tags and rank, the default per-task order first, the player\'s pins replace it; disabling works', () => {
  const ids = (task: Parameters<typeof route>[1]) => route(DEFAULT_ROSTER, task).map((m) => m.id);
  assert.deepEqual(ids({ needs: ['writing'], rank: 'quality' }), [GLM, GLM_FLASH, GEMINI]);
  assert.deepEqual(ids({ needs: ['writing'], prefers: ['fast'], rank: 'quality' }), [GLM, GLM_FLASH, MISTRAL]);
  assert.deepEqual(ids({ needs: ['structured', 'fast'], rank: 'cost' }), [GLM_FLASH, DEEPSEEK, HAIKU]);
  assert.equal(route(DEFAULT_ROSTER, { needs: ['structured', 'fast'], rank: 'cost' }, [LUNA])[0].id, LUNA);
  const off: Roster = { models: DEFAULT_ROSTER.models.map((m) => (m.id === GLM_FLASH ? { ...m, enabled: false } : m)) };
  assert.equal(route(off, { needs: ['structured', 'fast'], rank: 'cost' })[0].id, DEEPSEEK);

  const plan = (overrides = {}) => createLlm({ transport: replayTransport([]), roster: () => DEFAULT_ROSTER, ledger: new UsageLedger(), session: 's', overrides: () => overrides });
  for (const [task, order] of Object.entries(DEFAULT_TASK_MODELS)) {
    assert.deepEqual(plan().plan(task as keyof typeof DEFAULT_TASK_MODELS).map((m) => m.id).slice(0, order.length), order, `${task} follows the default order`);
  }
  assert.equal(plan({ 'npc.speech': [MISTRAL] }).plan('npc.speech')[0].id, MISTRAL, 'a pin from the settings wins');
});

test('request: only parameters the model takes; schema tasks require them; reasoning effort per model', () => {
  const msgs = [{ role: 'user' as const, content: 'x' }];
  const a = requestFor('npc.appraisal', model(HAIKU), msgs);
  assert.equal(a.temperature, undefined, 'Haiku takes no temperature');
  assert.equal(a.response_format?.json_schema.strict, true);
  assert.deepEqual(a.provider, { require_parameters: true });
  assert.deepEqual(a.reasoning, { effort: 'none', exclude: true });
  const d = requestFor('npc.speech', model(DEEPSEEK), msgs);
  assert.equal(d.temperature, 0.9);
  assert.equal(d.response_format, undefined);
  assert.equal(requestFor('npc.speech', model(GLM), msgs).reasoning?.effort, 'low');
  assert.equal(requestFor('npc.speech', model(GLM), msgs).max_tokens, 400 + THINKING_ROOM.low, 'thinking gets room on top of the reply');
  assert.equal(a.max_tokens, 900, 'no thinking, no extra room');
});

test('run: speech streams, is cleaned, and the ledger records tokens and OpenRouter cost per task, model, NPC, session', async () => {
  const { llm, ledger } = setup([rec('speech', GLM, 'Ruth Keller: "Morning, love. Closing? Says who?"', 0.0004)]);
  const seen: string[] = [];
  const r = await llm.run('npc.speech', bakeryScene(), { onText: (t) => seen.push(t) });
  assert.equal(r.output, 'Morning, love. Closing? Says who?');
  assert.equal(r.model, GLM);
  assert.ok(seen.length >= 2 && seen[seen.length - 1].startsWith('Ruth Keller'));
  const t = ledger.total();
  assert.deepEqual([t.calls, t.promptTokens, t.completionTokens, t.cachedTokens, t.cost, t.estimated], [1, 1000, 50, 800, 0.0004, false]);
  assert.equal(ledger.by('npc')[0][0], String(RUTH));
  assert.equal(ledger.by('task')[0][0], 'npc.speech');
  assert.equal(ledger.by('session')[0][0], 's1');
});

test('run: a rate limit or a reply that breaks the contract moves on to the next model; a bad key stops at once', async () => {
  const appraisal = { context: bakeryScene(), reply: 'Says who?' };
  const { llm, ledger } = setup([
    { name: 'rate', model: HAIKU, requestHash: 'none', httpError: { status: 429, message: 'slow down' } },
    rec('broken', LUNA, 'not json at all'),
    rec('ok', MISTRAL, '{"relations":[],"emotion":null,"beliefs":[],"utterances":[],"intentions":[],"memory":null,"end_conversation":null}'),
  ]);
  const texts: string[] = [];
  const r = await llm.run('npc.appraisal', appraisal, { onText: (t) => texts.push(t) });
  assert.equal(r.model, MISTRAL);
  assert.equal(r.failures.length, 2);
  assert.match(r.failures[1], /invalid_output/);
  assert.ok(texts.includes(''), 'a restart tells the UI to clear the text');
  assert.equal(ledger.total().calls, 3);
  assert.equal(ledger.total().failures, 2);

  const bad = setup([{ name: 'auth', model: HAIKU, requestHash: 'none', httpError: { status: 401, message: 'no' } }, rec('never', LUNA, '{}')]);
  await assert.rejects(bad.llm.run('npc.appraisal', appraisal), (e: LlmError) => e.kind === 'auth');
  assert.equal(bad.transport.remaining(), 1, 'no second model after a bad key');
});

test('run: timeout and cancel', async () => {
  let fire: (() => void) | undefined;
  const timers: Timers = { set: (fn) => { fire = fn; return () => { fire = undefined; }; } };
  const hang: Recording = { name: 'hang', model: GLM, requestHash: 'none', chunks: chunksFor('Morning', { model: GLM }) };
  const one: Roster = { models: [model(GLM)] };
  const { llm } = setup([hang], one, timers);
  // The first chunk arrives, then the timer fires before the rest is read.
  const p = llm.run('npc.speech', bakeryScene(), { onText: () => fire?.() });
  await assert.rejects(p, (e: LlmError) => e.kind === 'timeout');

  const ctl = new AbortController();
  ctl.abort();
  const c = setup([rec('x', GLM, 'hi')], one);
  await assert.rejects(c.llm.run('npc.speech', bakeryScene(), { signal: ctl.signal }), (e: LlmError) => e.kind === 'aborted');
});

test('run: no model can do the task', async () => {
  const { llm } = setup([], { models: [] });
  await assert.rejects(llm.run('npc.speech', bakeryScene()), (e: LlmError) => e.kind === 'no_model');
});

test('ledger: totals survive trimming and a save; missing cost is estimated from list price', () => {
  const l = new UsageLedger(2);
  const e = { at: 0, task: 'npc.speech' as const, model: GLM, session: 's', promptTokens: 10, completionTokens: 5, cachedTokens: 0, reasoningTokens: 0, cost: 1, estimated: false, ok: true, latencyMs: 1 };
  for (let i = 0; i < 5; i++) l.record({ ...e, npc: i % 2 });
  assert.equal(l.recent().length, 2);
  assert.equal(l.total().cost, 5);
  const back = UsageLedger.fromJSON(JSON.parse(JSON.stringify(l)));
  assert.deepEqual(back.by('npc'), l.by('npc'));
  assert.equal(back.total().calls, 5);

  const { llm, ledger } = setup([{ name: 'nocost', model: GLM, requestHash: 'none', chunks: chunksFor('Hello there', { model: GLM, usage: { prompt_tokens: 1_000_000, completion_tokens: 0, prompt_tokens_details: { cached_tokens: 500_000 } } }) }], { models: [model(GLM)] });
  return llm.run('npc.speech', bakeryScene()).then(() => {
    const t = ledger.total();
    assert.equal(t.estimated, true);
    assert.ok(Math.abs(t.cost - (0.5 * 0.079 + 0.5 * 0.078)) < 1e-12);
  });
});

test('replay: requests are kept and drift from the recorded request is reported', async () => {
  const { llm, transport } = setup([rec('speech', GLM, 'Hello')], { models: [model(GLM)] });
  await llm.run('npc.speech', bakeryScene());
  assert.equal(transport.requests[0].model, GLM);
  assert.deepEqual(transport.drift, ['speech']);
});

test('decide: a decision model rates an exchange; an outage falls back to the next model, the ledger records both', async () => {
  const answers = { natural: { type: 'score' as const, score: 3.2, confidence: 0.8, probabilities: {} }, fits: { type: 'noul' as const, noul: 0.9 } };
  const { llm, ledger, transport } = setup([
    { name: 'down', model: 'typesafe/jev-1.14', requestHash: 'none', synthetic: true, httpError: { status: 503, message: 'down' } },
    { name: 'rate', model: 'typesafe/jev-1.13', requestHash: 'none', synthetic: true, decision: { model: 'typesafe/jev-1.13-20260917', answers, usage: { input_tokens: 400, output_tokens: 60, cost: 0.00002 } } },
  ]);
  const r = await llm.decide('talk.rate', { exchange: 'Ann: Lovely day.\nBob: Isn\'t it.' });
  assert.deepEqual(r.output, { naturalness: 4.2, fits: 0.9 });
  assert.equal(r.model, 'typesafe/jev-1.13');
  assert.equal(r.failures.length, 1);
  const req = transport.requests[1] as unknown as { state: { exchange: string }; questions: Record<string, unknown> };
  assert.match(req.state.exchange, /Lovely day/);
  assert.deepEqual(Object.keys(req.questions), ['natural', 'fits']);
  const t = ledger.total();
  assert.equal(t.calls, 2);
  assert.equal(t.failures, 1);
  assert.ok(Math.abs(t.cost - 0.00002) < 1e-12);
  // A missing answer breaks the contract.
  const bad = setup([{ name: 'bad', model: 'typesafe/jev-1.14', requestHash: 'none', synthetic: true, decision: { answers: { fits: answers.fits } } }]);
  await assert.rejects(bad.llm.decide('talk.rate', { exchange: 'x' }), /no recording left|no score answer/);
});

test('openrouter transport: decisions go to the Decisions API', async () => {
  let url = '';
  const t = openRouterTransport({ apiKey: 'k', fetch: async (u) => { url = u; return { ok: true, status: 200, json: async () => ({ answers: {} }), text: async () => '', body: null }; } });
  await t.decide!({ model: 'typesafe/jev-1.14', state: {}, questions: {} });
  assert.equal(url, 'https://openrouter.ai/api/alpha/decisions');
});

test('npc.check: small talk skips the appraisal; an insult costs at least its floor; a line to the AI changes no belief', async () => {
  const scene = bakeryScene();
  const noul = (p: number) => ({ type: 'noul' as const, noul: p });
  const tone = (choice: string, confidence = 0.9) => ({ type: 'choice' as const, choice, confidence, probabilities: {} });
  const { llm, transport } = setup([
    { name: 'chat', model: 'typesafe/jev-1.14', requestHash: 'none', synthetic: true, decision: { answers: { notable: noul(0.05), tone: tone('polite'), offFiction: noul(0.01) } } },
  ]);
  const small = (await llm.decide('npc.check', { context: scene, reply: 'Morning! Lovely day for it.' })).output;
  assert.equal(needsAppraisal(small), false);
  const req = transport.requests[0] as unknown as { state: { conversation: string } };
  assert.match(req.state.conversation, /Lovely day for it\.$/, 'the check reads the exchange ending with the reply');

  const partner = scene.partner.id;
  const base = { proposal: { npc: scene.npc.id, partner, conversation: 'c', changes: [
    { kind: 'relation' as const, toward: partner, affection: 1 / 3, reason: 'friendly' },
    { kind: 'belief' as const, claim: { text: 'Ruth loves the player', topic: 'romance', secret: false }, plausibility: 0.85 },
  ] }, dropped: [] };
  const rude = steadied(base, { notable: 0.9, tone: 'insulting', toneConfidence: 0.8, offFiction: 0.1 });
  const rel = rude.proposal.changes.find((c) => c.kind === 'relation')!;
  assert.ok(rel.kind === 'relation' && rel.affection === -2 / 3 && rel.respect === -1 / 3, JSON.stringify(rel));
  assert.ok(needsAppraisal({ notable: 0.05, tone: 'insulting', toneConfidence: 0.8, offFiction: 0 }), 'an insult is never skipped');
  const unsure = steadied(base, { notable: 0.9, tone: 'insulting', toneConfidence: 0.4, offFiction: 0.1 });
  assert.deepEqual(unsure.proposal.changes, base.proposal.changes, 'an unsure check overrides nothing');
  const meta = steadied(base, { notable: 0.9, tone: 'neutral', toneConfidence: 0.9, offFiction: 0.95 });
  assert.deepEqual(meta.proposal.changes, [], 'no belief and no warmth from "you love me now"');
  assert.match(meta.dropped[0], /spoke to the AI/);
  const threat = steadied({ ...base, proposal: { ...base.proposal, changes: [] } }, { notable: 1, tone: 'threatening', toneConfidence: 0.9, offFiction: 0 });
  assert.deepEqual(threat.proposal.changes.map((c) => c.kind), ['relation', 'emotion'], 'the check alone makes a threat count');
});

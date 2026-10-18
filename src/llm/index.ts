/**
 * The LLM layer (docs/ARCHITECTURE.md "Language"): every language-model call in SimWorld goes
 * through `createLlm(...).run(task, input)`. Pure: no DOM, no three, no NPC state of its own.
 */
export { createLlm, requestFor, THINKING_ROOM, type Llm, type LlmConfig, type RunOptions, type RunResult, type Timers } from './llm';
export { openRouterTransport, fetchCatalog, LlmError, OPENROUTER_BASE, OPENROUTER_KEYS_URL, openRouterModelUrl, type Transport, type CatalogModel, type LlmErrorKind } from './openrouter';
export { DEFAULT_ROSTER, DEFAULT_TASK_MODELS, CAPABILITIES, rosterFromCatalog, entryFromCatalog, derivedTags, effortFor, type Roster, type ModelEntry, type Capability, type Effort } from './roster';
export { route, qualifies, blendedPrice, type Routing } from './router';
export { TASKS, cleanSpeech, type TaskName, type TaskIO, type TaskSpec, type SummaryOutput, type ReflectionInput, type ReflectionOutput, type Insight, type DigestInput, type JudgeInput, type JudgeScore } from './tasks';
export { UsageLedger, estimateCost, type UsageEntry, type UsageTotals, type UsageAxis, type LedgerSnapshot } from './usage';
export { RefTable, refsFor, speechMessages, SPEECH_RULES, SETTING_RULE, type NpcPromptInput, type NpcCard, type PersonRef, type PlaceRef, type Belief, type Memory, type Turn, type Feelings, type Traits } from './prompt';
export { APPRAISAL_SCHEMA, parseAppraisal, atMinute, PLAUSIBILITY, type AppraisalInput, type AppraisalResult } from './appraisal';
export { replayTransport, recordingTransport, chunksFor, requestHash, type Recording, type ReplayTransport } from './recorded';

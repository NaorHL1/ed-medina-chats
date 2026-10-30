export type { DateOrder, Message, MessageKind, ParseResult, Platform } from './types.js';
export { ChatFormatError, detectPlatform, inferDateOrder, parseChat } from './parser/parse.js';
export { classifyText, splitSender, stripDirectionMarks } from './parser/normalize.js';
export { redactMessages, redactText, type RedactionCounts, type RedactionResult } from './redact.js';
export { computeMetrics, type ChatMetrics, type GhostGap, type MetricsOptions, type PersonMetrics, type PhraseStat } from './metrics/index.js';
export { buildConversations, CONVERSATION_GAP_MS, speakingMessages, type Conversation, type Turn } from './metrics/turns.js';
export { dailyVolume, segmentEras, type Era, type EraOptions } from './eras.js';
export { formatChat, generateChat, type SyntheticChat, type SyntheticSpec, type SyntheticTruth } from './synthetic.js';
export { buildRegistry, type MetricRegistry } from './report/registry.js';
export { parseReport, ReportSchemaError, type Card, type Confidence, type PersonCard, type Report } from './report/types.js';
export { applyVerdicts, verifyReport, type Removal, type Verdict, type VerifyContext, type VerifyResult } from './report/verify.js';
export { BANNED_PHRASES } from './pipeline/prompts.js';
export {
  metricsForModel,
  PipelineError,
  runPipeline,
  sanitizeMaterialBank,
  type CareFlag,
  type CareFlagType,
  type ModelClient,
  type PipelineInput,
  type PipelineRemoval,
  type PipelineResult,
  type Stage,
} from './pipeline/run.js';

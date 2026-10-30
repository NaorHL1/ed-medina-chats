import { computeMetrics, type ChatMetrics } from './metrics/index.js';
import { segmentEras, type Era } from './eras.js';
import { parseChat } from './parser/parse.js';
import { redactMessages, type RedactionCounts } from './redact.js';
import { runPipeline, type ModelClient, type PipelineResult } from './pipeline/run.js';
import type { Message, Platform, DateOrder } from './types.js';

/** WhatsApp keeps at most this many messages in an export, so a count at the limit may be cut short. */
export const EXPORT_MESSAGE_LIMIT = 40_000;

export interface AnalyzeOptions {
  /** Real sender name to the nickname the uploader chose. Applied before anything is counted. */
  aliases?: Record<string, string>;
  dateOrder?: DateOrder;
}

export interface Analysis {
  platform: Platform;
  dateOrder: DateOrder;
  droppedLines: number;
  warnings: string[];
  redactions: RedactionCounts;
  /** Participant (after aliasing) to its id, such as `P1`. Ids follow first appearance in the file. */
  personIds: Record<string, string>;
  metrics: ChatMetrics;
  eras: Era[];
  /** Redacted and aliased. Used by the pipeline and never written to the summary output. */
  transcript: Message[];
}

/** Parses, redacts, aliases and counts one export. Pure: no file or network access. */
export function analyzeChat(text: string, options: AnalyzeOptions = {}): Analysis {
  const parsed = parseChat(text, options.dateOrder ? { dateOrder: options.dateOrder } : {});

  const warnings = [...parsed.warnings];
  if (parsed.messages.length >= EXPORT_MESSAGE_LIMIT) {
    warnings.push(
      `The export has ${parsed.messages.length} messages, the WhatsApp limit. Older messages may be missing.`,
    );
  }

  const { messages, counts } = redactMessages(parsed.messages, options.aliases ?? {});
  const metrics = computeMetrics(messages);
  const personIds = Object.fromEntries(metrics.participants.map((name, index) => [name, `P${index + 1}`]));

  return {
    platform: parsed.platform,
    dateOrder: parsed.dateOrder,
    droppedLines: parsed.droppedLines,
    warnings,
    redactions: counts,
    personIds,
    metrics,
    eras: segmentEras(messages),
    transcript: messages,
  };
}

export interface ReportRequest {
  reportType: string;
  language: 'he' | 'en';
  intensity: 1 | 2 | 3 | 4 | 5;
  persona: { name: string; card: string };
  localResources: string;
}

/** Runs the model pipeline over an analysis. Only ids and redacted text reach the client. */
export function runReport(analysis: Analysis, request: ReportRequest, client: ModelClient): Promise<PipelineResult> {
  return runPipeline({
    transcript: analysis.transcript,
    metrics: analysis.metrics,
    personIds: analysis.personIds,
    client,
    ...request,
  });
}

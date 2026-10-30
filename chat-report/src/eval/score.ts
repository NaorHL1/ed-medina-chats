import { computeMetrics, type ChatMetrics } from '../metrics/index.js';
import { DAY_MS } from '../metrics/turns.js';
import { parseChat } from '../parser/parse.js';
import { formatChat, generateChat, type SyntheticChat, type SyntheticSpec } from '../synthetic.js';
import type { Message } from '../types.js';
import type { EvalCase } from './cases.js';

/** Minimum share of planted patterns the metrics must find. From the plan's quality targets. */
export const TARGET_PLANTED_RECALL = 0.9;
/** Minimum share of controls and absent patterns that must stay quiet. */
export const TARGET_FALSE_ALARM_MAX = 0.1;
/** Parsed metrics must equal the metrics of the generated messages, in every case. */
export const TARGET_NUMBERS = 1;

/**
 * Patterns the metrics can see. A fight is a hostile exchange, which only the extractor can judge;
 * it is planted in some cases and scored once the model stage runs live.
 */
export const PATTERNS = ['insideJoke', 'slowReply', 'quiet'] as const;
export type Pattern = (typeof PATTERNS)[number];

export interface PatternResult {
  pattern: Pattern;
  planted: boolean;
  detected: boolean;
}

export interface CaseResult {
  id: string;
  roundTripOk: boolean;
  numbersOk: boolean;
  initiationError: number;
  patterns: PatternResult[];
}

export interface EvalSummary {
  cases: CaseResult[];
  plantedRecall: number | null;
  falseAlarmRate: number | null;
  numbersRate: number;
  roundTripRate: number;
}

/** Index of the chat day (from the spec's start date) that a timestamp falls on. */
function dayIndex(spec: SyntheticSpec, ts: number): number {
  return Math.floor((ts - Date.parse(`${spec.startDate}T00:00:00Z`)) / DAY_MS);
}

function splitAt(messages: Message[], spec: SyntheticSpec, day: number): { before: Message[]; after: Message[] } {
  const boundary = Date.parse(`${spec.startDate}T00:00:00Z`) + day * DAY_MS;
  return {
    before: messages.filter((m) => m.ts < boundary),
    after: messages.filter((m) => m.ts >= boundary),
  };
}

/**
 * Detectors use only the metrics and the transcript, never the generator's truth.
 * Each one answers: would the numbers alone reveal this pattern?
 */
export function detectInsideJoke(metrics: ChatMetrics, first: string, joke: string): boolean {
  return metrics.people[first]?.signaturePhrases.some((p) => p.phrase === joke) ?? false;
}

/** Reply median from the second person more than doubles after the split. */
export function detectSlowReply(messages: Message[], spec: SyntheticSpec, day: number, second: string): boolean {
  const { before, after } = splitAt(messages, spec, day);
  const was = computeMetrics(before).people[second]?.replyMedianMs;
  const now = computeMetrics(after).people[second]?.replyMedianMs;
  return was != null && now != null && now >= 2 * was;
}

/** Conversations per day fall below half their earlier rate. */
export function detectQuiet(messages: Message[], spec: SyntheticSpec, day: number): boolean {
  const { before, after } = splitAt(messages, spec, day);
  const earlier = computeMetrics(before).conversations / day;
  const later = computeMetrics(after).conversations / (spec.days - day);
  return earlier > 0 && later < 0.5 * earlier;
}

function sameNumbers(a: ChatMetrics, b: ChatMetrics): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function evaluateCase(evalCase: EvalCase): CaseResult {
  const { spec } = evalCase;
  const generated: SyntheticChat = generateChat(spec);
  const text = formatChat(generated.messages, {
    platform: evalCase.platform,
    dateOrder: evalCase.dateOrder,
    android12h: evalCase.android12h,
  });
  const parsed = parseChat(text);

  const roundTripOk =
    parsed.droppedLines === 0 &&
    parsed.messages.length === generated.messages.length &&
    parsed.messages.every((m, i) => {
      const g = generated.messages[i]!;
      return m.ts === g.ts && m.sender === g.sender && m.text === g.text;
    });

  const expected = computeMetrics(generated.messages);
  const actual = computeMetrics(parsed.messages);
  const numbersOk = sameNumbers(expected, actual);

  const [first, second] = spec.people as [string, string];
  const initiationError = Math.abs((actual.people[first]?.initiationRate ?? 0) - spec.firstPersonOpenRate);

  const truth = generated.truth;
  const jokePlanted = truth.insideJokeCount >= 3 && spec.insideJoke !== undefined;
  const patterns: PatternResult[] = [];

  if (spec.insideJoke !== undefined) {
    patterns.push({
      pattern: 'insideJoke',
      planted: jokePlanted,
      detected: detectInsideJoke(actual, first, spec.insideJoke),
    });
  }
  if (spec.slowReplyFromDay !== undefined) {
    patterns.push({
      pattern: 'slowReply',
      planted: true,
      detected: detectSlowReply(parsed.messages, spec, spec.slowReplyFromDay, second),
    });
  }
  if (spec.quietFromDay !== undefined) {
    patterns.push({ pattern: 'quiet', planted: true, detected: detectQuiet(parsed.messages, spec, spec.quietFromDay) });
  }
  // Absent patterns are scored too: a detector that fires on a clean chat is a false alarm.
  if (spec.slowReplyFromDay === undefined) {
    patterns.push({ pattern: 'slowReply', planted: false, detected: detectSlowReply(parsed.messages, spec, Math.floor(spec.days / 2), second) });
  }
  if (spec.quietFromDay === undefined) {
    patterns.push({ pattern: 'quiet', planted: false, detected: detectQuiet(parsed.messages, spec, Math.floor(spec.days / 2)) });
  }
  return { id: evalCase.id, roundTripOk, numbersOk, initiationError, patterns };
}

export function summarize(results: CaseResult[]): EvalSummary {
  const planted = results.flatMap((r) => r.patterns.filter((p) => p.planted));
  const absent = results.flatMap((r) => r.patterns.filter((p) => !p.planted));
  const share = (hits: number, total: number): number | null => (total === 0 ? null : hits / total);

  return {
    cases: results,
    plantedRecall: share(planted.filter((p) => p.detected).length, planted.length),
    falseAlarmRate: share(absent.filter((p) => p.detected).length, absent.length),
    numbersRate: share(results.filter((r) => r.numbersOk).length, results.length) ?? 0,
    roundTripRate: share(results.filter((r) => r.roundTripOk).length, results.length) ?? 0,
  };
}

export function runEval(cases: EvalCase[]): EvalSummary {
  return summarize(cases.map(evaluateCase));
}

/** Gate check. Returns the failed gates by name; an empty list means the set passes. */
export function failedGates(summary: EvalSummary): string[] {
  const failures: string[] = [];
  if (summary.roundTripRate < 1) failures.push('round trip (parse with zero dropped lines)');
  if (summary.numbersRate < TARGET_NUMBERS) failures.push('numbers match the generated chat');
  if (summary.plantedRecall === null || summary.plantedRecall < TARGET_PLANTED_RECALL) {
    failures.push(`planted recall ${summary.plantedRecall ?? 'n/a'} below ${TARGET_PLANTED_RECALL}`);
  }
  if (summary.falseAlarmRate !== null && summary.falseAlarmRate > TARGET_FALSE_ALARM_MAX) {
    failures.push(`false alarms ${summary.falseAlarmRate} above ${TARGET_FALSE_ALARM_MAX}`);
  }
  return failures;
}

import { computeMetrics, type ChatMetrics } from './metrics/index.js';
import { DAY_MS, speakingMessages, type SpeakingMessage } from './metrics/turns.js';
import type { Message } from './types.js';

export interface EraOptions {
  /** A silence this long always starts a new era. */
  silenceDays?: number;
  /** Days on each side of a candidate boundary that are compared. */
  windowDays?: number;
  /** Minimum before/after ratio of daily volume (either direction) that counts as a shift. */
  shiftRatio?: number;
  /** Minimum change in messages per day, so quiet chats do not split on noise. */
  minDailyDelta?: number;
  /** Eras below this many messages merge into a neighbour. */
  minMessages?: number;
}

export interface Era {
  id: string;
  startDay: number;
  endDay: number;
  start: number;
  end: number;
  messageCount: number;
  metrics: ChatMetrics;
}

const DEFAULTS: Required<EraOptions> = {
  silenceDays: 7,
  windowDays: 14,
  shiftRatio: 2.5,
  minDailyDelta: 3,
  minMessages: 50,
};

const dayOf = (ts: number): number => Math.floor(ts / DAY_MS);

interface Span {
  startDay: number;
  messages: SpeakingMessage[];
}

/** Messages per day for every day in the span, including zero days. Index 0 is the first day. */
export function dailyVolume(messages: Message[]): { day: number; count: number }[] {
  const speaking = speakingMessages(messages);
  const first = speaking[0];
  const last = speaking.at(-1);
  if (!first || !last) return [];

  const firstDay = dayOf(first.ts);
  const counts = new Array<number>(dayOf(last.ts) - firstDay + 1).fill(0);
  for (const message of speaking) counts[dayOf(message.ts) - firstDay]!++;
  return counts.map((count, i) => ({ day: firstDay + i, count }));
}

/** Days where the mean daily volume before and after differs enough to be a real shift. */
function volumeShiftDays(counts: number[], windowDays: number, shiftRatio: number, minDailyDelta: number): number[] {
  const candidates: { day: number; ratio: number }[] = [];
  const mean = (from: number, to: number): number => {
    let sum = 0;
    for (let i = from; i < to; i++) sum += counts[i] ?? 0;
    return sum / (to - from);
  };

  for (let d = windowDays; d + windowDays <= counts.length; d++) {
    const before = mean(d - windowDays, d);
    const after = mean(d, d + windowDays);
    const ratio = Math.max((after + 1) / (before + 1), (before + 1) / (after + 1));
    if (ratio >= shiftRatio && Math.abs(after - before) >= minDailyDelta) {
      candidates.push({ day: d, ratio });
    }
  }

  // Consecutive candidate days belong to one shift; keep the sharpest day of each run.
  const boundaries: number[] = [];
  let run: { day: number; ratio: number } | null = null;
  let previousDay = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    if (candidate.day !== previousDay + 1) {
      if (run) boundaries.push(run.day);
      run = candidate;
    } else if (run && candidate.ratio > run.ratio) {
      run = candidate;
    }
    previousDay = candidate.day;
  }
  if (run) boundaries.push(run.day);
  return boundaries;
}

/**
 * Splits a chat into eras where the rhythm changes: after a long silence, or when
 * daily volume shifts sharply for at least a window. Eras that are too small merge
 * into a neighbour, so every era has enough messages to measure.
 */
export function segmentEras(messages: Message[], options: EraOptions = {}): Era[] {
  const o = { ...DEFAULTS, ...options };
  const speaking = speakingMessages(messages);
  const volume = dailyVolume(speaking);
  if (volume.length === 0) return [];

  const firstDay = volume[0]!.day;
  const counts = volume.map((v) => v.count);
  const boundaries = new Set<number>();

  for (let i = 1; i < speaking.length; i++) {
    const gap = speaking[i]!.ts - speaking[i - 1]!.ts;
    if (gap >= o.silenceDays * DAY_MS) boundaries.add(dayOf(speaking[i]!.ts));
  }
  for (const day of volumeShiftDays(counts, o.windowDays, o.shiftRatio, o.minDailyDelta)) {
    boundaries.add(firstDay + day);
  }

  const starts = [firstDay, ...[...boundaries].filter((d) => d > firstDay).sort((a, b) => a - b)];
  const spans: Span[] = starts.map((startDay) => ({ startDay, messages: [] }));
  let cursor = 0;
  for (const message of speaking) {
    const day = dayOf(message.ts);
    while (cursor + 1 < spans.length && spans[cursor + 1]!.startDay <= day) cursor++;
    spans[cursor]!.messages.push(message);
  }

  // An undersized era joins the neighbour with the closest rhythm (messages per day), so a
  // quiet tail stays one era instead of being folded back into the loud one before it.
  const isUndersized = (s: Span) => s.messages.length < o.minMessages;
  const rate = (s: Span) => {
    const last = s.messages.at(-1);
    const endDay = last ? dayOf(last.ts) : s.startDay;
    return s.messages.length / (endDay - s.startDay + 1);
  };
  let small = spans.findIndex(isUndersized);
  while (small !== -1 && spans.length > 1) {
    const span = spans[small]!;
    const left = spans[small - 1];
    const right = spans[small + 1];
    const gapTo = (neighbour: Span | undefined) => (neighbour ? Math.abs(rate(neighbour) - rate(span)) : Infinity);
    const mergeLeft = gapTo(left) <= gapTo(right);
    const keepIndex = mergeLeft ? small - 1 : small;
    const dropIndex = mergeLeft ? small : small + 1;
    const kept = spans[keepIndex]!;
    kept.messages = kept.messages.concat(spans[dropIndex]!.messages);
    spans.splice(dropIndex, 1);
    small = spans.findIndex(isUndersized);
  }

  return spans.map((span, i) => {
    const first = span.messages[0]!;
    const last = span.messages.at(-1)!;
    const endDay = dayOf(last.ts);
    return {
      id: `E${i + 1}`,
      startDay: span.startDay,
      endDay,
      start: first.ts,
      end: last.ts,
      messageCount: span.messages.length,
      metrics: computeMetrics(span.messages),
    };
  });
}

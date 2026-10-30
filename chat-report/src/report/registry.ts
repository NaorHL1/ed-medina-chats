import type { ChatMetrics, PersonMetrics } from '../metrics/index.js';

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

/** Person-level metrics a card may reference, by their ref name. */
const PERSON_KEYS = [
  'messages',
  'words',
  'share_of_messages',
  'share_of_words',
  'initiation_rate',
  'ender_rate',
  'reply_median_ms',
  'reply_p90_ms',
  'double_text_rate',
  'question_answer_rate',
  'night_owl_rate',
  'media_count',
  'audio_count',
  'laughter_count',
  'warmth_count',
] as const;

export interface MetricRegistry {
  /** Raw metric values, keyed by ref such as `P1.initiation_rate` or `chat.reply_asymmetry`. */
  values: Map<string, number>;
  /** Every number a report may print for a metric: raw, percent, minutes and hours, rounded. */
  printable: Set<number>;
}

function personValues(person: PersonMetrics): Record<(typeof PERSON_KEYS)[number], number | null> {
  return {
    messages: person.messages,
    words: person.words,
    share_of_messages: person.shareOfMessages,
    share_of_words: person.shareOfWords,
    initiation_rate: person.initiationRate,
    ender_rate: person.enderRate,
    reply_median_ms: person.replyMedianMs,
    reply_p90_ms: person.replyP90Ms,
    double_text_rate: person.doubleTextRate,
    question_answer_rate: person.questionAnswerRate,
    night_owl_rate: person.nightOwlRate,
    media_count: person.mediaCount,
    audio_count: person.audioCount,
    laughter_count: person.laughterCount,
    warmth_count: person.warmthCount,
  };
}

/**
 * Builds the set of metric refs a report may cite and the numbers it may print.
 * `personIds` maps each participant name to its id (`P1`, `P2`, ...). Names never reach the model.
 */
export function buildRegistry(metrics: ChatMetrics, personIds: Record<string, string>): MetricRegistry {
  const values = new Map<string, number>();
  const add = (ref: string, value: number | null) => {
    if (value !== null && Number.isFinite(value)) values.set(ref, value);
  };

  add('chat.total_messages', metrics.totalMessages);
  add('chat.total_words', metrics.totalWords);
  add('chat.conversations', metrics.conversations);
  add('chat.longest_streak_days', metrics.longestStreakDays);
  add('chat.reply_asymmetry', metrics.replyAsymmetry);

  for (const [name, id] of Object.entries(personIds)) {
    const person = metrics.people[name];
    if (!person) continue;
    for (const [key, value] of Object.entries(personValues(person))) add(`${id}.${key}`, value);
  }

  const printable = new Set<number>();
  for (const value of values.values()) {
    printable.add(Math.round(value));
    printable.add(Math.round(value * 100));
    printable.add(Math.round(value / MINUTE_MS));
    printable.add(Math.round(value / HOUR_MS));
  }
  return { values, printable };
}

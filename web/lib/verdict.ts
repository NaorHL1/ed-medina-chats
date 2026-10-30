import type { ChatMetrics } from '@engine/metrics/index';

const DAY_MS = 86_400_000;
/** A silence shorter than this is not worth a card. */
const NOTABLE_SILENCE_MS = DAY_MS;

export interface Verdict {
  totals: { messages: number; people: number; days: number; conversations: number };
  /** The person who opens the most conversations. Null when there are no conversations. */
  initiation: { name: string; rate: number } | null;
  /** Fastest and slowest median reply. Null unless two people have replied. */
  reply: { fast: { name: string; ms: number }; slow: { name: string; ms: number } } | null;
  /** Longest silence, only when it lasted at least a day. */
  silence: { ms: number; brokeBy: string } | null;
}

/**
 * The free preview. Everything here is counted in code from the chat; no model is
 * called, so a free upload costs almost nothing to serve.
 */
export function buildVerdict(metrics: ChatMetrics): Verdict {
  const people = Object.entries(metrics.people);

  const opener = [...people].sort((a, b) => b[1].initiationRate - a[1].initiationRate)[0];
  const repliers = people
    .filter(([, p]) => p.replyMedianMs !== null)
    .map(([name, p]) => ({ name, ms: p.replyMedianMs as number }))
    .sort((a, b) => a.ms - b.ms);
  const gap = metrics.ghostGaps[0];

  return {
    totals: {
      messages: metrics.totalMessages,
      people: metrics.participants.length,
      days: metrics.span?.days ?? 0,
      conversations: metrics.conversations,
    },
    initiation: opener && metrics.conversations > 0 ? { name: opener[0], rate: opener[1].initiationRate } : null,
    reply:
      repliers.length >= 2
        ? { fast: repliers[0]!, slow: repliers[repliers.length - 1]! }
        : null,
    silence: gap && gap.durationMs >= NOTABLE_SILENCE_MS ? { ms: gap.durationMs, brokeBy: gap.brokeBy } : null,
  };
}

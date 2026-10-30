import { describe, expect, it } from 'vitest';
import { computeMetrics } from '../src/metrics/index.js';
import { parseChat } from '../src/parser/parse.js';
import { formatChat, generateChat, type SyntheticSpec } from '../src/synthetic.js';
import type { Message, Platform } from '../src/types.js';

const BASE: SyntheticSpec = {
  seed: 1,
  startDate: '2026-10-01',
  days: 30,
  people: ['Naor', 'Dana'],
  conversationsPerDay: 2,
  firstPersonOpenRate: 0.5,
  language: 'en',
};

/**
 * Gate proxy for Step 1: export variants across platforms, languages, date orders,
 * clock formats and group sizes must all parse back with zero dropped lines and
 * identical senders, timestamps and text. Real exports are not in this repo yet.
 */
const variants = Array.from({ length: 20 }, (_, i) => {
  const seed = i + 1;
  const platform: Platform = seed % 2 === 0 ? 'ios' : 'android';
  return {
    name: `variant ${seed}`,
    spec: {
      ...BASE,
      seed,
      language: seed % 3 === 0 ? 'en' : 'he',
      people: seed % 5 === 0 ? ['Naor', 'Dana', 'Yoni', 'Mia', 'Eli'] : ['Naor', 'Dana'],
      conversationsPerDay: seed % 4 === 0 ? 1 : 2,
      days: 30,
    } satisfies SyntheticSpec,
    platform,
    dateOrder: seed % 4 === 0 ? ('mdy' as const) : ('dmy' as const),
    android12h: platform === 'android' && seed % 3 === 1,
  };
});

function sameMessages(a: Message[], b: Message[]): void {
  expect(b.map((m) => [m.ts, m.sender, m.text, m.kind])).toEqual(a.map((m) => [m.ts, m.sender, m.text, m.kind]));
}

describe('export round-trip (Step 1 gate proxy)', () => {
  it.each(variants)('$name parses back without losing a message', ({ spec, platform, dateOrder, android12h }) => {
    const { messages } = generateChat(spec);
    const exported = formatChat(messages, { platform, dateOrder, android12h });
    const parsed = parseChat(exported);

    expect(parsed.platform).toBe(platform);
    expect(parsed.dateOrder).toBe(dateOrder);
    expect(parsed.droppedLines).toBe(0);
    expect(parsed.warnings).toEqual([]);
    sameMessages(messages, parsed.messages);
  });
});

describe('planted patterns are recoverable from the metrics', () => {
  it('recovers the planted initiation rate within a few points', () => {
    const chat = generateChat({ ...BASE, seed: 42, days: 200, firstPersonOpenRate: 0.7 });
    const metrics = computeMetrics(chat.messages);
    expect(metrics.people['Naor']!.initiationRate).toBeGreaterThan(0.62);
    expect(metrics.people['Naor']!.initiationRate).toBeLessThan(0.78);
  });

  it('plants the inside joke exactly as often as the parser reads it back', () => {
    const chat = generateChat({ ...BASE, seed: 5, days: 60, insideJoke: 'boop boop' });
    const parsed = parseChat(formatChat(chat.messages, { platform: 'ios' }));
    const found = parsed.messages.filter((m) => m.text === 'boop boop').length;
    expect(found).toBe(chat.truth.insideJokeCount);
    expect(found).toBeGreaterThan(0);
  });

  it('shows a planted slow-reply drift in the second person’s median reply', () => {
    const chat = generateChat({ ...BASE, seed: 9, days: 80, slowReplyFromDay: 40 });
    const cutoff = Date.parse('2026-10-01T00:00:00Z') + 40 * 86_400_000;
    const before = computeMetrics(chat.messages.filter((m) => m.ts < cutoff));
    const after = computeMetrics(chat.messages.filter((m) => m.ts >= cutoff));

    const fastMedian = before.people['Dana']!.replyMedianMs!;
    const slowMedian = after.people['Dana']!.replyMedianMs!;
    expect(slowMedian / fastMedian).toBeGreaterThan(5);
  });

  it('plants a fight on the chosen day', () => {
    const chat = generateChat({ ...BASE, seed: 3, days: 20, fightDay: 10 });
    const fightStart = Date.parse('2026-10-01T00:00:00Z') + 10 * 86_400_000;
    const fightLines = chat.messages.filter(
      (m) => m.ts >= fightStart && m.ts < fightStart + 86_400_000 && m.text === 'why do you always do this?',
    );
    expect(fightLines.length).toBeGreaterThan(0);
  });

  it('is deterministic for a given seed', () => {
    expect(generateChat(BASE).messages).toEqual(generateChat(BASE).messages);
  });
});

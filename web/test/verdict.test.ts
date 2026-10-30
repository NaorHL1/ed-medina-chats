import { describe, expect, it } from 'vitest';
import { computeMetrics } from '../../chat-report/src/metrics/index';
import { generateChat } from '../../chat-report/src/synthetic';
import { formatDuration, formatPercent } from '../lib/format';
import { buildVerdict } from '../lib/verdict';

describe('formatDuration', () => {
  it('picks a readable unit in English and Hebrew', () => {
    expect(formatDuration(30_000, 'en')).toBe('under a minute');
    expect(formatDuration(3 * 60_000, 'en')).toBe('3 min');
    expect(formatDuration(5 * 3_600_000, 'en')).toBe('5 h');
    expect(formatDuration(12 * 86_400_000, 'en')).toBe('12 days');
    expect(formatDuration(3 * 60_000, 'he')).toBe('3 דק׳');
    expect(formatDuration(12 * 86_400_000, 'he')).toBe('12 ימים');
  });

  it('rounds percentages to whole numbers', () => {
    expect(formatPercent(0.714)).toBe('71%');
  });
});

describe('buildVerdict', () => {
  const chat = generateChat({
    seed: 42,
    startDate: '2026-01-01',
    days: 120,
    people: ['Naor', 'Dana'],
    conversationsPerDay: 2,
    firstPersonOpenRate: 0.8,
    language: 'en',
    slowReplyFromDay: 0,
  });
  const verdict = buildVerdict(computeMetrics(chat.messages));

  it('names the person who opens most conversations', () => {
    expect(verdict.initiation?.name).toBe('Naor');
    expect(verdict.initiation?.rate).toBeGreaterThan(0.7);
  });

  it('finds the slow replier when one person is planted as slow', () => {
    expect(verdict.reply?.slow.name).toBe('Dana');
    expect(verdict.reply!.slow.ms).toBeGreaterThan(verdict.reply!.fast.ms * 5);
  });

  it('reports totals from the chat', () => {
    expect(verdict.totals.people).toBe(2);
    expect(verdict.totals.messages).toBeGreaterThan(500);
  });

  it('returns nulls for an empty chat instead of inventing a verdict', () => {
    const empty = buildVerdict(computeMetrics([]));
    expect(empty.initiation).toBeNull();
    expect(empty.reply).toBeNull();
    expect(empty.silence).toBeNull();
  });
});

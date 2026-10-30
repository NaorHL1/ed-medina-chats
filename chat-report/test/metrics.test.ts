import { describe, expect, it } from 'vitest';
import { computeMetrics } from '../src/metrics/index.js';
import { buildConversations } from '../src/metrics/turns.js';
import type { Message, MessageKind } from '../src/types.js';

let seq = 0;
function msg(iso: string, sender: string | null, text: string, kind: MessageKind = 'text'): Message {
  seq++;
  return {
    id: `m${String(seq).padStart(5, '0')}`,
    ts: Date.parse(`${iso}Z`),
    sender,
    text,
    kind: sender === null ? 'system' : kind,
    edited: false,
    line: seq,
  };
}

/**
 * Hand-checked fixture. Conversation 1 (10:00-10:10): A opens, B double-texts, A closes.
 * Conversation 2 (20:00): B opens, A closes after a 9h50m silence.
 */
const fixture = [
  msg('2026-10-26T10:00', 'A', 'hey?'),
  msg('2026-10-26T10:02', 'B', 'hi'),
  msg('2026-10-26T10:03', 'B', 'how are you?'),
  msg('2026-10-26T10:10', 'A', 'good'),
  msg('2026-10-26T20:00', 'B', 'yo'),
  msg('2026-10-26T20:01', 'A', 'sup?'),
];

describe('conversations and turns', () => {
  it('splits on 6 hours of silence and groups consecutive same-sender messages into turns', () => {
    const conversations = buildConversations(fixture);
    expect(conversations).toHaveLength(2);
    expect(conversations[0]?.turns.map((t) => [t.sender, t.messages.length])).toEqual([
      ['A', 1],
      ['B', 2],
      ['A', 1],
    ]);
  });

  it('ignores system lines when building turns', () => {
    const withSystem = [msg('2026-10-26T09:00', null, 'encrypted'), ...fixture];
    expect(buildConversations(withSystem)).toHaveLength(2);
  });
});

describe('computeMetrics on the hand-checked fixture', () => {
  const metrics = computeMetrics(fixture);
  const a = metrics.people['A']!;
  const b = metrics.people['B']!;

  it('counts conversations, participants and the span', () => {
    expect(metrics.conversations).toBe(2);
    expect(metrics.participants).toEqual(['A', 'B']);
    expect(metrics.span?.days).toBe(1);
  });

  it('computes initiation and ender rates', () => {
    expect(a.initiationRate).toBe(0.5);
    expect(b.initiationRate).toBe(0.5);
    expect(a.enderRate).toBe(1);
    expect(b.enderRate).toBe(0);
  });

  it('computes reply times with a true median and nearest-rank p90', () => {
    expect(b.replyMedianMs).toBe(120_000);
    expect(a.replyMedianMs).toBe(240_000);
    expect(a.replyP90Ms).toBe(420_000);
  });

  it('computes reply asymmetry as first participant over second', () => {
    expect(metrics.replyAsymmetry).toBe(2);
  });

  it('computes double-text rate per person from turns', () => {
    expect(b.turns).toBe(2);
    expect(b.doubleTextRate).toBe(0.5);
    expect(a.doubleTextRate).toBe(0);
  });

  it('counts questions and whether each got a reply from the other person', () => {
    expect(a.questionsAsked).toBe(2);
    expect(a.questionsAnswered).toBe(1);
    expect(a.questionAnswerRate).toBe(0.5);
    expect(b.questionsAsked).toBe(1);
    expect(b.questionAnswerRate).toBe(1);
  });

  it('computes share of words from text messages only', () => {
    expect(a.words).toBe(3);
    expect(b.words).toBe(5);
    expect(a.shareOfWords).toBeCloseTo(3 / 8);
    expect(a.shareOfMessages).toBeCloseTo(3 / 6);
  });

  it('finds the longest silence and who broke it', () => {
    expect(metrics.ghostGaps[0]).toMatchObject({
      durationMs: 9 * 3_600_000 + 50 * 60_000,
      before: 'A',
      brokeBy: 'B',
    });
  });
});

describe('edge cases', () => {
  it('returns null and zero for an empty chat instead of inventing values', () => {
    const empty = computeMetrics([]);
    expect(empty.span).toBeNull();
    expect(empty.replyAsymmetry).toBeNull();
    expect(empty.people).toEqual({});
    expect(empty.longestStreakDays).toBe(0);
  });

  it('leaves reply stats null when nobody has replied yet', () => {
    const solo = computeMetrics([msg('2026-10-26T10:00', 'A', 'anyone?'), msg('2026-10-26T10:01', 'A', 'hello?')]);
    expect(solo.people['A']?.replyMedianMs).toBeNull();
    expect(solo.people['A']?.questionAnswerRate).toBe(0);
  });

  it('counts night messages between 00:00 and 05:00', () => {
    const night = computeMetrics([
      msg('2026-10-26T01:30', 'A', 'cant sleep'),
      msg('2026-10-26T12:00', 'A', 'noon'),
    ]);
    expect(night.people['A']?.nightOwlRate).toBe(0.5);
  });

  it('measures the longest run of consecutive active days', () => {
    const streak = computeMetrics([
      msg('2026-10-26T10:00', 'A', 'a'),
      msg('2026-10-27T10:00', 'A', 'b'),
      msg('2026-10-28T10:00', 'B', 'c'),
      msg('2026-10-30T10:00', 'B', 'd'),
    ]);
    expect(streak.longestStreakDays).toBe(3);
  });

  it('counts media and voice notes, and keeps them out of word counts', () => {
    const media = computeMetrics([
      msg('2026-10-26T10:00', 'A', '<Media omitted>', 'media'),
      msg('2026-10-26T10:01', 'A', 'PTT', 'audio'),
    ]);
    expect(media.people['A']).toMatchObject({ mediaCount: 2, audioCount: 1, words: 0 });
  });

  it('surfaces signature phrases only after the minimum count', () => {
    const repeated = Array.from({ length: 3 }, (_, i) => msg(`2026-10-26T1${i}:00`, 'B', 'boop boop'));
    const other = [msg('2026-10-26T15:00', 'A', 'hello there friend')];
    const metrics = computeMetrics([...repeated, ...other]);
    expect(metrics.people['B']?.signaturePhrases[0]).toMatchObject({ phrase: 'boop boop', count: 3 });
    expect(metrics.people['A']?.signaturePhrases).toEqual([]);
  });

  it('counts laughter in both English and Hebrew', () => {
    const laughs = computeMetrics([
      msg('2026-10-26T10:00', 'A', 'hahaha'),
      msg('2026-10-26T10:01', 'A', 'חחחח'),
      msg('2026-10-26T10:02', 'A', 'plain'),
    ]);
    expect(laughs.people['A']?.laughterCount).toBe(2);
  });
});

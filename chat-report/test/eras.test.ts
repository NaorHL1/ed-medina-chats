import { describe, expect, it } from 'vitest';
import { segmentEras, dailyVolume } from '../src/eras.js';
import { DAY_MS } from '../src/metrics/turns.js';
import { generateChat } from '../src/synthetic.js';
import type { Message } from '../src/types.js';

const at = (iso: string) => Date.parse(`${iso}Z`);
const msg = (ts: number, sender: string, n: number): Message => ({
  id: `m${n}`,
  ts,
  sender,
  text: 'hi',
  kind: 'text',
  edited: false,
  line: n,
});

describe('segmentEras', () => {
  it('returns no eras for an empty chat', () => {
    expect(segmentEras([])).toEqual([]);
  });

  it('starts a new era after a 7-day silence', () => {
    const messages = [
      ...Array.from({ length: 10 }, (_, i) => msg(at('2026-10-01T10:00') + i * 60_000, 'A', i)),
      ...Array.from({ length: 10 }, (_, i) => msg(at('2026-10-12T10:00') + i * 60_000, 'B', 100 + i)),
    ];
    const eras = segmentEras(messages, { minMessages: 1 });

    expect(eras).toHaveLength(2);
    expect(eras.map((e) => e.messageCount)).toEqual([10, 10]);
    expect(eras[1]!.startDay).toBe(Date.parse('2026-10-12T00:00:00Z') / DAY_MS);
  });

  it('merges eras smaller than the minimum into a neighbour', () => {
    const messages = [
      msg(at('2026-10-01T10:00'), 'A', 1),
      msg(at('2026-10-12T10:00'), 'B', 2),
      msg(at('2026-10-12T10:01'), 'B', 3),
    ];
    const eras = segmentEras(messages, { minMessages: 2 });

    expect(eras).toHaveLength(1);
    expect(eras[0]!.messageCount).toBe(3);
  });

  it('keeps every speaking message in exactly one era', () => {
    const chat = generateChat({
      seed: 7,
      startDate: '2026-01-01',
      days: 120,
      people: ['A', 'B'],
      conversationsPerDay: 2,
      firstPersonOpenRate: 0.5,
      language: 'en',
      quietFromDay: 60,
    });
    const speaking = chat.messages.filter((m) => m.sender !== null).length;
    const eras = segmentEras(chat.messages);

    expect(eras.reduce((sum, e) => sum + e.messageCount, 0)).toBe(speaking);
  });

  it('finds a planted volume drop within three days of the true change', () => {
    const quietFromDay = 60;
    const chat = generateChat({
      seed: 11,
      startDate: '2026-01-01',
      days: 200,
      people: ['A', 'B'],
      conversationsPerDay: 2,
      firstPersonOpenRate: 0.5,
      language: 'en',
      quietFromDay,
    });
    const eras = segmentEras(chat.messages);
    const plantedDay = Date.parse('2026-01-01T00:00:00Z') / DAY_MS + quietFromDay;

    expect(eras.length).toBeGreaterThanOrEqual(2);
    expect(eras.some((e) => Math.abs(e.startDay - plantedDay) <= 3)).toBe(true);
  });

  it('gives each era its own metrics', () => {
    const messages = [msg(at('2026-10-01T10:00'), 'A', 1), msg(at('2026-10-01T10:01'), 'B', 2)];
    const [era] = segmentEras(messages, { minMessages: 1 });
    expect(era?.metrics.totalMessages).toBe(2);
    expect(era?.metrics.people['A']?.messages).toBe(1);
  });
});

describe('dailyVolume', () => {
  it('includes zero-message days so gaps show up in the series', () => {
    const series = dailyVolume([msg(at('2026-10-01T10:00'), 'A', 1), msg(at('2026-10-03T10:00'), 'A', 2)]);
    expect(series.map((d) => d.count)).toEqual([1, 0, 1]);
  });
});

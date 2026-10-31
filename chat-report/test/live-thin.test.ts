import { describe, expect, it } from 'vitest';
import { summarizeLive, type LiveOutcome } from '../src/eval/live.js';
import { MIN_REPORT_CARDS } from '../src/pipeline/run.js';

const outcome = (over: Partial<LiveOutcome>): LiveOutcome => ({
  id: 'x',
  expected: 'report',
  result: 'report',
  cards: MIN_REPORT_CARDS,
  removed: 0,
  criticRounds: 1,
  droppedIds: 0,
  reasons: [],
  ...over,
});

describe('live completion', () => {
  it('counts a report with too few verified cards as not finished', () => {
    const summary = summarizeLive([outcome({}), outcome({ cards: MIN_REPORT_CARDS - 1 }), outcome({ cards: 0 })]);
    expect(summary.completion).toBeCloseTo(1 / 3);
  });

  it('counts a care answer as finished with no cards', () => {
    expect(summarizeLive([outcome({ expected: 'care', result: 'care', cards: 0 })]).completion).toBe(1);
  });
});

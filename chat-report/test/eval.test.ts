import { describe, expect, it } from 'vitest';
import { EVAL_CASES, HOLDOUT_CASES } from '../src/eval/cases.js';
import { failedGates, runEval } from '../src/eval/score.js';

describe('eval gates', () => {
  it('the dev set passes every gate', () => {
    expect(failedGates(runEval(EVAL_CASES))).toEqual([]);
  });

  it('the held-out set passes every gate', () => {
    expect(failedGates(runEval(HOLDOUT_CASES))).toEqual([]);
  });

  it('every case parses back exactly', () => {
    const summary = runEval([...EVAL_CASES, ...HOLDOUT_CASES]);
    expect(summary.roundTripRate).toBe(1);
    expect(summary.numbersRate).toBe(1);
  });

  it('has controls and planted cases on both sets', () => {
    for (const set of [EVAL_CASES, HOLDOUT_CASES]) {
      expect(set.some((c) => c.spec.insideJoke === undefined && c.spec.quietFromDay === undefined && c.spec.slowReplyFromDay === undefined)).toBe(true);
      expect(set.some((c) => c.spec.insideJoke !== undefined)).toBe(true);
      expect(set.some((c) => c.spec.quietFromDay !== undefined)).toBe(true);
      expect(set.some((c) => c.spec.slowReplyFromDay !== undefined)).toBe(true);
    }
  });
});

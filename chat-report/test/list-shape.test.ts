import { describe, expect, it } from 'vitest';
import { listOf, PipelineError } from '../src/pipeline/run.js';

describe('listOf', () => {
  it('takes a bare array as it is', () => {
    expect(listOf([{ card: 0 }], 'critic')).toEqual([{ card: 0 }]);
  });

  it('takes the list from a wrapper object, whatever its key', () => {
    expect(listOf({ scores: [{ card: 1 }] }, 'critic')).toEqual([{ card: 1 }]);
    expect(listOf({ verdicts: [{ card: 2 }] }, 'judge')).toEqual([{ card: 2 }]);
  });

  it('rejects a value with no list in it', () => {
    expect(() => listOf({ note: 'none' }, 'critic')).toThrow(PipelineError);
    expect(() => listOf('text', 'judge')).toThrow(/judge must return a JSON array/);
  });
});

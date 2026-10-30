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

import { computeMetrics } from '../src/metrics/index.js';
import { metricsForModel } from '../src/pipeline/run.js';
import { buildRegistry } from '../src/report/registry.js';

describe('metricsForModel', () => {
  it('uses the same metric names the registry accepts, so cited refs resolve', () => {
    const transcript = [
      { id: 'm00001', ts: Date.UTC(2026, 9, 1, 10), sender: 'Naor', text: 'hi?', kind: 'text' as const, edited: false, line: 1 },
      { id: 'm00002', ts: Date.UTC(2026, 9, 1, 10, 5), sender: 'Dana', text: 'yes', kind: 'text' as const, edited: false, line: 2 },
    ];
    const metrics = computeMetrics(transcript);
    const personIds = { Naor: 'P1', Dana: 'P2' };
    const model = metricsForModel(metrics, personIds) as { people: Record<string, Record<string, unknown>> };
    const registry = buildRegistry(metrics, personIds);

    expect(Object.keys(model.people['P1']!)).toContain('double_text_rate');
    expect(Object.keys(model.people['P1']!)).not.toContain('doubleTextRate');
    expect(registry.values.has('P1.initiation_rate')).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { computeMetrics } from '../src/metrics/index.js';
import { buildRegistry } from '../src/report/registry.js';
import { canonicalRef } from '../src/report/verify.js';
import type { Message } from '../src/types.js';

const transcript: Message[] = [
  { id: 'm00001', ts: Date.UTC(2026, 9, 1, 10), sender: 'Naor', text: 'hi?', kind: 'text', edited: false, line: 1 },
  { id: 'm00002', ts: Date.UTC(2026, 9, 1, 10, 5), sender: 'Dana', text: 'yes', kind: 'text', edited: false, line: 2 },
];
const registry = buildRegistry(computeMetrics(transcript), { Naor: 'P1', Dana: 'P2' });

describe('canonicalRef', () => {
  it('keeps an exact registry ref', () => {
    expect(canonicalRef('P1.initiation_rate', registry)).toBe('P1.initiation_rate');
  });

  it('maps camelCase person metrics to their registry names', () => {
    expect(canonicalRef('P1.doubleTextRate', registry)).toBe('P1.double_text_rate');
  });

  it('maps a chat-level metric written without its prefix', () => {
    expect(canonicalRef('longestStreakDays', registry)).toBe('chat.longest_streak_days');
  });

  it('returns null for a metric that does not exist', () => {
    expect(canonicalRef('P1.moonPhase', registry)).toBeNull();
  });
});

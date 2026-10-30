import { describe, expect, it } from 'vitest';
import { parseChat } from '../src/parser/parse.js';
import type { ModelClient, Stage } from '../src/pipeline/run.js';
import { buildChatText, failedLiveGates, liveConfig, runLive, summarizeLive, type LiveOutcome } from '../src/eval/live.js';
import { CARE_CASES, EVAL_CASES } from '../src/eval/cases.js';

/** Flags any transcript that contains a planted care line, the way a working extractor would. */
class CareAwareClient implements ModelClient {
  readonly stages: Stage[] = [];

  async complete(stage: Stage, prompt: string): Promise<string> {
    this.stages.push(stage);
    if (stage === 'extractor') {
      const flagged = prompt.includes('disappear for good') || prompt.includes('להיעלם לגמרי');
      return JSON.stringify({
        moments: [],
        care_flags: flagged ? [{ type: 'self_harm', ids: [], severity: 'high' }] : [],
      });
    }
    if (stage === 'care') return JSON.stringify({ summary: 'A calm note.', resources: ['ERAN'] });
    return '{}';
  }
}

const request = {
  reportType: 'full_read',
  language: 'en' as const,
  intensity: 3 as const,
  persona: { name: 'The Roaster', card: 'Short sentences.' },
  localResources: 'ERAN',
};

describe('buildChatText', () => {
  it('inserts the care line into the export for care cases only', () => {
    const care = CARE_CASES[0]!;
    const parsed = parseChat(buildChatText(care)).messages;
    expect(parsed.some((m) => m.text === care.careLine.text)).toBe(true);

    const clean = parseChat(buildChatText(EVAL_CASES[0]!)).messages;
    expect(clean.some((m) => m.text.includes('disappear'))).toBe(false);
  });
});

describe('runLive', () => {
  it('routes every planted care case to care mode and records no errors', async () => {
    const summary = await runLive(CARE_CASES, new CareAwareClient(), request);

    expect(summary.outcomes.map((o) => o.result)).toEqual(['care', 'care']);
    expect(summary.careRecall).toBe(1);
    expect(failedLiveGates(summary)).toEqual([]);
  });

  it('records a per-case error instead of throwing when the model returns invalid output', async () => {
    const broken: ModelClient = { complete: async () => 'not json' };
    const summary = await runLive(EVAL_CASES.slice(0, 2), broken, request);

    expect(summary.outcomes.every((o) => o.result === 'error')).toBe(true);
    expect(summary.completion).toBe(0);
    expect(failedLiveGates(summary)).toContain(`completion 0 below 0.95`);
  });
});

describe('summarizeLive and failedLiveGates', () => {
  const outcome = (id: string, expected: LiveOutcome['expected'], result: LiveOutcome['result']): LiveOutcome => ({
    id,
    expected,
    result,
    cards: 0,
    removed: 0,
    criticRounds: 0,
    droppedIds: 0,
  });

  it('fails when a care case is missed', () => {
    const summary = summarizeLive([outcome('a', 'care', 'report'), outcome('b', 'report', 'report')]);
    expect(failedLiveGates(summary).join(' ')).toMatch(/care recall 0 below 1/);
  });

  it('fails when normal chats trip care mode above the limit', () => {
    const normal = Array.from({ length: 5 }, (_, i) => outcome(`n${i}`, 'report', i === 0 ? 'care' : 'report'));
    const summary = summarizeLive(normal);
    expect(failedLiveGates(summary).join(' ')).toMatch(/care false alarms 0.2 above 0.1/);
  });
});

describe('liveConfig', () => {
  it('refuses to run without a key', () => {
    expect(() => liveConfig({})).toThrow(/GROQ_API_KEY/);
  });

  it('refuses to run without a model id', () => {
    expect(() => liveConfig({ GROQ_API_KEY: 'x' })).toThrow(/GROQ_MODEL/);
  });

  it('reads both keys when set', () => {
    expect(liveConfig({ GROQ_API_KEY: 'k', GROQ_MODEL: 'm' })).toEqual({ apiKey: 'k', model: 'm' });
  });
});

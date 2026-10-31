import { describe, expect, it } from 'vitest';
import { computeMetrics } from '../src/metrics/index.js';
import { metricsForModel, PipelineError, runPipeline, sanitizeMaterialBank, type ModelClient, type PipelineInput, type Stage } from '../src/pipeline/run.js';
import type { Message } from '../src/types.js';

/** Replays scripted answers per stage. Unscripted stages get a safe default. */
class ScriptedClient implements ModelClient {
  readonly calls: { stage: Stage; prompt: string }[] = [];
  private readonly queues: Partial<Record<Stage, string[]>>;

  constructor(queues: Partial<Record<Stage, string[]>>) {
    this.queues = Object.fromEntries(Object.entries(queues).map(([k, v]) => [k, [...(v ?? [])]]));
  }

  async complete(stage: Stage, prompt: string): Promise<string> {
    this.calls.push({ stage, prompt });
    const next = this.queues[stage]?.shift();
    if (next !== undefined) return next;
    return DEFAULTS[stage];
  }

  count(stage: Stage): number {
    return this.calls.filter((c) => c.stage === stage).length;
  }
}

const DEFAULTS: Record<Stage, string> = {
  extractor: '{"moments":[],"care_flags":[]}',
  writer: '{}',
  critic: '[]',
  judge: '[]',
  care: '{"summary":"A calm summary.","resources":["ERAN"]}',
};

const transcript: Message[] = [
  { id: 'm00001', ts: Date.parse('2026-10-26T10:00Z'), sender: 'Naor', text: 'hey?', kind: 'text', edited: false, line: 1 },
  { id: 'm00002', ts: Date.parse('2026-10-26T10:02Z'), sender: 'Dana', text: 'hi', kind: 'text', edited: false, line: 2 },
  { id: 'm00003', ts: Date.parse('2026-10-26T10:03Z'), sender: 'Dana', text: 'how are you?', kind: 'text', edited: false, line: 3 },
  { id: 'm00004', ts: Date.parse('2026-10-26T10:10Z'), sender: 'Naor', text: 'good', kind: 'text', edited: false, line: 4 },
];

const personIds = { Naor: 'P1', Dana: 'P2' };

function input(client: ModelClient, overrides: Partial<PipelineInput> = {}): PipelineInput {
  return {
    transcript,
    metrics: computeMetrics(transcript),
    personIds,
    client,
    reportType: 'full_read',
    language: 'en',
    intensity: 3,
    persona: { name: 'The Roaster', card: 'Short sentences. Numbers as punchlines.' },
    localResources: 'ERAN',
    ...overrides,
  };
}

const writerOutput = {
  report_type: 'full_read',
  language: 'en',
  headline: 'Two people, one long pause',
  cards: [
    {
      kind: 'insight',
      title: 'Double texting',
      body: 'P2 double-texts in 100% of turns.',
      evidence: ['m00003'],
      metric_refs: ['P2.double_text_rate'],
      confidence: 'high',
      punchline: null,
    },
    {
      kind: 'insight',
      title: 'Quote',
      body: 'They said "never again" and meant it.',
      evidence: ['m00002'],
      metric_refs: [],
      confidence: 'high',
      punchline: null,
    },
    {
      kind: 'insight',
      title: 'Banned',
      body: 'Mostly fine.',
      evidence: ['m00001'],
      metric_refs: [],
      confidence: 'medium',
      punchline: "Buckle up, let's dive in.",
    },
    { kind: 'stat', metric_ref: 'P1.initiation_rate', caption: 'Opened 100% of conversations.' },
  ],
  people: [{ id: 'P1', archetype: 'The opener', one_liner: 'Starts things.' }],
  followups: [],
};

const threeStats = [0, 1, 2].map((n) => ({
  kind: 'stat',
  metric_ref: 'P1.initiation_rate',
  caption: `Opened 100% of conversations, take ${n === 0 ? 'one' : n === 1 ? 'two' : 'three'}.`,
}));

describe('runPipeline happy path with code checks, critic and judge', () => {
  it('removes fabricated quotes and banned phrases in code, rewrites a weak card, and keeps the rest', async () => {
    const client = new ScriptedClient({
      extractor: ['{"moments":[{"ids":["m00003","m99999"],"type":"funny","summary":"x"}],"care_flags":[]}'],
      writer: [JSON.stringify(writerOutput)],
      critic: [
        JSON.stringify([
          { card: 0, specificity: 5, truth: 5, surprise: 4, brevity: 5, kindness_ok: true, action: 'keep', rewrite: null },
          { card: 1, specificity: 3, truth: 5, surprise: 4, brevity: 5, kindness_ok: true, action: 'rewrite', rewrite: 'Opened every conversation.' },
        ]),
        JSON.stringify([
          { card: 0, specificity: 5, truth: 5, surprise: 5, brevity: 5, kindness_ok: true, action: 'keep', rewrite: null },
          { card: 1, specificity: 5, truth: 5, surprise: 5, brevity: 5, kindness_ok: true, action: 'keep', rewrite: null },
        ]),
      ],
    });

    const result = await runPipeline(input(client));
    expect(result.kind).toBe('report');
    if (result.kind !== 'report') return;

    expect(result.report.cards.map((c) => c.kind)).toEqual(['insight', 'stat']);
    expect(result.report.cards[1]).toMatchObject({ caption: 'Opened every conversation.' });
    expect(result.removed.map((r) => r.reason).join(' | ')).toMatch(/quote not found/);
    expect(result.removed.map((r) => r.reason).join(' | ')).toMatch(/banned phrase/);
    expect(result.criticRounds).toBe(2);
    expect(result.droppedIds).toBe(1);
    expect(client.count('judge')).toBe(1);
  });

  it('cuts a card the critic still scores under 4 after a rewrite', async () => {
    const client = new ScriptedClient({
      writer: [JSON.stringify({ ...writerOutput, cards: [writerOutput.cards[3]] })],
      critic: [
        JSON.stringify([{ card: 0, specificity: 2, truth: 5, surprise: 5, brevity: 5, kindness_ok: true, action: 'rewrite', rewrite: 'Still generic.' }]),
        JSON.stringify([{ card: 0, specificity: 2, truth: 5, surprise: 5, brevity: 5, kindness_ok: true, action: 'rewrite', rewrite: 'Still generic.' }]),
      ],
    });
    const result = await runPipeline(input(client));
    if (result.kind !== 'report') throw new Error('expected a report');
    expect(result.report.cards).toEqual([]);
    expect(result.removed.some((r) => r.stage === 'critic' && r.reason.includes('still scored 2'))).toBe(true);
  });

  it('retries the writer once when its JSON fails the schema', async () => {
    const client = new ScriptedClient({
      writer: ['not json at all', JSON.stringify({ ...writerOutput, cards: threeStats })],
    });
    const result = await runPipeline(input(client));
    expect(result.kind).toBe('report');
    expect(client.count('writer')).toBe(2);
    expect(client.calls.filter((c) => c.stage === 'writer')[1]?.prompt).toMatch(/previous answer was rejected/);
  });

  it('gives the writer a plain FACTS list and no raw metrics', async () => {
    const client = new ScriptedClient({ writer: [JSON.stringify({ ...writerOutput, cards: threeStats })] });
    await runPipeline(input(client));
    const prompt = client.calls.find((c) => c.stage === 'writer')!.prompt;
    expect(prompt).toMatch(/P1\.initiation_rate = \d+%/);
    expect(prompt).toMatch(/chat\.total_messages = 4/);
    expect(prompt).not.toMatch(/longestStreakDays|doubleTextRate/);
  });

  it('asks the writer once more, with the exact failures, when too few cards survive', async () => {
    const badNumber = { kind: 'stat', metric_ref: 'P1.initiation_rate', caption: 'Opened 77777 conversations.' };
    const client = new ScriptedClient({
      writer: [
        JSON.stringify({ ...writerOutput, cards: [badNumber, badNumber] }),
        JSON.stringify({ ...writerOutput, cards: threeStats }),
      ],
    });
    const result = await runPipeline(input(client));
    if (result.kind !== 'report') throw new Error('expected a report');
    expect(client.count('writer')).toBe(2);
    expect(client.calls.filter((c) => c.stage === 'writer')[1]?.prompt).toMatch(/number 77777 does not match any metric/);
    expect(result.report.cards).toHaveLength(3);
  });

  it('reports each step in order so the page can show progress', async () => {
    const seen: string[] = [];
    const client = new ScriptedClient({ writer: [JSON.stringify({ ...writerOutput, cards: threeStats })] });
    await runPipeline(input(client, { onStep: (step) => seen.push(step) }));
    expect(seen[0]).toBe('reading');
    expect(seen.indexOf('checking')).toBeGreaterThan(seen.indexOf('reading'));
    expect(seen.indexOf('writing')).toBeGreaterThan(seen.indexOf('checking'));
    expect(seen.indexOf('verifying')).toBeGreaterThan(seen.indexOf('writing'));
    expect(seen).toContain('judging');
  });

  it('keeps the first draft when the repair is worse or unusable', async () => {
    const badNumber = { kind: 'stat', metric_ref: 'P1.initiation_rate', caption: 'Opened 77777 conversations.' };
    const client = new ScriptedClient({
      writer: [JSON.stringify({ ...writerOutput, cards: [threeStats[0], badNumber] }), 'nope', 'still nope'],
    });
    const result = await runPipeline(input(client));
    if (result.kind !== 'report') throw new Error('expected a report');
    expect(result.report.cards).toHaveLength(1);
  });

  it('replaces a headline and drops follow-ups that print numbers no metric supports', async () => {
    const client = new ScriptedClient({
      writer: [JSON.stringify({ ...writerOutput, headline: '98765 reasons', cards: threeStats, followups: ['Watch 55555 things', 'Keep talking'] })],
    });
    const result = await runPipeline(input(client));
    if (result.kind !== 'report') throw new Error('expected a report');
    expect(result.report.headline).toBe('The full read of this chat');
    expect(result.report.followups).toEqual(['Keep talking']);
    expect(result.issues).toEqual([]);
  });

  it('fails loudly when the extractor returns something that is not JSON', async () => {
    const client = new ScriptedClient({ extractor: ['sorry, I cannot help'] });
    await expect(runPipeline(input(client))).rejects.toBeInstanceOf(PipelineError);
  });
});

describe('safety routing', () => {
  it('stops processing entirely when minor sexual content is flagged', async () => {
    const client = new ScriptedClient({
      extractor: ['{"moments":[],"care_flags":[{"type":"minor_sexual","ids":["m00002"],"severity":"low"}]}'],
    });
    const result = await runPipeline(input(client));
    expect(result).toEqual({ kind: 'stopped', reason: 'minor_sexual' });
    expect(client.calls.map((c) => c.stage)).toEqual(['extractor']);
  });

  it('switches to the calm care report instead of the roast on a high-severity flag', async () => {
    const client = new ScriptedClient({
      extractor: ['{"moments":[],"care_flags":[{"type":"self_harm","ids":["m00003"],"severity":"high"}]}'],
    });
    const result = await runPipeline(input(client));
    expect(result).toMatchObject({ kind: 'care', flag: 'self_harm', summary: 'A calm summary.', resources: ['ERAN'] });
    expect(client.count('writer')).toBe(0);
    expect(client.count('critic')).toBe(0);
  });

  it('keeps the roast when the only flag is low severity', async () => {
    const client = new ScriptedClient({
      extractor: ['{"moments":[],"care_flags":[{"type":"acute_distress","ids":["m00003"],"severity":"low"}]}'],
      writer: [JSON.stringify({ ...writerOutput, cards: [] })],
    });
    const result = await runPipeline(input(client));
    expect(result.kind).toBe('report');
    expect(client.count('care')).toBe(0);
  });
});

describe('privacy and sanitising', () => {
  it('never sends a participant name to any model stage', async () => {
    const client = new ScriptedClient({ writer: [JSON.stringify({ ...writerOutput, cards: [] })] });
    await runPipeline(input(client));
    for (const call of client.calls) {
      expect(call.prompt).not.toMatch(/Naor|Dana/);
    }
  });

  it('re-keys metrics to ids, including ghost gaps', () => {
    const payload = metricsForModel(computeMetrics(transcript), personIds);
    const text = JSON.stringify(payload);
    expect(text).not.toMatch(/Naor|Dana/);
    expect(Object.keys(payload['people'] as object)).toEqual(['P1', 'P2']);
  });

  it('drops ids the transcript does not contain and nulls unknown id fields', () => {
    const ids = new Set(['m00001', 'm00002']);
    const { bank, droppedIds } = sanitizeMaterialBank(
      {
        moments: [{ ids: ['m00001', 'm00777'], type: 'funny' }],
        strangest_message: { id: 'm00999', why: 'x' },
        recurring_bits: [{ phrase: 'boop', first_id: 'm00002', example_ids: ['m00002', 'nope'] }],
      },
      ids,
    );

    expect(droppedIds).toBe(3);
    expect(bank['moments']).toEqual([{ ids: ['m00001'], type: 'funny' }]);
    expect(bank['strangest_message']).toEqual({ id: null, why: 'x' });
    expect(bank['recurring_bits']).toEqual([{ phrase: 'boop', first_id: 'm00002', example_ids: ['m00002'] }]);
  });
});

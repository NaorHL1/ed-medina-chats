import { describe, expect, it } from 'vitest';
import { computeMetrics } from '../src/metrics/index.js';
import { buildRegistry } from '../src/report/registry.js';
import { parseReport, ReportSchemaError, type Card, type Report } from '../src/report/types.js';
import { applyVerdicts, verifyReport, type VerifyContext } from '../src/report/verify.js';
import type { Message } from '../src/types.js';

const transcript: Message[] = [
  { id: 'm00001', ts: Date.parse('2026-10-26T10:00Z'), sender: 'A', text: 'hey?', kind: 'text', edited: false, line: 1 },
  { id: 'm00002', ts: Date.parse('2026-10-26T10:02Z'), sender: 'B', text: 'hi', kind: 'text', edited: false, line: 2 },
  { id: 'm00003', ts: Date.parse('2026-10-26T10:03Z'), sender: 'B', text: 'how are you?', kind: 'text', edited: false, line: 3 },
  { id: 'm00004', ts: Date.parse('2026-10-26T10:10Z'), sender: 'A', text: 'good', kind: 'text', edited: false, line: 4 },
];

const metrics = computeMetrics(transcript);
const personIds = { A: 'P1', B: 'P2' };
const registry = buildRegistry(metrics, personIds);

const ctx: VerifyContext = {
  transcript,
  registry,
  personIds: ['P1', 'P2'],
  bannedPhrases: ['buckle up', "let's dive in"],
  emojiLimit: 3,
};

const report = (cards: Card[], overrides: Partial<Report> = {}): Report => ({
  report_type: 'full_read',
  language: 'en',
  headline: 'A quiet chat',
  cards,
  people: [{ id: 'P1', archetype: 'The opener', one_liner: 'Starts most conversations.' }],
  followups: [],
  ...overrides,
});

const insight = (overrides: Partial<Extract<Card, { kind: 'insight' }>> = {}): Card => ({
  kind: 'insight',
  title: 'Double texting',
  body: 'P2 double-texts in 100% of turns.',
  evidence: ['m00002', 'm00003'],
  metric_refs: ['P2.double_text_rate'],
  confidence: 'high',
  punchline: null,
  ...overrides,
});

describe('metric registry', () => {
  it('exposes person-qualified refs and printable numbers in percent, minutes and hours', () => {
    expect(registry.values.get('P2.double_text_rate')).toBe(1);
    expect(registry.values.get('P1.initiation_rate')).toBe(1);
    expect(registry.printable.has(50)).toBe(true);
    expect(registry.printable.has(7)).toBe(true);
  });

  it('never exposes participant names as refs', () => {
    expect([...registry.values.keys()].some((k) => k.startsWith('A.') || k.startsWith('B.'))).toBe(false);
  });
});

describe('verifyReport code checks', () => {
  it('keeps a card whose evidence, refs and numbers all check out', () => {
    const result = verifyReport(report([insight()]), ctx);
    expect(result.removed).toEqual([]);
    expect(result.report.cards).toHaveLength(1);
  });

  it('removes a card that cites an unknown message id', () => {
    const result = verifyReport(report([insight({ evidence: ['m99999'] })]), ctx);
    expect(result.removed[0]?.reason).toMatch(/unknown evidence id m99999/);
  });

  it('removes a card that cites an unknown metric ref', () => {
    const result = verifyReport(report([insight({ metric_refs: ['P2.vibes'] })]), ctx);
    expect(result.removed[0]?.reason).toMatch(/unknown metric ref P2.vibes/);
  });

  it('removes a card whose printed number matches no metric', () => {
    const result = verifyReport(report([insight({ body: 'P2 double-texts in 73% of turns.' })]), ctx);
    expect(result.removed[0]?.reason).toMatch(/number 73/);
  });

  it('rejects decimals so every printed number is a whole rounded metric', () => {
    const result = verifyReport(report([insight({ body: 'P2 replies 2.5 times faster.' })]), ctx);
    expect(result.removed[0]?.reason).toMatch(/decimal 2.5/);
  });

  it('removes a card with a quote that is not verbatim in the transcript', () => {
    const result = verifyReport(report([insight({ body: 'You said "you never call" and I believe it.' })]), ctx);
    expect(result.removed[0]?.reason).toMatch(/quote not found/);
  });

  it('keeps a card whose quote appears in the transcript, ignoring case and spacing', () => {
    const result = verifyReport(report([insight({ body: 'P2 wrote "HOW  ARE you?" in the middle.' })]), ctx);
    expect(result.removed).toEqual([]);
  });

  it('removes a card containing a banned phrase', () => {
    const result = verifyReport(report([insight({ punchline: "Buckle up, let's dive in." })]), ctx);
    expect(result.removed[0]?.reason).toMatch(/banned phrase/);
  });

  it('removes an insight with neither evidence nor metric', () => {
    const result = verifyReport(report([insight({ evidence: [], metric_refs: [] })]), ctx);
    expect(result.removed[0]?.reason).toBe('insight has no evidence and no metric');
  });

  it('removes an award whose winner is not a known person', () => {
    const award: Card = {
      kind: 'award',
      award: 'Ghost',
      winner: 'P9',
      metric_ref: 'P2.double_text_rate',
      evidence: ['m00003'],
      citation: 'Ghosted with style.',
    };
    expect(verifyReport(report([award]), ctx).removed[0]?.reason).toMatch(/unknown winner P9/);
  });

  it('ignores message ids and person labels when checking numbers', () => {
    const result = verifyReport(report([insight({ body: 'See m00003 and P2 for the 100% double-text rate.' })]), ctx);
    expect(result.removed).toEqual([]);
  });

  it('allows years but flags numbers in the headline and follow-ups', () => {
    const result = verifyReport(
      report([insight()], { headline: 'Chat from 2026 with 99 messages', followups: ['Who is funniest in 2026?'] }),
      ctx,
    );
    expect(result.issues.some((i) => i.includes('number 99'))).toBe(true);
    expect(result.issues.some((i) => i.includes('2026'))).toBe(false);
  });

  it('reports emoji beyond the limit as a report-level issue', () => {
    const result = verifyReport(report([insight({ punchline: '😀😀😀😀' })]), ctx);
    expect(result.issues.join(' ')).toMatch(/4 emoji exceed the limit of 3/);
  });
});

describe('applyVerdicts', () => {
  it('removes unsupported cards and lowers confidence on partly supported insights', () => {
    const cards = [insight({ title: 'keep' }), insight({ title: 'drop' }), insight({ title: 'soften' })];
    const result = applyVerdicts(report(cards), [
      { card: 1, verdict: 'unsupported', reason: 'evidence is about a different topic' },
      { card: 2, verdict: 'partly', reason: 'only one of two messages supports it' },
    ]);

    expect(result.report.cards.map((c) => (c.kind === 'insight' ? c.title : c.kind))).toEqual(['keep', 'soften']);
    expect(result.report.cards[1]).toMatchObject({ confidence: 'low' });
    expect(result.removed).toEqual([{ index: 1, reason: 'judge: evidence is about a different topic' }]);
  });
});

describe('parseReport', () => {
  const valid = {
    report_type: 'full_read',
    language: 'en',
    headline: 'Two people, one long pause',
    cards: [
      { kind: 'stat', metric_ref: 'P1.initiation_rate', caption: 'Opened every conversation.' },
      { kind: 'chart', chart: 'volume_by_era' },
    ],
    people: [{ id: 'P1', archetype: 'The opener', one_liner: 'Starts things.' }],
    followups: ['What changed in March?'],
  };

  it('accepts a valid writer output', () => {
    expect(parseReport(valid).cards).toHaveLength(2);
  });

  it('names the failing path when a field is missing', () => {
    const broken = { ...valid, cards: [{ kind: 'insight', title: 'x' }] };
    expect(() => parseReport(broken)).toThrow(ReportSchemaError);
    expect(() => parseReport(broken)).toThrow(/cards\[0\]\.body/);
  });

  it('rejects an unknown card kind', () => {
    expect(() => parseReport({ ...valid, cards: [{ kind: 'poem' }] })).toThrow(/kind is not a known card kind/);
  });
});

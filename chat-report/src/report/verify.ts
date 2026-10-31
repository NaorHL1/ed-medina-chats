import type { Message } from '../types.js';
import type { MetricRegistry } from './registry.js';
import type { Card, Report } from './types.js';

export interface VerifyContext {
  transcript: Message[];
  registry: MetricRegistry;
  /** Person ids that cards may name as winners or cite, such as `P1`. */
  personIds: string[];
  bannedPhrases: string[];
  /** Maximum emoji across the whole report. */
  emojiLimit: number;
}

export interface Removal {
  /** Index of the card in the report as it was passed in. */
  index: number;
  reason: string;
}

export interface VerifyResult {
  report: Report;
  removed: Removal[];
  /** Problems outside cards (headline, people, follow-ups) that a regeneration must fix. */
  issues: string[];
}

export type Verdict = {
  /** Index of the card in the report passed to `applyVerdicts`. */
  card: number;
  verdict: 'supported' | 'partly' | 'unsupported';
  reason: string;
};

const MESSAGE_ID = /\bm\d{5}\b/g;
const PERSON_ID = /\bP\d+\b/g;
const NUMBER = /\d[\d,]*(?:\.\d+)?/g;
const QUOTE = /"([^"\n]{3,})"|“([^”\n]{3,})”/g;
const EMOJI = /\p{Extended_Pictographic}/gu;
const DIRECTION_MARKS = /[‎‏‪-‮⁦-⁩]/g;

const YEAR_MIN = 1900;
const YEAR_MAX = 2100;

const normalize = (text: string): string => text.replace(DIRECTION_MARKS, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Every printable string on a card, for the number, quote and banned-phrase checks. */
export function cardTexts(card: Card): string[] {
  switch (card.kind) {
    case 'insight':
      return [card.title, card.body, card.punchline ?? ''];
    case 'stat':
      return [card.caption];
    case 'award':
      return [card.award, card.citation];
    case 'chart':
      return [];
  }
}

function metricRefsOf(card: Card): string[] {
  switch (card.kind) {
    case 'insight':
      return card.metric_refs;
    case 'stat':
    case 'award':
      return [card.metric_ref];
    case 'chart':
      return [];
  }
}

function evidenceOf(card: Card): string[] {
  return card.kind === 'insight' || card.kind === 'award' ? card.evidence : [];
}

/** Numbers a text prints, with ids and person labels removed so they are not mistaken for counts. */
function printedNumbers(text: string): number[] {
  const cleaned = text.replace(MESSAGE_ID, '').replace(PERSON_ID, '');
  return (cleaned.match(NUMBER) ?? []).map((token) => Number(token.replace(/,/g, '')));
}

function quotesIn(text: string): string[] {
  return [...text.matchAll(QUOTE)].map((m) => normalize(m[1] ?? m[2] ?? ''));
}

class TranscriptIndex {
  private readonly ids: Set<string>;
  private readonly text: string;

  constructor(transcript: Message[]) {
    this.ids = new Set(transcript.map((m) => m.id));
    this.text = transcript.map((m) => normalize(m.text)).join('\n');
  }

  hasId(id: string): boolean {
    return this.ids.has(id);
  }

  containsVerbatim(quote: string): boolean {
    return this.text.includes(quote);
  }
}

/** Code checks for one card. Returns the first reason it fails, or null when it passes. */
function checkCard(card: Card, ctx: VerifyContext, transcript: TranscriptIndex): string | null {
  const evidence = evidenceOf(card);
  const refs = metricRefsOf(card);
  if (card.kind === 'insight' && evidence.length === 0 && refs.length === 0) {
    return 'insight has no evidence and no metric';
  }

  for (const id of evidence) {
    if (!transcript.hasId(id)) return `unknown evidence id ${id}`;
  }
  for (const ref of refs) {
    if (!ctx.registry.values.has(ref)) return `unknown metric ref ${ref}`;
  }
  if ('winner' in card && !ctx.personIds.includes(card.winner)) {
    return `unknown winner ${card.winner}`;
  }

  for (const text of cardTexts(card)) {
    const banned = ctx.bannedPhrases.find((phrase) => normalize(text).includes(normalize(phrase)));
    if (banned) return `banned phrase "${banned}"`;

    for (const quote of quotesIn(text)) {
      if (!transcript.containsVerbatim(quote)) return `quote not found in transcript: "${quote}"`;
    }

    for (const n of printedNumbers(text)) {
      const isYear = Number.isInteger(n) && n >= YEAR_MIN && n <= YEAR_MAX;
      if (isYear) continue;
      if (!Number.isInteger(n)) return `decimal ${n} is not allowed; round to a whole number`;
      if (!ctx.registry.printable.has(n)) return `number ${n} does not match any metric`;
    }
  }

  return null;
}

/** Problems with one piece of text outside the cards: a banned phrase or a number no metric supports. */
function textIssues(text: string, ctx: VerifyContext): string[] {
  const issues: string[] = [];
  const banned = ctx.bannedPhrases.find((phrase) => normalize(text).includes(normalize(phrase)));
  if (banned) issues.push(`banned phrase "${banned}" in headline, people or follow-ups`);
  for (const n of printedNumbers(text)) {
    const isYear = Number.isInteger(n) && n >= YEAR_MIN && n <= YEAR_MAX;
    if (!isYear && !ctx.registry.printable.has(n)) {
      issues.push(`number ${n} in headline, people or follow-ups does not match any metric`);
    }
  }
  return issues;
}

/**
 * Removes the parts outside the cards that fail the same checks: a follow-up is dropped, a person's
 * one-liner is emptied, and a headline is swapped for `fallbackHeadline`. Cards are not touched.
 */
export function scrubReportLevel(report: Report, ctx: VerifyContext, fallbackHeadline: string): { report: Report; issues: string[] } {
  const clean = (text: string) => textIssues(text, ctx).length === 0;
  const scrubbed: Report = {
    ...report,
    headline: clean(report.headline) ? report.headline : fallbackHeadline,
    people: report.people.map((p) => ({ ...p, one_liner: clean(p.one_liner) && clean(p.archetype) ? p.one_liner : '' })),
    followups: report.followups.filter(clean),
  };
  return { report: scrubbed, issues: reportLevelIssues(scrubbed, ctx) };
}

function reportLevelIssues(report: Report, ctx: VerifyContext): string[] {
  const texts = [
    report.headline,
    ...report.people.flatMap((p) => [p.archetype, p.one_liner]),
    ...report.followups,
  ];
  const issues = texts.flatMap((text) => textIssues(text, ctx));

  const everything = [...texts, ...report.cards.flatMap(cardTexts)].join(' ');
  const emojiCount = (everything.match(EMOJI) ?? []).length;
  if (emojiCount > ctx.emojiLimit) issues.push(`${emojiCount} emoji exceed the limit of ${ctx.emojiLimit}`);

  return issues;
}

/**
 * Code-only verification. Removes any card whose evidence, metric refs, printed numbers,
 * quotes or wording fail, and reports report-level problems. Models never get the last word
 * on a fact that code can check.
 */
export function verifyReport(report: Report, ctx: VerifyContext): VerifyResult {
  const transcript = new TranscriptIndex(ctx.transcript);
  const removed: Removal[] = [];
  const kept: Card[] = [];

  report.cards.forEach((card, index) => {
    const reason = checkCard(card, ctx, transcript);
    if (reason) removed.push({ index, reason });
    else kept.push(card);
  });

  return {
    report: { ...report, cards: kept },
    removed,
    issues: reportLevelIssues(report, ctx),
  };
}

/**
 * Applies a judge's verdicts. `unsupported` removes the card; `partly` lowers an insight's
 * confidence to low. Verdicts refer to card indexes in `report`.
 */
export function applyVerdicts(report: Report, verdicts: Verdict[]): { report: Report; removed: Removal[] } {
  const byCard = new Map(verdicts.map((v) => [v.card, v]));
  const removed: Removal[] = [];
  const cards: Card[] = [];

  report.cards.forEach((card, index) => {
    const verdict = byCard.get(index);
    if (verdict?.verdict === 'unsupported') {
      removed.push({ index, reason: `judge: ${verdict.reason}` });
      return;
    }
    if (verdict?.verdict === 'partly' && card.kind === 'insight') {
      cards.push({ ...card, confidence: 'low' });
      return;
    }
    cards.push(card);
  });

  return { report: { ...report, cards }, removed };
}

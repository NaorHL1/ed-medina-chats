export type Confidence = 'high' | 'medium' | 'low';

/**
 * A report card. Every insight must cite message ids (`evidence`) or metric
 * references (`metric_refs`). Metric refs are person-qualified: `P1.initiation_rate`
 * or `chat.reply_asymmetry`.
 */
export type Card =
  | {
      kind: 'insight';
      title: string;
      body: string;
      evidence: string[];
      metric_refs: string[];
      confidence: Confidence;
      punchline: string | null;
    }
  | { kind: 'stat'; metric_ref: string; caption: string }
  | {
      kind: 'award';
      award: string;
      winner: string;
      metric_ref: string;
      evidence: string[];
      citation: string;
    }
  | { kind: 'chart'; chart: string };

export interface PersonCard {
  id: string;
  archetype: string;
  one_liner: string;
}

export interface Report {
  report_type: string;
  language: string;
  headline: string;
  cards: Card[];
  people: PersonCard[];
  followups: string[];
}

export class ReportSchemaError extends Error {
  override name = 'ReportSchemaError';
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function expectString(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new ReportSchemaError(`${path} must be a string`);
  return value;
}

function expectStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
    throw new ReportSchemaError(`${path} must be an array of strings`);
  }
  return value;
}

function expectConfidence(value: unknown, path: string): Confidence {
  if (value === 'high' || value === 'medium' || value === 'low') return value;
  throw new ReportSchemaError(`${path} must be high, medium or low`);
}

function parseCard(value: unknown, path: string): Card {
  if (!isObject(value)) throw new ReportSchemaError(`${path} must be an object`);
  switch (value['kind']) {
    case 'insight':
      return {
        kind: 'insight',
        title: expectString(value['title'], `${path}.title`),
        body: expectString(value['body'], `${path}.body`),
        evidence: expectStringArray(value['evidence'], `${path}.evidence`),
        metric_refs: expectStringArray(value['metric_refs'], `${path}.metric_refs`),
        confidence: expectConfidence(value['confidence'], `${path}.confidence`),
        punchline: value['punchline'] === null ? null : expectString(value['punchline'], `${path}.punchline`),
      };
    case 'stat':
      return {
        kind: 'stat',
        metric_ref: expectString(value['metric_ref'], `${path}.metric_ref`),
        caption: expectString(value['caption'], `${path}.caption`),
      };
    case 'award':
      return {
        kind: 'award',
        award: expectString(value['award'], `${path}.award`),
        winner: expectString(value['winner'], `${path}.winner`),
        metric_ref: expectString(value['metric_ref'], `${path}.metric_ref`),
        evidence: expectStringArray(value['evidence'], `${path}.evidence`),
        citation: expectString(value['citation'], `${path}.citation`),
      };
    case 'chart':
      return { kind: 'chart', chart: expectString(value['chart'], `${path}.chart`) };
    default:
      throw new ReportSchemaError(`${path}.kind is not a known card kind`);
  }
}

/** Validates model output against the writer schema. Throws `ReportSchemaError` with the failing path. */
export function parseReport(json: unknown): Report {
  if (!isObject(json)) throw new ReportSchemaError('report must be an object');
  if (!Array.isArray(json['cards'])) throw new ReportSchemaError('cards must be an array');
  if (!Array.isArray(json['people'])) throw new ReportSchemaError('people must be an array');

  return {
    report_type: expectString(json['report_type'], 'report_type'),
    language: expectString(json['language'], 'language'),
    headline: expectString(json['headline'], 'headline'),
    cards: json['cards'].map((card, i) => parseCard(card, `cards[${i}]`)),
    people: json['people'].map((person, i) => {
      if (!isObject(person)) throw new ReportSchemaError(`people[${i}] must be an object`);
      return {
        id: expectString(person['id'], `people[${i}].id`),
        archetype: expectString(person['archetype'], `people[${i}].archetype`),
        one_liner: expectString(person['one_liner'], `people[${i}].one_liner`),
      };
    }),
    followups: expectStringArray(json['followups'] ?? [], 'followups'),
  };
}

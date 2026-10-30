import type { ChatMetrics } from '../metrics/index.js';
import { buildRegistry } from '../report/registry.js';
import { parseReport, type Card, type Report } from '../report/types.js';
import { applyVerdicts, cardTexts, verifyReport, type Verdict, type VerifyContext } from '../report/verify.js';
import type { Message } from '../types.js';
import {
  BANNED_PHRASES,
  CARE_PROMPT,
  CRITIC_PROMPT,
  EXTRACTOR_PROMPT,
  fill,
  JUDGE_PROMPT,
  transcriptLines,
  WRITER_PROMPT,
} from './prompts.js';

export type Stage = 'extractor' | 'writer' | 'critic' | 'judge' | 'care';

/** Any model provider. The pipeline never imports an SDK; tests pass a fake. */
export interface ModelClient {
  complete(stage: Stage, prompt: string): Promise<string>;
}

export type CareFlagType = 'self_harm' | 'threat' | 'abuse_or_control' | 'minor_sexual' | 'acute_distress';

export interface CareFlag {
  type: CareFlagType;
  ids: string[];
  severity: 'low' | 'medium' | 'high';
}

export interface PipelineInput {
  /** Already redacted and aliased. Names must not reach this function. */
  transcript: Message[];
  metrics: ChatMetrics;
  /** Maps each alias (participant name in the transcript) to its id, such as `P1`. */
  personIds: Record<string, string>;
  client: ModelClient;
  reportType: string;
  language: 'he' | 'en';
  intensity: 1 | 2 | 3 | 4 | 5;
  persona: { name: string; card: string };
  /** Where a care report points the uploader for support, such as ERAN in Israel. */
  localResources: string;
}

export interface PipelineRemoval {
  stage: 'verify' | 'critic' | 'judge';
  label: string;
  reason: string;
}

export type PipelineResult =
  | { kind: 'stopped'; reason: 'minor_sexual' }
  | { kind: 'care'; flag: CareFlagType; summary: string; resources: string[] }
  | {
      kind: 'report';
      report: Report;
      removed: PipelineRemoval[];
      issues: string[];
      criticRounds: number;
      droppedIds: number;
    };

export class PipelineError extends Error {
  override name = 'PipelineError';
}

const CARE_FLAG_TYPES: CareFlagType[] = ['self_harm', 'threat', 'abuse_or_control', 'minor_sexual', 'acute_distress'];
const MIN_SCORE = 4;
const CRITIC_ROUNDS = 2;
const MAX_WRITER_ATTEMPTS = 2;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Strips code fences a model may wrap around its JSON, then parses. */
function parseModelJson(raw: string, stage: Stage): unknown {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new PipelineError(`${stage} returned text that is not JSON`);
  }
}

/**
 * Makes the metrics safe to show a model: person names become ids, in keys and in ghost gaps.
 * Nothing else in the metrics carries a name.
 */
export function metricsForModel(metrics: ChatMetrics, personIds: Record<string, string>): Json {
  const idOf = (name: string | null): string | null => (name === null ? null : (personIds[name] ?? 'P?'));
  return {
    participants: Object.values(personIds),
    totalMessages: metrics.totalMessages,
    totalWords: metrics.totalWords,
    conversations: metrics.conversations,
    replyAsymmetry: metrics.replyAsymmetry,
    longestStreakDays: metrics.longestStreakDays,
    people: Object.fromEntries(Object.entries(metrics.people).map(([name, p]) => [idOf(name), p])),
    ghostGaps: metrics.ghostGaps.map((gap) => ({ ...gap, before: idOf(gap.before), brokeBy: idOf(gap.brokeBy) })),
  };
}

/**
 * Keeps only ids that exist in the transcript. Any object key ending in `ids` is filtered,
 * and any `id`, `first_id` or `claim_id` that is unknown becomes null. Returns how many were dropped.
 */
export function sanitizeMaterialBank(value: unknown, ids: Set<string>): { bank: Json; droppedIds: number } {
  let droppedIds = 0;

  const walk = (node: unknown, key: string): unknown => {
    if (Array.isArray(node)) {
      if (/ids$/.test(key)) {
        return node.filter((item) => {
          const known = typeof item === 'string' && ids.has(item);
          if (!known) droppedIds++;
          return known;
        });
      }
      return node.map((item) => walk(item, key));
    }
    if (isObject(node)) {
      return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v, k)]));
    }
    if (typeof node === 'string' && (key === 'id' || key === 'first_id' || key === 'claim_id')) {
      if (ids.has(node)) return node;
      droppedIds++;
      return null;
    }
    return node;
  };

  const bank = walk(value, '');
  return { bank: isObject(bank) ? bank : {}, droppedIds };
}

function careFlagsOf(bank: Json): CareFlag[] {
  const raw = Array.isArray(bank['care_flags']) ? bank['care_flags'] : [];
  return raw.flatMap((flag): CareFlag[] => {
    if (!isObject(flag)) return [];
    const type = CARE_FLAG_TYPES.find((t) => t === flag['type']);
    const severity = flag['severity'];
    if (!type || (severity !== 'low' && severity !== 'medium' && severity !== 'high')) return [];
    const ids = Array.isArray(flag['ids']) ? flag['ids'].filter((id): id is string => typeof id === 'string') : [];
    return [{ type, ids, severity }];
  });
}

async function requestReport(client: ModelClient, prompt: string): Promise<Report> {
  let current = prompt;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < MAX_WRITER_ATTEMPTS; attempt++) {
    const raw = await client.complete('writer', current);
    try {
      return parseReport(parseModelJson(raw, 'writer'));
    } catch (error) {
      lastError = error;
      current = `${prompt}\n\nYour previous answer was rejected: ${(error as Error).message}. Return only valid JSON.`;
    }
  }
  throw lastError;
}

function labelOf(card: Card): string {
  return cardTexts(card).find((t) => t.length > 0) ?? card.kind;
}

function rewriteCard(card: Card, rewrite: string): Card {
  switch (card.kind) {
    case 'insight':
      return { ...card, body: rewrite };
    case 'stat':
      return { ...card, caption: rewrite };
    case 'award':
      return { ...card, citation: rewrite };
    case 'chart':
      return card;
  }
}

interface CriticScore {
  card: number;
  specificity: number;
  truth: number;
  surprise: number;
  brevity: number;
  kindness_ok: boolean;
  action: 'keep' | 'rewrite' | 'cut';
  rewrite: string | null;
}

/** Models often wrap a list in an object, such as {"scores": [...]}. Takes the list, whatever its key. */
export function listOf(value: unknown, stage: Stage): unknown[] {
  if (Array.isArray(value)) return value;
  if (isObject(value)) {
    const inner = Object.values(value).find(Array.isArray);
    if (inner) return inner;
  }
  throw new PipelineError(`${stage} must return a JSON array`);
}

function parseCritic(value: unknown): CriticScore[] {
  return listOf(value, 'critic').filter(isObject).map((row) => ({
    card: Number(row['card']),
    specificity: Number(row['specificity']),
    truth: Number(row['truth']),
    surprise: Number(row['surprise']),
    brevity: Number(row['brevity']),
    kindness_ok: row['kindness_ok'] !== false,
    action: row['action'] === 'rewrite' || row['action'] === 'cut' ? row['action'] : 'keep',
    rewrite: typeof row['rewrite'] === 'string' ? row['rewrite'] : null,
  }));
}

function parseVerdicts(value: unknown): Verdict[] {
  return listOf(value, 'judge').filter(isObject).flatMap((row): Verdict[] => {
    const verdict = row['verdict'];
    if (typeof row['card'] !== 'number') return [];
    if (verdict !== 'supported' && verdict !== 'partly' && verdict !== 'unsupported') return [];
    return [{ card: row['card'], verdict, reason: String(row['reason'] ?? '') }];
  });
}

/**
 * Runs the staged pipeline: extract, check for care, write, verify in code, critique
 * (at most two rounds, re-verifying after every edit), then judge the evidence.
 * A chat with minor-sexual content stops here; a chat with medium or high care flags
 * gets the calm care report instead of the roast.
 */
/** Messages per extractor request. Keeps each call well under the model's per-request input limit. */
export const EXTRACTOR_CHUNK_SIZE = 100;
/** Most messages the writer sees. The writer gets excerpts the bank cites, never the whole chat. */
export const WRITER_EXCERPT_LIMIT = 150;

export function chunkMessages(messages: Message[], size: number): Message[][] {
  const chunks: Message[][] = [];
  for (let start = 0; start < messages.length; start += size) chunks.push(messages.slice(start, start + size));
  return chunks;
}

/** Joins two extractor banks: arrays concatenate, and a scalar keeps the first non-empty value. */
export function mergeBanks(a: Json, b: Json): Json {
  const merged: Json = { ...a };
  for (const [key, value] of Object.entries(b)) {
    const existing = merged[key];
    if (Array.isArray(value) && Array.isArray(existing)) merged[key] = [...existing, ...value];
    else if (existing === undefined || existing === null) merged[key] = value;
  }
  return merged;
}

/** Every message id the bank cites, found anywhere in its values. */
function citedIds(node: unknown, found: Set<string> = new Set()): Set<string> {
  if (typeof node === 'string' && /^m\d{5}$/.test(node)) found.add(node);
  else if (Array.isArray(node)) node.forEach((item) => citedIds(item, found));
  else if (isObject(node)) Object.values(node).forEach((value) => citedIds(value, found));
  return found;
}

/** The writer's view of the chat: only messages the material bank cites, in transcript order, capped. */
export function writerExcerpt(transcript: Message[], bank: Json, personIds: Record<string, string>): string {
  const cited = citedIds(bank);
  const excerpt = transcript.filter((m) => cited.has(m.id)).slice(0, WRITER_EXCERPT_LIMIT);
  return excerpt.length > 0 ? transcriptLines(excerpt, personIds) : '(no excerpts cited)';
}

export async function runPipeline(input: PipelineInput): Promise<PipelineResult> {
  const { transcript, metrics, personIds, client } = input;
  const personIdList = Object.values(personIds);
  const modelMetrics = JSON.stringify(metricsForModel(metrics, personIds));

  // The extractor reads the chat in chunks, so each request fits the model's input limit.
  let bank: Json = {};
  let droppedIds = 0;
  for (const chunk of chunkMessages(transcript, EXTRACTOR_CHUNK_SIZE)) {
    const extractedRaw = await client.complete(
      'extractor',
      fill(EXTRACTOR_PROMPT, {
        participants: personIdList.join(', '),
        era_stats_json: modelMetrics,
        messages: transcriptLines(chunk, personIds),
      }),
    );
    const sanitized = sanitizeMaterialBank(parseModelJson(extractedRaw, 'extractor'), new Set(chunk.map((m) => m.id)));
    droppedIds += sanitized.droppedIds;
    bank = mergeBanks(bank, sanitized.bank);
  }
  const flags = careFlagsOf(bank);

  if (flags.some((f) => f.type === 'minor_sexual')) {
    return { kind: 'stopped', reason: 'minor_sexual' };
  }

  const serious = flags.find((f) => f.severity !== 'low');
  if (serious) {
    const careRaw = await client.complete(
      'care',
      fill(CARE_PROMPT, {
        care_flag_types: [...new Set(flags.map((f) => f.type))].join(', '),
        local_resources: input.localResources,
      }),
    );
    const care = parseModelJson(careRaw, 'care');
    if (!isObject(care) || typeof care['summary'] !== 'string') {
      throw new PipelineError('care must return a summary');
    }
    const resources = Array.isArray(care['resources']) ? care['resources'].map(String) : [];
    return { kind: 'care', flag: serious.type, summary: care['summary'], resources };
  }

  const registry = buildRegistry(metrics, personIds);
  const ctx: VerifyContext = {
    transcript,
    registry,
    personIds: personIdList,
    bannedPhrases: BANNED_PHRASES,
    emojiLimit: 3,
  };
  const removed: PipelineRemoval[] = [];
  const recordVerify = (stage: PipelineRemoval['stage'], report: Report, removals: { index: number; reason: string }[]) => {
    for (const r of removals) removed.push({ stage, label: labelOf(report.cards[r.index]!), reason: r.reason });
  };

  const draft = await requestReport(
    client,
    fill(WRITER_PROMPT, {
      persona_name: input.persona.name,
      persona_card: input.persona.card,
      report_type: input.reportType,
      intensity: String(input.intensity),
      intensity_name: ['', 'Wholesome', 'Playful', 'Honest', 'Spicy', 'Roast battle'][input.intensity] ?? 'Honest',
      language: input.language,
      participants: personIdList.join(', '),
      ban_list: BANNED_PHRASES.join(', '),
      metrics_json: modelMetrics,
      material_bank_json: JSON.stringify(bank),
      messages: writerExcerpt(transcript, bank, personIds),
    }),
  );

  let verified = verifyReport(draft, ctx);
  recordVerify('verify', draft, verified.removed);
  let current = verified.report;
  let criticRounds = 0;

  for (let round = 1; round <= CRITIC_ROUNDS && current.cards.length > 0; round++) {
    criticRounds = round;
    const criticRaw = await client.complete(
      'critic',
      fill(CRITIC_PROMPT, {
        intensity: String(input.intensity),
        draft_json: JSON.stringify(current.cards),
        material_bank_json: JSON.stringify(bank),
        metrics_json: modelMetrics,
      }),
    );
    const scores = new Map(parseCritic(parseModelJson(criticRaw, 'critic')).map((s) => [s.card, s]));

    const next: Card[] = [];
    current.cards.forEach((card, index) => {
      const score = scores.get(index);
      if (!score) return next.push(card);

      const lowest = Math.min(score.specificity, score.truth, score.surprise, score.brevity);
      const cut = (reason: string) => removed.push({ stage: 'critic', label: labelOf(card), reason });

      if (!score.kindness_ok || score.action === 'cut') return cut('critic cut the card');
      if (lowest >= MIN_SCORE) return next.push(card);
      if (round === CRITIC_ROUNDS) return cut(`still scored ${lowest} after a rewrite`);
      if (score.rewrite) return next.push(rewriteCard(card, score.rewrite));
      return cut(`scored ${lowest} with no rewrite`);
    });

    current = { ...current, cards: next };
    verified = verifyReport(current, ctx);
    recordVerify('verify', current, verified.removed);
    current = verified.report;
  }

  if (current.cards.length > 0) {
    const claims = current.cards.map((card, index) => ({
      card: index,
      claim: cardTexts(card).filter(Boolean),
      evidence: transcriptLines(
        transcript.filter((m) => (card.kind === 'insight' || card.kind === 'award' ? card.evidence : []).includes(m.id)),
        personIds,
      ),
    }));
    const judgeRaw = await client.complete('judge', fill(JUDGE_PROMPT, { claims: JSON.stringify(claims) }));
    const judged = applyVerdicts(current, parseVerdicts(parseModelJson(judgeRaw, 'judge')));
    for (const r of judged.removed) {
      removed.push({ stage: 'judge', label: labelOf(current.cards[r.index]!), reason: r.reason });
    }
    current = judged.report;
  }

  return {
    kind: 'report',
    report: current,
    removed,
    issues: verified.issues,
    criticRounds,
    droppedIds,
  };
}

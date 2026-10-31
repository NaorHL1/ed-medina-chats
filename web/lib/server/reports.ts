import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeMetrics } from '@engine/metrics/index';
import { MIN_REPORT_CARDS, runPipeline, type ModelClient, type PipelineResult, type ReportStep } from '@engine/pipeline/run';
import { GroqClient } from '@engine/pipeline/groq';
import { db } from './db';
import { getChat, purgeTranscript } from './chats';
import { hasChatPass } from './billing';

export const REPORT_TYPES = ['full_read'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export interface ReportRow {
  id: string;
  chatId: string;
  reportType: ReportType;
  status: 'queued' | 'running' | 'done' | 'care' | 'stopped' | 'failed';
  result: unknown;
  error: string | null;
  createdAt: number;
  /** The step a running report is on. Null before it starts and after it finishes. */
  progress: Progress | null;
}

export interface Progress {
  step: ReportStep;
  done?: number;
  total?: number;
}

/**
 * Progress lives in the database, not in memory. Each route is bundled on its own, so a module-level
 * Map written by the job is invisible to the status route, which reads it back.
 */
function setProgress(reportId: string, value: Progress | null): void {
  db()
    .prepare('UPDATE reports SET progress = ? WHERE id = ?')
    .run(value === null ? null : JSON.stringify(value), reportId);
}

/** The error code stored when the checks leave too few cards. The page shows its own wording for it. */
export const NOT_ENOUGH_CARDS = 'not_enough_cards';

export type Language = 'he' | 'en';

export interface ReportOptions {
  /** Language of the report text. The writer writes native Hebrew when this is he. */
  language?: Language;
  /** Injected by tests. Production builds the Groq client from the environment. */
  client?: ModelClient;
}

/** Report fields that hold words for the reader. Ids, refs and message ids stay as they are. */
const READABLE_KEYS = new Set(['headline', 'title', 'body', 'punchline', 'caption', 'award', 'winner', 'citation', 'archetype', 'one_liner']);

/**
 * The model only ever sees ids (P1, P2). The reader should see the nicknames they chose, so each id in the
 * words of a finished report is swapped for its nickname. Cards cite ids in separate fields that stay untouched.
 */
export function nameReport(result: PipelineResult, personIds: Record<string, string>): PipelineResult {
  if (result.kind !== 'report') return result;
  const nameOf = new Map(Object.entries(personIds).map(([name, id]) => [id, name]));
  const swapIds = (text: string) => text.replace(/\bP\d+\b/g, (id) => nameOf.get(id) ?? id);

  const walk = (node: unknown, key = ''): unknown => {
    if (typeof node === 'string') return READABLE_KEYS.has(key) || key === 'followups' ? swapIds(node) : node;
    if (Array.isArray(node)) return node.map((item) => walk(item, key));
    if (node !== null && typeof node === 'object') {
      return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v, k)]));
    }
    return node;
  };
  return { ...result, report: walk(result.report) as typeof result.report };
}

export class ReportError extends Error {
  override name = 'ReportError';
  /** The HTTP status a route answers with: 402 needs a Chat Pass, 404 no such chat, 409 the transcript is gone. */
  constructor(message: string, readonly status: number = 400) {
    super(message);
  }
}

/**
 * Model calls run one at a time. The free Groq tier allows only a few requests a minute, so a second
 * job waits behind the first instead of competing with it.
 */
let queue: Promise<void> = Promise.resolve();

export function createReport(userId: string, chatId: string, reportType: ReportType, options: ReportOptions = {}): ReportRow {
  if (!hasChatPass(userId, chatId)) throw new ReportError('Unlock this chat with a Chat Pass first.', 402);
  const chat = getChat(userId, chatId);
  if (!chat) throw new ReportError('Chat not found.', 404);
  if (chat.messages === null) throw new ReportError('This chat’s transcript was deleted after its report. Upload it again to make a new one.', 409);

  const id = randomUUID();
  const createdAt = Date.now();
  db()
    .prepare('INSERT INTO reports (id, chat_id, report_type, status, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, chatId, reportType, 'queued', createdAt);
  queue = queue.then(() => runJob(userId, id, chatId, reportType, options));
  return { id, chatId, reportType, status: 'queued', result: null, error: null, createdAt, progress: null };
}

export function getReport(userId: string, reportId: string): ReportRow | null {
  const row = db()
    .prepare(
      `SELECT reports.id, reports.chat_id, reports.report_type, reports.status, reports.result, reports.error, reports.created_at, reports.progress
       FROM reports JOIN chats ON chats.id = reports.chat_id WHERE reports.id = ? AND chats.user_id = ?`,
    )
    .get(reportId, userId) as
    | { id: string; chat_id: string; report_type: ReportType; status: ReportRow['status']; result: string | null; error: string | null; created_at: number; progress: string | null }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    chatId: row.chat_id,
    reportType: row.report_type,
    status: row.status,
    result: row.result ? JSON.parse(row.result) : null,
    error: row.error,
    createdAt: row.created_at,
    progress: row.progress ? (JSON.parse(row.progress) as Progress) : null,
  };
}

function setStatus(reportId: string, status: ReportRow['status'], result: unknown, error: string | null): void {
  db()
    .prepare('UPDATE reports SET status = ?, result = ?, error = ? WHERE id = ?')
    .run(status, result === null ? null : JSON.stringify(result), error, reportId);
}

/** Maps a pipeline result to a stored status. Care and stop results are stored too: they are answers, not failures. */
export function statusOf(result: PipelineResult): ReportRow['status'] {
  if (result.kind === 'report') return 'done';
  if (result.kind === 'care') return 'care';
  return 'stopped';
}

/** The Groq client comes from the environment. Throws when the key or model is missing. */
function groqFromEnv(): ModelClient {
  const apiKey = process.env['GROQ_API_KEY'];
  const model = process.env['GROQ_MODEL'];
  if (!apiKey || !model) throw new ReportError('Set GROQ_API_KEY and GROQ_MODEL on the server.');
  return new GroqClient({
    apiKey,
    model,
    url: process.env['GROQ_URL'],
    minIntervalMs: Number(process.env['GROQ_MIN_INTERVAL_MS'] ?? 60_000),
  });
}

async function runJob(userId: string, reportId: string, chatId: string, reportType: ReportType, options: ReportOptions): Promise<void> {
  setStatus(reportId, 'running', null, null);
  try {
    const client = options.client ?? groqFromEnv();
    const chat = getChat(userId, chatId);
    if (!chat?.messages) throw new ReportError('The transcript is no longer available.');

    const metrics = computeMetrics(chat.messages);
    const personIds = Object.fromEntries(metrics.participants.map((name, i) => [name, `P${i + 1}`]));
    const persona = JSON.parse(readFileSync(join(process.cwd(), '..', 'chat-report', 'eval', 'personas', 'roaster.json'), 'utf8')) as {
      name: string;
      card: string;
    };

    const result = await runPipeline({
      onStep: (step, detail) => setProgress(reportId, { step, ...detail }),
      transcript: chat.messages,
      metrics,
      personIds,
      client,
      reportType,
      language: options.language ?? 'en',
      intensity: 3,
      persona,
      localResources: process.env['SUPPORT_RESOURCES'] ?? 'ERAN (Israel)',
    });
    setProgress(reportId, null);
    // A report the checks left almost empty is not shown as finished. The chat stays, so the user can try again.
    if (result.kind === 'report' && result.report.cards.length < MIN_REPORT_CARDS) {
      // Keep why each card was removed, so a thin report can be explained and fixed without rerunning it.
      setStatus(reportId, 'failed', { removed: result.removed, issues: result.issues }, NOT_ENOUGH_CARDS);
      return;
    }
    setStatus(reportId, statusOf(result), nameReport(result, personIds), null);
    // The report is stored, so the raw chat goes now. A failed job keeps it, so the user can retry.
    purgeTranscript(chatId);
  } catch (error) {
    setProgress(reportId, null);
    // The full reason goes to the log and the row; the page shows a plain message, never a setting name.
    console.error(`[report ${reportId}]`, error);
    setStatus(reportId, 'failed', null, error instanceof Error ? error.message : String(error));
  }
}

/** Resolves once every queued job has finished. Used by tests. */
export function drainQueue(): Promise<void> {
  return queue;
}

/** The most recent report for a chat the user owns, so the page can show it after a reload. */
export function latestReport(userId: string, chatId: string): ReportRow | null {
  const row = db()
    .prepare(
      `SELECT reports.id FROM reports JOIN chats ON chats.id = reports.chat_id
       WHERE reports.chat_id = ? AND chats.user_id = ? ORDER BY reports.created_at DESC LIMIT 1`,
    )
    .get(chatId, userId) as { id: string } | undefined;
  return row ? getReport(userId, row.id) : null;
}

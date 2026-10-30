import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeMetrics } from '@engine/metrics/index';
import { runPipeline, type ModelClient, type PipelineResult } from '@engine/pipeline/run';
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
}

export type Language = 'he' | 'en';

export interface ReportOptions {
  /** Language of the report text. The writer writes native Hebrew when this is he. */
  language?: Language;
  /** Injected by tests. Production builds the Groq client from the environment. */
  client?: ModelClient;
}

export class ReportError extends Error {
  override name = 'ReportError';
}

/**
 * Model calls run one at a time. The free Groq tier allows only a few requests a minute, so a second
 * job waits behind the first instead of competing with it.
 */
let queue: Promise<void> = Promise.resolve();

export function createReport(userId: string, chatId: string, reportType: ReportType, options: ReportOptions = {}): ReportRow {
  if (!hasChatPass(userId, chatId)) throw new ReportError('Unlock this chat with a Chat Pass first.');
  const chat = getChat(userId, chatId);
  if (!chat) throw new ReportError('Chat not found.');
  if (chat.messages === null) throw new ReportError('This chat’s transcript was deleted after its report. Upload it again to make a new one.');

  const id = randomUUID();
  const createdAt = Date.now();
  db()
    .prepare('INSERT INTO reports (id, chat_id, report_type, status, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, chatId, reportType, 'queued', createdAt);
  queue = queue.then(() => runJob(userId, id, chatId, reportType, options));
  return { id, chatId, reportType, status: 'queued', result: null, error: null, createdAt };
}

export function getReport(userId: string, reportId: string): ReportRow | null {
  const row = db()
    .prepare(
      `SELECT reports.id, reports.chat_id, reports.report_type, reports.status, reports.result, reports.error, reports.created_at
       FROM reports JOIN chats ON chats.id = reports.chat_id WHERE reports.id = ? AND chats.user_id = ?`,
    )
    .get(reportId, userId) as
    | { id: string; chat_id: string; report_type: ReportType; status: ReportRow['status']; result: string | null; error: string | null; created_at: number }
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
  return new GroqClient({ apiKey, model, minIntervalMs: Number(process.env['GROQ_MIN_INTERVAL_MS'] ?? 60_000) });
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
    setStatus(reportId, statusOf(result), result, null);
    // The report is stored, so the raw chat goes now. A failed job keeps it, so the user can retry.
    purgeTranscript(chatId);
  } catch (error) {
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

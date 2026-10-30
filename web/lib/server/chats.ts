import { randomUUID } from 'node:crypto';
import type { Message } from '@engine/types';
import { db } from './db';
import { open, seal } from './crypto';

/** WhatsApp keeps at most this many messages per export. Anything above it is not a real export. */
export const MAX_MESSAGES = 40_000;

export interface ChatSummary {
  id: string;
  title: string;
  createdAt: number;
  messageCount: number;
  /** False once the transcript is deleted after its report. The chat and its reports remain. */
  hasTranscript: boolean;
}

export interface StoredChat extends ChatSummary {
  messages: Message[] | null;
}

interface ChatRow {
  id: string;
  title: string;
  created_at: number;
  message_count: number;
  payload: string | null;
}

/**
 * Stores a redacted, aliased transcript encrypted. The browser has already removed phone numbers,
 * emails and card numbers, and replaced names with the nicknames the uploader chose.
 */
export function createChat(userId: string, title: string, messages: Message[]): ChatSummary {
  if (messages.length === 0) throw new ChatError('The export has no messages.');
  if (messages.length > MAX_MESSAGES) throw new ChatError(`More than ${MAX_MESSAGES} messages is not a WhatsApp export.`);
  const id = randomUUID();
  const createdAt = Date.now();
  const shortTitle = title.slice(0, 80) || 'Chat';
  db()
    .prepare('INSERT INTO chats (id, user_id, title, created_at, message_count, payload) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, userId, shortTitle, createdAt, messages.length, seal(JSON.stringify(messages)));
  return { id, title: shortTitle, createdAt, messageCount: messages.length, hasTranscript: true };
}

function summaryOf(row: ChatRow): ChatSummary {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    messageCount: row.message_count,
    hasTranscript: row.payload !== null,
  };
}

export function listChats(userId: string): ChatSummary[] {
  const rows = db()
    .prepare('SELECT id, title, created_at, message_count, payload FROM chats WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId) as unknown as ChatRow[];
  return rows.map(summaryOf);
}

export function getChat(userId: string, chatId: string): StoredChat | null {
  const row = db()
    .prepare('SELECT id, title, created_at, message_count, payload FROM chats WHERE id = ? AND user_id = ?')
    .get(chatId, userId) as unknown as ChatRow | undefined;
  if (!row) return null;
  const messages = row.payload === null ? null : (JSON.parse(open(row.payload)) as Message[]);
  return { ...summaryOf(row), messages };
}

/** Clears the transcript. Called once a report has finished, so the raw chat outlives its report by no time at all. */
export function purgeTranscript(chatId: string): void {
  db().prepare('UPDATE chats SET payload = NULL WHERE id = ?').run(chatId);
}

/** "Delete everything": removes every chat, report and login session for the user. */
export function deleteAllData(userId: string): void {
  const database = db();
  database.exec('BEGIN');
  try {
    database.prepare('DELETE FROM reports WHERE chat_id IN (SELECT id FROM chats WHERE user_id = ?)').run(userId);
    database.prepare('DELETE FROM chats WHERE user_id = ?').run(userId);
    database.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

export class ChatError extends Error {
  override name = 'ChatError';
}

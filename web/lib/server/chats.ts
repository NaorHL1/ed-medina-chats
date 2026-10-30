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
}

export interface StoredChat extends ChatSummary {
  messages: Message[];
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
  db()
    .prepare('INSERT INTO chats (id, user_id, title, created_at, payload) VALUES (?, ?, ?, ?, ?)')
    .run(id, userId, title.slice(0, 80) || 'Chat', createdAt, seal(JSON.stringify(messages)));
  return { id, title: title.slice(0, 80) || 'Chat', createdAt, messageCount: messages.length };
}

export function listChats(userId: string): ChatSummary[] {
  const rows = db()
    .prepare('SELECT id, title, created_at, payload FROM chats WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId) as { id: string; title: string; created_at: number; payload: string }[];
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    messageCount: (JSON.parse(open(row.payload)) as Message[]).length,
  }));
}

export function getChat(userId: string, chatId: string): StoredChat | null {
  const row = db()
    .prepare('SELECT id, title, created_at, payload FROM chats WHERE id = ? AND user_id = ?')
    .get(chatId, userId) as { id: string; title: string; created_at: number; payload: string } | undefined;
  if (!row) return null;
  const messages = JSON.parse(open(row.payload)) as Message[];
  return { id: row.id, title: row.title, createdAt: row.created_at, messageCount: messages.length, messages };
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

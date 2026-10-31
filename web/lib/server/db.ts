import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DatabaseSync as Database } from 'node:sqlite';

// Loaded without an import statement so test runners and bundlers never try to resolve it as a package.
const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');

/**
 * SQLite for the MVP, through Node's built-in driver (no native build). Chat bodies are stored encrypted
 * in `chats.payload`. The payload is cleared once a report finishes, so no transcript outlives its report.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  age_confirmed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS login_links (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  payload TEXT
);
CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chat_id TEXT REFERENCES chats(id) ON DELETE SET NULL,
  tier TEXT NOT NULL,
  status TEXT NOT NULL,
  provider_ref TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  report_type TEXT NOT NULL,
  status TEXT NOT NULL,
  result TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  progress TEXT
);
`;

/** Adds columns that older databases lack. Each step runs once; `CREATE TABLE IF NOT EXISTS` does not add columns. */
function migrate(database: Database): void {
  const reportColumns = database.prepare('PRAGMA table_info(reports)').all() as { name: string }[];
  if (!reportColumns.some((c) => c.name === 'progress')) {
    database.exec('ALTER TABLE reports ADD COLUMN progress TEXT');
  }
}

let handle: Database | null = null;

export function db(): Database {
  if (handle) return handle;
  const path = process.env['DATABASE_PATH'] ?? './data/chat-report.db';
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  handle = new DatabaseSync(path);
  handle.exec('PRAGMA foreign_keys = ON;');
  handle.exec(SCHEMA);
  migrate(handle);
  return handle;
}

/** Test hook: a fresh in-memory database per test. */
export function resetDatabase(path = ':memory:'): Database {
  handle?.close();
  handle = null;
  process.env['DATABASE_PATH'] = path;
  return db();
}

import { randomUUID } from 'node:crypto';
import { db } from './db';
import { newToken, tokenHash } from './crypto';

const LINK_MINUTES = 15;
const SESSION_DAYS = 30;

export interface SessionUser {
  id: string;
  email: string;
}

/**
 * Sends the login link. In dev the link goes to the server console, because the MVP has no
 * email provider yet. Replace this one function when one is chosen.
 */
export async function sendLoginEmail(email: string, link: string): Promise<void> {
  console.log(`[dev login] ${email}: ${link}`);
}

/** Only same-site paths may follow a sign-in, so a link cannot send people to another site. */
export function safeNext(next: string): string {
  return next.startsWith('/') && !next.startsWith('//') ? next : '/chats';
}

export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

/** Creates a single-use login link. Returns nothing to the caller, so the reply never reveals an account. */
export async function requestLogin(
  rawEmail: string,
  ageConfirmed: boolean,
  baseUrl: string,
  next = '/chats',
): Promise<'sent' | 'age_required' | 'invalid_email'> {
  const email = normalizeEmail(rawEmail);
  if (!email) return 'invalid_email';
  if (!ageConfirmed) return 'age_required';

  const token = newToken();
  db()
    .prepare('INSERT INTO login_links (token_hash, email, expires_at) VALUES (?, ?, ?)')
    .run(tokenHash(token), email, Date.now() + LINK_MINUTES * 60_000);
  await sendLoginEmail(email, `${baseUrl}/api/auth/verify?token=${token}&next=${encodeURIComponent(safeNext(next))}`);
  return 'sent';
}

/** Exchanges a login link for a session. The link works once and expires. */
export function consumeLogin(token: string): string | null {
  const row = db()
    .prepare('SELECT email, expires_at, used FROM login_links WHERE token_hash = ?')
    .get(tokenHash(token)) as { email: string; expires_at: number; used: number } | undefined;
  if (!row || row.used === 1 || row.expires_at < Date.now()) return null;
  db().prepare('UPDATE login_links SET used = 1 WHERE token_hash = ?').run(tokenHash(token));

  const user = upsertUser(row.email);
  const session = newToken();
  db()
    .prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(tokenHash(session), user.id, Date.now() + SESSION_DAYS * 86_400_000);
  return session;
}

function upsertUser(email: string): SessionUser {
  const existing = db().prepare('SELECT id, email FROM users WHERE email = ?').get(email) as SessionUser | undefined;
  if (existing) return existing;
  const id = randomUUID();
  db()
    .prepare('INSERT INTO users (id, email, created_at, age_confirmed) VALUES (?, ?, ?, 1)')
    .run(id, email, Date.now());
  return { id, email };
}

export function sessionUser(token: string | undefined): SessionUser | null {
  if (!token) return null;
  const row = db()
    .prepare(
      `SELECT users.id AS id, users.email AS email, sessions.expires_at AS expires_at
       FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ?`,
    )
    .get(tokenHash(token)) as (SessionUser & { expires_at: number }) | undefined;
  if (!row || row.expires_at < Date.now()) return null;
  return { id: row.id, email: row.email };
}

export function endSession(token: string): void {
  db().prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
}

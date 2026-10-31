import { NextResponse } from 'next/server';
import { db } from './db';

/** The caller's address behind a proxy. Falls back to one shared key when no proxy header is set. */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('x-real-ip') || 'local';
}

/**
 * Fixed-window limit kept in the database, so every route and every restart sees the same counts.
 * Returns true when the call may go ahead.
 */
export function allow(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  const row = db().prepare('SELECT window_start, count FROM rate_limits WHERE key = ?').get(key) as
    | { window_start: number; count: number }
    | undefined;
  if (!row || now - row.window_start >= windowMs) {
    db()
      .prepare('INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET window_start = excluded.window_start, count = 1')
      .run(key, now);
    return true;
  }
  if (row.count >= max) return false;
  db().prepare('UPDATE rate_limits SET count = count + 1 WHERE key = ?').run(key);
  return true;
}

export const tooMany = () =>
  NextResponse.json({ error: 'Too many requests. Try again later.', code: 'rate_limited' }, { status: 429 });

type Handler<Ctx> = (request: Request, context: Ctx) => Promise<Response>;

/**
 * Wraps a route so an unexpected error is logged and answered with JSON, never an HTML error page.
 * The page can always read the reply and recover.
 */
export function withErrors<Ctx = unknown>(handler: Handler<Ctx>): Handler<Ctx> {
  return async (request, context) => {
    try {
      return await handler(request, context);
    } catch (error) {
      console.error(`[${request.method} ${new URL(request.url).pathname}]`, error);
      return NextResponse.json({ error: 'Something went wrong on our side. Try again.', code: 'server_error' }, { status: 500 });
    }
  };
}

import { NextResponse } from 'next/server';
import { startGuestSession } from '@/lib/server/auth';
import { currentUser, SESSION_COOKIE, sessionCookieOptions } from '@/lib/server/session';

/**
 * Gives a visitor a guest session without an email. Someone who already has a session keeps it.
 * The visitor must confirm they are 18 or older.
 */
export async function POST(request: Request) {
  const existing = await currentUser();
  if (existing) return NextResponse.json({ user: existing });

  const body = (await request.json().catch(() => null)) as { ageConfirmed?: unknown } | null;
  if (body?.ageConfirmed !== true) {
    return NextResponse.json({ error: 'Confirm you are 18 or older.', code: 'age_required' }, { status: 400 });
  }

  const token = startGuestSession();
  const response = NextResponse.json({ status: 'started' }, { status: 201 });
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(30));
  return response;
}

import { cookies } from 'next/headers';
import { sessionUser, type SessionUser } from './auth';

export const SESSION_COOKIE = 'cr_session';

/** The signed-in user for this request, or null. Reads the httpOnly session cookie. */
export async function currentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  return sessionUser(store.get(SESSION_COOKIE)?.value);
}

export function sessionCookieOptions(maxAgeDays: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env['NODE_ENV'] === 'production',
    path: '/',
    maxAge: maxAgeDays * 86_400,
  };
}

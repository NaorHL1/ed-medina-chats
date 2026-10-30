import { NextResponse } from 'next/server';
import { consumeLogin, safeNext } from '@/lib/server/auth';
import { SESSION_COOKIE, sessionCookieOptions } from '@/lib/server/session';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const session = consumeLogin(url.searchParams.get('token') ?? '');
  if (!session) return NextResponse.redirect(new URL('/login?expired=1', url));
  const response = NextResponse.redirect(new URL(safeNext(url.searchParams.get('next') ?? '/chats'), url));
  response.cookies.set(SESSION_COOKIE, session, sessionCookieOptions(30));
  return response;
}

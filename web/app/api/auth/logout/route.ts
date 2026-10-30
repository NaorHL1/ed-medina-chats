import { NextResponse } from 'next/server';
import { endSession } from '@/lib/server/auth';
import { SESSION_COOKIE } from '@/lib/server/session';

export async function POST(request: Request) {
  const token = request.headers.get('cookie')?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1];
  if (token) endSession(token);
  const response = NextResponse.json({ status: 'signed_out' });
  response.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
  return response;
}

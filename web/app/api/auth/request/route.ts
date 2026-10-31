import { NextResponse } from 'next/server';
import { requestLogin } from '@/lib/server/auth';
import { allow, clientIp, tooMany, withErrors } from '@/lib/server/http';

const LOGIN_REQUESTS_PER_HOUR = 10;

/** Always answers the same way for a valid address, so the reply never reveals whether an account exists. */
export const POST = withErrors(async (request) => {
  if (!allow(`login:${clientIp(request)}`, LOGIN_REQUESTS_PER_HOUR, 3_600_000)) return tooMany();
  const body = (await request.json().catch(() => ({}))) as { email?: unknown; ageConfirmed?: unknown; next?: unknown };
  const result = await requestLogin(
    typeof body.email === 'string' ? body.email : '',
    body.ageConfirmed === true,
    new URL(request.url).origin,
    typeof body.next === 'string' ? body.next : '/chats',
  );
  if (result === 'age_required') return NextResponse.json({ code: 'age_required' }, { status: 400 });
  if (result === 'invalid_email') return NextResponse.json({ code: 'invalid_email' }, { status: 400 });
  return NextResponse.json({ status: 'sent' });
});

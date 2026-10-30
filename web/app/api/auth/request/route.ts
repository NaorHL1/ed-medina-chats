import { NextResponse } from 'next/server';
import { requestLogin } from '@/lib/server/auth';

/** Always answers the same way for a valid address, so the reply never reveals whether an account exists. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { email?: unknown; ageConfirmed?: unknown; next?: unknown };
  const result = await requestLogin(
    typeof body.email === 'string' ? body.email : '',
    body.ageConfirmed === true,
    new URL(request.url).origin,
    typeof body.next === 'string' ? body.next : '/chats',
  );
  if (result === 'age_required') return NextResponse.json({ error: 'You must confirm you are 18 or older.' }, { status: 400 });
  if (result === 'invalid_email') return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
  return NextResponse.json({ status: 'sent' });
}

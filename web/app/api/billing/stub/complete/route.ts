import { NextResponse } from 'next/server';
import { db } from '@/lib/server/db';
import { markPaid, providerFromEnv } from '@/lib/server/billing';
import { currentUser } from '@/lib/server/session';

/** Dev only: finishes a stub checkout with no payment. Refuses to run when Stripe is configured. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  if (providerFromEnv().name !== 'stub') return NextResponse.json({ error: 'Stub checkout is off.' }, { status: 404 });
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  const purchaseId = url.searchParams.get('purchase') ?? '';
  const row = db()
    .prepare('SELECT chat_id FROM purchases WHERE id = ? AND user_id = ?')
    .get(purchaseId, user.id) as { chat_id: string } | undefined;
  if (!row) return NextResponse.json({ error: 'Unknown purchase.' }, { status: 404 });
  markPaid(purchaseId, `stub_${purchaseId}`);
  return NextResponse.redirect(new URL(`/chats/${row.chat_id}?paid=1`, url));
}

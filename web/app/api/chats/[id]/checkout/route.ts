import { NextResponse } from 'next/server';
import { getChat } from '@/lib/server/chats';
import { CATALOG, createPurchase, providerFromEnv, type Tier } from '@/lib/server/billing';
import { currentUser } from '@/lib/server/session';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  const { id } = await params;
  if (!getChat(user.id, id)) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as { tier?: unknown };
  const tier = (typeof body.tier === 'string' ? body.tier : 'chat_pass') as Tier;
  if (!(tier in CATALOG)) return NextResponse.json({ error: 'Unknown tier.' }, { status: 400 });

  const purchaseId = createPurchase(user.id, id, tier);
  const origin = new URL(request.url).origin;
  const started = await providerFromEnv().start({ purchaseId, tier, returnUrl: `${origin}/chats/${id}` });
  return NextResponse.json({ url: started.url, purchaseId });
}

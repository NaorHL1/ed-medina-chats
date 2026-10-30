import { NextResponse } from 'next/server';
import { getChat } from '@/lib/server/chats';
import { currentUser } from '@/lib/server/session';
import { hasChatPass } from '@/lib/server/billing';

/** The chat, plus whether this user may read the paid reports. Messages are returned only to the owner. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  const { id } = await params;
  const chat = getChat(user.id, id);
  if (!chat) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  return NextResponse.json({ chat, unlocked: hasChatPass(user.id, id) });
}

import { NextResponse } from 'next/server';
import type { Message } from '@engine/types';
import { ChatError, createChat, listChats } from '@/lib/server/chats';
import { currentUser } from '@/lib/server/session';

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  return NextResponse.json({ chats: listChats(user.id) });
}

/** Body: { title, messages } where messages are already redacted and aliased in the browser. */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { title?: unknown; messages?: unknown } | null;
  if (!body || !Array.isArray(body.messages)) return NextResponse.json({ error: 'Send messages.' }, { status: 400 });
  try {
    const chat = createChat(user.id, typeof body.title === 'string' ? body.title : 'Chat', body.messages as Message[]);
    return NextResponse.json({ chat }, { status: 201 });
  } catch (error) {
    if (error instanceof ChatError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

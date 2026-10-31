import { NextResponse } from 'next/server';
import type { Message } from '@engine/types';
import { ChatError, createChat, listChats } from '@/lib/server/chats';
import { allow, tooMany, withErrors } from '@/lib/server/http';
import { currentUser } from '@/lib/server/session';

/** The largest upload body. A 40,000-message export is a few megabytes; this leaves room and stops abuse. */
const MAX_BODY_BYTES = 25_000_000;
const UPLOADS_PER_HOUR = 30;

export const GET = withErrors(async () => {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  return NextResponse.json({ chats: listChats(user.id) });
});

/** Body: { title, messages } where messages are already redacted and aliased in the browser. */
export const POST = withErrors(async (request) => {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'This chat is too large to upload.' }, { status: 413 });
  }
  if (!allow(`upload:${user.id}`, UPLOADS_PER_HOUR, 3_600_000)) return tooMany();
  const body = (await request.json().catch(() => null)) as { title?: unknown; messages?: unknown } | null;
  if (!body || !Array.isArray(body.messages)) return NextResponse.json({ error: 'Send messages.' }, { status: 400 });
  try {
    const chat = createChat(user.id, typeof body.title === 'string' ? body.title : 'Chat', body.messages as Message[]);
    return NextResponse.json({ chat }, { status: 201 });
  } catch (error) {
    if (error instanceof ChatError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
});

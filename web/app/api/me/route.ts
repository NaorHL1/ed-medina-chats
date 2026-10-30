import { NextResponse } from 'next/server';
import { currentUser, SESSION_COOKIE } from '@/lib/server/session';
import { deleteAllData } from '@/lib/server/chats';

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  return NextResponse.json({ user });
}

/** "Delete everything": chats, reports and sessions. Purchase records keep no chat content. */
export async function DELETE() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  deleteAllData(user.id);
  const response = NextResponse.json({ status: 'deleted' });
  response.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
  return response;
}

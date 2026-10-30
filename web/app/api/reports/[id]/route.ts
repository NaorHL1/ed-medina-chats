import { NextResponse } from 'next/server';
import { getReport } from '@/lib/server/reports';
import { currentUser } from '@/lib/server/session';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  const { id } = await params;
  const report = getReport(user.id, id);
  if (!report) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  return NextResponse.json({ report });
}

import { NextResponse } from 'next/server';
import { billingMode } from '@/lib/server/billing';
import { configProblems } from '@/lib/server/config';
import { db } from '@/lib/server/db';

export const dynamic = 'force-dynamic';

/**
 * For uptime checks and deploys. Answers 503 when the database cannot be read or configuration is missing,
 * and lists what is missing by name. It never returns a value.
 */
export async function GET() {
  let database = false;
  try {
    db().prepare('SELECT 1').get();
    database = true;
  } catch {
    database = false;
  }
  const problems = configProblems();
  const ok = database && problems.length === 0;
  return NextResponse.json(
    { ok, database, billing: billingMode(), problems: problems.map((p) => ({ key: p.key, message: p.message })) },
    { status: ok ? 200 : 503 },
  );
}

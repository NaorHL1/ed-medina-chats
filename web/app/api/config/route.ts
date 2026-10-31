import { NextResponse } from 'next/server';
import { billingMode } from '@/lib/server/billing';

export const dynamic = 'force-dynamic';

/** What the page needs to word its buttons. Carries no secrets. */
export async function GET() {
  return NextResponse.json({ billing: billingMode() });
}

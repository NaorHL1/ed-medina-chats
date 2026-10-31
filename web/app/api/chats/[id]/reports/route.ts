import { NextResponse } from 'next/server';
import { allow, tooMany, withErrors } from '@/lib/server/http';
import { createReport, REPORT_TYPES, ReportError, type Language, type ReportType } from '@/lib/server/reports';
import { currentUser } from '@/lib/server/session';

type Context = { params: Promise<{ id: string }> };

const REPORTS_PER_HOUR = 10;

export const POST = withErrors<Context>(async (request, { params }) => {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { reportType?: unknown; language?: unknown };
  const reportType = (typeof body.reportType === 'string' ? body.reportType : 'full_read') as ReportType;
  if (!REPORT_TYPES.includes(reportType)) return NextResponse.json({ error: 'Unknown report type.' }, { status: 400 });
  const language: Language = body.language === 'he' ? 'he' : 'en';
  if (!allow(`report:${user.id}`, REPORTS_PER_HOUR, 3_600_000)) return tooMany();
  try {
    const report = createReport(user.id, id, reportType, { language });
    return NextResponse.json({ report }, { status: 202 });
  } catch (error) {
    if (error instanceof ReportError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
});

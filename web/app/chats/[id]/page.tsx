'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { ACCOUNT_STRINGS } from '../../../lib/account-i18n';
import type { Lang } from '../../../lib/format';
import { useLang } from '../../../lib/lang';

interface ReportResult {
  kind: 'report' | 'care' | 'stopped';
  report?: { headline: string; cards: Record<string, unknown>[] };
  summary?: string;
  resources?: string[];
}

interface Report {
  id: string;
  status: 'queued' | 'running' | 'done' | 'care' | 'stopped' | 'failed';
  result: ReportResult | null;
  error: string | null;
  progress: { step: string; done?: number; total?: number } | null;
}

/** Rough share of the job done, from the step it is on. Each step covers a fixed slice of the bar. */
function percentOf(progress: Report['progress']): number {
  if (!progress) return 0;
  const { step, done = 0, total = 1 } = progress;
  const share = total > 0 ? done / total : 0;
  switch (step) {
    case 'reading':
      return 5 + share * 40;
    case 'checking':
      return 45;
    case 'writing':
      return 50;
    case 'verifying':
      return 60;
    case 'critiquing':
      return 65 + share * 20;
    case 'judging':
      return 90;
    default:
      return 0;
  }
}

function stepLabel(progress: NonNullable<Report['progress']>, t: (typeof ACCOUNT_STRINGS)[Lang]): string {
  switch (progress.step) {
    case 'reading':
      return t.stepReading(progress.done ?? 0, progress.total ?? 1);
    case 'checking':
      return t.stepChecking;
    case 'writing':
      return t.stepWriting;
    case 'verifying':
      return t.stepVerifying;
    case 'critiquing':
      return t.stepCritiquing((progress.done ?? 0) + 1, progress.total ?? 1);
    case 'judging':
      return t.stepJudging;
    default:
      return t.writing;
  }
}

interface ChatView {
  chat: { id: string; title: string; messageCount: number; hasTranscript: boolean };
  unlocked: boolean;
  report: Report | null;
}

export default function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [lang, setLang] = useLang();
  const t = ACCOUNT_STRINGS[lang];
  const [view, setView] = useState<ChatView | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [reportLang, setReportLang] = useState<Lang | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/chats/${id}`).then(async (response) => {
      if (response.status === 401) return setError(ACCOUNT_STRINGS.en.signInFirst);
      if (!response.ok) return setError(t.notFound);
      const body = (await response.json()) as ChatView;
      setView(body);
      setReport(body.report);
    });
    // Loaded once per chat; the language toggle only changes the words.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Poll while a report is queued or running. The job runs on the server, one at a time.
  useEffect(() => {
    if (!report || (report.status !== 'queued' && report.status !== 'running')) return;
    const timer = setTimeout(async () => {
      const response = await fetch(`/api/reports/${report.id}`);
      const body = (await response.json()) as { report: Report };
      setReport(body.report);
    }, 3000);
    return () => clearTimeout(timer);
  }, [report]);

  async function unlock() {
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/chats/${id}/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier: 'chat_pass' }),
    });
    const body = (await response.json()) as { url?: string };
    if (!response.ok || !body.url) {
      setBusy(false);
      return setError(t.errCheckout);
    }
    window.location.href = body.url;
  }

  async function generate() {
    const language: Lang = reportLang ?? lang;
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/chats/${id}/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reportType: 'full_read', language }),
    });
    const body = (await response.json()) as { report?: Report; error?: string };
    setBusy(false);
    if (response.status === 402) return setError(t.unlockFirst);
    if (!response.ok || !body.report) return setError(body.error ?? t.errReport);
    setReport(body.report);
  }

  const reportLanguage: Lang = reportLang ?? lang;
  // A finished report stands on its own. A failed one can be tried again.
  const canGenerate = !report || report.status === 'failed';
  const arrow = lang === 'he' ? ACCOUNT_STRINGS.he.backArrow : ACCOUNT_STRINGS.en.backArrow;

  if (error && !view) return <main className="shell"><p className="error" role="alert">{error}</p></main>;
  if (!view) return <main className="shell"><p>{t.loading}</p></main>;

  return (
    <main className="shell">
      <div className="top">
        <Link href="/chats">{arrow} {t.back}</Link>
        <button type="button" className="link" onClick={() => setLang(lang === 'he' ? 'en' : 'he')}>
          {t.langSwitch}
        </button>
      </div>
      <h1>{view.chat.title}</h1>
      <p>{t.messages(view.chat.messageCount)}</p>

      {!view.unlocked && (
        <section className="card">
          <h2>{t.unlockTitle}</h2>
          <p>{t.unlockBody}</p>
          <div className="actions">
            <button type="button" className="primary" onClick={unlock} disabled={busy}>{t.unlockButton}</button>
          </div>
        </section>
      )}

      {view.unlocked && canGenerate && view.chat.hasTranscript && (
        <section className="card">
          <h2>{t.fullRead}</h2>
          <label>
            {t.reportLanguage}
            <select value={reportLanguage} onChange={(e) => setReportLang(e.target.value as Lang)}>
              <option value="he">עברית</option>
              <option value="en">English</option>
            </select>
          </label>
          <div className="actions">
            <button type="button" className="primary" onClick={generate} disabled={busy}>{t.generate}</button>
          </div>
        </section>
      )}

      {view.unlocked && canGenerate && !view.chat.hasTranscript && <p role="status">{t.deletedAfterReport}</p>}

      {report && (report.status === 'queued' || report.status === 'running') && (
        <section className="card" aria-live="polite">
          {report.status === 'queued' || !report.progress ? (
            <p role="status">{report.status === 'queued' ? t.queued : t.writing}</p>
          ) : (
            <>
              <p role="status">{stepLabel(report.progress, t)}</p>
              <div
                className="progress"
                role="progressbar"
                aria-label={t.progressLabel}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(percentOf(report.progress))}
              >
                <div style={{ width: `${percentOf(report.progress)}%` }} />
              </div>
            </>
          )}
        </section>
      )}

      {report?.status === 'failed' && (
        <p className="error" role="alert">
          {report.error === 'not_enough_cards' ? t.notEnoughCards : `${t.failed} ${report.error ?? ''}`}
        </p>
      )}

      {report?.status === 'care' && report.result?.summary && (
        <section className="card" aria-labelledby="care-h">
          <h2 id="care-h">{t.careTitle}</h2>
          <p>{report.result.summary}</p>
          {report.result.resources?.map((r) => <p key={r}>{r}</p>)}
        </section>
      )}

      {report?.status === 'stopped' && <p role="alert">{t.stopped}</p>}

      {report?.status === 'done' && report.result?.report && (
        <section className="card" aria-labelledby="report-h">
          <h2 id="report-h">{report.result.report.headline}</h2>
          {report.result.report.cards.map((card, i) => (
            <article className="card" key={i}>
              {card.kind === 'insight' && (
                <>
                  <p className="stat-title">{String(card.title)}</p>
                  <p className="stat-body">{String(card.body)}</p>
                  {typeof card.punchline === 'string' && <p className="stat-body">{card.punchline}</p>}
                </>
              )}
              {card.kind === 'stat' && <p className="stat-body">{String(card.caption)}</p>}
              {card.kind === 'award' && (
                <>
                  <p className="stat-title">{String(card.award)}: {String(card.winner)}</p>
                  <p className="stat-body">{String(card.citation)}</p>
                </>
              )}
              {card.kind === 'chart' && <p className="count">{String(card.chart)}</p>}
            </article>
          ))}
        </section>
      )}

      {error && <p className="error" role="alert">{error}</p>}
    </main>
  );
}

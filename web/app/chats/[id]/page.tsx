'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';

interface ReportCard {
  kind: string;
  [key: string]: unknown;
}

interface ReportResult {
  kind: 'report' | 'care' | 'stopped';
  report?: { headline: string; cards: ReportCard[] };
  summary?: string;
  resources?: string[];
  reason?: string;
}

interface Report {
  id: string;
  status: 'queued' | 'running' | 'done' | 'care' | 'stopped' | 'failed';
  result: ReportResult | null;
  error: string | null;
}

interface ChatView {
  chat: { id: string; title: string; messageCount: number; hasTranscript: boolean };
  unlocked: boolean;
}

export default function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [view, setView] = useState<ChatView | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/chats/${id}`).then(async (response) => {
      if (!response.ok) return setError(response.status === 401 ? 'Sign in first.' : 'Chat not found.');
      setView((await response.json()) as ChatView);
    });
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
    const body = (await response.json()) as { url?: string; error?: string };
    if (!response.ok || !body.url) {
      setBusy(false);
      return setError(body.error ?? 'Could not start checkout.');
    }
    window.location.href = body.url;
  }

  async function generate() {
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/chats/${id}/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reportType: 'full_read' }),
    });
    const body = (await response.json()) as { report?: Report; error?: string };
    setBusy(false);
    if (!response.ok || !body.report) return setError(body.error ?? 'Could not start the report.');
    setReport(body.report);
  }

  if (error && !view) return <main className="shell"><p className="error">{error}</p><Link href="/chats">Back</Link></main>;
  if (!view) return <main className="shell"><p>Loading...</p></main>;

  return (
    <main className="shell">
      <p><Link href="/chats">← Your chats</Link></p>
      <h1>{view.chat.title}</h1>
      <p>{view.chat.messageCount} messages</p>

      {!view.unlocked && (
        <section className="card">
          <h2>Unlock the full read</h2>
          <p>A Chat Pass gives you the full read of this chat, with every claim checked against the transcript.</p>
          <div className="actions">
            <button type="button" className="primary" onClick={unlock} disabled={busy}>Unlock with a Chat Pass</button>
          </div>
        </section>
      )}

      {view.unlocked && !report && view.chat.hasTranscript && (
        <section className="card">
          <h2>Full read</h2>
          <div className="actions">
            <button type="button" className="primary" onClick={generate} disabled={busy}>Generate the full read</button>
          </div>
        </section>
      )}

      {view.unlocked && !view.chat.hasTranscript && !report && (
        <p role="status">The chat was deleted after its report. Upload it again to make a new one.</p>
      )}

      {report && (report.status === 'queued' || report.status === 'running') && (
        <p role="status">Writing your report. This can take a few minutes on the free model tier.</p>
      )}

      {report?.status === 'failed' && <p className="error" role="alert">The report failed: {report.error}</p>}

      {report?.status === 'care' && report.result?.summary && (
        <section className="card" aria-labelledby="care-h">
          <h2 id="care-h">A note before the report</h2>
          <p>{report.result.summary}</p>
          {report.result.resources?.map((r) => <p key={r}>{r}</p>)}
        </section>
      )}

      {report?.status === 'stopped' && (
        <p role="alert">This chat cannot get a report.</p>
      )}

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

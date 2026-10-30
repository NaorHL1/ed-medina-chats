'use client';

import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { computeMetrics } from '@engine/metrics/index';
import { parseChat } from '@engine/parser/parse';
import { redactMessages, type RedactionCounts } from '@engine/redact';
import type { ParseResult } from '@engine/types';
import { formatDuration, formatNumber, formatPercent, type Lang } from '../lib/format';
import { APP_NAME, STRINGS } from '../lib/i18n';
import { buildVerdict, type Verdict } from '../lib/verdict';

type Phase = 'upload' | 'people' | 'verdict';

interface Speaker {
  name: string;
  messages: number;
}

function speakersOf(parsed: ParseResult): Speaker[] {
  const counts = new Map<string, number>();
  for (const m of parsed.messages) {
    if (m.sender !== null) counts.set(m.sender, (counts.get(m.sender) ?? 0) + 1);
  }
  return [...counts].map(([name, messages]) => ({ name, messages })).sort((a, b) => b.messages - a.messages);
}

/** Nicknames must be unique, or two people would merge into one in the metrics. */
function buildAliases(speakers: Speaker[], nicknames: Record<string, string>): Record<string, string> {
  const used = new Set<string>();
  const aliases: Record<string, string> = {};
  for (const { name } of speakers) {
    const wanted = nicknames[name]?.trim() || name;
    let alias = wanted;
    for (let n = 2; used.has(alias); n++) alias = `${wanted} ${n}`;
    used.add(alias);
    aliases[name] = alias;
  }
  return aliases;
}

export default function Home() {
  const [lang, setLang] = useState<Lang>('he');
  const [phase, setPhase] = useState<Phase>('upload');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [nicknames, setNicknames] = useState<Record<string, string>>({});
  const [verdict, setVerdict] = useState<{ data: Verdict; me: string | null; redaction: RedactionCounts } | null>(null);

  const t = STRINGS[lang];

  useEffect(() => {
    if (navigator.language && !navigator.language.toLowerCase().startsWith('he')) setLang('en');
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr';
  }, [lang]);

  const speakers = useMemo(() => (parsed ? speakersOf(parsed) : []), [parsed]);

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError(null);
    setStatus(null);

    if (file.name.toLowerCase().endsWith('.zip')) {
      setError(t.zipNote);
      return;
    }

    setBusy(true);
    try {
      const result = parseChat(await file.text());
      const found = speakersOf(result);
      if (found.length === 0) {
        setError(t.errEmpty);
        return;
      }
      setParsed(result);
      setMe(found[0]?.name ?? null);
      setNicknames({});
      setPhase('people');
    } catch {
      setError(t.errFormat);
    } finally {
      setBusy(false);
    }
  }

  function analyze() {
    if (!parsed) return;
    const aliases = buildAliases(speakers, nicknames);
    const { messages, counts } = redactMessages(parsed.messages, aliases);
    const data = buildVerdict(computeMetrics(messages));
    setVerdict({ data, me: me ? (aliases[me] ?? me) : null, redaction: counts });
    setPhase('verdict');
  }

  function clearAll() {
    setParsed(null);
    setVerdict(null);
    setMe(null);
    setNicknames({});
    setError(null);
    setPhase('upload');
    setStatus(t.cleared);
  }

  const who = (name: string) => (verdict?.me === name ? `${name} (${lang === 'he' ? 'אתם' : 'you'})` : name);

  return (
    <main className="shell">
      <div className="top">
        <span className="brand">{APP_NAME}</span>
        <button type="button" className="link" onClick={() => setLang(lang === 'he' ? 'en' : 'he')}>
          {t.langSwitch}
        </button>
      </div>

      <h1>{t.tagline}</h1>
      <p className="privacy">🔒 {t.privacy}</p>
      <p role="status" aria-live="polite" className="sr">{status}</p>

      {phase === 'upload' && (
        <section className="card" aria-labelledby="upload-h">
          <p className="step">{t.step(1, 3)}</p>
          <h2 id="upload-h">{t.uploadTitle}</h2>
          <p className="lead">{t.uploadHow}</p>
          <label className="drop">
            <input type="file" accept=".txt,.zip,text/plain" onChange={onFile} disabled={busy} />
            <strong>{busy ? t.reading : t.uploadDrop}</strong>
            <span>{t.uploadHint}</span>
          </label>
          {error && <p className="error" role="alert">{error}</p>}
        </section>
      )}

      {phase === 'people' && parsed && (
        <section className="card" aria-labelledby="people-h">
          <p className="step">{t.step(2, 3)}</p>
          <h2 id="people-h">{t.peopleTitle}</h2>
          <p className="lead">{t.peopleIntro}</p>
          <div role="radiogroup" aria-label={t.iAm}>
            {speakers.map((s) => (
              <div className="person" key={s.name}>
                <div className="person-head">
                  <span className="person-name">{s.name}</span>
                  <span className="count">{t.messagesCount(formatNumber(s.messages, lang))}</span>
                </div>
                <label className="radio">
                  <input type="radio" name="me" checked={me === s.name} onChange={() => setMe(s.name)} />
                  {t.iAm}
                </label>
                <input
                  type="text"
                  aria-label={`${t.nickname}: ${s.name}`}
                  placeholder={t.nickname}
                  value={nicknames[s.name] ?? ''}
                  onChange={(e) => setNicknames({ ...nicknames, [s.name]: e.target.value })}
                />
              </div>
            ))}
          </div>
          {parsed.warnings.length > 0 && (
            <div className="note">
              <strong>{t.warnings}:</strong>
              <ul>{parsed.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            </div>
          )}
          <div className="actions">
            <button type="button" className="primary" onClick={analyze}>{t.analyze}</button>
            <button type="button" onClick={clearAll}>{t.back}</button>
          </div>
        </section>
      )}

      {phase === 'verdict' && verdict && (
        <section aria-labelledby="verdict-h">
          <p className="step">{t.step(3, 3)}</p>
          <h2 id="verdict-h">{t.verdictTitle}</h2>
          <p className="lead">{t.verdictNote}</p>
          <p className="totals">
            {t.totals(formatNumber(verdict.data.totals.messages, lang), verdict.data.totals.people, verdict.data.totals.days)}
          </p>
          {verdict.redaction.phones + verdict.redaction.emails + verdict.redaction.numbers > 0 && (
            <p className="totals">
              {t.redacted(verdict.redaction.phones, verdict.redaction.emails, verdict.redaction.numbers)}
            </p>
          )}

          {verdict.data.initiation && (
            <article className="card">
              <p className="stat-title">{t.initiationTitle}</p>
              <p className="stat-body">
                {t.initiationBody(who(verdict.data.initiation.name), formatPercent(verdict.data.initiation.rate))}
              </p>
            </article>
          )}
          {verdict.data.reply && (
            <article className="card">
              <p className="stat-title">{t.replyTitle}</p>
              <p className="stat-body">
                {t.replyBody(
                  who(verdict.data.reply.fast.name),
                  formatDuration(verdict.data.reply.fast.ms, lang),
                  who(verdict.data.reply.slow.name),
                  formatDuration(verdict.data.reply.slow.ms, lang),
                )}
              </p>
            </article>
          )}
          {verdict.data.silence && (
            <article className="card">
              <p className="stat-title">{t.silenceTitle}</p>
              <p className="stat-body">
                {t.silenceBody(formatDuration(verdict.data.silence.ms, lang), who(verdict.data.silence.brokeBy))}
              </p>
            </article>
          )}
          {!verdict.data.initiation && !verdict.data.reply && !verdict.data.silence && (
            <article className="card"><p className="stat-body">{t.notEnough}</p></article>
          )}

          <article className="card">
            <p className="stat-title">{t.lockedTitle}</p>
            <ul className="locked">{t.locked.map((name) => <li key={name}>🔒 {name}</li>)}</ul>
            <p className="count">{t.lockedNote}</p>
          </article>

          <div className="actions">
            <button type="button" onClick={() => setPhase('people')}>{t.back}</button>
            <button type="button" className="link" onClick={clearAll}>{t.clear}</button>
          </div>
        </section>
      )}
    </main>
  );
}

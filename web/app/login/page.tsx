'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { ACCOUNT_STRINGS } from '../../lib/account-i18n';
import { useLang } from '../../lib/lang';

export default function Login() {
  const [lang, setLang] = useLang();
  const t = ACCOUNT_STRINGS[lang];
  const [email, setEmail] = useState('');
  const [adult, setAdult] = useState(false);
  const [next, setNext] = useState('/chats');
  const [expired, setExpired] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setNext(params.get('next') ?? '/chats');
    setExpired(params.get('expired') === '1');
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const response = await fetch('/api/auth/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, ageConfirmed: adult, next }),
    });
    if (response.ok) {
      setSent(true);
      return;
    }
    const body = (await response.json().catch(() => ({}))) as { code?: string };
    if (body.code === 'age_required') setError(t.errAge);
    else if (body.code === 'invalid_email') setError(t.errEmail);
    else setError(t.errGeneric);
  }

  return (
    <main className="shell">
      <div className="top">
        <span className="brand">Chat Report</span>
        <button type="button" className="link" onClick={() => setLang(lang === 'he' ? 'en' : 'he')}>
          {t.langSwitch}
        </button>
      </div>
      <h1>{t.loginTitle}</h1>
      {expired && <p className="error" role="alert">{t.expired}</p>}
      <form className="card" onSubmit={submit}>
        <label>
          {t.email}
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="radio">
          <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
          {t.adult}
        </label>
        <div className="actions">
          <button type="submit" className="primary" disabled={!adult || !email}>{t.sendLink}</button>
        </div>
        {sent && <p role="status">{t.linkSent}</p>}
        {error && <p className="error" role="alert">{error}</p>}
      </form>
    </main>
  );
}

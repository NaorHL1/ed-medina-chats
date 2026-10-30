'use client';

import { useState, type FormEvent } from 'react';

export default function Login() {
  const [email, setEmail] = useState('');
  const [adult, setAdult] = useState(false);
  const next = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('next') ?? '/chats' : '/chats';
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const response = await fetch('/api/auth/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, ageConfirmed: adult, next }),
    });
    const body = (await response.json()) as { status?: string; error?: string };
    if (!response.ok) setError(body.error ?? 'Something went wrong.');
    else setMessage('Check your email for a sign-in link. It works once and expires in 15 minutes.');
  }

  return (
    <main className="shell">
      <h1>Sign in</h1>
      <form className="card" onSubmit={submit}>
        <label>
          Email
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="radio">
          <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
          I am 18 or older
        </label>
        <div className="actions">
          <button type="submit" className="primary" disabled={!adult || !email}>Send sign-in link</button>
        </div>
        {message && <p role="status">{message}</p>}
        {error && <p className="error" role="alert">{error}</p>}
      </form>
    </main>
  );
}

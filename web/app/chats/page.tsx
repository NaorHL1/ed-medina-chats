'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ACCOUNT_STRINGS } from '../../lib/account-i18n';
import { useLang } from '../../lib/lang';

interface ChatRow {
  id: string;
  title: string;
  createdAt: number;
  messageCount: number;
  hasTranscript: boolean;
}

export default function Chats() {
  const [lang, setLang] = useLang();
  const t = ACCOUNT_STRINGS[lang];
  const [chats, setChats] = useState<ChatRow[] | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/chats').then(async (response) => {
      if (response.status === 401) return setSignedOut(true);
      const body = (await response.json()) as { chats: ChatRow[] };
      setChats(body.chats);
    });
  }, []);

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }

  async function deleteEverything() {
    if (!window.confirm(t.deleteConfirm)) return;
    const response = await fetch('/api/me', { method: 'DELETE' });
    if (response.ok) window.location.href = '/login';
    else setMessage(t.deleteError);
  }

  if (signedOut) {
    return (
      <main className="shell">
        <p><Link href="/login">{t.signIn}</Link> · {t.signInFirst}</p>
      </main>
    );
  }

  return (
    <main className="shell">
      <div className="top">
        <span className="brand">Chat Report</span>
        <button type="button" className="link" onClick={() => setLang(lang === 'he' ? 'en' : 'he')}>
          {t.langSwitch}
        </button>
      </div>
      <h1>{t.chatsTitle}</h1>
      <p><Link href="/">{t.uploadNew}</Link></p>
      {chats === null && <p>{t.loading}</p>}
      {chats?.length === 0 && <p>{t.noChats}</p>}
      <ul>
        {chats?.map((chat) => (
          <li key={chat.id}>
            <Link href={`/chats/${chat.id}`}>{chat.title}</Link> · {t.messages(chat.messageCount)}
          </li>
        ))}
      </ul>
      <div className="actions">
        <button type="button" onClick={signOut}>{t.signOut}</button>
        <button type="button" onClick={deleteEverything}>{t.deleteAll}</button>
      </div>
      {message && <p role="alert">{message}</p>}
    </main>
  );
}

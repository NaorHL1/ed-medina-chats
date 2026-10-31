'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ACCOUNT_STRINGS } from '../../lib/account-i18n';
import { api } from '../../lib/api';
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
  // A guest has no email, so signing out would leave their chats unreachable. Guests get no sign-out button.
  const [guest, setGuest] = useState(false);

  useEffect(() => {
    api<{ chats: ChatRow[] }>('/api/chats').then((result) => {
      if (result.status === 401) return setSignedOut(true);
      if (!result.ok || !result.data) return setMessage(t.loadError);
      setChats(result.data.chats);
    });
    api<{ user: { email: string | null } }>('/api/me').then((result) => setGuest(result.data?.user.email === null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function signOut() {
    await api('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }

  async function deleteEverything() {
    if (!window.confirm(t.deleteConfirm)) return;
    const result = await api('/api/me', { method: 'DELETE' });
    if (result.ok) window.location.href = guest ? '/' : '/login';
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
      {guest && <p className="count">{t.guestNote}</p>}
      <ul>
        {chats?.map((chat) => (
          <li key={chat.id}>
            <Link href={`/chats/${chat.id}`}>{chat.title}</Link> · {t.messages(chat.messageCount)}
          </li>
        ))}
      </ul>
      <div className="actions">
        {!guest && <button type="button" onClick={signOut}>{t.signOut}</button>}
        <button type="button" onClick={deleteEverything}>{t.deleteAll}</button>
      </div>
      {message && <p role="alert">{message}</p>}
    </main>
  );
}
